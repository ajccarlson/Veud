import { createHash } from 'node:crypto'
import { type LoaderFunctionArgs } from 'react-router'
import { cache, cachified } from '#app/utils/cache.server.ts'

/**
 * Server-side fetch proxy for the narrow public catalog requests still made by
 * the browser (TMDB, MyAnimeList, and one AniList schedule query).
 *
 * SECURITY NOTE
 * -------------
 * This endpoint previously fetched an arbitrary, client-supplied `url` and attached
 * secrets chosen by a client-supplied `authorization` string. That allowed two
 * critical attacks:
 *   1. SSRF — the server would fetch ANY URL (internal services, cloud metadata, etc.)
 *      and return the body to the caller.
 *   2. Credential theft — pointing `url` at an attacker-controlled host while passing
 *      e.g. `authorization=trakt` caused the server to send the real Trakt token to
 *      that host.
 *
 * It now:
 *   - only fetches HTTPS URLs and path/method combinations Veud uses,
 *   - derives which credential to attach from the validated destination host, never
 *     from a client parameter, so a secret can only ever be sent to the host it
 *     belongs to (closes the credential theft),
 *   - reconstructs the sole allowed AniList query from a validated numeric MAL id,
 *   - never exposes Trakt access tokens through this public route,
 *   - ignores any client-supplied throttle value (closes a timer-based DoS),
 *   - returns generic errors and logs details server-side (no internal leakage).
 *
 * The `authorization` query param that callers still send is now IGNORED — the
 * destination host is authoritative. No caller changes are required.
 *
 * This route is intentionally NOT behind requireUserId: the public home page fetches
 * trending/upcoming through it client-side. The allowlist + host-derived credentials
 * fully close the SSRF and credential-theft issues regardless of authentication. To
 * additionally prevent anonymous relay/quota abuse, move trending server-side and gate
 * this route (roadmap item 0.1, option 1) and/or add response caching (roadmap 5.1).
 */

// Only these hosts may be contacted, and each maps to the credentials it — and only
// it — is allowed to receive.
const ALLOWED_HOSTS = new Set([
	'api.themoviedb.org',
	'api.myanimelist.net',
	'graphql.anilist.co',
])

const MAX_URL_LENGTH = 2_048
const MAX_BODY_LENGTH = 10_000
const ANILIST_SCHEDULE_QUERY = `
	query ($id: Int) {
		Media (idMal: $id, type: ANIME) {
			nextAiringEpisode { airingAt episode mediaId }
			streamingEpisodes { title thumbnail url site }
			duration
			coverImage { extraLarge large medium color }
		}
	}
`

function permittedPath(target: URL, method: string) {
	if (target.hostname === 'graphql.anilist.co') {
		return method === 'POST' && target.pathname === '/'
	}
	if (method !== 'GET') return false
	if (target.hostname === 'api.themoviedb.org') {
		return [
			/^\/3\/search\/(movie|tv|person|multi)$/,
			/^\/3\/collection\/\d+$/,
			/^\/3\/(movie|tv|person)\/\d+$/,
			/^\/3\/tv\/\d+\/content_ratings$/,
			/^\/3\/movie\/\d+\/release_dates$/,
			/^\/3\/find\/[a-z0-9_-]+$/i,
			/^\/3\/trending\/(movie|tv|person|all)\/(day|week)$/,
		].some(pattern => pattern.test(target.pathname))
	}
	if (target.hostname === 'api.myanimelist.net') {
		return [
			/^\/v2\/(anime|manga)$/,
			/^\/v2\/(anime|manga)\/\d+$/,
			/^\/v2\/(anime|manga)\/ranking$/,
			/^\/v2\/anime\/season\/\d{4}\/(winter|spring|summer|fall)$/,
		].some(pattern => pattern.test(target.pathname))
	}
	return false
}

function boundedProviderQuery(target: URL) {
	const limit = target.searchParams.get('limit')
	const page = target.searchParams.get('page')
	if (limit && (!/^\d{1,3}$/.test(limit) || Number(limit) > 100)) return false
	if (page && (!/^\d{1,3}$/.test(page) || Number(page) > 500)) return false
	return true
}

function sanitizedBody(host: string, rawBody: string | null) {
	if (host !== 'graphql.anilist.co') return undefined
	if (!rawBody || rawBody.length > MAX_BODY_LENGTH) return null
	try {
		const payload = JSON.parse(rawBody) as {
			variables?: { id?: unknown }
		}
		const id = payload.variables?.id
		if (!Number.isSafeInteger(id) || Number(id) <= 0) return null
		return JSON.stringify({
			query: ANILIST_SCHEDULE_QUERY,
			variables: { id },
		})
	} catch {
		return null
	}
}

// Per-host, server-side rate limiting toward upstream APIs, using each provider's published
// limits. A token bucket is acquired only on a cache MISS (inside getFreshValue below), so
// cached responses are served instantly and only real upstream calls are throttled. This
// supersedes the old client-supplied `sleepTime` (a timer-based DoS vector) and the cruder
// post-fetch delay it had become.
//
// Published limits: TMDB removed its public rate limit in 2023 (no bucket); AniList allows
// 90 req/min plus an undocumented burst limiter; Trakt allows 1000 GET/5min (~3.3/s);
// MyAnimeList publishes no hard number, so it is kept deliberately conservative.
class TokenBucket {
	private tokens: number
	private lastRefill: number
	constructor(
		private readonly ratePerSec: number,
		private readonly capacity: number,
	) {
		this.tokens = capacity
		this.lastRefill = Date.now()
	}
	async acquire(): Promise<void> {
		const now = Date.now()
		this.tokens = Math.min(
			this.capacity,
			this.tokens + ((now - this.lastRefill) / 1000) * this.ratePerSec,
		)
		this.lastRefill = now
		if (this.tokens >= 1) {
			this.tokens -= 1
			return
		}
		// Not enough credit yet — wait for a token to accrue, then re-check.
		const waitMs = ((1 - this.tokens) / this.ratePerSec) * 1000
		await new Promise(resolve => setTimeout(resolve, waitMs))
		return this.acquire()
	}
}

// null = no rate limiting (TMDB). Buckets are module-level, so the limit is shared across all
// requests in this (single-instance) process.
const RATE_LIMITERS: Record<string, TokenBucket | null> = {
	'api.themoviedb.org': null,
	'api.myanimelist.net': new TokenBucket(1, 5),
	'graphql.anilist.co': new TokenBucket(1.5, 10),
}

const HOUR = 1000 * 60 * 60
const DAY = HOUR * 24

type CachedProviderResponse = {
	__veudProviderCache: 1
	observedAt: string
	data: unknown
}

function isCachedProviderResponse(
	value: unknown,
): value is CachedProviderResponse {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false
	const candidate = value as Record<string, unknown>
	return (
		candidate.__veudProviderCache === 1 &&
		typeof candidate.observedAt === 'string' &&
		Number.isFinite(new Date(candidate.observedAt).getTime()) &&
		'data' in candidate
	)
}

// Cache TTLs. "Now" data (trending / seasonal / airing schedules) changes daily; title and
// search details change rarely. `swr` serves stale while revalidating in the background.
// Keyed off the request path/query/body so it covers both REST and AniList's single-endpoint
// GraphQL (whose query text carries the "season"/"airing" signal).
function cacheTtlFor(
	target: URL,
	body: string | undefined,
): { ttl: number; swr: number } {
	const haystack = `${target.pathname}${target.search}${body ?? ''}`
	if (/trending|season|schedule|airing|calendar/i.test(haystack)) {
		return { ttl: 6 * HOUR, swr: DAY }
	}
	return { ttl: DAY, swr: 7 * DAY }
}

function hashKey(input: string): string {
	return createHash('sha1').update(input).digest('hex')
}

/**
 * Build the outgoing headers for a validated host. Secrets are read here, keyed by host,
 * so a given credential is only ever attached to requests going to its own provider.
 */
function buildHeadersForHost(host: string) {
	const headers: Record<string, string> = { 'Content-Type': 'application/json' }

	switch (host) {
		case 'api.themoviedb.org': {
			const key = process.env.TMDB_API_KEY
			if (key) headers['Authorization'] = `Bearer ${key}`
			break
		}
		case 'api.myanimelist.net': {
			const clientId = process.env.MAL_CLIENT_ID
			if (clientId) headers['X-MAL-CLIENT-ID'] = clientId
			break
		}
		case 'graphql.anilist.co': {
			// AniList's public GraphQL endpoint needs no credentials.
			break
		}
	}

	return headers
}

export async function loader({ params }: LoaderFunctionArgs) {
	const searchParams = new URLSearchParams(params.request)

	// 1) Validate the destination: a well-formed HTTPS URL on an allowed host.
	const rawUrl = searchParams.get('url')
	if (!rawUrl) {
		throw new Response('Missing url', { status: 400 })
	}
	if (rawUrl.length > MAX_URL_LENGTH) {
		throw new Response('URL not permitted', { status: 400 })
	}

	let target
	try {
		target = new URL(rawUrl)
	} catch {
		throw new Response('Invalid url', { status: 400 })
	}

	if (target.protocol !== 'https:' || !ALLOWED_HOSTS.has(target.hostname)) {
		// Refuse to fetch arbitrary/internal URLs.
		throw new Response('URL not permitted', { status: 400 })
	}

	// 2) Validate the HTTP method and provider-specific path.
	const method = (searchParams.get('fetchMethod') ?? 'GET').toUpperCase()
	if (!permittedPath(target, method) || !boundedProviderQuery(target)) {
		throw new Response('Provider request not permitted', { status: 400 })
	}

	// 3) Credentials are derived from the validated host, never from a client param.
	const headers = buildHeadersForHost(target.hostname)

	const options: RequestInit = { method, headers, redirect: 'error' }
	const fetchBody = sanitizedBody(
		target.hostname,
		searchParams.get('fetchBody'),
	)
	if (method === 'POST') {
		if (!fetchBody) {
			throw new Response('Provider request not permitted', { status: 400 })
		}
		options.body = fetchBody
	}

	// 4) Perform the upstream request — cached (so repeat views don't re-hit the provider)
	//    and rate-limited on a cache miss. Details are logged server-side; the client only
	//    ever sees a generic status.
	const isTest = process.env.NODE_ENV === 'test'

	// Fetch fresh from upstream, rate-limited per host. Factored out so it can run either
	// directly (tests) or as cachified's getFreshValue (production).
	const fetchUpstream = async (
		markUncacheable?: () => void,
	): Promise<CachedProviderResponse> => {
		const limiter = RATE_LIMITERS[target.hostname]
		if (limiter && !isTest) await limiter.acquire()
		const response = await fetch(target.toString(), options)
		const json = await response.json()
		if (!response.ok) markUncacheable?.() // never cache an upstream error body
		return {
			__veudProviderCache: 1,
			observedAt: new Date().toISOString(),
			data: json,
		}
	}

	const bodyForKey = typeof options.body === 'string' ? options.body : undefined
	const { ttl, swr } = cacheTtlFor(target, bodyForKey)

	let cached: unknown
	try {
		// The shared SQLite cache + module-level rate limiter are bypassed under test so the
		// security tests stay deterministic and never read or write the real cache DB.
		cached = isTest
			? await fetchUpstream()
			: await cachified({
					key: `media:${method}:${target.toString()}${bodyForKey ? `:${hashKey(bodyForKey)}` : ''}`,
					cache,
					ttl,
					swr,
					getFreshValue: context =>
						fetchUpstream(() => {
							context.metadata.ttl = 0
						}),
				})
	} catch (error) {
		console.error(
			`[media proxy] upstream request to ${target.hostname} failed:`,
			error,
		)
		throw new Response('Upstream request failed', { status: 502 })
	}

	// Keep the existing two-element response contract, but use the formerly empty
	// metadata slot to expose the actual upstream observation time. Older raw cache
	// values remain readable during the envelope rollout and expire normally.
	const providerResponse = isCachedProviderResponse(cached)
		? cached
		: {
				__veudProviderCache: 1 as const,
				observedAt: new Date().toISOString(),
				data: cached,
			}
	return [{ observedAt: providerResponse.observedAt }, providerResponse.data]
}
