import { z } from 'zod'
import { requestStructuredAi } from './ai-gateway.server.ts'

export const reviewAssistanceOperations = [
	'clarity',
	'grammar',
	'structure',
	'concise',
	'tone',
	'spoilers',
] as const

const FindingSchema = z
	.object({
		category: z.enum([
			'grammar',
			'clarity',
			'structure',
			'concision',
			'tone',
			'spoiler',
		]),
		original: z.string().max(300),
		replacement: z.string().max(300),
		explanation: z.string().trim().min(1).max(240),
		substantive: z.boolean(),
	})
	.strict()

const AssistanceSchema = z
	.object({
		findings: z.array(FindingSchema).max(8),
		proposedRevision: z.string().max(10_000).nullable(),
		spoilerLikelihood: z.enum(['low', 'medium', 'high']),
		spoilerReason: z.string().trim().max(300),
	})
	.strict()

const assistanceJsonSchema = {
	type: 'object',
	additionalProperties: false,
	required: [
		'findings',
		'proposedRevision',
		'spoilerLikelihood',
		'spoilerReason',
	],
	properties: {
		findings: {
			type: 'array',
			maxItems: 8,
			items: {
				type: 'object',
				additionalProperties: false,
				required: [
					'category',
					'original',
					'replacement',
					'explanation',
					'substantive',
				],
				properties: {
					category: {
						type: 'string',
						enum: [
							'grammar',
							'clarity',
							'structure',
							'concision',
							'tone',
							'spoiler',
						],
					},
					original: { type: 'string' },
					replacement: { type: 'string' },
					explanation: { type: 'string' },
					substantive: { type: 'boolean' },
				},
			},
		},
		proposedRevision: { type: ['string', 'null'] },
		spoilerLikelihood: {
			type: 'string',
			enum: ['low', 'medium', 'high'],
		},
		spoilerReason: { type: 'string' },
	},
}

export async function assistReviewDraft(
	input: {
		draft: string
		operation: (typeof reviewAssistanceOperations)[number]
		rateLimitKey: string
	},
	options: { fetchImpl?: typeof fetch } = {},
) {
	const draft = input.draft.trim()
	if (draft.length < 20 || draft.length > 10_000) {
		throw new Response(
			'Write at least 20 characters (up to 10,000) before requesting assistance.',
			{ status: 400 },
		)
	}
	const result = await requestStructuredAi({
		capability: 'review-assistance',
		promptVersion: 'review-assistance-v1',
		instructions:
			'Assist with the selected editing operation on the member-authored review draft. Do not invent an opinion, viewing experience, media fact, title, synopsis, rating, or recommendation. Mechanical findings should quote a short exact substring and offer a replacement. Mark substantive rewrites clearly. A spoiler judgment is advisory only. Preserve the author’s meaning and voice.',
		input: { memberDraft: draft, operation: input.operation },
		outputSchema: AssistanceSchema,
		jsonSchemaName: 'review_writing_assistance',
		jsonSchema: assistanceJsonSchema,
		assertSafeInput(value) {
			const parsed = z
				.object({
					memberDraft: z.string().min(20).max(10_000),
					operation: z.enum(reviewAssistanceOperations),
				})
				.strict()
				.safeParse(value)
			if (!parsed.success) throw new Error('Unsafe review assistance payload')
		},
		rateLimitKey: input.rateLimitKey,
		rateLimit: 8,
		rateLimitWindowMs: 10 * 60 * 1_000,
		timeoutMs: 14_000,
		fetchImpl: options.fetchImpl,
	})
	return {
		...result,
		findings: result.findings.filter(
			finding =>
				finding.original.length > 0 && draft.includes(finding.original),
		),
		proposedRevision:
			result.proposedRevision?.trim() &&
			result.proposedRevision.trim() !== draft
				? result.proposedRevision.trim()
				: null,
	}
}
