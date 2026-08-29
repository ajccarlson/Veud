import { prisma } from '#app/utils/db.server.ts'
import { stripProtectedFields } from '#app/utils/lists/authorization.server.ts'
import {
	ensureMediaForIdentity,
	parseMediaIdentityForListType,
} from '#app/utils/media.server.ts'

export async function addFavoriteCommand(ownerId: string, favorite: unknown) {
	if (!favorite || typeof favorite !== 'object' || Array.isArray(favorite)) {
		throw new Response('Invalid favorite payload', { status: 400 })
	}

	const favoriteObj = favorite as Record<string, unknown>
	const typeId = favoriteObj.typeId
	if (typeof typeId !== 'string') {
		throw new Response('Invalid favorite type', { status: 400 })
	}
	const listType = await prisma.listType.findUnique({
		where: { id: typeId },
		select: { name: true },
	})
	if (!listType) throw new Response('List type not found', { status: 400 })
	const mediaIdentity = parseMediaIdentityForListType(
		favoriteObj.mediaIdentity,
		listType.name,
		typeof favoriteObj.thumbnail === 'string' ? favoriteObj.thumbnail : null,
	)
	if (!mediaIdentity) {
		throw new Response('Choose a catalog title before adding a favorite', {
			status: 400,
		})
	}

	// Identity, relations, and ownership are server-managed.
	const data = {
		...stripProtectedFields(favoriteObj, [
			'id',
			'media',
			'mediaId',
			'mediaIdentity',
			'mediaRelations',
			'owner',
			'ownerId',
			'type',
		]),
		ownerId,
	}

	return await prisma.$transaction(async tx => {
		const mediaId = await ensureMediaForIdentity(tx, mediaIdentity)

		// `data` is a runtime-validated object; Prisma's create input can't be inferred from
		// arbitrary client JSON, so the shape is asserted here.
		return tx.userFavorite.create({ data: { ...data, mediaId } as any })
	})
}
