import { type LoaderFunctionArgs } from '@remix-run/node'

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

// Per-host, server-controlled politeness delay toward upstream APIs (ms). Not
// client-controllable (a client-supplied value was previously a trivial way to tie up
// server request timers).
//
// TMDB removed its public rate limit in 2023, so it needs no delay. This matters for UX:
// the home page fires a large batch of TMDB requests through this proxy, and delaying
// every response by 1.5s held the browser's limited (~6) connection pool open long enough
// that client-side navigation away from the home page appeared to hang until the backlog
// drained. Zeroing TMDB's delay lets that backlog clear quickly. The genuinely
// rate-limited providers (MAL / AniList / Trakt) keep a throttle.
const UPSTREAM_DELAY_MS: Record<string, number> = {
	'api.themoviedb.org': 0,
	'api.myanimelist.net': 1500,
	'graphql.anilist.co': 1500,
	'api.trakt.tv': 1500,
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

	// 4) Perform the upstream request. Details are logged server-side; the client only
	//    ever sees a generic status.
	let response: any, data: any
	try {
		response = await fetch(target.toString(), options)
		data = await response.json()
	} catch (error) {
		console.error(
			`[media proxy] upstream request to ${target.hostname} failed:`,
			error,
		)
		throw new Response('Upstream request failed', { status: 502 })
	}

	// Per-host server-side politeness delay (not client-controlled).
	const delayMs = UPSTREAM_DELAY_MS[target.hostname] ?? 0
	if (delayMs > 0) {
		await new Promise(resolve => setTimeout(resolve, delayMs))
	}

	// Preserve the existing response contract for callers.
	return [response, data]
}
