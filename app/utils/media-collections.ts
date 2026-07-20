import { z } from 'zod'

export const COLLECTION_TITLE_MAX_LENGTH = 80
export const COLLECTION_DESCRIPTION_MAX_LENGTH = 2000
export const COLLECTION_COMMENT_MAX_LENGTH = 1000
export const COLLECTION_ITEM_NOTE_MAX_LENGTH = 500
export const COLLECTION_TAG_MAX_COUNT = 5
export const COLLECTION_TAG_MAX_LENGTH = 24
export const COLLECTION_TAG_INPUT_MAX_LENGTH = 200

export type NormalizedCollectionTag = { name: string; slug: string }

export function normalizeCollectionTag(
	value: string,
): NormalizedCollectionTag | null {
	const name = value
		.normalize('NFKC')
		.trim()
		.replace(/^#+/, '')
		.replace(/\s+/g, ' ')
		.toLocaleLowerCase()
	if (!name || name.length > COLLECTION_TAG_MAX_LENGTH) return null
	const slug = name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '')
	if (!slug) return null
	return { name, slug }
}

export function parseCollectionTags(value: string) {
	const tags: NormalizedCollectionTag[] = []
	const seen = new Set<string>()
	for (const candidate of value.split(',')) {
		if (!candidate.trim()) continue
		const tag = normalizeCollectionTag(candidate)
		if (!tag) return null
		if (seen.has(tag.slug)) continue
		seen.add(tag.slug)
		tags.push(tag)
	}
	return tags
}

const CollectionTagsSchema = z
	.string()
	.max(
		COLLECTION_TAG_INPUT_MAX_LENGTH,
		`Keep tags under ${COLLECTION_TAG_INPUT_MAX_LENGTH} characters total.`,
	)
	.optional()
	.default('')
	.transform((value, context) => {
		const tags = parseCollectionTags(value)
		if (!tags) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: `Each tag must contain letters or numbers and be at most ${COLLECTION_TAG_MAX_LENGTH} characters.`,
			})
			return z.NEVER
		}
		if (tags.length > COLLECTION_TAG_MAX_COUNT) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: `Use no more than ${COLLECTION_TAG_MAX_COUNT} tags.`,
			})
			return z.NEVER
		}
		return tags
	})

export const CollectionDetailsSchema = z.object({
	title: z
		.string()
		.trim()
		.min(1, 'Give your collection a title.')
		.max(
			COLLECTION_TITLE_MAX_LENGTH,
			`Keep the title under ${COLLECTION_TITLE_MAX_LENGTH} characters.`,
		),
	description: z
		.string()
		.trim()
		.max(
			COLLECTION_DESCRIPTION_MAX_LENGTH,
			`Keep the description under ${COLLECTION_DESCRIPTION_MAX_LENGTH} characters.`,
		)
		.transform(value => value || null),
	tags: CollectionTagsSchema,
	isPublic: z
		.string()
		.optional()
		.transform(value => value === 'true' || value === 'on'),
})
