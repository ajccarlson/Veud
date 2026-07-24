import { z } from 'zod'

export const naturalDiscoveryKinds = ['movie', 'tv', 'anime', 'manga'] as const
export const naturalDiscoverySorts = [
	'popular',
	'top-rated',
	'newest',
	'title',
	'for-you',
] as const
export const naturalDiscoveryReleaseStates = [
	'upcoming',
	'ongoing',
	'completed',
	'hiatus',
	'cancelled',
] as const

function normalizedSet(values: string[]) {
	return new Set(values.map(value => value.trim().toLocaleLowerCase()))
}

export const NaturalLanguageDiscoveryPlanSchema = z
	.object({
		kinds: z.array(z.enum(naturalDiscoveryKinds)).min(1).max(4),
		includeGenres: z.array(z.string().trim().min(1).max(80)).max(8),
		excludeGenres: z.array(z.string().trim().min(1).max(80)).max(8),
		includeTerms: z.array(z.string().trim().min(2).max(80)).max(12),
		excludeTerms: z.array(z.string().trim().min(2).max(80)).max(12),
		yearFrom: z.number().int().min(1870).max(2200).nullable(),
		yearTo: z.number().int().min(1870).max(2200).nullable(),
		releaseStatus: z.enum(naturalDiscoveryReleaseStates).nullable(),
		language: z.string().trim().min(2).max(60).nullable(),
		toneTerms: z.array(z.string().trim().min(2).max(80)).max(6),
		pace: z.enum(['slow', 'moderate', 'fast']).nullable(),
		lengthUnit: z
			.enum(['minutes', 'episodes', 'chapters', 'volumes'])
			.nullable(),
		lengthFrom: z.number().int().min(0).max(1_000_000).nullable(),
		lengthTo: z.number().int().min(0).max(1_000_000).nullable(),
		sort: z.enum(naturalDiscoverySorts),
		explanation: z.string().trim().min(1).max(300),
		unsupportedConstraints: z.array(z.string().trim().min(1).max(160)).max(8),
	})
	.strict()
	.superRefine((plan, context) => {
		const includedGenres = normalizedSet(plan.includeGenres)
		const excludedGenres = normalizedSet(plan.excludeGenres)
		const includedTerms = normalizedSet([
			...plan.includeTerms,
			...plan.toneTerms,
		])
		const excludedTerms = normalizedSet(plan.excludeTerms)
		if ([...includedGenres].some(value => excludedGenres.has(value))) {
			context.addIssue({
				code: 'custom',
				path: ['excludeGenres'],
				message: 'a genre cannot be both included and excluded',
			})
		}
		if ([...includedTerms].some(value => excludedTerms.has(value))) {
			context.addIssue({
				code: 'custom',
				path: ['excludeTerms'],
				message: 'a concept cannot be both included and excluded',
			})
		}
		if (
			plan.yearFrom !== null &&
			plan.yearTo !== null &&
			plan.yearFrom > plan.yearTo
		) {
			context.addIssue({
				code: 'custom',
				path: ['yearTo'],
				message: 'yearTo must be greater than or equal to yearFrom',
			})
		}
		if (
			(plan.lengthFrom !== null || plan.lengthTo !== null) &&
			plan.lengthUnit === null
		) {
			context.addIssue({
				code: 'custom',
				path: ['lengthUnit'],
				message: 'lengthUnit is required when a length bound is supplied',
			})
		}
		if (
			plan.lengthFrom !== null &&
			plan.lengthTo !== null &&
			plan.lengthFrom > plan.lengthTo
		) {
			context.addIssue({
				code: 'custom',
				path: ['lengthTo'],
				message: 'lengthTo must be greater than or equal to lengthFrom',
			})
		}
		const compatibleKinds = {
			minutes: ['movie', 'tv', 'anime'],
			episodes: ['tv', 'anime'],
			chapters: ['manga'],
			volumes: ['manga'],
		} as const
		const compatibleLengthKinds: readonly string[] = plan.lengthUnit
			? compatibleKinds[plan.lengthUnit]
			: []
		if (
			plan.lengthUnit &&
			plan.kinds.some(kind => !compatibleLengthKinds.includes(kind))
		) {
			context.addIssue({
				code: 'custom',
				path: ['lengthUnit'],
				message: `${plan.lengthUnit} bounds are incompatible with one or more selected media kinds`,
			})
		}
	})

export type NaturalLanguageDiscoveryPlan = z.infer<
	typeof NaturalLanguageDiscoveryPlanSchema
>

export const naturalLanguageDiscoveryJsonSchema = {
	type: 'object',
	additionalProperties: false,
	required: [
		'kinds',
		'includeGenres',
		'excludeGenres',
		'includeTerms',
		'excludeTerms',
		'yearFrom',
		'yearTo',
		'releaseStatus',
		'language',
		'toneTerms',
		'pace',
		'lengthUnit',
		'lengthFrom',
		'lengthTo',
		'sort',
		'explanation',
		'unsupportedConstraints',
	],
	properties: {
		kinds: {
			type: 'array',
			minItems: 1,
			maxItems: 4,
			items: { type: 'string', enum: naturalDiscoveryKinds },
		},
		includeGenres: {
			type: 'array',
			maxItems: 8,
			items: { type: 'string' },
		},
		excludeGenres: {
			type: 'array',
			maxItems: 8,
			items: { type: 'string' },
		},
		includeTerms: {
			type: 'array',
			maxItems: 12,
			items: { type: 'string' },
		},
		excludeTerms: {
			type: 'array',
			maxItems: 12,
			items: { type: 'string' },
		},
		yearFrom: { type: ['integer', 'null'] },
		yearTo: { type: ['integer', 'null'] },
		releaseStatus: {
			type: ['string', 'null'],
			enum: [...naturalDiscoveryReleaseStates, null],
		},
		language: { type: ['string', 'null'] },
		toneTerms: {
			type: 'array',
			maxItems: 6,
			items: { type: 'string' },
		},
		pace: {
			type: ['string', 'null'],
			enum: ['slow', 'moderate', 'fast', null],
		},
		lengthUnit: {
			type: ['string', 'null'],
			enum: ['minutes', 'episodes', 'chapters', 'volumes', null],
		},
		lengthFrom: { type: ['integer', 'null'] },
		lengthTo: { type: ['integer', 'null'] },
		sort: { type: 'string', enum: naturalDiscoverySorts },
		explanation: { type: 'string' },
		unsupportedConstraints: {
			type: 'array',
			maxItems: 8,
			items: { type: 'string' },
		},
	},
}

export function discoveryPlanChips(plan: NaturalLanguageDiscoveryPlan) {
	return [
		...plan.kinds.map(value => ({ type: 'kind', value })),
		...plan.includeGenres.map(value => ({ type: 'genre', value })),
		...plan.excludeGenres.map(value => ({
			type: 'excluded genre',
			value,
		})),
		...plan.includeTerms.map(value => ({ type: 'concept', value })),
		...plan.excludeTerms.map(value => ({
			type: 'excluded concept',
			value,
		})),
		...(plan.yearFrom === null && plan.yearTo === null
			? []
			: [
					{
						type: 'years',
						value: `${plan.yearFrom ?? 'any'}–${plan.yearTo ?? 'now'}`,
					},
				]),
		...(plan.releaseStatus
			? [{ type: 'status', value: plan.releaseStatus }]
			: []),
		...(plan.language ? [{ type: 'language', value: plan.language }] : []),
		...plan.toneTerms.map(value => ({ type: 'tone', value })),
		...(plan.pace ? [{ type: 'pace', value: plan.pace }] : []),
		...(plan.lengthUnit && (plan.lengthFrom !== null || plan.lengthTo !== null)
			? [
					{
						type: plan.lengthUnit,
						value: `${plan.lengthFrom ?? 'any'}–${plan.lengthTo ?? 'any'}`,
					},
				]
			: []),
		{ type: 'sort', value: plan.sort },
	]
}
