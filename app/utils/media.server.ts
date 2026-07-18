import { type Prisma } from '@prisma/client'
import {
	MediaIdentitySchema,
	mediaIdentityFromThumbnail,
	mediaIdentityMatchesListType,
	type MediaIdentity,
} from './media-identity.ts'

export function parseMediaIdentityForListType(
	value: unknown,
	listTypeName: string,
	legacyThumbnail?: string | null,
): MediaIdentity | null {
	const candidate =
		value === undefined || value === null
			? mediaIdentityFromThumbnail(legacyThumbnail)
			: value
	if (candidate === null) return null

	const result = MediaIdentitySchema.safeParse(candidate)
	if (!result.success) {
		throw new Response('Invalid media identity', { status: 400 })
	}
	if (!mediaIdentityMatchesListType(result.data, listTypeName)) {
		throw new Response('Media identity does not match the list type', {
			status: 400,
		})
	}
	return result.data
}

/**
 * Return the shared Media row for an upstream identifier, creating it if this
 * is the first time the work has been seen. The compound unique key makes this
 * idempotent across entries, favorites, imports, and backfill runs.
 */
export async function ensureMediaForIdentity(
	tx: Prisma.TransactionClient,
	identity: MediaIdentity,
) {
	const externalId = await tx.mediaExternalId.upsert({
		where: {
			provider_kind_externalId: identity,
		},
		update: {},
		create: {
			...identity,
			media: { create: { kind: identity.kind } },
		},
		select: {
			mediaId: true,
			media: { select: { kind: true } },
		},
	})

	if (externalId.media.kind !== identity.kind) {
		throw new Error('Canonical media kind does not match its external identity')
	}
	return externalId.mediaId
}
