import { type Prisma } from '@prisma/client'
import { getUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { serializeUserLibraryMutation } from '#app/utils/watchlist-limits.ts'
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

/**
 * Keep verified tracking activity aligned with a list's visibility. Legacy
 * label-only rows are quarantined rather than attached by mutable label. Both
 * branches use a fixed number of server-side updates, independent of history
 * size.
 */
export async function syncWatchlistActivityVisibility(
	tx: Prisma.TransactionClient,
	watchlist: { id: string; ownerId: string; header: string; isPublic: boolean },
	previousHeader?: string,
) {
	await serializeUserLibraryMutation(tx, watchlist.ownerId)
	const labels = [...new Set([watchlist.header, previousHeader])].filter(
		(label): label is string => Boolean(label),
	)
	const linkedToWatchlist = {
		OR: [
			{ statusWatchlistId: watchlist.id },
			{ previousStatusWatchlistId: watchlist.id },
		],
	} satisfies Prisma.ActivityEventWhereInput

	if (labels.length) {
		await tx.activityEvent.updateMany({
			where: {
				actorId: watchlist.ownerId,
				publicEligible: false,
				OR: labels.flatMap(label => [
					{ statusWatchlistId: null, statusLabel: label },
					{
						previousStatusWatchlistId: null,
						previousStatusLabel: label,
					},
				]),
			},
			data: { isPublic: false },
		})
	}

	if (!watchlist.isPublic) {
		await tx.activityEvent.updateMany({
			where: linkedToWatchlist,
			data: { isPublic: false },
		})
		return
	}

	// Recompute all linked rows fail-closed in two statements. Historical and
	// private-created rows remain private; eligible rows are public only when
	// both immutable list relations are currently public or genuinely absent.
	await tx.activityEvent.updateMany({
		where: linkedToWatchlist,
		data: { isPublic: false },
	})
	await tx.activityEvent.updateMany({
		where: {
			...linkedToWatchlist,
			publicEligible: true,
			AND: [
				{
					OR: [
						{ statusWatchlistId: null, statusLabel: null },
						{ statusWatchlist: { isPublic: true } },
					],
				},
				{
					OR: [
						{
							previousStatusWatchlistId: null,
							previousStatusLabel: null,
						},
						{ previousStatusWatchlist: { isPublic: true } },
					],
				},
			],
		},
		data: { isPublic: true },
	})
}
