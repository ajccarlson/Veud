import { type ActionFunctionArgs } from 'react-router'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { requireOwnedFavorite } from '#app/utils/lists/authorization.server.ts'

export async function removeFavoriteCommand(
	ownerId: string,
	favoriteId: string | null,
) {
	const favorite = await requireOwnedFavorite(ownerId, favoriteId)
	return prisma.userFavorite.delete({ where: { id: favorite.id } })
}

export async function action({ request, params }: ActionFunctionArgs) {
	const ownerId = await requireUserId(request)
	const searchParams = new URLSearchParams(params.request)
	return removeFavoriteCommand(ownerId, searchParams.get('id'))
}
