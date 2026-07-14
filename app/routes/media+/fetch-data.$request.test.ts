/**
 * Security regression tests for the media proxy
 * (app/routes/media+/fetch-data.$request.jsx).
 *
 * These lock in the 0.1 hardening. The proxy must:
 *   (a) refuse any URL that isn't HTTPS on an allow-listed host  -> closes SSRF
 *   (b) attach only the credentials belonging to the *validated destination host*,
 *       never anything the client asks for                       -> closes credential theft
 *
 * If a future change reopens either hole, one of these fails.
 *
 * NOTE: these were written but not executed in the environment that authored them
 * (the shared test setup boots a better-sqlite3 test DB that couldn't build there).
 * Run with `npm run test` and adjust if anything drifts.
 */
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { consoleError } from '#tests/setup/setup-test-env.ts'
import { loader } from './fetch-data.$request.jsx'

function jsonResponse(body: unknown) {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { 'Content-Type': 'application/json' },
	})
}

// Invoke the loader the way Remix would: params.request carries the query string.
function callLoader(request: string) {
	return loader({ params: { request } } as any)
}

// helper: run the loader and return whatever it threw/returned
function callAndCatch(request: string) {
	return callLoader(request).catch((e: unknown) => e)
}

let fetchMock: any

beforeEach(() => {
	// Real, host-derived credentials the proxy should attach — set here so we can prove
	// each one only ever reaches its own provider.
	vi.stubEnv('TMDB_API_KEY', 'tmdb-secret')
	vi.stubEnv('MAL_CLIENT_ID', 'mal-client-id')
	vi.stubEnv('TRAKT_API_KEY', 'trakt-key')
	vi.stubEnv('TRAKT_ACCESS_TOKEN_MAIN', 'trakt-main-token')
	fetchMock = vi
		.spyOn(globalThis, 'fetch')
		.mockResolvedValue(jsonResponse({ ok: true }))
})

afterEach(() => {
	vi.unstubAllEnvs()
})

// ---- SSRF: only HTTPS + allow-listed hosts are ever contacted ----

test('rejects a URL on a non-allow-listed host and makes no request', async () => {
	const res = await callAndCatch(
		'url=' + encodeURIComponent('https://evil.example.com/steal'),
	)
	expect(res).toBeInstanceOf(Response)
	expect((res as Response).status).toBe(400)
	expect(fetchMock).not.toHaveBeenCalled()
})

test('rejects a non-HTTPS URL even on an allowed host', async () => {
	const res = await callAndCatch(
		'url=' + encodeURIComponent('http://api.themoviedb.org/3/movie/1'),
	)
	expect((res as Response).status).toBe(400)
	expect(fetchMock).not.toHaveBeenCalled()
})

test('rejects a malformed URL', async () => {
	const res = await callAndCatch('url=' + encodeURIComponent('not a url'))
	expect((res as Response).status).toBe(400)
	expect(fetchMock).not.toHaveBeenCalled()
})

test('rejects a missing URL', async () => {
	const res = await callAndCatch('fetchMethod=GET')
	expect((res as Response).status).toBe(400)
	expect(fetchMock).not.toHaveBeenCalled()
})

test('rejects a disallowed HTTP method', async () => {
	const res = await callAndCatch(
		'url=' +
			encodeURIComponent('https://api.themoviedb.org/3/movie/1') +
			'&fetchMethod=DELETE',
	)
	expect((res as Response).status).toBe(400)
	expect(fetchMock).not.toHaveBeenCalled()
})

// ---- Credential theft: creds are host-derived, never client-chosen ----

test('attaches the destination host\u2019s own credentials and ignores a client "authorization" param', async () => {
	// The client tries to trick the proxy into sending Trakt creds via authorization=trakt.
	await callLoader(
		'url=' +
			encodeURIComponent('https://api.themoviedb.org/3/movie/1') +
			'&authorization=trakt',
	)
	expect(fetchMock).toHaveBeenCalledTimes(1)
	const [calledUrl, init] = fetchMock.mock.calls[0]
	expect(calledUrl).toBe('https://api.themoviedb.org/3/movie/1')
	const headers = (init?.headers ?? {}) as Record<string, string>
	// TMDB gets its own bearer token...
	expect(headers['Authorization']).toBe('Bearer tmdb-secret')
	// ...and none of Trakt's credentials leak across, despite the client's param.
	expect(headers['trakt-api-key']).toBeUndefined()
	expect(headers['trakt-api-version']).toBeUndefined()
})

test('sends Trakt-only credentials to Trakt (per-host isolation)', async () => {
	await callLoader('url=' + encodeURIComponent('https://api.trakt.tv/users/me'))
	const [, init] = fetchMock.mock.calls[0]
	const headers = (init?.headers ?? {}) as Record<string, string>
	expect(headers['trakt-api-key']).toBe('trakt-key')
	expect(headers['Authorization']).toBe('Bearer trakt-main-token')
	// The TMDB secret must not ride along to Trakt.
	expect(headers['Authorization']).not.toBe('Bearer tmdb-secret')
})

test('sends the MAL client-id header to MyAnimeList', async () => {
	await callLoader(
		'url=' +
			encodeURIComponent('https://api.myanimelist.net/v2/anime/1'),
	)
	const [, init] = fetchMock.mock.calls[0]
	const headers = (init?.headers ?? {}) as Record<string, string>
	expect(headers['X-MAL-CLIENT-ID']).toBe('mal-client-id')
})

// ---- Upstream failures surface as a generic 502; details stay server-side ----

test('maps an upstream failure to a generic 502', async () => {
	consoleError.mockImplementation(() => {}) // expected: the proxy logs the real error
	fetchMock.mockRejectedValueOnce(new Error('network down'))
	const res = await callAndCatch(
		'url=' + encodeURIComponent('https://api.themoviedb.org/3/movie/1'),
	)
	expect((res as Response).status).toBe(502)
})
