import { prisma } from '#app/utils/db.server.ts'
import { requireOwnedFavorite } from '#app/utils/lists/authorization.server.ts'

export async function removeFavoriteCommand(
	ownerId: string,
	favoriteId: string | null,
) {
	const favorite = await requireOwnedFavorite(ownerId, favoriteId)
	return prisma.userFavorite.delete({ where: { id: favorite.id } })
}
