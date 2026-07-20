import { z } from 'zod'
import { MediaIdentitySchema, type MediaIdentity } from './media-identity.ts'

export const mediaRelationTypes = [
	'adaptation',
	'alternative_setting',
	'alternative_version',
	'character',
	'compilation',
	'franchise',
	'full_story',
	'other',
	'parent_story',
	'prequel',
	'remake',
	'sequel',
	'side_story',
	'source_material',
	'spin_off',
	'summary',
] as const

export type MediaRelationType = (typeof mediaRelationTypes)[number]

const MediaRelationTypeSchema = z.preprocess(
	value =>
		typeof value === 'string'
			? value
					.trim()
					.toLowerCase()
					.replace(/[^a-z0-9]+/g, '_')
					.replace(/^_+|_+$/g, '')
			: value,
	z.enum(mediaRelationTypes),
)

export const MediaRelationCandidateSchema = z
	.object({
		relationType: MediaRelationTypeSchema,
		targetIdentity: MediaIdentitySchema,
		targetCatalog: z.record(z.unknown()).optional(),
	})
	.strict()

const MediaRelationCandidatesSchema = z
	.array(MediaRelationCandidateSchema)
	.max(100)

export type MediaRelationCandidate = z.infer<
	typeof MediaRelationCandidateSchema
>

const inverseRelationTypes: Partial<
	Record<MediaRelationType, MediaRelationType>
> = {
	adaptation: 'source_material',
	full_story: 'summary',
	parent_story: 'side_story',
	prequel: 'sequel',
	sequel: 'prequel',
	side_story: 'parent_story',
	source_material: 'adaptation',
	summary: 'full_story',
}

const relationLabels: Record<MediaRelationType, string> = {
	adaptation: 'Adaptation',
	alternative_setting: 'Alternative setting',
	alternative_version: 'Alternative version',
	character: 'Shared characters',
	compilation: 'Compilation',
	franchise: 'Same franchise',
	full_story: 'Full story',
	other: 'Other',
	parent_story: 'Parent story',
	prequel: 'Prequel',
	remake: 'Remake',
	sequel: 'Sequel',
	side_story: 'Side story',
	source_material: 'Source material',
	spin_off: 'Spin-off',
	summary: 'Summary',
}

export function inverseMediaRelationType(type: MediaRelationType) {
	return inverseRelationTypes[type] ?? type
}

export function mediaRelationLabel(type: MediaRelationType) {
	return relationLabels[type]
}

/**
 * Parse provider relation metadata without accepting canonical database IDs.
 * Relations must stay within one upstream provider, though MAL may legitimately
 * connect anime and manga kinds.
 */
export function parseMediaRelationCandidates(
	value: unknown,
	sourceIdentity: MediaIdentity,
): MediaRelationCandidate[] | null {
	if (value === undefined || value === null) return null
	const result = MediaRelationCandidatesSchema.safeParse(value)
	if (!result.success) {
		throw new Response('Invalid media relations', { status: 400 })
	}
	if (
		result.data.some(
			relation => relation.targetIdentity.provider !== sourceIdentity.provider,
		)
	) {
		throw new Response('Media relations must use the source provider', {
			status: 400,
		})
	}
	if (
		sourceIdentity.provider === 'tmdb' &&
		result.data.some(
			relation =>
				relation.relationType !== 'franchise' ||
				sourceIdentity.kind !== 'movie' ||
				relation.targetIdentity.kind !== 'movie',
		)
	) {
		throw new Response('TMDB relations must describe a movie franchise', {
			status: 400,
		})
	}
	return result.data
}
