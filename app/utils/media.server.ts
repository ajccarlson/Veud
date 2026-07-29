import { type Prisma } from '@prisma/client'
import {
	catalogHydrationPriorities,
	requestCatalogHydration,
} from './catalog-sync.server.ts'
import {
	catalogDataFromSnapshot,
	emptyMediaCatalogData,
	hasCatalogValue,
	entryCatalogMetadataFields,
	type MediaCatalogField,
	mediaCatalogFields,
	mediaCatalogSelect,
	TRUSTED_CATALOG_PROVENANCE_VERSION,
} from './media-catalog.ts'
import {
	MediaIdentitySchema,
	mediaIdentityFromThumbnail,
	mediaIdentityMatchesListType,
	type MediaIdentity,
} from './media-identity.ts'
import {
	deriveNextReleaseAt,
	syncNextReleaseOccurrence,
} from './release-occurrences.server.ts'

export async function hydrateMediaCatalog(
	tx: Prisma.TransactionClient,
	mediaId: string,
	snapshot: Record<string, unknown>,
	options: {
		overwrite?: boolean
		authoritativeFields?: MediaCatalogField[]
		syncLegacyFields?: readonly MediaCatalogField[]
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

	// A first trusted provider write resets the entire untrusted baseline. Claim
	// that transition conditionally: if another hydrator promotes the row after
	// our read, retry against its v1 values instead of applying a stale reset.
	for (let baselineAttempt = 0; baselineAttempt < 3; baselineAttempt++) {
		const current = await tx.media.findUniqueOrThrow({
			where: { id: mediaId },
			select: {
				kind: true,
				catalogProvenanceVersion: true,
				...mediaCatalogSelect,
			},
		})
		const requiresBaselineReset =
			current.catalogProvenanceVersion !== TRUSTED_CATALOG_PROVENANCE_VERSION
		if (Object.keys(candidate).length === 0 && !requiresBaselineReset) return

		let data = candidate
		if (!options.overwrite && !requiresBaselineReset) {
			data = Object.fromEntries(
				mediaCatalogFields
					.filter(
						field =>
							authoritativeFields.has(field) ||
							(!hasCatalogValue(current[field]) &&
								hasCatalogValue(candidate[field])),
					)
					.filter(field =>
						Object.prototype.hasOwnProperty.call(candidate, field),
					)
					.map(field => [field, candidate[field]]),
			)
		}

		if (Object.keys(data).length === 0 && !requiresBaselineReset) return

		const writesNextRelease = Object.prototype.hasOwnProperty.call(
			data,
			'nextRelease',
		)
		const mediaData = {
			...(requiresBaselineReset ? emptyMediaCatalogData() : {}),
			...data,
			...(writesNextRelease
				? { nextReleaseAt: deriveNextReleaseAt(data.nextRelease) }
				: requiresBaselineReset
					? { nextReleaseAt: null }
					: {}),
			catalogProvenanceVersion: TRUSTED_CATALOG_PROVENANCE_VERSION,
		}

		if (requiresBaselineReset) {
			const claimed = await tx.media.updateMany({
				where: {
					id: mediaId,
					catalogProvenanceVersion: current.catalogProvenanceVersion,
				},
				data: mediaData as Prisma.MediaUpdateManyMutationInput,
			})
			if (claimed.count === 0) continue
		} else {
			await tx.media.update({
				where: { id: mediaId },
				data: mediaData as Prisma.MediaUpdateInput,
			})
		}

		if (requiresBaselineReset) {
			const safeTitle =
				typeof data.title === 'string' && data.title.trim()
					? data.title.trim()
					: `Untitled ${current.kind}`
			const legacyCatalogReset = Object.fromEntries(
				entryCatalogMetadataFields.map(field => [
					field,
					field === 'title' ? safeTitle : null,
				]),
			)
			await Promise.all([
				tx.entry.updateMany({
					where: { mediaId },
					data: legacyCatalogReset as Prisma.EntryUpdateManyMutationInput,
				}),
				tx.userFavorite.updateMany({
					where: { mediaId },
					data: {
						title: safeTitle,
						thumbnail: null,
						mediaType: null,
						startYear: null,
					},
				}),
				tx.libraryImportItem.updateMany({
					where: { mediaId },
					data: { candidates: '[]' },
				}),
				tx.mediaRelation.deleteMany({
					where: {
						catalogProvenanceVersion: {
							not: TRUSTED_CATALOG_PROVENANCE_VERSION,
						},
						OR: [{ sourceMediaId: mediaId }, { targetMediaId: mediaId }],
					},
				}),
			])
		}
		if (writesNextRelease || requiresBaselineReset) {
			await syncNextReleaseOccurrence(tx, mediaId, data.nextRelease)
		}
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
		return
	}

	throw new Error(
		'Catalog provenance baseline changed repeatedly during hydration',
	)
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
 * idempotent across entries, favorites, imports, and backfill runs. This
 * identity boundary deliberately accepts no catalog snapshot; canonical fields
 * are hydrated only by trusted provider ingestion.
 */
export async function ensureMediaForIdentity(
	tx: Prisma.TransactionClient,
	identity: MediaIdentity,
	options: { requestHydration?: boolean } = {},
) {
	const normalizedIdentity = MediaIdentitySchema.parse(identity)
	const externalId = await tx.mediaExternalId.upsert({
		where: {
			provider_kind_externalId: normalizedIdentity,
		},
		update: {},
		create: {
			...normalizedIdentity,
			media: {
				create: {
					kind: normalizedIdentity.kind,
					catalogProvenanceVersion: TRUSTED_CATALOG_PROVENANCE_VERSION,
				},
			},
		},
		select: {
			mediaId: true,
			media: { select: { kind: true } },
		},
	})

	if (externalId.media.kind !== normalizedIdentity.kind) {
		throw new Error('Canonical media kind does not match its external identity')
	}
	if (
		options.requestHydration !== false &&
		(normalizedIdentity.provider === 'tmdb' ||
			normalizedIdentity.provider === 'mal')
	) {
		await requestCatalogHydration(tx, {
			...normalizedIdentity,
			priority: catalogHydrationPriorities.userDemand,
			reason: 'user-demand',
		})
	}
	return externalId.mediaId
}
