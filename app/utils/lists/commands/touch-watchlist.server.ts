import { prisma } from '#app/utils/db.server.ts'
import { requireOwnedWatchlist } from '#app/utils/lists/authorization.server.ts'

export async function touchWatchlistCommand(
	ownerId: string,
	watchlistId: string | null,
) {
	const watchlist = await requireOwnedWatchlist(ownerId, watchlistId)
	return prisma.watchlist.update({
		where: { id: watchlist.id },
		data: { updatedAt: new Date() },
	})
}
