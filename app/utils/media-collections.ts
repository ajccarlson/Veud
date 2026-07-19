import { z } from 'zod'

export const COLLECTION_TITLE_MAX_LENGTH = 80
export const COLLECTION_DESCRIPTION_MAX_LENGTH = 2000
export const COLLECTION_COMMENT_MAX_LENGTH = 1000

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
	isPublic: z
		.string()
		.optional()
		.transform(value => value === 'true' || value === 'on'),
})
