import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
	createApplicationShutdown,
	createDeferredApplicationShutdown,
	HTTP_DRAIN_TIMEOUT_MS,
	PROCESS_SHUTDOWN_TIMEOUT_MS,
	type ApplicationShutdownDependencies,
	type ClosableHttpServer,
} from './shutdown.ts'

function createDependencies(
	overrides: Partial<ApplicationShutdownDependencies> = {},
) {
	const httpServer: ClosableHttpServer = {
		listening: true,
		close(callback) {
			callback()
		},
		closeAllConnections: vi.fn(),
	}
	return {
		httpServer,
		closePrisma: vi.fn(),
		closeCache: vi.fn(),
		flushSentry: vi.fn(),
		...overrides,
	} satisfies ApplicationShutdownDependencies
}

afterEach(() => {
	vi.useRealTimers()
})

describe('application shutdown', () => {
	test('drains HTTP before closing every process resource', async () => {
		const events: string[] = []
		const dependencies = createDependencies({
			httpServer: {
				listening: true,
				close(callback) {
					events.push('http:start')
					events.push('http:closed')
					callback()
				},
				closeAllConnections: vi.fn(),
			},
			closePrisma: () => {
				events.push('prisma')
			},
			closeBackgroundTasks: () => {
				events.push('background')
			},
			closeCache: () => {
				events.push('cache')
			},
			flushSentry: () => {
				events.push('sentry')
			},
			closeVite: () => {
				events.push('vite')
			},
			closeMocks: () => {
				events.push('mocks')
			},
		})

		await createApplicationShutdown(dependencies)({})

		expect(events.slice(0, 2)).toEqual(['http:start', 'http:closed'])
		expect(new Set(events.slice(2, -1))).toEqual(
			new Set(['background', 'prisma', 'cache', 'vite', 'mocks']),
		)
		expect(events.at(-1)).toBe('sentry')
	})

	test('forces active HTTP connections closed after the drain deadline', async () => {
		vi.useFakeTimers()
		let closeCallback: ((error?: Error) => void) | undefined
		const closeAllConnections = vi.fn(() => closeCallback?.())
		const dependencies = createDependencies({
			httpServer: {
				listening: true,
				close(callback) {
					closeCallback = callback
				},
				closeAllConnections,
			},
		})
		const shutdown = createApplicationShutdown(dependencies)

		const result = shutdown({})
		await vi.advanceTimersByTimeAsync(HTTP_DRAIN_TIMEOUT_MS)
		await result

		expect(closeAllConnections).toHaveBeenCalledOnce()
		expect(dependencies.closePrisma).toHaveBeenCalledOnce()
	})

	test('attempts every cleanup and reports all failures', async () => {
		const events: string[] = []
		const closePrisma = vi.fn().mockRejectedValue(new Error('database failed'))
		const closeCache = vi.fn(() => {
			throw new Error('cache failed')
		})
		const flushSentry = vi.fn(() => {
			events.push('sentry')
		})
		const closeMocks = vi.fn()
		const onShutdownError = vi.fn(() => {
			events.push('report')
		})
		const shutdown = createApplicationShutdown(
			createDependencies({
				closePrisma,
				closeCache,
				flushSentry,
				closeMocks,
				onShutdownError,
			}),
		)

		await expect(shutdown({})).rejects.toMatchObject({
			errors: expect.arrayContaining([
				expect.objectContaining({ message: 'Prisma cleanup failed' }),
				expect.objectContaining({ message: 'cache cleanup failed' }),
			]),
		})
		expect(flushSentry).toHaveBeenCalledOnce()
		expect(closeMocks).toHaveBeenCalledOnce()
		expect(onShutdownError).toHaveBeenCalledOnce()
		expect(events).toEqual(['report', 'sentry'])
	})

	test('bounds individual resource cleanup before flushing Sentry', async () => {
		vi.useFakeTimers()
		const closeCache = vi.fn()
		const flushSentry = vi.fn()
		const shutdown = createApplicationShutdown(
			createDependencies({
				closePrisma: () => new Promise<void>(() => undefined),
				closeCache,
				flushSentry,
			}),
			{ resourceCleanupTimeoutMs: 5 },
		)

		const result = shutdown({})
		const rejection = expect(result).rejects.toMatchObject({
			errors: expect.arrayContaining([
				expect.objectContaining({ message: 'Prisma cleanup failed' }),
			]),
		})
		await vi.advanceTimersByTimeAsync(5)
		await rejection

		expect(closeCache).toHaveBeenCalledOnce()
		expect(flushSentry).toHaveBeenCalledOnce()
	})

	test('normalizes non-Error fatal rejections', async () => {
		const onFatalError = vi.fn()
		await createApplicationShutdown(createDependencies({ onFatalError }))({
			err: 'string rejection',
		})

		expect(onFatalError).toHaveBeenCalledWith(
			expect.objectContaining({
				name: 'Error',
				message: 'string rejection',
			}),
		)
	})

	test('forces a bounded cutoff and still cleans resources when close never settles', async () => {
		vi.useFakeTimers()
		const closeAllConnections = vi.fn()
		const dependencies = createDependencies({
			httpServer: {
				listening: true,
				close() {},
				closeAllConnections,
			},
		})
		const shutdown = createApplicationShutdown(dependencies, {
			httpDrainTimeoutMs: 5,
			httpForceCloseWaitMs: 5,
		})

		const result = shutdown({})
		const rejection = expect(result).rejects.toThrow(
			'Application shutdown completed',
		)
		await vi.advanceTimersByTimeAsync(10)

		await rejection
		expect(closeAllConnections).toHaveBeenCalledOnce()
		expect(dependencies.closeCache).toHaveBeenCalledOnce()
		expect(dependencies.flushSentry).toHaveBeenCalledOnce()
	})

	test('is idempotent when shutdown is requested more than once', async () => {
		let finishClose: (() => void) | undefined
		const closePrisma = vi.fn()
		const dependencies = createDependencies({
			httpServer: {
				listening: true,
				close(callback) {
					finishClose = () => callback()
				},
				closeAllConnections: vi.fn(),
			},
			closePrisma,
		})
		const shutdown = createApplicationShutdown(dependencies)

		const first = shutdown({})
		const second = shutdown({})
		expect(second).toBe(first)
		finishClose?.()
		await Promise.all([first, second])

		expect(closePrisma).toHaveBeenCalledOnce()
	})

	test('waits for the real coordinator when shutdown is requested during startup', async () => {
		const deferred = createDeferredApplicationShutdown()
		const coordinator = vi.fn()
		let settled = false

		const shutdown = deferred.shutdown({ signal: 'SIGTERM' }).then(() => {
			settled = true
		})
		await Promise.resolve()
		expect(settled).toBe(false)

		deferred.activate(coordinator)
		await shutdown
		expect(coordinator).toHaveBeenCalledWith({ signal: 'SIGTERM' })
	})

	test('routes an early shutdown through startup-failure cleanup', async () => {
		const deferred = createDeferredApplicationShutdown()
		const startupFailure = new Error('startup cleanup failed')
		const shutdown = deferred.shutdown({ signal: 'SIGTERM' })

		deferred.activate(() => Promise.reject(startupFailure))

		await expect(shutdown).rejects.toBe(startupFailure)
		expect(() => deferred.activate(vi.fn())).toThrow(
			'Application shutdown handler has already been activated.',
		)
	})

	test('keeps exactly one close-with-grace registration', () => {
		const files = [
			'index.js',
			'server/index.ts',
			'server/shutdown.ts',
			'tests/mocks/index.ts',
		]
		const registrations = files.flatMap(file => {
			const source = fs.readFileSync(path.join(process.cwd(), file), 'utf8')
			const count = source.match(/\bcloseWithGrace\s*\(/g)?.length ?? 0
			return Array.from({ length: count }, () => file)
		})

		expect(registrations).toEqual(['server/shutdown.ts'])
	})

	test('validates first and installs shutdown before importing the server', () => {
		const source = fs.readFileSync(path.join(process.cwd(), 'index.js'), 'utf8')
		const validation = source.indexOf('init()')
		const installation = source.indexOf('installApplicationShutdownHandler')
		const instrumentation = source.indexOf(
			"await import('./instrument.server.mjs')",
		)
		const serverImport = source.indexOf(
			"await import('./server-build/index.js')",
		)

		expect(validation).toBeGreaterThan(-1)
		expect(installation).toBeGreaterThan(validation)
		expect(instrumentation).toBeGreaterThan(installation)
		expect(serverImport).toBeGreaterThan(instrumentation)
	})

	test('gives direct PM2 execution more time than the app deadline', () => {
		const require = createRequire(import.meta.url)
		const config = require(
			path.join(process.cwd(), 'ecosystem.config.cjs'),
		) as {
			apps: Array<{
				name: string
				script: string
				interpreter?: string
				kill_timeout?: number
			}>
		}
		const app = config.apps.find(candidate => candidate.name === 'veud')

		expect(app).toMatchObject({
			script: 'scripts/pm2-entry.mjs',
			interpreter: 'node',
		})
		expect(app?.kill_timeout).toBeGreaterThan(PROCESS_SHUTDOWN_TIMEOUT_MS)
	})

	test('sets development mode before the clean-checkout dev launcher starts', () => {
		const packageJson = JSON.parse(
			fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'),
		) as { scripts: Record<string, string> }

		expect(packageJson.scripts.dev).toMatch(
			/^cross-env NODE_ENV=development node \.\/server\/dev-server\.js$/,
		)
	})
})
