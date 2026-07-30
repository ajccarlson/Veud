import { type Prisma, type PrismaClient } from '@prisma/client'
import {
	entryCatalogMetadataFields,
	hasCatalogValue,
	mediaCatalogSelect,
} from './media-catalog.ts'

type WatchlistMetadataSyncOptions = {
	batchSize?: number
	commit?: boolean
}

const metadataRepairMediaSelect = {
	id: true,
	kind: true,
	...mediaCatalogSelect,
} satisfies Prisma.MediaSelect

type MetadataRepairMedia = Prisma.MediaGetPayload<{
	select: typeof metadataRepairMediaSelect
}>

function canonicalEntryField(
	media: MetadataRepairMedia,
	field: (typeof entryCatalogMetadataFields)[number],
) {
	if (field === 'title') {
		return media.title?.trim() || `Untitled ${media.kind}`
	}
	return hasCatalogValue(media[field]) ? media[field] : null
}

function favoriteStartYear(
	media: Pick<
		MetadataRepairMedia,
		'kind' | 'startSeason' | 'startYear' | 'airYear' | 'releaseStart'
	>,
) {
	const configured =
		media.kind === 'anime'
			? media.startSeason
			: media.kind === 'manga'
				? media.startYear
				: media.airYear
	return (
		configured?.trim() ||
		(media.releaseStart ? String(media.releaseStart.getUTCFullYear()) : null)
	)
}

/**
 * Reconcile legacy Entry metadata from canonical Media without touching any
 * member-owned fields. This catches catalog updates made outside the normal
 * hydration path; hydrateMediaCatalog already performs that sync transactionally.
 */
export async function synchronizeWatchlistMetadata(
	prisma: PrismaClient,
	options: WatchlistMetadataSyncOptions = {},
) {
	const batchSize = options.batchSize ?? 500
	if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 2_000) {
		throw new Error('batchSize must be an integer between 1 and 2000')
	}
	const commit = options.commit ?? false
	let cursor: string | undefined
	let scanned = 0
	let matched = 0
	let updated = 0

	for (;;) {
		const entries = await prisma.entry.findMany({
			where: { mediaId: { not: null } },
			orderBy: { id: 'asc' },
			take: batchSize,
			...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
			select: { id: true, mediaId: true },
		})
		if (!entries.length) break
		cursor = entries.at(-1)?.id
		scanned += entries.length

		const mediaRows = await prisma.media.findMany({
			where: {
				id: {
					in: entries.flatMap(entry => (entry.mediaId ? [entry.mediaId] : [])),
				},
			},
			select: metadataRepairMediaSelect,
		})
		const mediaById = new Map(mediaRows.map(media => [media.id, media]))
		const changes = entries.flatMap(entry => {
			const media = entry.mediaId ? mediaById.get(entry.mediaId) : undefined
			if (!media) return []
			const data = Object.fromEntries(
				entryCatalogMetadataFields.map(field => [
					field,
					canonicalEntryField(media, field),
				]),
			) as Prisma.EntryUpdateManyMutationInput
			return [{ id: entry.id, mediaId: entry.mediaId, data }]
		})
		matched += changes.length

		if (commit && changes.length) {
			const results = await prisma.$transaction(
				changes.map(change =>
					prisma.entry.updateMany({
						where: { id: change.id, mediaId: change.mediaId },
						data: change.data,
					}),
				),
			)
			updated += results.reduce((total, result) => total + result.count, 0)
		}
	}

	let favoriteCursor: string | undefined
	let favoriteScanned = 0
	let favoriteMatched = 0
	let favoriteUpdated = 0
	for (;;) {
		const favorites = await prisma.userFavorite.findMany({
			where: { mediaId: { not: null } },
			orderBy: { id: 'asc' },
			take: batchSize,
			...(favoriteCursor ? { cursor: { id: favoriteCursor }, skip: 1 } : {}),
			select: { id: true, mediaId: true },
		})
		if (!favorites.length) break
		favoriteCursor = favorites.at(-1)?.id
		favoriteScanned += favorites.length

		const mediaRows = await prisma.media.findMany({
			where: {
				id: {
					in: favorites.flatMap(favorite =>
						favorite.mediaId ? [favorite.mediaId] : [],
					),
				},
			},
			select: metadataRepairMediaSelect,
		})
		const mediaById = new Map(mediaRows.map(media => [media.id, media]))
		const changes = favorites.flatMap(favorite => {
			const media = favorite.mediaId
				? mediaById.get(favorite.mediaId)
				: undefined
			if (!media) return []
			const data = {
				title: media.title?.trim() || `Untitled ${media.kind}`,
				thumbnail: hasCatalogValue(media.thumbnail) ? media.thumbnail : null,
				mediaType: hasCatalogValue(media.type) ? media.type : null,
				startYear: favoriteStartYear(media),
			}
			return [{ id: favorite.id, mediaId: favorite.mediaId, data }]
		})
		favoriteMatched += changes.length

		if (commit && changes.length) {
			const results = await prisma.$transaction(
				changes.map(change =>
					prisma.userFavorite.updateMany({
						where: { id: change.id, mediaId: change.mediaId },
						data: change.data,
					}),
				),
			)
			favoriteUpdated += results.reduce(
				(total, result) => total + result.count,
				0,
			)
		}
	}

	return {
		dryRun: !commit,
		scanned,
		matched,
		updated,
		favoriteScanned,
		favoriteMatched,
		favoriteUpdated,
	}
}
