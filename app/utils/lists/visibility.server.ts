import { getUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { visibleWatchlistWhere } from './visibility.ts'

export {
	publicActivityEventWhere,
	publicTrackingStateWhere,
	publicWatchlistWhere,
	visibleActivityEventWhere,
	visibleTrackingStateWhere,
	visibleWatchlistWhere,
} from './visibility.ts'

/** Return a public watchlist or one owned by the current viewer, otherwise 404. */
export async function requireVisibleWatchlist(
	request: Request,
	watchlistId: string | null | undefined,
) {
	const viewerId = await getUserId(request)
	const watchlist = watchlistId
		? await prisma.watchlist.findFirst({
				where: {
					id: watchlistId,
					AND: [visibleWatchlistWhere(viewerId)],
				},
			})
		: null
	if (!watchlist) throw new Response('Not found', { status: 404 })
	return { viewerId, watchlist }
}
