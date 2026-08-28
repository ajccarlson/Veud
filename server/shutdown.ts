import closeWithGrace from 'close-with-grace'

export const HTTP_DRAIN_TIMEOUT_MS = 6_000
export const HTTP_FORCE_CLOSE_WAIT_MS = 500
export const RESOURCE_CLEANUP_TIMEOUT_MS = 2_000
export const SENTRY_FLUSH_TIMEOUT_MS = 2_000
export const PROCESS_SHUTDOWN_TIMEOUT_MS = 12_000

type MaybePromise = void | Promise<void>

export type ShutdownReason = {
	err?: unknown
	signal?: closeWithGrace.Signals
	manual?: boolean
}

export type ApplicationShutdown = (reason: ShutdownReason) => MaybePromise

export type ClosableHttpServer = {
	listening: boolean
	close(callback: (error?: Error) => void): unknown
	closeAllConnections(): void
}

type NamedCloser = {
	name: string
	close: () => MaybePromise
}

export type ApplicationShutdownDependencies = {
	httpServer: ClosableHttpServer
	closeBackgroundTasks?: () => MaybePromise
	closePrisma: () => MaybePromise
	closeCache: () => MaybePromise
	flushSentry: () => MaybePromise
	closeVite?: () => MaybePromise
	closeMocks?: () => MaybePromise
	onFatalError?: (error: Error) => MaybePromise
	onShutdownError?: (error: AggregateError) => MaybePromise
}

export type ApplicationShutdownOptions = {
	httpDrainTimeoutMs?: number
	httpForceCloseWaitMs?: number
	resourceCleanupTimeoutMs?: number
	sentryFlushTimeoutMs?: number
}

export function createDeferredApplicationShutdown() {
	let activateHandler: (handler: ApplicationShutdown) => void = () => undefined
	let activated = false
	const handlerReady = new Promise<ApplicationShutdown>(resolve => {
		activateHandler = resolve
	})

	return {
		shutdown(reason: ShutdownReason) {
			return handlerReady.then(handler => handler(reason))
		},
		activate(handler: ApplicationShutdown) {
			if (activated) {
				throw new Error(
					'Application shutdown handler has already been activated.',
				)
			}
			activated = true
			activateHandler(handler)
		},
	}
}

function raceWithTimeout<Value>(promise: Promise<Value>, milliseconds: number) {
	return new Promise<
		{ status: 'settled'; value: Value } | { status: 'timeout' }
	>(resolve => {
		const timer = setTimeout(() => resolve({ status: 'timeout' }), milliseconds)
		void promise.then(value => {
			clearTimeout(timer)
			resolve({ status: 'settled', value })
		})
	})
}

function cleanupError(name: string, cause: unknown) {
	return new Error(`${name} cleanup failed`, { cause })
}

function normalizeError(error: unknown) {
	return error instanceof Error ? error : new Error(String(error))
}

async function closeHttpServer(
	server: ClosableHttpServer,
	{
		drainTimeoutMs,
		forceCloseWaitMs,
	}: {
		drainTimeoutMs: number
		forceCloseWaitMs: number
	},
) {
	if (!server.listening) return

	const closeResult = new Promise<
		{ status: 'closed' } | { status: 'error'; error: unknown }
	>(resolve => {
		try {
			server.close(error => {
				resolve(error ? { status: 'error', error } : { status: 'closed' })
			})
		} catch (error) {
			resolve({ status: 'error', error })
		}
	})

	const gracefulRace = await raceWithTimeout(closeResult, drainTimeoutMs)
	if (gracefulRace.status === 'settled') {
		if (gracefulRace.value.status === 'closed') return
		throw gracefulRace.value.error
	}

	server.closeAllConnections()
	const forcedRace = await raceWithTimeout(closeResult, forceCloseWaitMs)
	if (forcedRace.status === 'settled') {
		if (forcedRace.value.status === 'closed') return
		throw forcedRace.value.error
	}

	throw new Error(
		`HTTP server did not close within ${drainTimeoutMs + forceCloseWaitMs}ms`,
	)
}

async function closeWithTimeout(
	closer: NamedCloser,
	timeoutMs: number,
): Promise<Error | null> {
	const result = Promise.resolve()
		.then(closer.close)
		.then(
			() => ({ status: 'closed' as const }),
			error => ({ status: 'error' as const, error }),
		)
	const race = await raceWithTimeout(result, timeoutMs)
	if (race.status === 'timeout') {
		return cleanupError(
			closer.name,
			new Error(`Timed out after ${timeoutMs}ms`),
		)
	}
	if (race.value.status === 'error') {
		return cleanupError(closer.name, race.value.error)
	}
	return null
}

export function createApplicationShutdown(
	dependencies: ApplicationShutdownDependencies,
	options: ApplicationShutdownOptions = {},
) {
	const httpDrainTimeoutMs = options.httpDrainTimeoutMs ?? HTTP_DRAIN_TIMEOUT_MS
	const httpForceCloseWaitMs =
		options.httpForceCloseWaitMs ?? HTTP_FORCE_CLOSE_WAIT_MS
	const resourceCleanupTimeoutMs =
		options.resourceCleanupTimeoutMs ?? RESOURCE_CLEANUP_TIMEOUT_MS
	const sentryFlushTimeoutMs =
		options.sentryFlushTimeoutMs ?? SENTRY_FLUSH_TIMEOUT_MS
	let shutdownPromise: Promise<void> | undefined

	async function run(reason: ShutdownReason) {
		const errors: Error[] = []

		if (reason.err && dependencies.onFatalError) {
			try {
				await dependencies.onFatalError(normalizeError(reason.err))
			} catch (error) {
				errors.push(cleanupError('Fatal error reporting', error))
			}
		}

		try {
			await closeHttpServer(dependencies.httpServer, {
				drainTimeoutMs: httpDrainTimeoutMs,
				forceCloseWaitMs: httpForceCloseWaitMs,
			})
		} catch (error) {
			errors.push(cleanupError('HTTP server', error))
		}

		const closers: NamedCloser[] = [
			...(dependencies.closeBackgroundTasks
				? ([
						{
							name: 'background tasks',
							close: dependencies.closeBackgroundTasks,
						},
					] as NamedCloser[])
				: []),
			{ name: 'Prisma', close: dependencies.closePrisma },
			{ name: 'cache', close: dependencies.closeCache },
		]
		if (dependencies.closeVite) {
			closers.push({ name: 'Vite', close: dependencies.closeVite })
		}
		if (dependencies.closeMocks) {
			closers.push({ name: 'mock server', close: dependencies.closeMocks })
		}

		const cleanupErrors = await Promise.all(
			closers.map(closer => closeWithTimeout(closer, resourceCleanupTimeoutMs)),
		)
		errors.push(
			...cleanupErrors.filter((error): error is Error => Boolean(error)),
		)

		if (errors.length && dependencies.onShutdownError) {
			try {
				await dependencies.onShutdownError(
					new AggregateError(errors, 'Application resource cleanup failed'),
				)
			} catch (error) {
				errors.push(cleanupError('Shutdown error reporting', error))
			}
		}

		const sentryError = await closeWithTimeout(
			{ name: 'Sentry', close: dependencies.flushSentry },
			sentryFlushTimeoutMs,
		)
		if (sentryError) errors.push(sentryError)

		if (errors.length) {
			throw new AggregateError(
				errors,
				`Application shutdown completed with ${errors.length} error${
					errors.length === 1 ? '' : 's'
				}`,
			)
		}
	}

	return (reason: ShutdownReason) => {
		shutdownPromise ??= run(reason)
		return shutdownPromise
	}
}

export function installApplicationShutdownHandler(
	shutdown: ApplicationShutdown,
) {
	return closeWithGrace(
		{
			delay: PROCESS_SHUTDOWN_TIMEOUT_MS,
			onTimeout(delay) {
				console.error(`Application shutdown exceeded ${delay}ms`)
			},
		},
		shutdown,
	)
}
