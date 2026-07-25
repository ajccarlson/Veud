import { type ActionFunctionArgs } from 'react-router'
import { requireUserId } from '#app/utils/auth.server.ts'
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

export async function action({ request, params }: ActionFunctionArgs) {
	const ownerId = await requireUserId(request)
	const searchParams = new URLSearchParams(params.request)
	return touchWatchlistCommand(ownerId, searchParams.get('watchlistId'))
}
