import { type Prisma } from '@prisma/client'
import {
	catalogDataFromSnapshot,
	hasCatalogValue,
	mediaCatalogFields,
	mediaCatalogSelect,
} from './media-catalog.ts'
import {
	MediaIdentitySchema,
	mediaIdentityFromThumbnail,
	mediaIdentityMatchesListType,
	type MediaIdentity,
} from './media-identity.ts'

export async function hydrateMediaCatalog(
	tx: Prisma.TransactionClient,
	mediaId: string,
	snapshot: Record<string, unknown>,
	options: { overwrite?: boolean } = {},
) {
	const candidate = catalogDataFromSnapshot(snapshot)
	if (Object.keys(candidate).length === 0) return

	let data = candidate
	if (!options.overwrite) {
		const current = await tx.media.findUniqueOrThrow({
			where: { id: mediaId },
			select: mediaCatalogSelect,
		})
		data = Object.fromEntries(
			mediaCatalogFields
				.filter(
					field =>
						!hasCatalogValue(current[field]) &&
						hasCatalogValue(candidate[field]),
				)
				.map(field => [field, candidate[field]]),
		)
	}

	if (Object.keys(data).length > 0) {
		await tx.media.update({
			where: { id: mediaId },
			data: data as Prisma.MediaUpdateInput,
		})
	}
}

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
	catalogSnapshot?: Record<string, unknown>,
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
	if (catalogSnapshot) {
		await hydrateMediaCatalog(tx, externalId.mediaId, catalogSnapshot)
	}
	return externalId.mediaId
}
