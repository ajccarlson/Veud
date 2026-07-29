import { type LoaderFunctionArgs } from 'react-router'
import { prisma } from '#app/utils/db.server.ts'
import {
	prepareWatchlistEntryForViewer,
	publicEntryPayload,
} from '#app/utils/lists/public-watchlist.server.ts'
import { requireVisibleWatchlist } from '#app/utils/lists/visibility.server.ts'
import { normalizeWatchlistEntryScores } from '#app/utils/lists/watchlist-entry-scores.server.ts'

export async function loader({ request, params }: LoaderFunctionArgs) {
	const searchParams = new URLSearchParams(params.request)

	const watchlistId = searchParams.get('watchlistId')?.toLowerCase()
	const { viewerId, watchlist } = await requireVisibleWatchlist(
		request,
		watchlistId,
	)

	const entries = await prisma.entry.findMany({
		where: {
			watchlistId: watchlist.id,
		},
		include: {
			media: { select: { tmdbScore: true, malScore: true } },
			trackingState: {
				select: {
					ownerId: true,
					mediaId: true,
					statusWatchlistId: true,
					score: true,
					startedAt: true,
					completedAt: true,
					statusWatchlist: { select: { ownerId: true, isPublic: true } },
				},
			},
		},
	})
	const isOwner = viewerId === watchlist.ownerId
	const normalized = entries
		.map(entry =>
			prepareWatchlistEntryForViewer(entry, watchlist.ownerId, isOwner),
		)
		.map(normalizeWatchlistEntryScores)
	return isOwner
		? normalized
		: normalized.map(entry =>
				publicEntryPayload(entry, watchlist.displayedColumns),
			)
}
