import { type Prisma } from '@prisma/client'
import {
	catalogHydrationPriorities,
	requestCatalogHydration,
} from './catalog-sync.server.ts'
import {
	catalogDataFromSnapshot,
	hasCatalogValue,
	type MediaCatalogField,
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
	options: {
		overwrite?: boolean
		authoritativeFields?: MediaCatalogField[]
		syncLegacyFields?: MediaCatalogField[]
	} = {},
) {
	const candidate = catalogDataFromSnapshot(snapshot)
	const authoritativeFields = new Set(options.authoritativeFields ?? [])
	for (const field of authoritativeFields) {
		if (
			Object.prototype.hasOwnProperty.call(snapshot, field) &&
			snapshot[field] === null
		) {
			candidate[field] = null
		}
	}
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
						authoritativeFields.has(field) ||
						(!hasCatalogValue(current[field]) &&
							hasCatalogValue(candidate[field])),
				)
				.filter(field => Object.prototype.hasOwnProperty.call(candidate, field))
				.map(field => [field, candidate[field]]),
		)
	}

	if (Object.keys(data).length > 0) {
		await tx.media.update({
			where: { id: mediaId },
			data: data as Prisma.MediaUpdateInput,
		})
		const legacyData = Object.fromEntries(
			(options.syncLegacyFields ?? [])
				.filter(field => Object.prototype.hasOwnProperty.call(data, field))
				.map(field => [field, data[field]]),
		)
		if (Object.keys(legacyData).length) {
			await tx.entry.updateMany({
				where: { mediaId },
				data: legacyData as Prisma.EntryUpdateManyMutationInput,
			})
		}
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
	options: { requestHydration?: boolean } = {},
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
	if (
		options.requestHydration !== false &&
		(identity.provider === 'tmdb' || identity.provider === 'mal')
	) {
		await requestCatalogHydration(tx, {
			...identity,
			priority: catalogHydrationPriorities.userDemand,
			reason: 'user-demand',
		})
	}
	return externalId.mediaId
}
