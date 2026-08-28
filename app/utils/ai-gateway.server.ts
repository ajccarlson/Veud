import { createHash } from 'node:crypto'
import { z } from 'zod'
import { prisma } from './db.server.ts'

const AI_UNAVAILABLE_COOLDOWN_MS = 10 * 60 * 1_000
const AI_QUOTA_COOLDOWN_MS = 60 * 60 * 1_000
const AI_TRANSIENT_FAILURE_WINDOW_MS = 60 * 1_000
const AI_TRANSIENT_FAILURE_THRESHOLD = 3
const SHARED_ANONYMOUS_WARNING_INTERVAL_MS = 10 * 60 * 1_000
const MAX_RATE_LIMIT_KEYS = 5_000
const MAX_TELEMETRY_EVENTS = 500
const DAY_MS = 24 * 60 * 60 * 1_000
const DEFAULT_DAILY_CAPABILITY_LIMIT = 5_000
const DEFAULT_ANONYMOUS_DAILY_CAPABILITY_LIMIT = 250
export const DEFAULT_OPENAI_MODEL = 'gpt-5.6-luna'

export const aiCapabilities = [
	'tip-of-tongue',
	'natural-language-discovery',
	'discovery-refinement',
	'tracking-command',
	'image-tip-of-tongue',
	'import-reconciliation',
	'review-assistance',
	'moderation-triage',
] as const

export type AiCapability = (typeof aiCapabilities)[number]
export type AiCircuit = {
	unavailableUntil: number
	unavailableReason?: 'model-unavailable'
	transientFailures?: number
	transientWindowStartedAt?: number
}

export type AiGatewayTelemetry = {
	capability: AiCapability
	model: string
	promptVersion: string
	startedAt: Date
	durationMs: number
	outcome: 'success' | 'rate-limited' | 'unavailable' | 'error'
	fallbackReason:
		| 'not-configured'
		| 'rate-limited'
		| 'unavailable'
		| 'error'
		| 'concurrency'
		| 'shared-rate-limited'
		| 'unsafe-input'
		| 'model-unavailable'
		| null
	status: number | null
	inputTokens: number | null
	outputTokens: number | null
}

const requestHistory = new Map<string, number[]>()
const blockedDailyBudgets = new Map<string, number>()
const circuits = new Map<AiCapability, AiCircuit>()
const sharedAnonymousWarnings = new Map<AiCapability, number>()
const telemetry: AiGatewayTelemetry[] = []
let activeRequests = 0

const responseEnvelopeSchema = z.object({
	output: z.array(
		z.object({
			type: z.string(),
			content: z
				.array(z.object({ type: z.string(), text: z.string().optional() }))
				.optional(),
		}),
	),
	usage: z
		.object({
			input_tokens: z.number().int().nonnegative().optional(),
			output_tokens: z.number().int().nonnegative().optional(),
		})
		.optional(),
})

const moderationResponseSchema = z.object({
	results: z
		.array(
			z.object({
				flagged: z.boolean(),
				categories: z.record(z.string(), z.boolean()),
				category_scores: z.record(z.string(), z.number()),
			}),
		)
		.min(1),
})

function responseText(payload: unknown) {
	const parsed = responseEnvelopeSchema.safeParse(payload)
	if (!parsed.success) return { text: null, usage: null }
	for (const output of parsed.data.output) {
		for (const content of output.content ?? []) {
			if (content.type === 'output_text' && content.text) {
				return { text: content.text, usage: parsed.data.usage ?? null }
			}
		}
	}
	return { text: null, usage: parsed.data.usage ?? null }
}

async function recordTelemetry(event: AiGatewayTelemetry, persist: boolean) {
	telemetry.push(event)
	if (telemetry.length > MAX_TELEMETRY_EVENTS) {
		telemetry.splice(0, telemetry.length - MAX_TELEMETRY_EVENTS)
	}
	if (!persist) return
	try {
		await prisma.aiUsageEvent.create({
			data: {
				capability: event.capability,
				model: event.model,
				promptVersion: event.promptVersion,
				outcome: event.outcome,
				fallbackReason: event.fallbackReason,
				status: event.status,
				durationMs: Math.round(event.durationMs),
				inputTokens: event.inputTokens,
				outputTokens: event.outputTokens,
				createdAt: event.startedAt,
			},
		})
	} catch (error) {
		console.warn(
			'Unable to persist privacy-safe AI operations telemetry',
			error instanceof Error ? error.name : 'DatabaseError',
		)
	}
}

function consumeRequest(input: {
	capability: AiCapability
	key: string
	now: number
	limit: number
	windowMs: number
}) {
	const storageKey = `${input.capability}:${input.key}`
	const cutoff = input.now - input.windowMs
	const recent = (requestHistory.get(storageKey) ?? []).filter(
		timestamp => timestamp > cutoff,
	)
	if (recent.length >= input.limit) {
		requestHistory.set(storageKey, recent)
		return false
	}
	recent.push(input.now)
	requestHistory.set(storageKey, recent)
	if (requestHistory.size > MAX_RATE_LIMIT_KEYS) {
		const oldestFirst = [...requestHistory.entries()].sort(
			([, left], [, right]) => Math.max(...left, 0) - Math.max(...right, 0),
		)
		for (const [key] of oldestFirst) {
			requestHistory.delete(key)
			if (requestHistory.size <= MAX_RATE_LIMIT_KEYS - 1_000) break
		}
	}
	return true
}

async function consumeDurableRequest(input: {
	capability: AiCapability
	key: string
	now: number
	limit: number
	windowMs: number
	subjectHash?: string
	failClosed?: boolean
}) {
	const subjectHash =
		input.subjectHash ??
		createHash('sha256').update(`veud-ai-limit:${input.key}`).digest('hex')
	const windowStartedAtMs =
		Math.floor(input.now / input.windowMs) * input.windowMs
	const id = createHash('sha256')
		.update(
			`${input.capability}:${subjectHash}:${windowStartedAtMs}:${input.windowMs}`,
		)
		.digest('hex')
	try {
		const bucket = await prisma.aiRateLimitBucket.upsert({
			where: { id },
			create: {
				id,
				capability: input.capability,
				subjectHash,
				windowStartedAt: new Date(windowStartedAtMs),
				windowMs: input.windowMs,
				count: 1,
				expiresAt: new Date(windowStartedAtMs + input.windowMs * 2),
			},
			update: { count: { increment: 1 } },
			select: { count: true },
		})
		return { allowed: bucket.count <= input.limit, count: bucket.count }
	} catch (error) {
		console.warn(
			'Unable to coordinate durable AI rate limit',
			error instanceof Error ? error.name : 'DatabaseError',
		)
		return { allowed: input.failClosed !== true, count: null }
	}
}

function configuredLimit(name: string, fallback: number) {
	const value = Number.parseInt(process.env[name] ?? '', 10)
	return Number.isFinite(value) && value > 0
		? Math.min(1_000_000, value)
		: fallback
}

function warnAtBudgetThreshold(input: {
	capability: AiCapability
	scope: 'global' | 'anonymous'
	count: number | null
	limit: number
}) {
	if (input.count === null) return
	const alertAt = Math.max(1, Math.ceil(input.limit * 0.8))
	if (input.count !== alertAt && input.count !== input.limit) return
	console.warn('AI daily request budget threshold reached', {
		capability: input.capability,
		scope: input.scope,
		count: input.count,
		limit: input.limit,
	})
}

function warnSharedAnonymousLimit(capability: AiCapability, now: number) {
	const lastWarning = sharedAnonymousWarnings.get(capability)
	if (
		lastWarning !== undefined &&
		now - lastWarning < SHARED_ANONYMOUS_WARNING_INTERVAL_MS
	) {
		return
	}
	sharedAnonymousWarnings.set(capability, now)
	console.warn('Shared anonymous AI request bucket reached its limit', {
		capability,
	})
}

function dailyBudgetBlockKey(
	capability: AiCapability,
	scope: 'global' | 'anonymous',
) {
	return `${capability}:daily-${scope}`
}

function isDailyBudgetBlocked(input: {
	capability: AiCapability
	scope: 'global' | 'anonymous'
	now: number
}) {
	const blockKey = dailyBudgetBlockKey(input.capability, input.scope)
	const blockedUntil = blockedDailyBudgets.get(blockKey) ?? 0
	if (blockedUntil > input.now) return true
	if (blockedUntil) blockedDailyBudgets.delete(blockKey)
	return false
}

async function consumeDailyBudget(input: {
	capability: AiCapability
	scope: 'global' | 'anonymous'
	now: number
	limit: number
	persist: boolean
}) {
	const windowStartedAt = Math.floor(input.now / DAY_MS) * DAY_MS
	const key = `daily-${input.scope}:${windowStartedAt}`
	const blockKey = dailyBudgetBlockKey(input.capability, input.scope)
	if (isDailyBudgetBlocked(input)) return false

	const budget = {
		capability: input.capability,
		key,
		now: input.now,
		limit: input.limit,
		windowMs: DAY_MS,
	}
	if (!consumeRequest(budget)) {
		blockedDailyBudgets.set(blockKey, windowStartedAt + DAY_MS)
		return false
	}
	if (!input.persist) return true

	const result = await consumeDurableRequest({
		...budget,
		subjectHash: input.scope === 'global' ? 'global' : 'anonymous-global',
		failClosed: true,
	})
	warnAtBudgetThreshold({
		capability: input.capability,
		scope: input.scope,
		count: result.count,
		limit: input.limit,
	})
	if (!result.allowed && result.count !== null) {
		blockedDailyBudgets.set(blockKey, windowStartedAt + DAY_MS)
	}
	return result.allowed
}

export class AiGatewayError extends Error {
	constructor(
		readonly reason:
			'not-configured' | 'rate-limited' | 'unavailable' | 'error',
		message: string,
		readonly status: number | null = null,
		readonly code: string | null = null,
	) {
		super(message)
		this.name = 'AiGatewayError'
	}
}

function opensCircuitImmediately(status: number) {
	return status === 401 || status === 403 || status === 429
}

function isModelUnavailableCode(code: string | null) {
	return code === 'model_not_found'
}

function isTransientTransportError(error: unknown) {
	const name =
		typeof error === 'object' && error !== null && 'name' in error
			? error.name
			: null
	return (
		error instanceof TypeError ||
		name === 'AbortError' ||
		name === 'NetworkError' ||
		name === 'TimeoutError'
	)
}

function clearTransientFailures(circuit: AiCircuit) {
	delete circuit.transientFailures
	delete circuit.transientWindowStartedAt
}

function clearCircuitAvailability(circuit: AiCircuit) {
	circuit.unavailableUntil = 0
	delete circuit.unavailableReason
}

function recordTransientFailure(circuit: AiCircuit, now: number) {
	const windowStartedAt = circuit.transientWindowStartedAt
	if (
		windowStartedAt === undefined ||
		now - windowStartedAt >= AI_TRANSIENT_FAILURE_WINDOW_MS
	) {
		circuit.transientWindowStartedAt = now
		circuit.transientFailures = 1
	} else {
		circuit.transientFailures = (circuit.transientFailures ?? 0) + 1
	}
	if ((circuit.transientFailures ?? 0) < AI_TRANSIENT_FAILURE_THRESHOLD) {
		return
	}
	circuit.unavailableUntil = Math.max(
		circuit.unavailableUntil,
		now + AI_UNAVAILABLE_COOLDOWN_MS,
	)
	delete circuit.unavailableReason
	clearTransientFailures(circuit)
}

function cooldownMs(code: string | null) {
	return code === 'insufficient_quota' || code === 'billing_hard_limit_reached'
		? AI_QUOTA_COOLDOWN_MS
		: AI_UNAVAILABLE_COOLDOWN_MS
}

const capabilityModelEnvironmentKeys = {
	'tip-of-tongue': 'OPENAI_TIP_OF_TONGUE_MODEL',
	'natural-language-discovery': 'OPENAI_NATURAL_LANGUAGE_DISCOVERY_MODEL',
	'discovery-refinement': 'OPENAI_DISCOVERY_REFINEMENT_MODEL',
	'tracking-command': 'OPENAI_TRACKING_COMMAND_MODEL',
	'image-tip-of-tongue': 'OPENAI_IMAGE_TIP_OF_TONGUE_MODEL',
	'import-reconciliation': 'OPENAI_IMPORT_RECONCILIATION_MODEL',
	'review-assistance': 'OPENAI_REVIEW_ASSISTANCE_MODEL',
	'moderation-triage': 'OPENAI_MODERATION_TRIAGE_MODEL',
} as const satisfies Record<AiCapability, string>

export function modelFor(
	capability: AiCapability,
	fallback = DEFAULT_OPENAI_MODEL,
) {
	return (
		process.env[capabilityModelEnvironmentKeys[capability]]?.trim() ||
		process.env.OPENAI_DEFAULT_MODEL?.trim() ||
		fallback
	)
}

export function isAiCapabilityConfigured(capability: AiCapability) {
	const environment = process.env as Record<string, string | undefined>
	const capabilityFlag = `VEUD_AI_${capability
		.replaceAll('-', '_')
		.toUpperCase()}_ENABLED`
	return Boolean(
		environment.OPENAI_API_KEY?.trim() &&
		!['0', 'false'].includes(
			environment.VEUD_AI_ENABLED?.trim().toLowerCase() ?? 'true',
		) &&
		!['0', 'false'].includes(
			environment[capabilityFlag]?.trim().toLowerCase() ?? 'true',
		),
	)
}

export function getAiGatewayTelemetry() {
	return telemetry.map(event => ({ ...event }))
}

export async function getAiGatewayOperationsTelemetry(since: Date) {
	try {
		const events = await prisma.aiUsageEvent.findMany({
			where: { createdAt: { gte: since } },
			orderBy: { createdAt: 'desc' },
			take: 5_000,
		})
		return events.map(event => ({
			capability: event.capability as AiCapability,
			model: event.model,
			promptVersion: event.promptVersion,
			startedAt: event.createdAt,
			durationMs: event.durationMs,
			outcome: event.outcome as AiGatewayTelemetry['outcome'],
			fallbackReason:
				event.fallbackReason as AiGatewayTelemetry['fallbackReason'],
			status: event.status,
			inputTokens: event.inputTokens,
			outputTokens: event.outputTokens,
		}))
	} catch {
		return getAiGatewayTelemetry().filter(event => event.startedAt >= since)
	}
}

export function resetAiGatewayStateForTests() {
	requestHistory.clear()
	blockedDailyBudgets.clear()
	circuits.clear()
	sharedAnonymousWarnings.clear()
	telemetry.splice(0)
	activeRequests = 0
}

type ControlledAiRequestOptions<Output> = {
	capability: AiCapability
	promptVersion: string
	model: string
	input: unknown
	assertSafeInput: (input: unknown) => void
	rateLimitKey?: string
	rateLimit?: number
	rateLimitWindowMs?: number
	timeoutMs: number
	usesDefaultFetch: boolean
	now?: number
	circuit?: AiCircuit
	execute: (input: { apiKey: string; signal: AbortSignal }) => Promise<{
		output: Output
		status: number
		inputTokens: number | null
		outputTokens: number | null
	}>
}

function providerRequestError(status: number, payload: unknown) {
	const parsedError = z
		.object({
			error: z.object({ code: z.string().nullable().optional() }).optional(),
		})
		.safeParse(payload)
	const code = parsedError.success
		? (parsedError.data.error?.code ?? null)
		: null
	const unavailable =
		opensCircuitImmediately(status) ||
		status >= 500 ||
		isModelUnavailableCode(code)
	return new AiGatewayError(
		unavailable ? 'unavailable' : 'error',
		unavailable
			? `AI service unavailable (${status}).`
			: `AI request failed (${status}).`,
		status,
		code,
	)
}

async function runControlledAiRequest<Output>(
	options: ControlledAiRequestOptions<Output>,
) {
	const startedAtMs = options.now ?? Date.now()
	const requestStartedAtMs = Date.now()
	const startedAt = new Date(startedAtMs)
	const baseTelemetry = {
		capability: options.capability,
		model: options.model,
		promptVersion: options.promptVersion,
		startedAt,
	}
	const persistOperations =
		process.env.NODE_ENV === 'production' && options.usesDefaultFetch
	const apiKey = process.env.OPENAI_API_KEY?.trim()
	if (!apiKey || !isAiCapabilityConfigured(options.capability)) {
		await recordTelemetry(
			{
				...baseTelemetry,
				durationMs: 0,
				outcome: 'unavailable',
				fallbackReason: 'not-configured',
				status: null,
				inputTokens: null,
				outputTokens: null,
			},
			persistOperations,
		)
		throw new AiGatewayError(
			'not-configured',
			'This AI capability is not configured.',
		)
	}
	try {
		options.assertSafeInput(options.input)
	} catch (error) {
		await recordTelemetry(
			{
				...baseTelemetry,
				durationMs: 0,
				outcome: 'error',
				fallbackReason: 'unsafe-input',
				status: null,
				inputTokens: null,
				outputTokens: null,
			},
			persistOperations,
		)
		throw error
	}
	const circuit = options.circuit ??
		circuits.get(options.capability) ?? { unavailableUntil: 0 }
	circuits.set(options.capability, circuit)
	if (circuit.unavailableUntil > startedAtMs) {
		await recordTelemetry(
			{
				...baseTelemetry,
				durationMs: 0,
				outcome: 'unavailable',
				fallbackReason: circuit.unavailableReason ?? 'unavailable',
				status: null,
				inputTokens: null,
				outputTokens: null,
			},
			persistOperations,
		)
		throw new AiGatewayError(
			'unavailable',
			'AI capability is temporarily unavailable.',
		)
	}
	if (circuit.unavailableUntil) clearCircuitAvailability(circuit)
	const dailyLimit = configuredLimit(
		'VEUD_AI_DAILY_LIMIT_PER_CAPABILITY',
		DEFAULT_DAILY_CAPABILITY_LIMIT,
	)
	const anonymousDailyLimit = configuredLimit(
		'VEUD_AI_ANONYMOUS_DAILY_LIMIT_PER_CAPABILITY',
		DEFAULT_ANONYMOUS_DAILY_CAPABILITY_LIMIT,
	)
	const isAnonymous = options.rateLimitKey?.startsWith('anonymous:') === true
	const isSharedAnonymous = options.rateLimitKey === 'anonymous:shared'
	const aggregateBudgetBlocked =
		isDailyBudgetBlocked({
			capability: options.capability,
			scope: 'global',
			now: startedAtMs,
		}) ||
		(isAnonymous &&
			isDailyBudgetBlocked({
				capability: options.capability,
				scope: 'anonymous',
				now: startedAtMs,
			}))
	const rateLimitInput = options.rateLimitKey
		? {
				capability: options.capability,
				key: options.rateLimitKey,
				now: startedAtMs,
				limit: options.rateLimit ?? 5,
				windowMs: options.rateLimitWindowMs ?? 10 * 60 * 1_000,
			}
		: null
	const withinLocalLimit = aggregateBudgetBlocked
		? true
		: rateLimitInput
			? consumeRequest(rateLimitInput)
			: true
	if (aggregateBudgetBlocked || !withinLocalLimit) {
		const sharedClientLimit = !aggregateBudgetBlocked && isSharedAnonymous
		if (sharedClientLimit) {
			warnSharedAnonymousLimit(options.capability, startedAtMs)
		}
		await recordTelemetry(
			{
				...baseTelemetry,
				durationMs: 0,
				outcome: 'rate-limited',
				fallbackReason: sharedClientLimit
					? 'shared-rate-limited'
					: 'rate-limited',
				status: null,
				inputTokens: null,
				outputTokens: null,
			},
			persistOperations,
		)
		throw new AiGatewayError('rate-limited', 'AI request limit reached.')
	}
	const configuredConcurrency = Number.parseInt(
		process.env.VEUD_AI_MAX_CONCURRENCY ?? '',
		10,
	)
	const maxConcurrency = Number.isFinite(configuredConcurrency)
		? Math.min(20, Math.max(1, configuredConcurrency))
		: 4
	if (activeRequests >= maxConcurrency) {
		await recordTelemetry(
			{
				...baseTelemetry,
				durationMs: 0,
				outcome: 'unavailable',
				fallbackReason: 'concurrency',
				status: null,
				inputTokens: null,
				outputTokens: null,
			},
			persistOperations,
		)
		throw new AiGatewayError(
			'unavailable',
			'AI concurrency capacity is temporarily full.',
		)
	}
	activeRequests += 1

	let status: number | null = null
	try {
		const withinDurableLimit =
			rateLimitInput && persistOperations
				? (await consumeDurableRequest(rateLimitInput)).allowed
				: true
		const withinAnonymousDailyLimit =
			withinDurableLimit && isAnonymous
				? await consumeDailyBudget({
						capability: options.capability,
						scope: 'anonymous',
						now: startedAtMs,
						limit: anonymousDailyLimit,
						persist: persistOperations,
					})
				: true
		const withinGlobalDailyLimit =
			withinDurableLimit && withinAnonymousDailyLimit
				? await consumeDailyBudget({
						capability: options.capability,
						scope: 'global',
						now: startedAtMs,
						limit: dailyLimit,
						persist: persistOperations,
					})
				: true
		if (
			!withinDurableLimit ||
			!withinAnonymousDailyLimit ||
			!withinGlobalDailyLimit
		) {
			const sharedClientLimit = !withinDurableLimit && isSharedAnonymous
			if (sharedClientLimit) {
				warnSharedAnonymousLimit(options.capability, startedAtMs)
			}
			throw new AiGatewayError(
				'rate-limited',
				'AI request limit reached.',
				null,
				sharedClientLimit ? 'shared-anonymous-client-limit' : null,
			)
		}
		const result = await options.execute({
			apiKey,
			signal: AbortSignal.timeout(options.timeoutMs),
		})
		status = result.status
		clearCircuitAvailability(circuit)
		clearTransientFailures(circuit)
		await recordTelemetry(
			{
				...baseTelemetry,
				durationMs: Math.max(0, Date.now() - requestStartedAtMs),
				outcome: 'success',
				fallbackReason: null,
				status,
				inputTokens: result.inputTokens,
				outputTokens: result.outputTokens,
			},
			persistOperations,
		)
		return result.output
	} catch (error) {
		const transportFailure = isTransientTransportError(error)
		const gatewayError =
			error instanceof AiGatewayError
				? error
				: transportFailure
					? new AiGatewayError(
							'unavailable',
							'AI service is temporarily unavailable.',
						)
					: new AiGatewayError(
							'error',
							error instanceof Error ? error.message : 'AI request failed.',
							status,
						)
		if (isModelUnavailableCode(gatewayError.code)) {
			circuit.unavailableUntil = Math.max(
				circuit.unavailableUntil,
				startedAtMs + AI_UNAVAILABLE_COOLDOWN_MS,
			)
			circuit.unavailableReason = 'model-unavailable'
			clearTransientFailures(circuit)
		} else if (
			gatewayError.status !== null &&
			opensCircuitImmediately(gatewayError.status)
		) {
			circuit.unavailableUntil = Math.max(
				circuit.unavailableUntil,
				startedAtMs + cooldownMs(gatewayError.code),
			)
			delete circuit.unavailableReason
			clearTransientFailures(circuit)
		} else if (
			transportFailure ||
			(gatewayError.status !== null && gatewayError.status >= 500)
		) {
			recordTransientFailure(circuit, startedAtMs)
		} else if (gatewayError.status !== null) {
			clearTransientFailures(circuit)
		}
		await recordTelemetry(
			{
				...baseTelemetry,
				durationMs: Math.max(0, Date.now() - requestStartedAtMs),
				outcome:
					gatewayError.reason === 'rate-limited'
						? 'rate-limited'
						: gatewayError.reason === 'unavailable'
							? 'unavailable'
							: 'error',
				fallbackReason: isModelUnavailableCode(gatewayError.code)
					? 'model-unavailable'
					: gatewayError.reason === 'rate-limited' &&
						  gatewayError.code === 'shared-anonymous-client-limit'
						? 'shared-rate-limited'
						: gatewayError.reason,
				status: gatewayError.status,
				inputTokens: null,
				outputTokens: null,
			},
			persistOperations,
		)
		throw gatewayError
	} finally {
		activeRequests = Math.max(0, activeRequests - 1)
	}
}

export async function requestModerationClassification(options: {
	input: string
	rateLimitKey: string
	rateLimit?: number
	rateLimitWindowMs?: number
	timeoutMs?: number
	fetchImpl?: typeof fetch
	now?: number
	circuit?: AiCircuit
}) {
	const model = 'omni-moderation-latest'
	const fetchImpl = options.fetchImpl ?? fetch
	return await runControlledAiRequest({
		capability: 'moderation-triage',
		promptVersion: 'moderation-classifier-v1',
		model,
		input: options.input,
		assertSafeInput(input) {
			if (typeof input !== 'string' || input.length > 3_001) {
				throw new Error('Unsafe moderation classifier payload')
			}
		},
		rateLimitKey: options.rateLimitKey,
		rateLimit: options.rateLimit,
		rateLimitWindowMs: options.rateLimitWindowMs,
		timeoutMs: options.timeoutMs ?? 8_000,
		usesDefaultFetch: options.fetchImpl === undefined,
		now: options.now,
		circuit: options.circuit,
		async execute({ apiKey, signal }) {
			const response = await fetchImpl(
				'https://api.openai.com/v1/moderations',
				{
					method: 'POST',
					headers: {
						Authorization: `Bearer ${apiKey}`,
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({ model, input: options.input }),
					signal,
				},
			)
			const payload = await response.json().catch(() => null)
			if (!response.ok) throw providerRequestError(response.status, payload)
			const parsed = moderationResponseSchema.safeParse(payload)
			if (!parsed.success) {
				throw new AiGatewayError(
					'error',
					'AI returned an invalid moderation classification.',
					response.status,
				)
			}
			const result = parsed.data.results[0]!
			const categories = Object.entries(result.categories)
				.filter(([, flagged]) => flagged)
				.map(([category]) => category)
			const critical = Object.entries(result.category_scores).some(
				([category, score]) =>
					score >= 0.7 &&
					(category.includes('minors') ||
						category.includes('self-harm/instructions') ||
						category.includes('hate/threatening') ||
						category.includes('violence/graphic')),
			)
			return {
				output: { flagged: result.flagged, categories, critical },
				status: response.status,
				inputTokens: null,
				outputTokens: null,
			}
		},
	})
}

export async function requestStructuredAi<Output>(options: {
	capability: AiCapability
	promptVersion: string
	instructions: string
	input: unknown
	/**
	 * A preconstructed Responses API input for validated multimodal content.
	 * It is intentionally restricted to the image TOMT capability.
	 */
	apiInput?: unknown
	outputSchema: z.ZodType<Output>
	jsonSchemaName: string
	jsonSchema: Record<string, unknown>
	assertSafeInput: (input: unknown) => void
	rateLimitKey?: string
	rateLimit?: number
	rateLimitWindowMs?: number
	timeoutMs?: number
	maxOutputTokens?: number
	model?: string
	fallbackModel?: string
	reasoningEffort?: 'none' | 'low' | 'medium' | 'high'
	fetchImpl?: typeof fetch
	now?: number
	circuit?: AiCircuit
}) {
	const model =
		options.model?.trim() || modelFor(options.capability, options.fallbackModel)
	const fetchImpl = options.fetchImpl ?? fetch
	return await runControlledAiRequest({
		capability: options.capability,
		promptVersion: options.promptVersion,
		model,
		input: options.input,
		assertSafeInput(input) {
			options.assertSafeInput(input)
			if (
				options.apiInput !== undefined &&
				options.capability !== 'image-tip-of-tongue'
			) {
				throw new AiGatewayError(
					'error',
					'Multimodal input is not permitted for this capability.',
				)
			}
		},
		rateLimitKey: options.rateLimitKey,
		rateLimit: options.rateLimit,
		rateLimitWindowMs: options.rateLimitWindowMs,
		timeoutMs: options.timeoutMs ?? 12_000,
		usesDefaultFetch: options.fetchImpl === undefined,
		now: options.now,
		circuit: options.circuit,
		async execute({ apiKey, signal }) {
			const response = await fetchImpl('https://api.openai.com/v1/responses', {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${apiKey}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					model,
					store: false,
					...(options.rateLimitKey
						? {
								safety_identifier: createHash('sha256')
									.update(`veud-ai:${options.rateLimitKey}`)
									.digest('hex'),
							}
						: {}),
					reasoning: { effort: options.reasoningEffort ?? 'none' },
					max_output_tokens: Math.min(
						4_000,
						Math.max(200, options.maxOutputTokens ?? 1_200),
					),
					instructions: options.instructions,
					input:
						options.apiInput ??
						(typeof options.input === 'string'
							? options.input
							: JSON.stringify(options.input)),
					text: {
						verbosity: 'low',
						format: {
							type: 'json_schema',
							name: options.jsonSchemaName,
							strict: true,
							schema: options.jsonSchema,
						},
					},
				}),
				signal,
			})
			const payload = await response.json().catch(() => null)
			if (!response.ok) throw providerRequestError(response.status, payload)
			const parsedResponse = responseText(payload)
			if (!parsedResponse.text) {
				throw new AiGatewayError(
					'error',
					'AI returned no structured output.',
					response.status,
				)
			}
			try {
				return {
					output: options.outputSchema.parse(
						JSON.parse(parsedResponse.text) as unknown,
					),
					status: response.status,
					inputTokens: parsedResponse.usage?.input_tokens ?? null,
					outputTokens: parsedResponse.usage?.output_tokens ?? null,
				}
			} catch (error) {
				throw new AiGatewayError(
					'error',
					error instanceof Error
						? error.message
						: 'AI output validation failed.',
					response.status,
				)
			}
		},
	})
}
