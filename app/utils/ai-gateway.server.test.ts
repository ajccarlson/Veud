import { randomUUID } from 'node:crypto'
import { afterEach, expect, test, vi } from 'vitest'
import { z } from 'zod'
import {
	getAiGatewayTelemetry,
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

function response(value: unknown, status = 200) {
	return new Response(
		JSON.stringify(
			status === 200
				? {
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

test('does not spend the shared daily budget on a concurrency rejection', async () => {
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
	await expect(request('viewer-three')).resolves.toEqual({ value: 'ok' })
	expect(fetchImpl).toHaveBeenCalledTimes(2)
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
	const circuit = { unavailableUntil: 0 }
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
			fallbackReason: 'error',
			inputTokens: null,
			outputTokens: null,
		}),
	])
	expect(JSON.stringify(getAiGatewayTelemetry())).not.toContain('hello')
})
