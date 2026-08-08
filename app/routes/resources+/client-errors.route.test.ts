import { beforeEach, expect, test } from 'vitest'
import { consoleError } from '#tests/setup/setup-test-env.ts'
import { BASE_URL } from '#tests/utils.ts'
import { action } from './client-errors.ts'

// The endpoint logs every accepted report on purpose: a browser crash should
// appear in the server log next to the server's own errors.
beforeEach(() => {
	consoleError.mockImplementation(() => {})
})

async function statusOf(body: unknown, method = 'POST') {
	const response = (await post(body, method)) as
		Response | { init?: { status?: number } }
	return response instanceof Response
		? response.status
		: (response.init?.status ?? 200)
}

function post(body: unknown, method = 'POST') {
	return action({
		request: new Request(`${BASE_URL}/resources/client-errors`, {
			method,
			headers: { 'content-type': 'application/json' },
			body: method === 'POST' ? JSON.stringify(body) : undefined,
		}),
		params: {},
	} as any)
}

test('a browser crash is accepted with nothing said back', async () => {
	// A browser that just crashed has no use for a body.
	expect(
		await statusOf({
			message: 'Cannot read properties of null',
			stack: 'Error: boom\n    at Grid (watchlist.js:1:1)',
			url: '/lists/me/anime',
			release: 'abc123',
		}),
	).toBe(204)
})

test('a report with no message is refused', async () => {
	expect(await statusOf({ message: '' })).toBe(400)
	expect(await statusOf({ message: '   ' })).toBe(400)
	expect(await statusOf({})).toBe(400)
})

test('a full URL is refused, so no origin or query can be smuggled in', async () => {
	// The client sends a path. Anything else is either a bug or an attempt to
	// put a viewer's search terms into the error log.
	expect(
		await statusOf({
			message: 'x',
			url: 'https://veud.example/discover?q=secret',
		}),
	).toBe(400)
	expect(await statusOf({ message: 'x', url: '/discover' })).toBe(204)
	expect(await statusOf({ message: 'x', url: '' })).toBe(204)
})

test('oversized reports are refused rather than truncated silently', async () => {
	expect(await statusOf({ message: 'm'.repeat(501) })).toBe(400)
	expect(await statusOf({ message: 'ok', stack: 's'.repeat(4_001) })).toBe(400)
})

test('a body that is not JSON is refused', async () => {
	const response = (await action({
		request: new Request(`${BASE_URL}/resources/client-errors`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: 'not json',
		}),
		params: {},
	} as any)) as { init?: { status?: number } }
	expect(response.init?.status).toBe(400)
})

test('the endpoint only accepts posts', async () => {
	const response = (await post(undefined, 'GET')) as {
		init?: { status: number }
	}
	expect(response.init?.status).toBe(405)
})

test('an oversized body is refused before it is parsed', async () => {
	// Nothing upstream limits the body — the Express adapter passes the raw
	// stream through and no body-parser is installed — so without this the
	// endpoint buffers whatever an unauthenticated caller sends.
	const huge = JSON.stringify({ message: 'x', stack: 's'.repeat(200_000) })
	const response = (await action({
		request: new Request(`${BASE_URL}/resources/client-errors`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: huge,
		}),
		params: {},
	} as any)) as { init?: { status?: number } }
	expect(response.init?.status).toBe(413)
})

test('a lying Content-Length does not get the body past the cap', async () => {
	// The header is the sender's claim, and a chunked request carries none.
	const huge = JSON.stringify({ message: 'x', stack: 's'.repeat(200_000) })
	const request = new Request(`${BASE_URL}/resources/client-errors`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: huge,
	})
	request.headers.delete('content-length')
	const response = (await action({ request, params: {} } as any)) as {
		init?: { status?: number }
	}
	expect(response.init?.status).toBe(413)
})

test('a normal report is still accepted', async () => {
	expect(
		await statusOf({ message: 'ordinary', stack: 'at Grid', url: '/discover' }),
	).toBe(204)
})

test('a declared oversized length is refused without reading the body', async () => {
	// Distinguishes the header check from the post-read cap: the body here is
	// tiny, so only a check that trusts the declaration can reject it.
	const request = new Request(`${BASE_URL}/resources/client-errors`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ message: 'small' }),
	})
	request.headers.set('content-length', String(50 * 1024 * 1024))
	const response = (await action({ request, params: {} } as any)) as {
		init?: { status?: number }
	}
	expect(response.init?.status).toBe(413)
})
