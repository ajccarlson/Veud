import { afterEach, expect, test, vi } from 'vitest'
import {
	beginObservedRequest,
	createRequestId,
	expressErrorStatus,
	getRuntimeOperationsSnapshot,
	recordOperationalError,
	releaseMetadata,
	resetOperationsStateForTest,
	safeRequestPath,
	writeStructuredLog,
} from './operations-observability.server.ts'

afterEach(() => {
	vi.unstubAllEnvs()
	resetOperationsStateForTest()
})

test('records bounded request latency, statuses, and errors without query data', () => {
	resetOperationsStateForTest()
	const finish = beginObservedRequest()
	expect(finish(503)).toBeGreaterThanOrEqual(0)
	expect(finish(200)).toBe(0)
	recordOperationalError({
		requestId: 'request-1',
		method: 'POST',
		path: '/login?password=never-log-this',
		status: 503,
		error: new Error('Database unavailable'),
	})

	const snapshot = getRuntimeOperationsSnapshot()
	expect(snapshot.requests).toEqual(
		expect.objectContaining({
			total: 1,
			completed: 1,
			inFlight: 0,
			statuses: expect.objectContaining({ '5xx': 1 }),
			errorRatePercent: 100,
			sampleSize: 1,
		}),
	)
	expect(snapshot.recentErrors[0]).toEqual(
		expect.objectContaining({
			requestId: 'request-1',
			path: '/login',
			message: 'Database unavailable',
		}),
	)
	expect(JSON.stringify(snapshot)).not.toContain('never-log-this')
})

test('uses explicit release metadata and produces UUID request identifiers', () => {
	vi.stubEnv('VEUD_RELEASE', 'release-123')
	vi.stubEnv('VEUD_ENVIRONMENT', 'staging')
	expect(releaseMetadata()).toEqual({
		release: 'release-123',
		environment: 'staging',
	})
	expect(createRequestId()).toMatch(
		/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
	)
	expect(safeRequestPath('%%%')).toBe('/%%%')
	expect(
		expressErrorStatus(Object.assign(new Error('bad body'), { status: 400 })),
	).toBe(400)
	expect(expressErrorStatus(new TypeError('programmer error'))).toBe(500)
})

test('redacts secret-like fields and query strings in captured errors', () => {
	recordOperationalError({
		requestId: 'request-3',
		method: 'GET',
		path: '/callback?code=private-code',
		status: 500,
		error: new Error(
			'failed at https://example.com/callback?token=private password=hunter2',
		),
	})
	const [error] = getRuntimeOperationsSnapshot().recentErrors
	expect(error?.path).toBe('/callback')
	expect(error?.message).toContain('callback?[redacted]')
	expect(error?.message).toContain('password=[redacted]')
	expect(error?.message).not.toContain('private')
	expect(error?.message).not.toContain('hunter2')
})

test('emits one-line JSON operational logs', () => {
	const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
	writeStructuredLog('info', 'request.completed', {
		requestId: 'request-2',
		status: 204,
	})
	const line = String(info.mock.calls[0]?.[0])
	expect(JSON.parse(line)).toEqual(
		expect.objectContaining({
			level: 'info',
			event: 'request.completed',
			requestId: 'request-2',
			status: 204,
		}),
	)
	expect(line).not.toContain('\n')
})
