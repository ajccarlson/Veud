import { afterEach, expect, test, vi } from 'vitest'
import { z } from 'zod'
import {
	getAiGatewayTelemetry,
	requestStructuredAi,
	resetAiGatewayStateForTests,
} from './ai-gateway.server.ts'

afterEach(() => {
	vi.unstubAllEnvs()
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
