import { z } from 'zod'
import {
	aiCapabilities,
	type AiCapability,
	isAiCapabilityConfigured,
	modelFor,
} from './ai-model-config.server.ts'

const DAY_MS = 24 * 60 * 60 * 1_000
export const AI_MODEL_HEALTH_INITIAL_DELAY_MS = 60 * 1_000
export const AI_MODEL_HEALTH_INTERVAL_MS = DAY_MS
export const AI_MODEL_SHUTDOWN_WARNING_DAYS = 45
const MODERATION_CLASSIFIER_MODEL = 'omni-moderation-latest'

const modelMetadataSchema = z.object({
	id: z.string().min(1).max(200),
	object: z.literal('model'),
	shutdown_date: z.string().nullable().optional(),
})

const providerErrorSchema = z.object({
	error: z.object({ code: z.string().nullable().optional() }).optional(),
})

export type AiModelConsumer = AiCapability | 'moderation-classifier'

export type ConfiguredAiModel = {
	model: string
	consumers: AiModelConsumer[]
}

export type AiModelHealthResult = ConfiguredAiModel & {
	status:
		'available' | 'shutdown-announced' | 'unavailable' | 'invalid-response'
	httpStatus: number | null
	providerCode: string | null
	resolvedModel: string | null
	shutdownDate: string | null
	daysUntilShutdown: number | null
	actionRequired: boolean
}

export function shouldStartAiModelHealthMonitor(
	mode: string,
	isVettedProductionTestRuntime: boolean,
) {
	return mode === 'production' && !isVettedProductionTestRuntime
}

export function configuredAiModels(
	environment: NodeJS.ProcessEnv = process.env,
) {
	const configured = new Map<string, Set<AiModelConsumer>>()
	const add = (model: string, consumer: AiModelConsumer) => {
		const consumers = configured.get(model) ?? new Set<AiModelConsumer>()
		consumers.add(consumer)
		configured.set(model, consumers)
	}

	for (const capability of aiCapabilities) {
		if (!isAiCapabilityConfigured(capability, environment)) continue
		add(modelFor(capability, undefined, environment), capability)
	}
	if (isAiCapabilityConfigured('moderation-triage', environment)) {
		add(MODERATION_CLASSIFIER_MODEL, 'moderation-classifier')
	}

	return [...configured]
		.map(([model, consumers]) => ({ model, consumers: [...consumers] }))
		.sort((left, right) => left.model.localeCompare(right.model))
}

function safeProviderCode(payload: unknown) {
	const parsed = providerErrorSchema.safeParse(payload)
	const code = parsed.success ? parsed.data.error?.code : null
	return typeof code === 'string'
		? code.replace(/[^a-z0-9._-]/gi, '-').slice(0, 80) || null
		: null
}

function shutdownDateDetails(value: string | null, now: number) {
	if (value === null) return { valid: true as const, days: null }
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		return { valid: false as const, days: null }
	}
	const shutdownAt = Date.parse(`${value}T00:00:00.000Z`)
	if (
		!Number.isFinite(shutdownAt) ||
		new Date(shutdownAt).toISOString().slice(0, 10) !== value
	) {
		return { valid: false as const, days: null }
	}
	return {
		valid: true as const,
		days: Math.ceil((shutdownAt - now) / DAY_MS),
	}
}

function combinedSignal(parent: AbortSignal | undefined, timeoutMs: number) {
	const timeout = AbortSignal.timeout(timeoutMs)
	return parent ? AbortSignal.any([parent, timeout]) : timeout
}

export async function probeConfiguredAiModels(
	options: {
		environment?: NodeJS.ProcessEnv
		fetchImpl?: typeof fetch
		now?: number
		timeoutMs?: number
		signal?: AbortSignal
	} = {},
) {
	const environment = options.environment ?? process.env
	const fetchImpl = options.fetchImpl ?? fetch
	const now = options.now ?? Date.now()
	const apiKey = environment.OPENAI_API_KEY?.trim()
	const configured = configuredAiModels(environment)
	if (!apiKey || configured.length === 0) return []

	return await Promise.all(
		configured.map(async configuredModel => {
			let response: Response
			try {
				response = await fetchImpl(
					`https://api.openai.com/v1/models/${encodeURIComponent(configuredModel.model)}`,
					{
						method: 'GET',
						headers: { Authorization: `Bearer ${apiKey}` },
						signal: combinedSignal(options.signal, options.timeoutMs ?? 10_000),
					},
				)
			} catch {
				return {
					...configuredModel,
					status: 'unavailable' as const,
					httpStatus: null,
					providerCode: null,
					resolvedModel: null,
					shutdownDate: null,
					daysUntilShutdown: null,
					actionRequired: true,
				}
			}

			const payload = await response.json().catch(() => null)
			if (!response.ok) {
				return {
					...configuredModel,
					status: 'unavailable' as const,
					httpStatus: response.status,
					providerCode: safeProviderCode(payload),
					resolvedModel: null,
					shutdownDate: null,
					daysUntilShutdown: null,
					actionRequired: true,
				}
			}

			const metadata = modelMetadataSchema.safeParse(payload)
			if (!metadata.success) {
				return {
					...configuredModel,
					status: 'invalid-response' as const,
					httpStatus: response.status,
					providerCode: null,
					resolvedModel: null,
					shutdownDate: null,
					daysUntilShutdown: null,
					actionRequired: true,
				}
			}

			const shutdownDate = metadata.data.shutdown_date ?? null
			const shutdown = shutdownDateDetails(shutdownDate, now)
			if (!shutdown.valid) {
				return {
					...configuredModel,
					status: 'invalid-response' as const,
					httpStatus: response.status,
					providerCode: null,
					resolvedModel: metadata.data.id,
					shutdownDate: null,
					daysUntilShutdown: null,
					actionRequired: true,
				}
			}

			return {
				...configuredModel,
				status: shutdownDate
					? ('shutdown-announced' as const)
					: ('available' as const),
				httpStatus: response.status,
				providerCode: null,
				resolvedModel: metadata.data.id,
				shutdownDate,
				daysUntilShutdown: shutdown.days,
				actionRequired:
					shutdown.days !== null &&
					shutdown.days <= AI_MODEL_SHUTDOWN_WARNING_DAYS,
			}
		}),
	)
}

export function startAiModelHealthMonitor(options: {
	environment?: NodeJS.ProcessEnv
	fetchImpl?: typeof fetch
	initialDelayMs?: number
	intervalMs?: number
	timeoutMs?: number
	onResults: (results: AiModelHealthResult[]) => void
	onMonitorError?: (error: unknown) => void
}) {
	let closed = false
	let timer: ReturnType<typeof setTimeout> | undefined
	let activeController: AbortController | undefined
	const reportMonitorError = (error: unknown) => {
		if (closed || !options.onMonitorError) return
		try {
			options.onMonitorError(error)
		} catch {
			// Monitoring must never create an unhandled rejection in the server.
		}
	}

	const schedule = (delay: number) => {
		timer = setTimeout(() => void run(), delay)
		timer.unref()
	}
	const run = async () => {
		activeController = new AbortController()
		try {
			const results = await probeConfiguredAiModels({
				environment: options.environment,
				fetchImpl: options.fetchImpl,
				timeoutMs: options.timeoutMs,
				signal: activeController.signal,
			})
			if (!closed) options.onResults(results)
		} catch (error) {
			reportMonitorError(error)
		} finally {
			activeController = undefined
			if (!closed) schedule(options.intervalMs ?? AI_MODEL_HEALTH_INTERVAL_MS)
		}
	}

	schedule(options.initialDelayMs ?? AI_MODEL_HEALTH_INITIAL_DELAY_MS)
	return {
		close() {
			closed = true
			if (timer) clearTimeout(timer)
			activeController?.abort()
		},
	}
}
