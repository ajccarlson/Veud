import { expect, test } from 'vitest'
import {
	buildClientErrorReport,
	createClientErrorReporter,
	initializeClientMonitoring,
	reportablePath,
} from './monitoring.client.ts'

const production = { MODE: 'production', VEUD_RELEASE: 'abc123' }

function collector() {
	const reports: unknown[] = []
	return { reports, send: (report: unknown) => reports.push(report) }
}

test('a report carries the message, stack, path and release', () => {
	const error = new Error('Cannot read properties of null')
	error.stack = 'Error: boom\n    at Grid (watchlist.js:12:9)'
	expect(
		buildClientErrorReport(error, {
			url: '/lists/me/anime',
			release: 'abc123',
		}),
	).toEqual({
		message: 'Cannot read properties of null',
		stack: 'Error: boom\n    at Grid (watchlist.js:12:9)',
		url: '/lists/me/anime',
		release: 'abc123',
	})
})

test('an error with nothing to say is not reported', () => {
	expect(buildClientErrorReport(new Error('   '))).toBeNull()
	expect(buildClientErrorReport('')).toBeNull()
	expect(buildClientErrorReport(null)).toBeNull()
	expect(buildClientErrorReport({ message: 'not an error' })).toBeNull()
})

test('a thrown string still reports', () => {
	// Browsers deliver plenty of failures that are not Error instances.
	expect(buildClientErrorReport('Script error.')).toMatchObject({
		message: 'Script error.',
		stack: null,
	})
})

test('long messages and stacks are bounded', () => {
	const error = new Error('m'.repeat(900))
	error.stack = 's'.repeat(9_000)
	const report = buildClientErrorReport(error)
	expect(report?.message).toHaveLength(500)
	expect(report?.stack).toHaveLength(4_000)
})

test('only the path travels, never the query or fragment', () => {
	// A query string carries search terms and filters, which are the viewer's
	// business and are not needed to locate a crash.
	expect(reportablePath('https://veud.example/discover?q=frieren#top')).toBe(
		'/discover',
	)
	expect(reportablePath('/lists/me/anime?sort=score')).toBe('/lists/me/anime')
	expect(reportablePath(undefined)).toBe('')
	// The guarantee is the shape, not the content: whatever goes in, what comes
	// out is a path with no origin, query, or fragment attached.
	for (const href of [
		'::not a url::',
		'https://elsewhere.example/x?y=1#z',
		'/a?b=c#d',
	]) {
		const path = reportablePath(href)
		expect(path.startsWith('/')).toBe(true)
		expect(path).not.toContain('?')
		expect(path).not.toContain('#')
		expect(path).not.toContain('elsewhere.example')
	}
})

test('nothing is reported outside production', () => {
	const { reports, send } = collector()
	const reporter = createClientErrorReporter({ MODE: 'development' }, { send })
	reporter.report(new Error('boom'))
	expect(reports).toEqual([])
	expect(reporter.reportCount()).toBe(0)
})

test('the same failure is reported once, however often it repeats', () => {
	// A render loop throws every frame and says nothing new after the first.
	const { reports, send } = collector()
	const reporter = createClientErrorReporter(production, { send })
	for (let index = 0; index < 20; index++) {
		const error = new Error('same failure')
		error.stack = 'identical stack'
		reporter.report(error)
	}
	expect(reports).toHaveLength(1)
})

test('a crashing page cannot flood the endpoint', () => {
	const { reports, send } = collector()
	const reporter = createClientErrorReporter(production, { send })
	for (let index = 0; index < 20; index++) {
		reporter.report(new Error(`distinct failure ${index}`))
	}
	expect(reports).toHaveLength(5)
	expect(reporter.reportCount()).toBe(5)
})

test('global listeners catch what React never sees', () => {
	const handlers: Record<string, (event: unknown) => void> = {}
	const target = {
		addEventListener: (name: string, handler: (event: unknown) => void) => {
			handlers[name] = handler
		},
	}
	const reporter = initializeClientMonitoring(
		production,
		target as never,
		() => 'https://veud.example/discover?q=secret',
	)
	expect(reporter).not.toBeNull()
	expect(Object.keys(handlers).sort()).toEqual(['error', 'unhandledrejection'])

	handlers.error?.({ error: new Error('uncaught') })
	handlers.unhandledrejection?.({ reason: new Error('rejected') })
	expect(reporter?.reportCount()).toBe(2)
})

test('an error event with only a message still reports', () => {
	const handlers: Record<string, (event: unknown) => void> = {}
	const target = {
		addEventListener: (name: string, handler: (event: unknown) => void) => {
			handlers[name] = handler
		},
	}
	const reporter = initializeClientMonitoring(
		production,
		target as never,
		() => '/',
	)
	handlers.error?.({ message: 'Script error.' })
	expect(reporter?.reportCount()).toBe(1)
})

test('no listeners are installed outside production', () => {
	let installed = 0
	const target = { addEventListener: () => installed++ }
	expect(
		initializeClientMonitoring(
			{ MODE: 'development' },
			target as never,
			() => '/',
		),
	).toBeNull()
	expect(installed).toBe(0)
})

test('a crash is attributed to the route the visitor is on, not where they landed', () => {
	// This is a client-routed app, so the document survives navigation. Capturing
	// the URL at install time pinned every report to the landing page — and since
	// this reporter carries no breadcrumbs, that path is the only location signal
	// a report has, so triage would point at the wrong route entirely.
	const { reports, send } = collector()
	let here = 'https://veud.example/'
	const reporter = createClientErrorReporter(production, {
		send,
		href: () => here,
	})

	reporter.report(new Error('crash on the home page'))
	expect((reports[0] as { url: string }).url).toBe('/')

	// The visitor navigates without the document reloading.
	here = 'https://veud.example/lists/me/anime?sort=score'
	reporter.report(new Error('crash on the grid'))
	expect((reports[1] as { url: string }).url).toBe('/lists/me/anime')
})
