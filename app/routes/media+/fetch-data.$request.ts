import { createHash } from 'node:crypto'
<<<<<<< HEAD
import { type LoaderFunctionArgs } from '@remix-run/node'
=======
import { type LoaderFunctionArgs } from 'react-router'
>>>>>>> develop
import { cache, cachified } from '#app/utils/cache.server.ts'

/**
 * Server-side fetch proxy for third-party media APIs
 * (TMDB, MyAnimeList, AniList, Trakt).
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
 *   - only fetches HTTPS URLs whose host is in ALLOWED_HOSTS (closes the SSRF),
 *   - derives which credential to attach from the validated destination host, never
 *     from a client parameter, so a secret can only ever be sent to the host it
 *     belongs to (closes the credential theft),
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
	'api.trakt.tv',
])

const ALLOWED_METHODS = new Set(['GET', 'POST'])

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
	'api.trakt.tv': new TokenBucket(3, 30),
}

const HOUR = 1000 * 60 * 60
const DAY = HOUR * 24

// Cache TTLs. "Now" data (trending / seasonal / airing schedules) changes daily; title and
// search details change rarely. `swr` serves stale while revalidating in the background.
// Keyed off the request path/query/body so it covers both REST and AniList's single-endpoint
// GraphQL (whose query text carries the "season"/"airing" signal).
function cacheTtlFor(target: URL, body: string | undefined): { ttl: number; swr: number } {
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
function buildHeadersForHost(host: string, searchParams: URLSearchParams) {
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
		case 'api.trakt.tv': {
			const traktKey = process.env.TRAKT_API_KEY
			if (traktKey) {
				headers['trakt-api-version'] = '2'
				headers['trakt-api-key'] = traktKey
			}
			// main vs. backup token selection is safe here because the host is already
			// validated as Trakt — the token can only be sent to Trakt either way.
			const useBackup =
				(searchParams.get('traktToken') ?? '').toLowerCase() === 'backup'
			const token = useBackup
				? process.env.TRAKT_ACCESS_TOKEN_BACKUP
				: process.env.TRAKT_ACCESS_TOKEN_MAIN
			if (token) headers['Authorization'] = `Bearer ${token}`
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

	// 2) Validate the HTTP method.
	const method = (searchParams.get('fetchMethod') ?? 'GET').toUpperCase()
	if (!ALLOWED_METHODS.has(method)) {
		throw new Response('Method not permitted', { status: 400 })
	}

	// 3) Credentials are derived from the validated host, never from a client param.
	const headers = buildHeadersForHost(target.hostname, searchParams)

	const options: RequestInit = { method, headers }
	const fetchBody = searchParams.get('fetchBody')
	if (method === 'POST' && fetchBody && fetchBody !== 'undefined') {
		options.body = fetchBody
	}

	// 4) Perform the upstream request — cached (so repeat views don't re-hit the provider)
	//    and rate-limited on a cache miss. Details are logged server-side; the client only
	//    ever sees a generic status.
	const isTest = process.env.NODE_ENV === 'test'

	// Fetch fresh from upstream, rate-limited per host. Factored out so it can run either
	// directly (tests) or as cachified's getFreshValue (production).
	const fetchUpstream = async (markUncacheable?: () => void): Promise<any> => {
		const limiter = RATE_LIMITERS[target.hostname]
		if (limiter && !isTest) await limiter.acquire()
		const response = await fetch(target.toString(), options)
		const json = await response.json()
		if (!response.ok) markUncacheable?.() // never cache an upstream error body
		return json
	}

	const bodyForKey = typeof options.body === 'string' ? options.body : undefined
	const { ttl, swr } = cacheTtlFor(target, bodyForKey)

	let data: any
	try {
		// The shared SQLite cache + module-level rate limiter are bypassed under test so the
		// security tests stay deterministic and never read or write the real cache DB.
		data = isTest
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

	// Preserve the existing response contract for callers: a 2-element array whose first
	// element they merge-and-discard (a fetch Response serializes to {} over the wire), so we
	// return {} in its place on both cache hits and misses.
	return [{}, data]
}
