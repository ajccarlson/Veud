import { randomUUID } from 'node:crypto'
import { afterEach, expect, test, vi } from 'vitest'
import { z } from 'zod'
import {
	type AiCapability,
	type AiCircuit,
	DEFAULT_OPENAI_MODEL,
	getAiGatewayTelemetry,
	modelFor,
	requestModerationClassification,
	requestStructuredAi,
	resetAiGatewayStateForTests,
} from './ai-gateway.server.ts'
import { prisma } from './db.server.ts'

afterEach(() => {
	vi.unstubAllEnvs()
	vi.unstubAllGlobals()
	resetAiGatewayStateForTests()
})

const OutputSchema = z.object({ value: z.string() })
const jsonSchema = {
	type: 'object',
	additionalProperties: false,
	required: ['value'],
	properties: { value: { type: 'string' } },
}

const capabilityModelVariables = [
	['tip-of-tongue', 'OPENAI_TIP_OF_TONGUE_MODEL'],
	['natural-language-discovery', 'OPENAI_NATURAL_LANGUAGE_DISCOVERY_MODEL'],
	['discovery-refinement', 'OPENAI_DISCOVERY_REFINEMENT_MODEL'],
	['tracking-command', 'OPENAI_TRACKING_COMMAND_MODEL'],
	['image-tip-of-tongue', 'OPENAI_IMAGE_TIP_OF_TONGUE_MODEL'],
	['import-reconciliation', 'OPENAI_IMPORT_RECONCILIATION_MODEL'],
	['review-assistance', 'OPENAI_REVIEW_ASSISTANCE_MODEL'],
	['moderation-triage', 'OPENAI_MODERATION_TRIAGE_MODEL'],
] as const satisfies ReadonlyArray<readonly [AiCapability, string]>

test('resolves the caller fallback, global override, and centralized default in order', () => {
	vi.stubEnv('OPENAI_DEFAULT_MODEL', '')
	expect(modelFor('tracking-command')).toBe(DEFAULT_OPENAI_MODEL)
	expect(modelFor('review-assistance', 'caller-fallback')).toBe(
		'caller-fallback',
	)

	vi.stubEnv('OPENAI_DEFAULT_MODEL', 'global-model')
	expect(modelFor('tracking-command')).toBe('global-model')
	expect(modelFor('review-assistance', 'caller-fallback')).toBe('global-model')
})

test.each(capabilityModelVariables)(
	'resolves the %s capability override from %s',
	(capability, variable) => {
		vi.stubEnv('OPENAI_DEFAULT_MODEL', 'global-model')
		vi.stubEnv(variable, 'capability-model')
		expect(modelFor(capability)).toBe('capability-model')
	},
)

function response(value: unknown, status = 200) {
	return new Response(
		JSON.stringify(
			status === 200
				? {
						status: 'completed',
						output: [
							{
								type: 'message',
								content: [{ type: 'output_text', text: JSON.stringify(value) }],
							},
						],
						usage: { input_tokens: 10, output_tokens: 2 },
					}
				: value,
		),
		{ status, headers: { 'content-type': 'application/json' } },
	)
}

function moderationResponse(
	value: unknown = {
		results: [
			{
				flagged: true,
				categories: { harassment: true, violence: false },
				category_scores: { harassment: 0.9, violence: 0.1 },
			},
		],
	},
	status = 200,
) {
	return new Response(JSON.stringify(value), {
		status,
		headers: { 'content-type': 'application/json' },
	})
}

test('sends only the asserted input with storage disabled and validates output', async () => {
	vi.stubEnv('OPENAI_API_KEY', 'test-key')
	const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
		const body = JSON.parse(String(init?.body)) as Record<string, unknown>
		expect(body).toEqual(
			expect.objectContaining({
				store: false,
				input: JSON.stringify({ memberText: 'hello' }),
				model: 'gpt-5.6-luna',
			}),
		)
		return response({ value: 'ok' })
	})
	const result = await requestStructuredAi({
		capability: 'review-assistance',
		promptVersion: 'test-v1',
		instructions: 'Return the value.',
		input: { memberText: 'hello' },
		outputSchema: OutputSchema,
		jsonSchemaName: 'test_output',
		jsonSchema,
		assertSafeInput(input) {
			expect(input).toEqual({ memberText: 'hello' })
		},
		fetchImpl,
	})
	expect(result).toEqual({ value: 'ok' })
	expect(getAiGatewayTelemetry()).toEqual([
		expect.objectContaining({
			capability: 'review-assistance',
			promptVersion: 'test-v1',
			outcome: 'success',
			fallbackReason: null,
			inputTokens: 10,
			outputTokens: 2,
		}),
	])
})

test('enforces per-capability rate limits without sending rejected requests', async () => {
	vi.stubEnv('OPENAI_API_KEY', 'test-key')
	const fetchImpl = vi.fn<typeof fetch>(async () => response({ value: 'ok' }))
	const request = () =>
		requestStructuredAi({
			capability: 'tracking-command',
			promptVersion: 'test-v1',
			instructions: 'Return the value.',
			input: { memberText: 'hello' },
			outputSchema: OutputSchema,
			jsonSchemaName: 'test_output',
			jsonSchema,
			assertSafeInput() {},
			rateLimitKey: 'member-1',
			rateLimit: 1,
			now: 1_000,
			fetchImpl,
		})
	await expect(request()).resolves.toEqual({ value: 'ok' })
	await expect(request()).rejects.toMatchObject({
		reason: 'rate-limited',
	})
	expect(fetchImpl).toHaveBeenCalledOnce()
	expect(getAiGatewayTelemetry().at(-1)).toEqual(
		expect.objectContaining({ fallbackReason: 'rate-limited' }),
	)
})

test('identifies and throttles shared anonymous bucket warnings', async () => {
	vi.stubEnv('OPENAI_API_KEY', 'test-key')
	const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
	const fetchImpl = vi.fn<typeof fetch>(async () => response({ value: 'ok' }))
	const request = () =>
		requestStructuredAi({
			capability: 'tip-of-tongue',
			promptVersion: 'shared-anonymous-limit-test-v1',
			instructions: 'Return the value.',
			input: { memory: 'private clue' },
			outputSchema: OutputSchema,
			jsonSchemaName: 'test_output',
			jsonSchema,
			assertSafeInput() {},
			rateLimitKey: 'anonymous:shared',
			rateLimit: 1,
			now: 1_000,
			fetchImpl,
		})

	await expect(request()).resolves.toEqual({ value: 'ok' })
	await expect(request()).rejects.toMatchObject({ reason: 'rate-limited' })
	await expect(request()).rejects.toMatchObject({ reason: 'rate-limited' })
	expect(fetchImpl).toHaveBeenCalledOnce()
	expect(warning).toHaveBeenCalledOnce()
	expect(warning).toHaveBeenCalledWith(
		'Shared anonymous AI request bucket reached its limit',
		{ capability: 'tip-of-tongue' },
	)
	expect(getAiGatewayTelemetry().slice(1)).toEqual([
		expect.objectContaining({ fallbackReason: 'shared-rate-limited' }),
		expect.objectContaining({ fallbackReason: 'shared-rate-limited' }),
	])
	expect(JSON.stringify(getAiGatewayTelemetry())).not.toContain('private clue')
})

test('records unsafe input rejections without retaining input or calling the provider', async () => {
	vi.stubEnv('OPENAI_API_KEY', 'test-key')
	vi.stubEnv('NODE_ENV', 'production')
	const fetchMock = vi.fn<typeof fetch>()
	vi.stubGlobal('fetch', fetchMock)
	const unsafeInput = { memberText: 'private contract failure' }
	const unsafeError = new Error('Unsafe test payload')
	const promptVersion = `unsafe-input-test-${randomUUID()}`
	try {
		await expect(
			requestStructuredAi({
				capability: 'review-assistance',
				promptVersion,
				instructions: 'Return the value.',
				input: unsafeInput,
				outputSchema: OutputSchema,
				jsonSchemaName: 'test_output',
				jsonSchema,
				assertSafeInput(input) {
					expect(input).toBe(unsafeInput)
					throw unsafeError
				},
			}),
		).rejects.toBe(unsafeError)
		expect(fetchMock).not.toHaveBeenCalled()
		expect(getAiGatewayTelemetry()).toEqual([
			expect.objectContaining({
				outcome: 'error',
				fallbackReason: 'unsafe-input',
				status: null,
			}),
		])
		const events = await prisma.aiUsageEvent.findMany({
			where: { promptVersion },
		})
		expect(events).toEqual([
			expect.objectContaining({
				outcome: 'error',
				fallbackReason: 'unsafe-input',
				status: null,
			}),
		])
		expect(
			JSON.stringify([...getAiGatewayTelemetry(), ...events]),
		).not.toContain('private contract failure')
	} finally {
		await prisma.aiUsageEvent.deleteMany({ where: { promptVersion } })
	}
})

test('records rejected multimodal capability contracts without network access', async () => {
	vi.stubEnv('OPENAI_API_KEY', 'test-key')
	const fetchImpl = vi.fn<typeof fetch>()
	await expect(
		requestStructuredAi({
			capability: 'review-assistance',
			promptVersion: 'unsafe-multimodal-test-v1',
			instructions: 'Return the value.',
			input: { memberText: 'hello' },
			apiInput: [{ type: 'input_image', image_url: 'private' }],
			outputSchema: OutputSchema,
			jsonSchemaName: 'test_output',
			jsonSchema,
			assertSafeInput() {},
			fetchImpl,
		}),
	).rejects.toMatchObject({ reason: 'error' })
	expect(fetchImpl).not.toHaveBeenCalled()
	expect(getAiGatewayTelemetry()).toEqual([
		expect.objectContaining({ fallbackReason: 'unsafe-input' }),
	])
})

test('applies gateway admission and telemetry to moderation classification', async () => {
	vi.stubEnv('OPENAI_API_KEY', 'test-key')
	const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
		expect(String(url)).toBe('https://api.openai.com/v1/moderations')
		expect(JSON.parse(String(init?.body))).toEqual({
			model: 'omni-moderation-latest',
			input: 'reported text',
		})
		return moderationResponse()
	})
	const request = () =>
		requestModerationClassification({
			input: 'reported text',
			rateLimitKey: 'staff:moderator-one',
			rateLimit: 1,
			now: 1_000,
			fetchImpl,
		})

	await expect(request()).resolves.toEqual({
		flagged: true,
		categories: ['harassment'],
		critical: false,
	})
	await expect(request()).rejects.toMatchObject({ reason: 'rate-limited' })
	expect(fetchImpl).toHaveBeenCalledOnce()
	expect(getAiGatewayTelemetry()).toEqual([
		expect.objectContaining({
			capability: 'moderation-triage',
			model: 'omni-moderation-latest',
			promptVersion: 'moderation-classifier-v1',
			outcome: 'success',
			status: 200,
		}),
		expect.objectContaining({
			capability: 'moderation-triage',
			promptVersion: 'moderation-classifier-v1',
			outcome: 'rate-limited',
		}),
	])
})

test('shares moderation classifier failures with the capability circuit', async () => {
	vi.stubEnv('OPENAI_API_KEY', 'test-key')
	const classifierFetch = vi.fn<typeof fetch>(async () =>
		moderationResponse({ error: { code: 'insufficient_quota' } }, 429),
	)
	await expect(
		requestModerationClassification({
			input: 'reported text',
			rateLimitKey: 'staff:moderator-two',
			now: 1_000,
			fetchImpl: classifierFetch,
		}),
	).rejects.toMatchObject({ reason: 'unavailable', status: 429 })

	const triageFetch = vi.fn<typeof fetch>()
	await expect(
		requestStructuredAi({
			capability: 'moderation-triage',
			promptVersion: 'moderation-triage-test-v1',
			instructions: 'Return the value.',
			input: { reportedContent: 'reported text' },
			outputSchema: OutputSchema,
			jsonSchemaName: 'test_output',
			jsonSchema,
			assertSafeInput() {},
			now: 2_000,
			fetchImpl: triageFetch,
		}),
	).rejects.toMatchObject({ reason: 'unavailable' })
	expect(classifierFetch).toHaveBeenCalledOnce()
	expect(triageFetch).not.toHaveBeenCalled()
})

test('records configured model failures distinctly and suppresses retries until recovery', async () => {
	vi.stubEnv('OPENAI_API_KEY', 'test-key')
	const circuit: AiCircuit = { unavailableUntil: 0 }
	const fetchImpl = vi
		.fn<typeof fetch>()
		.mockResolvedValueOnce(
			response({ error: { code: 'model_not_found' } }, 404),
		)
		.mockResolvedValueOnce(response({ value: 'recovered' }))
	const request = (now: number) =>
		requestStructuredAi({
			capability: 'review-assistance',
			promptVersion: 'model-unavailable-test-v1',
			instructions: 'Return the value.',
			input: { memberText: 'private input' },
			outputSchema: OutputSchema,
			jsonSchemaName: 'test_output',
			jsonSchema,
			assertSafeInput() {},
			fetchImpl,
			now,
			circuit,
		})

	await expect(request(1_000)).rejects.toMatchObject({
		reason: 'unavailable',
		status: 404,
		code: 'model_not_found',
	})
	expect(circuit).toMatchObject({
		unavailableUntil: 601_000,
		unavailableReason: 'model-unavailable',
	})
	await expect(request(2_000)).rejects.toMatchObject({ reason: 'unavailable' })
	expect(fetchImpl).toHaveBeenCalledOnce()
	expect(getAiGatewayTelemetry().map(event => event.fallbackReason)).toEqual([
		'model-unavailable',
		'model-unavailable',
	])
	expect(JSON.stringify(getAiGatewayTelemetry())).not.toContain('private input')

	await expect(request(601_001)).resolves.toEqual({ value: 'recovered' })
	expect(fetchImpl).toHaveBeenCalledTimes(2)
	expect(circuit).toEqual({ unavailableUntil: 0 })
})

test('does not classify an unrelated provider 404 as model unavailability', async () => {
	vi.stubEnv('OPENAI_API_KEY', 'test-key')
	const circuit: AiCircuit = { unavailableUntil: 0 }
	const fetchImpl = vi.fn<typeof fetch>(async () =>
		response({ error: { code: 'resource_not_found' } }, 404),
	)
	const request = () =>
		requestStructuredAi({
			capability: 'review-assistance',
			promptVersion: 'ordinary-404-test-v1',
			instructions: 'Return the value.',
			input: { memberText: 'hello' },
			outputSchema: OutputSchema,
			jsonSchemaName: 'test_output',
			jsonSchema,
			assertSafeInput() {},
			fetchImpl,
			circuit,
		})

	await expect(request()).rejects.toMatchObject({
		reason: 'error',
		status: 404,
	})
	await expect(request()).rejects.toMatchObject({ reason: 'error' })
	expect(fetchImpl).toHaveBeenCalledTimes(2)
	expect(circuit).toEqual({ unavailableUntil: 0 })
	expect(getAiGatewayTelemetry().at(-1)).toEqual(
		expect.objectContaining({ fallbackReason: 'error' }),
	)
})

test('does not spend the shared daily budget on a per-client rejection', async () => {
	vi.stubEnv('OPENAI_API_KEY', 'test-key')
	vi.stubEnv('VEUD_AI_DAILY_LIMIT_PER_CAPABILITY', '2')
	const fetchImpl = vi.fn<typeof fetch>(async () => response({ value: 'ok' }))
	const request = (rateLimitKey: string) =>
		requestStructuredAi({
			capability: 'tracking-command',
			promptVersion: 'admission-order-test-v1',
			instructions: 'Return the value.',
			input: { memberText: 'hello' },
			outputSchema: OutputSchema,
			jsonSchemaName: 'test_output',
			jsonSchema,
			assertSafeInput() {},
			rateLimitKey,
			rateLimit: 1,
			now: 1_000,
			fetchImpl,
		})

	await expect(request('viewer-one')).resolves.toEqual({ value: 'ok' })
	await expect(request('viewer-one')).rejects.toMatchObject({
		reason: 'rate-limited',
	})
	await expect(request('viewer-two')).resolves.toEqual({ value: 'ok' })
	expect(fetchImpl).toHaveBeenCalledTimes(2)
})

test('does not spend client or shared daily budgets on a concurrency rejection', async () => {
	vi.stubEnv('OPENAI_API_KEY', 'test-key')
	vi.stubEnv('VEUD_AI_DAILY_LIMIT_PER_CAPABILITY', '2')
	vi.stubEnv('VEUD_AI_MAX_CONCURRENCY', '1')
	let releaseFirstRequest = () => {}
	const firstRequestHeld = new Promise<void>(resolve => {
		releaseFirstRequest = resolve
	})
	let fetchCount = 0
	const fetchImpl = vi.fn<typeof fetch>(async () => {
		fetchCount += 1
		if (fetchCount === 1) await firstRequestHeld
		return response({ value: 'ok' })
	})
	const request = (rateLimitKey: string) =>
		requestStructuredAi({
			capability: 'tracking-command',
			promptVersion: 'concurrency-admission-test-v1',
			instructions: 'Return the value.',
			input: { memberText: 'hello' },
			outputSchema: OutputSchema,
			jsonSchemaName: 'test_output',
			jsonSchema,
			assertSafeInput() {},
			rateLimitKey,
			rateLimit: 1,
			now: 1_000,
			fetchImpl,
		})

	const firstRequest = request('viewer-one')
	await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce())
	try {
		await expect(request('viewer-two')).rejects.toMatchObject({
			reason: 'unavailable',
		})
	} finally {
		releaseFirstRequest()
	}
	await expect(firstRequest).resolves.toEqual({ value: 'ok' })
	await expect(request('viewer-two')).resolves.toEqual({ value: 'ok' })
	expect(fetchImpl).toHaveBeenCalledTimes(2)
})

test('reserves provider capacity for members and moderation', async () => {
	vi.stubEnv('OPENAI_API_KEY', 'test-key')
	vi.stubEnv('VEUD_AI_MAX_CONCURRENCY', '4')
	let releaseRequests = () => {}
	const requestsHeld = new Promise<void>(resolve => {
		releaseRequests = resolve
	})
	const fetchImpl = vi.fn<typeof fetch>(async () => {
		await requestsHeld
		return response({ value: 'ok' })
	})
	const request = (capability: AiCapability, rateLimitKey: string) =>
		requestStructuredAi({
			capability,
			promptVersion: 'priority-admission-test-v1',
			instructions: 'Return the value.',
			input: { memberText: 'hello' },
			outputSchema: OutputSchema,
			jsonSchemaName: 'test_output',
			jsonSchema,
			assertSafeInput() {},
			rateLimitKey,
			fetchImpl,
		})

	const anonymousOne = request('tip-of-tongue', 'anonymous:one')
	const anonymousTwo = request('tip-of-tongue', 'anonymous:two')
	let memberRequest: ReturnType<typeof request> | undefined
	let moderationRequest: ReturnType<typeof request> | undefined
	try {
		await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2))
		await expect(
			request('tip-of-tongue', 'anonymous:three'),
		).rejects.toMatchObject({ reason: 'unavailable' })

		memberRequest = request('tracking-command', 'member:one')
		await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(3))
		await expect(
			request('tracking-command', 'member:two'),
		).rejects.toMatchObject({ reason: 'unavailable' })

		moderationRequest = request('moderation-triage', 'moderator:one')
		await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(4))
	} finally {
		releaseRequests()
	}

	await expect(
		Promise.all([anonymousOne, anonymousTwo, memberRequest, moderationRequest]),
	).resolves.toEqual([
		{ value: 'ok' },
		{ value: 'ok' },
		{ value: 'ok' },
		{ value: 'ok' },
	])
	expect(fetchImpl).toHaveBeenCalledTimes(4)
	expect(
		getAiGatewayTelemetry()
			.filter(event => event.outcome === 'unavailable')
			.map(event => event.fallbackReason),
	).toEqual(['reserved-capacity', 'reserved-capacity'])
})

test('keeps anonymous requests available with a one-slot ceiling', async () => {
	vi.stubEnv('OPENAI_API_KEY', 'test-key')
	vi.stubEnv('VEUD_AI_MAX_CONCURRENCY', '1')
	const fetchImpl = vi.fn<typeof fetch>(async () => response({ value: 'ok' }))

	await expect(
		requestStructuredAi({
			capability: 'tip-of-tongue',
			promptVersion: 'minimum-capacity-test-v1',
			instructions: 'Return the value.',
			input: { memory: 'old animated film' },
			outputSchema: OutputSchema,
			jsonSchemaName: 'test_output',
			jsonSchema,
			assertSafeInput() {},
			rateLimitKey: 'anonymous:minimum',
			fetchImpl,
		}),
	).resolves.toEqual({ value: 'ok' })
	expect(fetchImpl).toHaveBeenCalledOnce()
})

test('does not reserve unused capacity when moderation is disabled', async () => {
	vi.stubEnv('OPENAI_API_KEY', 'test-key')
	vi.stubEnv('VEUD_AI_MAX_CONCURRENCY', '4')
	vi.stubEnv('VEUD_AI_MODERATION_TRIAGE_ENABLED', 'false')
	let releaseRequests = () => {}
	const requestsHeld = new Promise<void>(resolve => {
		releaseRequests = resolve
	})
	const fetchImpl = vi.fn<typeof fetch>(async () => {
		await requestsHeld
		return response({ value: 'ok' })
	})
	const request = (key: string) =>
		requestStructuredAi({
			capability: 'tracking-command',
			promptVersion: 'disabled-moderation-capacity-test-v1',
			instructions: 'Return the value.',
			input: { memberText: 'hello' },
			outputSchema: OutputSchema,
			jsonSchemaName: 'test_output',
			jsonSchema,
			assertSafeInput() {},
			rateLimitKey: key,
			fetchImpl,
		})
	const requests = [1, 2, 3, 4].map(number => request(`member:${number}`))

	try {
		await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(4))
	} finally {
		releaseRequests()
	}
	await expect(Promise.all(requests)).resolves.toEqual(
		Array.from({ length: 4 }, () => ({ value: 'ok' })),
	)
})

test('resets in-process daily budgets at the UTC day boundary', async () => {
	vi.stubEnv('OPENAI_API_KEY', 'test-key')
	vi.stubEnv('VEUD_AI_DAILY_LIMIT_PER_CAPABILITY', '1')
	const fetchImpl = vi.fn<typeof fetch>(async () => response({ value: 'ok' }))
	const request = (now: number) =>
		requestStructuredAi({
			capability: 'tracking-command',
			promptVersion: 'utc-budget-test-v1',
			instructions: 'Return the value.',
			input: { memberText: 'hello' },
			outputSchema: OutputSchema,
			jsonSchemaName: 'test_output',
			jsonSchema,
			assertSafeInput() {},
			rateLimitKey: 'viewer-utc',
			rateLimit: 10,
			now,
			fetchImpl,
		})

	await expect(request(86_400_000 - 1)).resolves.toEqual({ value: 'ok' })
	await expect(request(86_400_000 + 1)).resolves.toEqual({ value: 'ok' })
	expect(fetchImpl).toHaveBeenCalledTimes(2)
})

test('coordinates production limits across process state and persists privacy-safe telemetry', async () => {
	vi.stubEnv('OPENAI_API_KEY', 'test-key')
	vi.stubEnv('NODE_ENV', 'production')
	const subject = `member-${randomUUID()}`
	const fetchMock = vi.fn<typeof fetch>(async () => response({ value: 'ok' }))
	vi.stubGlobal('fetch', fetchMock)
	const request = () =>
		requestStructuredAi({
			capability: 'tracking-command',
			promptVersion: 'durable-test-v1',
			instructions: 'Return the value.',
			input: { memberText: 'private and never stored' },
			outputSchema: OutputSchema,
			jsonSchemaName: 'test_output',
			jsonSchema,
			assertSafeInput() {},
			rateLimitKey: subject,
			rateLimit: 1,
			now: 10_000,
		})

	await expect(request()).resolves.toEqual({ value: 'ok' })
	resetAiGatewayStateForTests()
	await expect(request()).rejects.toMatchObject({ reason: 'rate-limited' })
	expect(fetchMock).toHaveBeenCalledOnce()

	const events = await prisma.aiUsageEvent.findMany({
		where: { promptVersion: 'durable-test-v1' },
	})
	expect(events.map(event => event.outcome).sort()).toEqual([
		'rate-limited',
		'success',
	])
	expect(JSON.stringify(events)).not.toContain('private and never stored')
	await prisma.aiUsageEvent.deleteMany({
		where: { promptVersion: 'durable-test-v1' },
	})
})

test('identifies a durable shared anonymous rejection after process restart', async () => {
	vi.stubEnv('OPENAI_API_KEY', 'test-key')
	vi.stubEnv('NODE_ENV', 'production')
	const now = Date.UTC(2044, 4, 6, 12)
	const windowStartedAt = new Date(Math.floor(now / 86_400_000) * 86_400_000)
	const fetchMock = vi.fn<typeof fetch>(async () => response({ value: 'ok' }))
	vi.stubGlobal('fetch', fetchMock)
	const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
	const request = () =>
		requestStructuredAi({
			capability: 'import-reconciliation',
			promptVersion: 'durable-shared-limit-test-v1',
			instructions: 'Return the value.',
			input: { memberText: 'private import data' },
			outputSchema: OutputSchema,
			jsonSchemaName: 'test_output',
			jsonSchema,
			assertSafeInput() {},
			rateLimitKey: 'anonymous:shared',
			rateLimit: 1,
			now,
		})

	try {
		await expect(request()).resolves.toEqual({ value: 'ok' })
		resetAiGatewayStateForTests()
		await expect(request()).rejects.toMatchObject({ reason: 'rate-limited' })
		expect(fetchMock).toHaveBeenCalledOnce()
		expect(warning).toHaveBeenCalledOnce()
		const events = await prisma.aiUsageEvent.findMany({
			where: { promptVersion: 'durable-shared-limit-test-v1' },
			orderBy: { createdAt: 'asc' },
		})
		expect(events.map(event => event.fallbackReason)).toEqual([
			null,
			'shared-rate-limited',
		])
		expect(JSON.stringify(events)).not.toContain('private import data')
	} finally {
		await prisma.aiUsageEvent.deleteMany({
			where: { promptVersion: 'durable-shared-limit-test-v1' },
		})
		await prisma.aiRateLimitBucket.deleteMany({
			where: {
				capability: 'import-reconciliation',
				windowStartedAt: { gte: windowStartedAt },
			},
		})
	}
})

test('enforces the durable daily capability budget across client keys and process state', async () => {
	vi.stubEnv('OPENAI_API_KEY', 'test-key')
	vi.stubEnv('NODE_ENV', 'production')
	vi.stubEnv('VEUD_AI_DAILY_LIMIT_PER_CAPABILITY', '1')
	vi.stubEnv('VEUD_AI_ANONYMOUS_DAILY_LIMIT_PER_CAPABILITY', '10')
	const now = Date.UTC(2042, 3, 5, 12)
	const windowStartedAt = new Date(Math.floor(now / 86_400_000) * 86_400_000)
	const fetchMock = vi.fn<typeof fetch>(async () => response({ value: 'ok' }))
	vi.stubGlobal('fetch', fetchMock)
	vi.spyOn(console, 'warn').mockImplementation(() => undefined)
	const request = (rateLimitKey: string) =>
		requestStructuredAi({
			capability: 'review-assistance',
			promptVersion: 'daily-budget-test-v1',
			instructions: 'Return the value.',
			input: { memberText: 'hello' },
			outputSchema: OutputSchema,
			jsonSchemaName: 'test_output',
			jsonSchema,
			assertSafeInput() {},
			rateLimitKey,
			rateLimit: 10,
			now,
		})

	try {
		await expect(request('viewer-one')).resolves.toEqual({ value: 'ok' })
		resetAiGatewayStateForTests()
		await expect(request('viewer-two')).rejects.toMatchObject({
			reason: 'rate-limited',
		})
		expect(fetchMock).toHaveBeenCalledOnce()
		expect(console.warn).toHaveBeenCalledWith(
			'AI daily request budget threshold reached',
			expect.objectContaining({
				capability: 'review-assistance',
				scope: 'global',
				limit: 1,
			}),
		)
	} finally {
		await prisma.aiUsageEvent.deleteMany({
			where: { promptVersion: 'daily-budget-test-v1' },
		})
		await prisma.aiRateLimitBucket.deleteMany({
			where: {
				capability: 'review-assistance',
				windowStartedAt: { gte: windowStartedAt },
			},
		})
	}
})

test('opens a shared circuit for provider and quota failures', async () => {
	vi.stubEnv('OPENAI_API_KEY', 'test-key')
	const circuit: AiCircuit = { unavailableUntil: 0 }
	const firstFetch = vi.fn<typeof fetch>(async () =>
		response({ error: { code: 'insufficient_quota' } }, 429),
	)
	const options = {
		capability: 'tip-of-tongue' as const,
		promptVersion: 'test-v1',
		instructions: 'Return the value.',
		input: { memory: 'hello' },
		outputSchema: OutputSchema,
		jsonSchemaName: 'test_output',
		jsonSchema,
		assertSafeInput() {},
		now: 1_000,
		circuit,
	}
	await expect(
		requestStructuredAi({ ...options, fetchImpl: firstFetch }),
	).rejects.toMatchObject({ reason: 'unavailable' })
	expect(circuit.unavailableUntil).toBe(3_601_000)
	const secondFetch = vi.fn<typeof fetch>()
	await expect(
		requestStructuredAi({ ...options, now: 2_000, fetchImpl: secondFetch }),
	).rejects.toMatchObject({ reason: 'unavailable' })
	expect(secondFetch).not.toHaveBeenCalled()
})

test('opens the circuit only after three transient server failures', async () => {
	vi.stubEnv('OPENAI_API_KEY', 'test-key')
	const circuit: AiCircuit = { unavailableUntil: 0 }
	const fetchImpl = vi.fn<typeof fetch>(async () =>
		response({ error: { code: 'server_error' } }, 500),
	)
	const request = (now: number) =>
		requestStructuredAi({
			capability: 'review-assistance',
			promptVersion: 'server-circuit-test-v1',
			instructions: 'Return the value.',
			input: { memberText: 'hello' },
			outputSchema: OutputSchema,
			jsonSchemaName: 'test_output',
			jsonSchema,
			assertSafeInput() {},
			now,
			circuit,
			fetchImpl,
		})

	await expect(request(1_000)).rejects.toMatchObject({
		reason: 'unavailable',
		status: 500,
	})
	await expect(request(2_000)).rejects.toMatchObject({
		reason: 'unavailable',
		status: 500,
	})
	expect(circuit.unavailableUntil).toBe(0)
	await expect(request(3_000)).rejects.toMatchObject({
		reason: 'unavailable',
		status: 500,
	})
	expect(circuit.unavailableUntil).toBe(603_000)
	await expect(request(4_000)).rejects.toMatchObject({
		reason: 'unavailable',
		status: null,
	})
	expect(fetchImpl).toHaveBeenCalledTimes(3)
})

test('counts transport failures in a bounded window and resets after success', async () => {
	vi.stubEnv('OPENAI_API_KEY', 'test-key')
	const circuit: AiCircuit = { unavailableUntil: 0 }
	const outcomes = [
		'timeout',
		'timeout',
		'success',
		'timeout',
		'timeout',
		'timeout',
		'timeout',
		'timeout',
	] as const
	let outcomeIndex = 0
	const fetchImpl = vi.fn<typeof fetch>(async () => {
		const outcome = outcomes[outcomeIndex++]
		if (outcome === 'timeout') {
			const error = new Error('provider timed out')
			error.name = 'TimeoutError'
			throw error
		}
		return response({ value: 'ok' })
	})
	const request = (now: number) =>
		requestStructuredAi({
			capability: 'natural-language-discovery',
			promptVersion: 'transport-circuit-test-v1',
			instructions: 'Return the value.',
			input: { memberText: 'hello' },
			outputSchema: OutputSchema,
			jsonSchemaName: 'test_output',
			jsonSchema,
			assertSafeInput() {},
			now,
			circuit,
			fetchImpl,
		})

	await expect(request(1_000)).rejects.toMatchObject({
		reason: 'unavailable',
		status: null,
	})
	await expect(request(2_000)).rejects.toMatchObject({ reason: 'unavailable' })
	expect(circuit).toEqual(
		expect.objectContaining({
			unavailableUntil: 0,
			transientFailures: 2,
			transientWindowStartedAt: 1_000,
		}),
	)
	await expect(request(3_000)).resolves.toEqual({ value: 'ok' })
	expect(circuit.transientFailures).toBeUndefined()

	await expect(request(4_000)).rejects.toMatchObject({ reason: 'unavailable' })
	await expect(request(5_000)).rejects.toMatchObject({ reason: 'unavailable' })
	expect(circuit.unavailableUntil).toBe(0)
	await expect(request(64_000)).rejects.toMatchObject({ reason: 'unavailable' })
	expect(circuit.transientFailures).toBe(1)
	await expect(request(65_000)).rejects.toMatchObject({ reason: 'unavailable' })
	await expect(request(66_000)).rejects.toMatchObject({ reason: 'unavailable' })
	expect(circuit.unavailableUntil).toBe(666_000)

	await expect(request(67_000)).rejects.toMatchObject({ reason: 'unavailable' })
	expect(fetchImpl).toHaveBeenCalledTimes(8)
	expect(getAiGatewayTelemetry()).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				promptVersion: 'transport-circuit-test-v1',
				outcome: 'unavailable',
				status: null,
			}),
		]),
	)
})

test('honors global and capability kill switches before network access', async () => {
	vi.stubEnv('OPENAI_API_KEY', 'test-key')
	vi.stubEnv('VEUD_AI_REVIEW_ASSISTANCE_ENABLED', 'false')
	const fetchImpl = vi.fn<typeof fetch>()
	await expect(
		requestStructuredAi({
			capability: 'review-assistance',
			promptVersion: 'test-v1',
			instructions: 'Return the value.',
			input: { memberText: 'hello' },
			outputSchema: OutputSchema,
			jsonSchemaName: 'test_output',
			jsonSchema,
			assertSafeInput() {},
			fetchImpl,
		}),
	).rejects.toMatchObject({ reason: 'not-configured' })
	expect(fetchImpl).not.toHaveBeenCalled()
	expect(getAiGatewayTelemetry()).toEqual([
		expect.objectContaining({
			outcome: 'unavailable',
			fallbackReason: 'not-configured',
		}),
	])
})

test('classifies refusals and persists their billed usage without retaining refusal text', async () => {
	vi.stubEnv('OPENAI_API_KEY', 'test-key')
	vi.stubEnv('NODE_ENV', 'production')
	const refusalText = 'private provider refusal explanation'
	const promptVersion = `refusal-test-${randomUUID()}`
	vi.stubGlobal(
		'fetch',
		vi.fn<typeof fetch>(
			async () =>
				new Response(
					JSON.stringify({
						status: 'completed',
						output: [
							{
								type: 'message',
								content: [{ type: 'refusal', refusal: refusalText }],
							},
						],
						usage: { input_tokens: 19, output_tokens: 4 },
					}),
					{ status: 200, headers: { 'content-type': 'application/json' } },
				),
		),
	)

	try {
		await expect(
			requestStructuredAi({
				capability: 'review-assistance',
				promptVersion,
				instructions: 'Return the value.',
				input: { memberText: 'safe input' },
				outputSchema: OutputSchema,
				jsonSchemaName: 'test_output',
				jsonSchema,
				assertSafeInput() {},
			}),
		).rejects.toMatchObject({ reason: 'error', status: 200 })

		const memoryEvent = getAiGatewayTelemetry().at(-1)
		expect(memoryEvent).toEqual(
			expect.objectContaining({
				outcome: 'error',
				fallbackReason: 'refusal',
				inputTokens: 19,
				outputTokens: 4,
			}),
		)
		const durableEvents = await prisma.aiUsageEvent.findMany({
			where: { promptVersion },
		})
		expect(durableEvents).toEqual([
			expect.objectContaining({
				outcome: 'error',
				fallbackReason: 'refusal',
				inputTokens: 19,
				outputTokens: 4,
			}),
		])
		expect(JSON.stringify([memoryEvent, ...durableEvents])).not.toContain(
			refusalText,
		)
	} finally {
		await prisma.aiUsageEvent.deleteMany({ where: { promptVersion } })
	}
})

test.each([
	{
		label: 'the output token cap',
		payload: {
			status: 'incomplete',
			incomplete_details: { reason: 'max_output_tokens' },
			output: [
				{
					type: 'message',
					content: [{ type: 'output_text', text: '{"value":' }],
				},
			],
			usage: { input_tokens: 20, output_tokens: 5 },
		},
		fallbackReason: 'max-output-tokens',
	},
	{
		label: 'the provider content filter',
		payload: {
			status: 'incomplete',
			incomplete_details: { reason: 'content_filter' },
			output: [],
			usage: { input_tokens: 21, output_tokens: 0 },
		},
		fallbackReason: 'content-filter',
	},
	{
		label: 'an otherwise incomplete response',
		payload: {
			status: 'failed',
			output: [],
			usage: { input_tokens: 22, output_tokens: 1 },
		},
		fallbackReason: 'incomplete-response',
	},
	{
		label: 'an empty completed response',
		payload: {
			status: 'completed',
			output: [],
			usage: { input_tokens: 23, output_tokens: 0 },
		},
		fallbackReason: 'empty-output',
	},
	{
		label: 'a drifted response envelope',
		payload: {
			status: 'completed',
			output: 'unexpected',
			usage: { input_tokens: 24, output_tokens: 2 },
		},
		fallbackReason: 'invalid-output',
	},
] as const)(
	'classifies $label while retaining token usage',
	async ({ payload, fallbackReason }) => {
		vi.stubEnv('OPENAI_API_KEY', 'test-key')
		const fetchImpl = vi.fn<typeof fetch>(
			async () =>
				new Response(JSON.stringify(payload), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				}),
		)
		await expect(
			requestStructuredAi({
				capability: 'natural-language-discovery',
				promptVersion: 'response-classification-test-v1',
				instructions: 'Return the value.',
				input: { memberText: 'safe input' },
				outputSchema: OutputSchema,
				jsonSchemaName: 'test_output',
				jsonSchema,
				assertSafeInput() {},
				fetchImpl,
			}),
		).rejects.toMatchObject({ reason: 'error', status: 200 })
		expect(getAiGatewayTelemetry().at(-1)).toEqual(
			expect.objectContaining({
				outcome: 'error',
				fallbackReason,
				inputTokens: payload.usage.input_tokens,
				outputTokens: payload.usage.output_tokens,
			}),
		)
	},
)

test('rejects malformed structured output and records a privacy-safe failure', async () => {
	vi.stubEnv('OPENAI_API_KEY', 'test-key')
	const fetchImpl = vi.fn<typeof fetch>(async () =>
		response({ unexpected: 'field' }),
	)
	await expect(
		requestStructuredAi({
			capability: 'natural-language-discovery',
			promptVersion: 'test-v1',
			instructions: 'Return the value.',
			input: { memberText: 'hello' },
			outputSchema: OutputSchema,
			jsonSchemaName: 'test_output',
			jsonSchema,
			assertSafeInput() {},
			fetchImpl,
		}),
	).rejects.toMatchObject({ reason: 'error' })
	expect(getAiGatewayTelemetry()).toEqual([
		expect.objectContaining({
			capability: 'natural-language-discovery',
			outcome: 'error',
			fallbackReason: 'invalid-output',
			inputTokens: 10,
			outputTokens: 2,
		}),
	])
	expect(JSON.stringify(getAiGatewayTelemetry())).not.toContain('hello')
})
