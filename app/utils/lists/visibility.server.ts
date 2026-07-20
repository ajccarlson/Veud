import { type Prisma } from '@prisma/client'
import { getUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'

export const publicWatchlistWhere = {
	isPublic: true,
} satisfies Prisma.WatchlistWhereInput

export function visibleWatchlistWhere(viewerId: string | null) {
	return viewerId
		? ({
				OR: [{ isPublic: true }, { ownerId: viewerId }],
			} satisfies Prisma.WatchlistWhereInput)
		: publicWatchlistWhere
}

/** Tracking without a status list remains public; a private status list does not. */
export const publicTrackingStateWhere = {
	OR: [
		{ statusWatchlistId: null },
		{ statusWatchlist: { isPublic: true } },
	],
} satisfies Prisma.TrackingStateWhereInput

export function visibleTrackingStateWhere(viewerId: string | null) {
	return viewerId
		? ({
				OR: [
					{ ownerId: viewerId },
					{ statusWatchlistId: null },
					{ statusWatchlist: { isPublic: true } },
				],
			} satisfies Prisma.TrackingStateWhereInput)
		: publicTrackingStateWhere
}

export function visibleActivityEventWhere(viewerId: string | null) {
	return viewerId
		? ({
				OR: [{ isPublic: true }, { actorId: viewerId }],
			} satisfies Prisma.ActivityEventWhereInput)
		: ({ isPublic: true } satisfies Prisma.ActivityEventWhereInput)
}

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
 * Keep historical tracking activity aligned with a list's visibility. Events
 * created after LIST-013 carry exact list ids. The label fallback safely hides
 * older rows created before those provenance columns existed.
 */
export async function syncWatchlistActivityVisibility(
	tx: Prisma.TransactionClient,
	watchlist: { id: string; ownerId: string; header: string; isPublic: boolean },
) {
	if (!watchlist.isPublic) {
		await tx.activityEvent.updateMany({
			where: {
				actorId: watchlist.ownerId,
				OR: [
					{ statusWatchlistId: watchlist.id },
					{ previousStatusWatchlistId: watchlist.id },
					{ statusLabel: watchlist.header },
					{ previousStatusLabel: watchlist.header },
				],
			},
			data: { isPublic: false },
		})
		return
	}

	const events = await tx.activityEvent.findMany({
		where: {
			actorId: watchlist.ownerId,
			OR: [
				{ statusWatchlistId: watchlist.id },
				{ previousStatusWatchlistId: watchlist.id },
			],
		},
		select: {
			id: true,
			statusWatchlist: { select: { isPublic: true } },
			previousStatusWatchlist: { select: { isPublic: true } },
		},
	})
	for (const event of events) {
		const isPublic =
			(event.statusWatchlist?.isPublic ?? true) &&
			(event.previousStatusWatchlist?.isPublic ?? true)
		await tx.activityEvent.update({
			where: { id: event.id },
			data: { isPublic },
		})
	}
}
