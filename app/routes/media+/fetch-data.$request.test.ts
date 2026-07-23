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
import { loader } from './fetch-data.$request.ts'

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

test('never exposes Trakt through the public media relay', async () => {
	const res = await callAndCatch(
		'url=' + encodeURIComponent('https://api.trakt.tv/users/me'),
	)
	expect((res as Response).status).toBe(400)
	expect(fetchMock).not.toHaveBeenCalled()
})

test('sends the MAL client-id header to MyAnimeList', async () => {
	await callLoader(
		'url=' + encodeURIComponent('https://api.myanimelist.net/v2/anime/1'),
	)
	const [, init] = fetchMock.mock.calls[0]
	const headers = (init?.headers ?? {}) as Record<string, string>
	expect(headers['X-MAL-CLIENT-ID']).toBe('mal-client-id')
})

test('rejects unused provider paths, mutations, and oversized result requests', async () => {
	for (const request of [
		'url=' +
			encodeURIComponent(
				'https://api.themoviedb.org/3/authentication/token/new',
			),
		'url=' + encodeURIComponent('https://api.myanimelist.net/v2/users/@me'),
		'url=' +
			encodeURIComponent(
				'https://api.myanimelist.net/v2/anime/ranking?limit=500',
			),
		'url=' +
			encodeURIComponent('https://api.themoviedb.org/3/movie/1') +
			'&fetchMethod=POST',
	]) {
		const res = await callAndCatch(request)
		expect((res as Response).status).toBe(400)
	}
	expect(fetchMock).not.toHaveBeenCalled()
})

test('reconstructs the only allowed AniList schedule query from a numeric MAL id', async () => {
	await callLoader(
		'url=' +
			encodeURIComponent('https://graphql.anilist.co') +
			'&fetchMethod=POST&fetchBody=' +
			encodeURIComponent(
				JSON.stringify({
					query: 'mutation { DeleteUser { deleted } }',
					variables: { id: 123 },
				}),
			),
	)
	const [calledUrl, init] = fetchMock.mock.calls[0]
	expect(calledUrl).toBe('https://graphql.anilist.co/')
	const body = JSON.parse(String(init?.body)) as {
		query: string
		variables: { id: number }
	}
	expect(body.variables).toEqual({ id: 123 })
	expect(body.query).toContain('nextAiringEpisode')
	expect(body.query).not.toContain('DeleteUser')
})

test('rejects an AniList request without a safe numeric MAL id', async () => {
	const res = await callAndCatch(
		'url=' +
			encodeURIComponent('https://graphql.anilist.co') +
			'&fetchMethod=POST&fetchBody=' +
			encodeURIComponent(JSON.stringify({ variables: { id: '../secret' } })),
	)
	expect((res as Response).status).toBe(400)
	expect(fetchMock).not.toHaveBeenCalled()
})

test('returns the upstream observation time in the proxy metadata slot', async () => {
	const before = Date.now()
	const result = await callLoader(
		'url=' + encodeURIComponent('https://api.themoviedb.org/3/movie/1'),
	)
	const after = Date.now()
	const metadata = result[0] as { observedAt: string }
	const observedAt = new Date(metadata.observedAt).getTime()

	expect(observedAt).toBeGreaterThanOrEqual(before)
	expect(observedAt).toBeLessThanOrEqual(after)
	expect(result[1]).toEqual({ ok: true })
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
