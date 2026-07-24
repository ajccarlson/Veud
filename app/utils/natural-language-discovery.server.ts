import { z } from 'zod'
import {
	AiGatewayError,
	type AiCircuit,
	requestStructuredAi,
} from './ai-gateway.server.ts'
import {
	naturalDiscoveryKinds,
	naturalLanguageDiscoveryJsonSchema,
	NaturalLanguageDiscoveryPlanSchema,
	type NaturalLanguageDiscoveryPlan,
} from './natural-language-discovery.ts'

const PROMPT_VERSION = 'natural-discovery-v1'

function selectedKinds(kind: string) {
	return naturalDiscoveryKinds.includes(
		kind as (typeof naturalDiscoveryKinds)[number],
	)
		? [kind as (typeof naturalDiscoveryKinds)[number]]
		: [...naturalDiscoveryKinds]
}

function safeInitialInput(value: unknown) {
	const parsed = z
		.object({
			memberRequest: z.string().trim().min(3).max(500),
			allowedKinds: z.array(z.enum(naturalDiscoveryKinds)).min(1).max(4),
		})
		.strict()
		.safeParse(value)
	if (!parsed.success)
		throw new Error('Unsafe natural-language discovery payload')
}

function safeRefinementInput(value: unknown) {
	const parsed = z
		.object({
			memberPhrases: z.array(z.string().trim().min(1).max(500)).max(12),
			currentPlan: NaturalLanguageDiscoveryPlanSchema,
			newRequest: z.string().trim().min(1).max(500),
		})
		.strict()
		.safeParse(value)
	if (!parsed.success) throw new Error('Unsafe discovery refinement payload')
}

export async function createNaturalLanguageDiscoveryPlan(
	input: { memberRequest: string; kind: string },
	options: {
		rateLimitKey: string
		fetchImpl?: typeof fetch
		now?: number
		circuit?: AiCircuit
	},
) {
	const payload = {
		memberRequest: input.memberRequest.trim().slice(0, 500),
		allowedKinds: selectedKinds(input.kind),
	}
	return await requestStructuredAi({
		capability: 'natural-language-discovery',
		promptVersion: PROMPT_VERSION,
		instructions:
			'Translate the member’s media request into Veud’s closed discovery plan. Use only the allowed media kinds. releaseStatus uses only the generic upcoming, ongoing, completed, hiatus, or cancelled values. Put genres in genre fields; mood or emotional qualities in toneTerms; pace in pace; language in language; and runtime, episode, chapter, or volume bounds in the typed length fields. Length units must be compatible with every selected media kind. Put plot, setting, theme, style, or format concepts in term fields. Keep terms short enough for local retrieval. Preserve explicit exclusions and never include and exclude the same property. If a requested property cannot be represented reliably, repeat it in unsupportedConstraints instead of pretending it was applied. Do not propose or name titles. Do not infer personal information.',
		input: payload,
		outputSchema: NaturalLanguageDiscoveryPlanSchema,
		jsonSchemaName: 'veud_natural_discovery_plan',
		jsonSchema: naturalLanguageDiscoveryJsonSchema,
		assertSafeInput: safeInitialInput,
		rateLimitKey: options.rateLimitKey,
		rateLimit: 10,
		rateLimitWindowMs: 10 * 60 * 1_000,
		fetchImpl: options.fetchImpl,
		now: options.now,
		circuit: options.circuit,
	})
}

export async function refineNaturalLanguageDiscoveryPlan(
	input: {
		memberPhrases: string[]
		currentPlan: NaturalLanguageDiscoveryPlan
		newRequest: string
	},
	options: {
		rateLimitKey: string
		fetchImpl?: typeof fetch
		now?: number
		circuit?: AiCircuit
	},
) {
	const payload = {
		memberPhrases: input.memberPhrases
			.slice(-12)
			.map(value => value.slice(0, 500)),
		currentPlan: NaturalLanguageDiscoveryPlanSchema.parse(input.currentPlan),
		newRequest: input.newRequest.trim().slice(0, 500),
	}
	return await requestStructuredAi({
		capability: 'discovery-refinement',
		promptVersion: PROMPT_VERSION,
		instructions:
			'Update the current Veud discovery plan according to the member’s newest refinement. Return the complete replacement plan. A request to relax, remove, or replace a constraint must actually change the corresponding field. Preserve unrelated constraints. Never add media titles or catalog facts. Put unsupported requests in unsupportedConstraints.',
		input: payload,
		outputSchema: NaturalLanguageDiscoveryPlanSchema,
		jsonSchemaName: 'veud_refined_discovery_plan',
		jsonSchema: naturalLanguageDiscoveryJsonSchema,
		assertSafeInput: safeRefinementInput,
		rateLimitKey: options.rateLimitKey,
		rateLimit: 15,
		rateLimitWindowMs: 10 * 60 * 1_000,
		fetchImpl: options.fetchImpl,
		now: options.now,
		circuit: options.circuit,
	})
}

export function naturalDiscoveryFallbackReason(error: unknown) {
	if (!(error instanceof AiGatewayError)) return 'error' as const
	return error.reason
}
