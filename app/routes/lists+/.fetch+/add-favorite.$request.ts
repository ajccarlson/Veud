<<<<<<< HEAD
import { type ActionFunctionArgs } from '@remix-run/node'
=======
import { type ActionFunctionArgs } from 'react-router'
>>>>>>> develop
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { stripProtectedFields } from '#app/utils/lists/authorization.server.ts'
import {
	ensureMediaForIdentity,
	parseMediaIdentityForListType,
} from '#app/utils/media.server.ts'

export async function action({ request, params }: ActionFunctionArgs) {
	const userId = await requireUserId(request)
	const searchParams = new URLSearchParams(params.request)

	let favorite: unknown
	try {
		favorite = JSON.parse(searchParams.get('favorite') ?? '')
	} catch {
		throw new Response('Invalid favorite payload', { status: 400 })
	}
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

	// Identity, relations, and ownership are server-managed.
	const data = {
		...stripProtectedFields(favoriteObj, [
			'id',
			'media',
			'mediaId',
			'mediaIdentity',
			'owner',
			'ownerId',
		]),
		ownerId: userId,
	}

	return await prisma.$transaction(async tx => {
		const favoriteCatalog = {
			...data,
			type: favoriteObj.mediaType,
			...(mediaIdentity?.kind === 'anime'
				? { startSeason: favoriteObj.startYear }
				: mediaIdentity?.kind === 'manga'
					? { startYear: favoriteObj.startYear }
					: { airYear: favoriteObj.startYear }),
		}
		const mediaId = mediaIdentity
			? await ensureMediaForIdentity(tx, mediaIdentity, favoriteCatalog)
			: undefined

		// `data` is a runtime-validated object; Prisma's create input can't be inferred from
		// arbitrary client JSON, so the shape is asserted here.
		return tx.userFavorite.create({ data: { ...data, mediaId } as any })
	})
}
