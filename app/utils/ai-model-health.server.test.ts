import { afterEach, expect, test, vi } from 'vitest'
import {
	configuredAiModels,
	probeConfiguredAiModels,
	shouldStartAiModelHealthMonitor,
	startAiModelHealthMonitor,
} from './ai-model-health.server.ts'

function environment(
	overrides: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
	return {
		OPENAI_API_KEY: 'private-provider-key',
		OPENAI_DEFAULT_MODEL: 'shared-model',
		...overrides,
	} as NodeJS.ProcessEnv
}

function modelResponse(
	model: string,
	shutdownDate: string | null = null,
	status = 200,
) {
	return new Response(
		JSON.stringify(
			status === 200
				? {
						id: model,
						object: 'model',
						created: 1,
						owned_by: 'provider',
						shutdown_date: shutdownDate,
					}
				: { error: { code: model, message: 'private provider detail' } },
		),
		{ status, headers: { 'content-type': 'application/json' } },
	)
}

afterEach(() => {
	vi.useRealTimers()
})

test('starts only in a real production runtime', () => {
	expect(shouldStartAiModelHealthMonitor('production', false)).toBe(true)
	expect(shouldStartAiModelHealthMonitor('production', true)).toBe(false)
	expect(shouldStartAiModelHealthMonitor('development', false)).toBe(false)
	expect(shouldStartAiModelHealthMonitor('test', false)).toBe(false)
})

test('deduplicates enabled capability models and includes the moderation classifier', () => {
	const models = configuredAiModels(
		environment({
			OPENAI_REVIEW_ASSISTANCE_MODEL: 'review-model',
			VEUD_AI_IMAGE_TIP_OF_TONGUE_ENABLED: 'false',
		}),
	)

	expect(models).toEqual([
		{
			model: 'omni-moderation-latest',
			consumers: ['moderation-classifier'],
		},
		{ model: 'review-model', consumers: ['review-assistance'] },
		{
			model: 'shared-model',
			consumers: [
				'tip-of-tongue',
				'natural-language-discovery',
				'discovery-refinement',
				'tracking-command',
				'import-reconciliation',
				'moderation-triage',
			],
		},
	])
	expect(configuredAiModels(environment({ VEUD_AI_ENABLED: 'false' }))).toEqual(
		[],
	)
})

test('retrieves unique model metadata without sending user content', async () => {
	const now = Date.parse('2026-09-15T12:00:00.000Z')
	const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
		const model = decodeURIComponent(String(url).split('/').at(-1) ?? '')
		expect(init).toEqual(
			expect.objectContaining({
				method: 'GET',
				headers: { Authorization: 'Bearer private-provider-key' },
			}),
		)
		expect(init?.body).toBeUndefined()
		return modelResponse(
			model === 'shared-model' ? 'canonical-shared-model' : model,
			model === 'review-model' ? '2026-10-01' : null,
		)
	})

	const results = await probeConfiguredAiModels({
		environment: environment({
			OPENAI_REVIEW_ASSISTANCE_MODEL: 'review-model',
			VEUD_AI_MODERATION_TRIAGE_ENABLED: 'false',
		}),
		fetchImpl,
		now,
	})

	expect(fetchImpl).toHaveBeenCalledTimes(2)
	expect(results).toEqual([
		expect.objectContaining({
			model: 'review-model',
			status: 'shutdown-announced',
			shutdownDate: '2026-10-01',
			daysUntilShutdown: 16,
			actionRequired: true,
		}),
		expect.objectContaining({
			model: 'shared-model',
			status: 'available',
			resolvedModel: 'canonical-shared-model',
			shutdownDate: null,
			actionRequired: false,
		}),
	])
})

test('returns bounded unavailable diagnostics without retaining provider bodies or keys', async () => {
	const fetchImpl = vi.fn<typeof fetch>(async () =>
		modelResponse('model_not_found', null, 404),
	)
	const results = await probeConfiguredAiModels({
		environment: environment({
			VEUD_AI_MODERATION_TRIAGE_ENABLED: 'false',
		}),
		fetchImpl,
	})

	expect(results).toEqual([
		expect.objectContaining({
			model: 'shared-model',
			status: 'unavailable',
			httpStatus: 404,
			providerCode: 'model_not_found',
			actionRequired: true,
		}),
	])
	const serialized = JSON.stringify(results)
	expect(serialized).not.toContain('private provider detail')
	expect(serialized).not.toContain('private-provider-key')
})

test('classifies transport failures without retaining their messages', async () => {
	const fetchImpl = vi.fn<typeof fetch>(async () => {
		throw new Error('private proxy path and credentials')
	})
	const results = await probeConfiguredAiModels({
		environment: environment({
			VEUD_AI_MODERATION_TRIAGE_ENABLED: 'false',
		}),
		fetchImpl,
	})

	expect(results).toEqual([
		expect.objectContaining({
			status: 'unavailable',
			httpStatus: null,
			providerCode: null,
			actionRequired: true,
		}),
	])
	expect(JSON.stringify(results)).not.toContain('private proxy path')
})

test('bounds a provider request that does not complete', async () => {
	const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
		return await new Promise<Response>((_resolve, reject) => {
			init?.signal?.addEventListener('abort', () => {
				reject(new DOMException('timed out', 'AbortError'))
			})
		})
	})
	const results = await probeConfiguredAiModels({
		environment: environment({
			VEUD_AI_MODERATION_TRIAGE_ENABLED: 'false',
		}),
		fetchImpl,
		timeoutMs: 5,
	})

	expect(results).toEqual([
		expect.objectContaining({
			status: 'unavailable',
			httpStatus: null,
			providerCode: null,
			actionRequired: true,
		}),
	])
})

test('rejects malformed metadata and invalid shutdown dates', async () => {
	const fetchImpl = vi.fn<typeof fetch>(async () =>
		modelResponse('shared-model', '2026-02-30'),
	)
	const [result] = await probeConfiguredAiModels({
		environment: environment({
			VEUD_AI_MODERATION_TRIAGE_ENABLED: 'false',
		}),
		fetchImpl,
	})

	expect(result).toEqual(
		expect.objectContaining({
			status: 'invalid-response',
			resolvedModel: 'shared-model',
			shutdownDate: null,
			actionRequired: true,
		}),
	)
})

test('runs after the initial delay, repeats without overlap, and stops cleanly', async () => {
	vi.useFakeTimers()
	const fetchImpl = vi.fn<typeof fetch>(async () =>
		modelResponse('shared-model'),
	)
	const onResults = vi.fn()
	const monitor = startAiModelHealthMonitor({
		environment: environment({
			VEUD_AI_MODERATION_TRIAGE_ENABLED: 'false',
		}),
		fetchImpl,
		initialDelayMs: 100,
		intervalMs: 1_000,
		onResults,
	})

	await vi.advanceTimersByTimeAsync(99)
	expect(fetchImpl).not.toHaveBeenCalled()
	await vi.advanceTimersByTimeAsync(1)
	expect(fetchImpl).toHaveBeenCalledOnce()
	expect(onResults).toHaveBeenCalledOnce()
	await vi.advanceTimersByTimeAsync(1_000)
	expect(fetchImpl).toHaveBeenCalledTimes(2)
	expect(onResults).toHaveBeenCalledTimes(2)

	monitor.close()
	await vi.advanceTimersByTimeAsync(2_000)
	expect(fetchImpl).toHaveBeenCalledTimes(2)
})

test('does not start another interval while a slow probe is still running', async () => {
	vi.useFakeTimers()
	let resolveFirst: ((response: Response) => void) | undefined
	const firstResponse = new Promise<Response>(resolve => {
		resolveFirst = resolve
	})
	const fetchImpl = vi
		.fn<typeof fetch>()
		.mockImplementationOnce(async () => await firstResponse)
		.mockResolvedValue(modelResponse('shared-model'))
	const monitor = startAiModelHealthMonitor({
		environment: environment({
			VEUD_AI_MODERATION_TRIAGE_ENABLED: 'false',
		}),
		fetchImpl,
		initialDelayMs: 0,
		intervalMs: 100,
		onResults: vi.fn(),
	})

	await vi.advanceTimersByTimeAsync(0)
	expect(fetchImpl).toHaveBeenCalledOnce()
	await vi.advanceTimersByTimeAsync(1_000)
	expect(fetchImpl).toHaveBeenCalledOnce()

	resolveFirst?.(modelResponse('shared-model'))
	await vi.advanceTimersByTimeAsync(0)
	await vi.advanceTimersByTimeAsync(99)
	expect(fetchImpl).toHaveBeenCalledOnce()
	await vi.advanceTimersByTimeAsync(1)
	expect(fetchImpl).toHaveBeenCalledTimes(2)
	monitor.close()
})

test('keeps scheduling when result and error reporters fail', async () => {
	vi.useFakeTimers()
	const fetchImpl = vi.fn<typeof fetch>(async () =>
		modelResponse('shared-model'),
	)
	const onResults = vi.fn(() => {
		throw new Error('result reporter failed')
	})
	const onMonitorError = vi.fn(() => {
		throw new Error('error reporter failed')
	})
	const monitor = startAiModelHealthMonitor({
		environment: environment({
			VEUD_AI_MODERATION_TRIAGE_ENABLED: 'false',
		}),
		fetchImpl,
		initialDelayMs: 0,
		intervalMs: 100,
		onResults,
		onMonitorError,
	})

	await vi.advanceTimersByTimeAsync(0)
	expect(onResults).toHaveBeenCalledOnce()
	expect(onMonitorError).toHaveBeenCalledOnce()
	await vi.advanceTimersByTimeAsync(100)
	expect(fetchImpl).toHaveBeenCalledTimes(2)
	expect(onResults).toHaveBeenCalledTimes(2)
	expect(onMonitorError).toHaveBeenCalledTimes(2)
	monitor.close()
})

test('aborts an in-flight health request without reporting shutdown as failure', async () => {
	vi.useFakeTimers()
	let requestSignal: AbortSignal | undefined
	const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
		requestSignal = init?.signal ?? undefined
		return await new Promise<Response>((_resolve, reject) => {
			requestSignal?.addEventListener('abort', () => {
				reject(new DOMException('aborted', 'AbortError'))
			})
		})
	})
	const onResults = vi.fn()
	const onMonitorError = vi.fn()
	const monitor = startAiModelHealthMonitor({
		environment: environment({
			VEUD_AI_MODERATION_TRIAGE_ENABLED: 'false',
		}),
		fetchImpl,
		initialDelayMs: 0,
		onResults,
		onMonitorError,
	})

	await vi.advanceTimersByTimeAsync(0)
	expect(fetchImpl).toHaveBeenCalledOnce()
	monitor.close()
	await Promise.resolve()
	expect(requestSignal?.aborted).toBe(true)
	expect(onResults).not.toHaveBeenCalled()
	expect(onMonitorError).not.toHaveBeenCalled()
})
