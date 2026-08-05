/**
 * Browser crash reporting.
 *
 * `GeneralErrorBoundary` has always called `captureException`, but nothing ever
 * initialized a client, so every one of those calls was a no-op and every
 * browser crash went unrecorded. The server has reported its errors since
 * `instrument.server.mjs`; this is the other half.
 *
 * It reports to this application rather than loading Sentry's browser SDK,
 * which measured 180 KiB gzipped — carrying tracing, session replay and user
 * feedback, none of which are used here. That is a large payload for every
 * visitor to answer one question, in a codebase that has an open entry for
 * trimming payloads. Errors are posted to `/resources/client-errors` and
 * forwarded from the server, where a Sentry client already exists, so
 * everything still lands in one place.
 *
 * What this gives up is real and worth naming: stack symbolication,
 * breadcrumbs, and release health. If those become worth 180 KiB, the endpoint
 * stays and the SDK goes back in front of it.
 */

export const CLIENT_ERROR_ENDPOINT = '/resources/client-errors'

/**
 * A crashing page can crash repeatedly — a render loop reports every frame.
 * Enough to see the problem, not enough to be the problem.
 */
const MAX_REPORTS_PER_PAGE = 5

/** Long enough for any real stack; past this it is noise. */
const MAX_STACK_LENGTH = 4_000
const MAX_MESSAGE_LENGTH = 500

export type ClientErrorReport = {
	message: string
	stack: string | null
	url: string
	release: string | null
}

/** The message and stack worth sending, or null when there is nothing to say. */
export function buildClientErrorReport(
	error: unknown,
	context: { url?: string; release?: string | null } = {},
): ClientErrorReport | null {
	const message =
		error instanceof Error
			? error.message
			: typeof error === 'string'
				? error
				: ''
	const trimmed = message.trim()
	if (!trimmed) return null
	return {
		message: trimmed.slice(0, MAX_MESSAGE_LENGTH),
		stack:
			error instanceof Error && typeof error.stack === 'string'
				? error.stack.slice(0, MAX_STACK_LENGTH)
				: null,
		url: context.url ?? '',
		release: context.release ?? null,
	}
}

/**
 * Strip everything but the path.
 *
 * A query string carries search terms and filters, which are the viewer's
 * business and are not needed to locate a crash.
 */
export function reportablePath(href: string | undefined) {
	if (!href) return ''
	try {
		return new URL(href, 'https://veud.invalid').pathname
	} catch {
		return ''
	}
}

export type ClientErrorReporter = {
	report(error: unknown): void
	reportCount(): number
}

/**
 * A reporter that throttles, deduplicates, and never reports outside
 * production, where a crash is already in front of the person who caused it.
 */
export function createClientErrorReporter(
	env: { MODE?: string; VEUD_RELEASE?: string } | undefined,
	options: {
		send?: (report: ClientErrorReport) => void
		href?: string
	} = {},
): ClientErrorReporter {
	const enabled = env?.MODE === 'production'
	const release = env?.VEUD_RELEASE ?? null
	const seen = new Set<string>()
	let sent = 0

	const send =
		options.send ??
		((report: ClientErrorReport) => {
			// keepalive so a report survives the navigation a crash often triggers;
			// no credentials so no session cookie rides along with it.
			void fetch(CLIENT_ERROR_ENDPOINT, {
				method: 'POST',
				credentials: 'omit',
				keepalive: true,
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(report),
			}).catch(() => {})
		})

	return {
		reportCount: () => sent,
		report(error: unknown) {
			if (!enabled || sent >= MAX_REPORTS_PER_PAGE) return
			const report = buildClientErrorReport(error, {
				url: reportablePath(options.href),
				release,
			})
			if (!report) return
			// One report per distinct failure. A loop throwing the same error every
			// frame says nothing new after the first.
			const key = `${report.message}::${report.stack ?? ''}`
			if (seen.has(key)) return
			seen.add(key)
			sent++
			send(report)
		},
	}
}

let activeReporter: ClientErrorReporter | null = null

/** Hand over an error React caught, which `window.onerror` never sees. */
export function reportClientError(error: unknown) {
	activeReporter?.report(error)
}

/** Install the global listeners. Called once, from the client entry. */
export function initializeClientMonitoring(
	env: { MODE?: string; VEUD_RELEASE?: string } | undefined,
	target: Pick<Window, 'addEventListener'> | undefined = globalThis.window,
	href: string | undefined = globalThis.location?.href,
) {
	if (env?.MODE !== 'production' || !target?.addEventListener) return null
	const reporter = createClientErrorReporter(env, { href })
	activeReporter = reporter
	target.addEventListener('error', event => {
		const errorEvent = event as ErrorEvent
		reporter.report(errorEvent.error ?? errorEvent.message)
	})
	target.addEventListener('unhandledrejection', event => {
		reporter.report((event as PromiseRejectionEvent).reason)
	})
	return reporter
}
