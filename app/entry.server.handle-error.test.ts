import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { handleError } from './entry.server.tsx'
import {
	getRuntimeOperationsSnapshot,
	resetOperationsStateForTest,
} from './utils/operations-observability.server.ts'

beforeEach(() => {
	resetOperationsStateForTest()
	vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
	vi.restoreAllMocks()
	resetOperationsStateForTest()
})

function argsFor(url: string, init: RequestInit = {}) {
	return {
		request: new Request(url, init),
		params: {},
		context: {} as never,
	}
}

function recentErrors() {
	return getRuntimeOperationsSnapshot().recentErrors
}

test('a loader failure reaches the operations dashboard', () => {
	// These never touch the Express error middleware, which was the only thing
	// recording operational errors, so most application 5xx went uncounted.
	handleError(
		new Error('loader exploded'),
		argsFor('https://veud.example/lists/me/anime') as never,
	)
	const errors = recentErrors()
	expect(errors).toHaveLength(1)
	expect(errors[0]).toMatchObject({
		method: 'GET',
		path: '/lists/me/anime',
		status: 500,
		message: 'loader exploded',
	})
})

test('an action failure is recorded with its method', () => {
	handleError(
		new Error('action exploded'),
		argsFor('https://veud.example/resources/quick-track', {
			method: 'POST',
		}) as never,
	)
	expect(recentErrors()[0]).toMatchObject({
		method: 'POST',
		path: '/resources/quick-track',
	})
})

test('a client that navigated away is not counted as a server fault', () => {
	const controller = new AbortController()
	controller.abort()
	handleError(
		new Error('aborted'),
		argsFor('https://veud.example/discover', {
			signal: controller.signal,
		}) as never,
	)
	expect(recentErrors()).toHaveLength(0)
})

test('a query string never lands in the error log', () => {
	handleError(
		new Error('boom'),
		argsFor('https://veud.example/discover?q=private+search') as never,
	)
	expect(recentErrors()[0]?.path).toBe('/discover')
})
