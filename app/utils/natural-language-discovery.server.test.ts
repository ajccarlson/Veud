import { afterEach, expect, test, vi } from 'vitest'
import { resetAiGatewayStateForTests } from './ai-gateway.server.ts'
import {
	createNaturalLanguageDiscoveryPlan,
	refineNaturalLanguageDiscoveryPlan,
} from './natural-language-discovery.server.ts'
import {
	discoveryPlanChips,
	NaturalLanguageDiscoveryPlanSchema,
	type NaturalLanguageDiscoveryPlan,
} from './natural-language-discovery.ts'

afterEach(() => {
	vi.unstubAllEnvs()
	resetAiGatewayStateForTests()
})

const plan: NaturalLanguageDiscoveryPlan = {
	kinds: ['anime'],
	includeGenres: ['Psychological'],
	excludeGenres: ['Romance'],
	includeTerms: ['slow burn'],
	excludeTerms: ['gore'],
	yearFrom: 1990,
	yearTo: 1999,
	releaseStatus: null,
	language: null,
	toneTerms: [],
	pace: 'slow',
	lengthUnit: 'episodes',
	lengthFrom: null,
	lengthTo: 29,
	sort: 'top-rated',
	explanation: '1990s psychological anime with deliberate pacing.',
	unsupportedConstraints: [],
}

function response(output: unknown) {
	return new Response(
		JSON.stringify({
			output: [
				{
					type: 'message',
					content: [{ type: 'output_text', text: JSON.stringify(output) }],
				},
			],
		}),
		{ status: 200, headers: { 'content-type': 'application/json' } },
	)
}

test('compiles member language without sending catalog records', async () => {
	vi.stubEnv('OPENAI_API_KEY', 'test-key')
	const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
		const body = JSON.parse(String(init?.body)) as { input: string }
		expect(JSON.parse(body.input)).toEqual({
			memberRequest:
				'1990s psychological anime, slow, no romance or gore, under 30 episodes',
			allowedKinds: ['anime'],
		})
		expect(body.input).not.toContain('catalogPopularity')
		return response(plan)
	})
	await expect(
		createNaturalLanguageDiscoveryPlan(
			{
				memberRequest:
					'1990s psychological anime, slow, no romance or gore, under 30 episodes',
				kind: 'anime',
			},
			{ rateLimitKey: 'member-1', fetchImpl },
		),
	).resolves.toEqual(plan)
	expect(discoveryPlanChips(plan)).toContainEqual({
		type: 'excluded concept',
		value: 'gore',
	})
})

test('refinement sends only member phrases and the normalized plan', async () => {
	vi.stubEnv('OPENAI_API_KEY', 'test-key')
	const refined = {
		...plan,
		includeTerms: [],
		explanation: 'A less restrictive psychological anime search.',
	}
	const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
		const body = JSON.parse(String(init?.body)) as { input: string }
		expect(JSON.parse(body.input)).toEqual({
			memberPhrases: ['1990s psychological anime', 'less slow'],
			currentPlan: plan,
			newRequest: 'less slow',
		})
		return response(refined)
	})
	await expect(
		refineNaturalLanguageDiscoveryPlan(
			{
				memberPhrases: ['1990s psychological anime', 'less slow'],
				currentPlan: plan,
				newRequest: 'less slow',
			},
			{ rateLimitKey: 'member-1', fetchImpl },
		),
	).resolves.toEqual(refined)
})

test('rejects contradictory and media-incompatible plans', () => {
	expect(() =>
		NaturalLanguageDiscoveryPlanSchema.parse({
			...plan,
			includeGenres: ['Romance'],
			excludeGenres: ['romance'],
		}),
	).toThrow('both included and excluded')
	expect(() =>
		NaturalLanguageDiscoveryPlanSchema.parse({
			...plan,
			kinds: ['manga'],
			lengthUnit: 'episodes',
		}),
	).toThrow('incompatible')
})
