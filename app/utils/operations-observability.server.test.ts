import { afterEach, expect, test, vi } from 'vitest'
import {
	beginObservedRequest,
	createRequestId,
	expressErrorStatus,
	getRuntimeOperationsSnapshot,
	isHealthSampledPath,
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
	expect(
		expressErrorStatus(
			new TypeError(
				'Content-Type was not one of "multipart/form-data" or "application/x-www-form-urlencoded".',
			),
		),
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

test('assets and healthchecks do not get a vote on service health', () => {
	// They are numerous and uniformly fast, so including them pulls the p95
	// toward their latency and hides the pages people actually wait on.
	resetOperationsStateForTest()
	for (const path of [
		'/resources/healthcheck',
		'/assets/app-abc123.js',
		'/favicons/icon.png',
		'/img/poster.webp',
	]) {
		expect(isHealthSampledPath(path)).toBe(false)
		beginObservedRequest(path)(200)
	}
	const quiet = getRuntimeOperationsSnapshot()
	// They still count as traffic...
	expect(quiet.requests.completed).toBe(4)
	// ...but contribute nothing to the health sample.
	expect(quiet.requests.sampleSize).toBe(0)

	expect(isHealthSampledPath('/lists/me/anime')).toBe(true)
	beginObservedRequest('/lists/me/anime')(200)
	expect(getRuntimeOperationsSnapshot().requests.sampleSize).toBe(1)
})

test('the error rate describes now, not since boot', () => {
	// A burst of failures at start-up used to keep the service "critical" for
	// as long as it stayed up, because the rate was cumulative while the p95 it
	// sat beside was a rolling window.
	resetOperationsStateForTest()
	for (let index = 0; index < 10; index++) {
		beginObservedRequest('/discover')(500)
	}
	expect(getRuntimeOperationsSnapshot().requests.errorRatePercent).toBe(100)

	for (let index = 0; index < 990; index++) {
		beginObservedRequest('/discover')(200)
	}
	const snapshot = getRuntimeOperationsSnapshot()
	// The failures have aged out of the window entirely.
	expect(snapshot.requests.errorRatePercent).toBe(0)
	// The lifetime figure still remembers them, which is a different question.
	expect(snapshot.requests.lifetimeErrorRatePercent).toBeGreaterThan(0)
})

test('a current outage is not diluted by a long healthy history', () => {
	resetOperationsStateForTest()
	for (let index = 0; index < 400; index++) {
		beginObservedRequest('/discover')(200)
	}
	for (let index = 0; index < 100; index++) {
		beginObservedRequest('/discover')(500)
	}
	const snapshot = getRuntimeOperationsSnapshot()
	expect(snapshot.requests.errorRatePercent).toBe(20)
	expect(snapshot.requests.lifetimeErrorRatePercent).toBe(20)

	// Another 500 healthy requests and the window has moved on, while the
	// lifetime figure has barely shifted.
	for (let index = 0; index < 500; index++) {
		beginObservedRequest('/discover')(200)
	}
	const later = getRuntimeOperationsSnapshot()
	expect(later.requests.errorRatePercent).toBe(0)
	expect(later.requests.lifetimeErrorRatePercent).toBeGreaterThan(0)
})

test('client errors are not service failures', () => {
	// A 404 is someone asking for a page that does not exist. Counting those
	// would make the service look unhealthy for as long as anyone mistypes a
	// URL, which is permanently.
	resetOperationsStateForTest()
	for (let index = 0; index < 50; index++) {
		beginObservedRequest('/lists/missing')(404)
	}
	beginObservedRequest('/discover')(403)
	beginObservedRequest('/discover')(422)
	const snapshot = getRuntimeOperationsSnapshot()
	expect(snapshot.requests.errorRatePercent).toBe(0)
	expect(snapshot.requests.lifetimeErrorRatePercent).toBe(0)
	expect(snapshot.requests.statuses['4xx']).toBe(52)

	// A single 500 among them does register.
	beginObservedRequest('/discover')(500)
	expect(
		getRuntimeOperationsSnapshot().requests.errorRatePercent,
	).toBeGreaterThan(0)
})
