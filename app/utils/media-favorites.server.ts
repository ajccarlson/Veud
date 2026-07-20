import { type Prisma } from '@prisma/client'
import { type MediaCatalogSnapshot } from './media-catalog.ts'
import { listTypeNameForMediaKind } from './media-detail.ts'

type MediaFavoriteClient = Pick<
	Prisma.TransactionClient,
	'listType' | 'userFavorite'
>

function releaseYear(value: Date | null | undefined) {
	return value ? String(value.getUTCFullYear()) : null
}

function favoriteStartYear(kind: string, catalog: MediaCatalogSnapshot) {
	if (kind === 'anime') {
		return catalog.startSeason || releaseYear(catalog.releaseStart)
	}
	if (kind === 'manga') {
		return catalog.startYear || releaseYear(catalog.releaseStart)
	}
	return catalog.airYear || releaseYear(catalog.releaseStart)
}

/**
 * Toggle a canonical title in a member's profile favorites. Removing clears any
 * duplicate legacy rows, while adding appends to the end of the media category.
 */
export async function toggleMediaFavorite(
	db: MediaFavoriteClient,
	input: {
		ownerId: string
		mediaId: string
		kind: string
		catalog: MediaCatalogSnapshot
	},
) {
	const existing = await db.userFavorite.findMany({
		where: { ownerId: input.ownerId, mediaId: input.mediaId },
		select: { id: true },
	})
	if (existing.length) {
		await db.userFavorite.deleteMany({
			where: { ownerId: input.ownerId, mediaId: input.mediaId },
		})
		return { isFavorite: false, favoriteId: null }
	}

	const listTypeName = listTypeNameForMediaKind(input.kind)
	if (!listTypeName) {
		throw new Response('Unsupported media kind', { status: 400 })
	}
	const listType = await db.listType.findUnique({
		where: { name: listTypeName },
		select: { id: true },
	})
	if (!listType) {
		throw new Response('Favorite category not found', { status: 400 })
	}
	const highest = await db.userFavorite.aggregate({
		where: { ownerId: input.ownerId, typeId: listType.id },
		_max: { position: true },
	})
	const favorite = await db.userFavorite.create({
		data: {
			ownerId: input.ownerId,
			mediaId: input.mediaId,
			typeId: listType.id,
			position: (highest._max.position ?? 0) + 1,
			thumbnail: input.catalog.thumbnail,
			title: input.catalog.title?.trim() || `Untitled ${input.kind}`,
			mediaType: input.catalog.type,
			startYear: favoriteStartYear(input.kind, input.catalog),
		},
		select: { id: true },
	})
	return { isFavorite: true, favoriteId: favorite.id }
}
