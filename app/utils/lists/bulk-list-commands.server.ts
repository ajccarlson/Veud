import { prisma } from '#app/utils/db.server.ts'
import {
	deleteTrackingStateIfOrphan,
	reconcileTrackingStateBeforeEntryDeletion,
} from '#app/utils/tracking-state.server.ts'
import {
	moveEntryToWatchlist,
	normalizeEntryPositions,
} from './entry-order.server.ts'
import { claimWatchlistRevisions } from './watchlist-revision.server.ts'

function uniqueIds(entryIds: string[]) {
	const ids = [...new Set(entryIds)]
	if (ids.length !== entryIds.length) {
		throw new Response('Entry selection contains duplicates', { status: 400 })
	}
	return ids
}

export async function bulkDeleteEntriesCommand(
	ownerId: string,
	entryIds: string[],
) {
	const ids = uniqueIds(entryIds)
	return prisma.$transaction(async tx => {
		const entries = await tx.entry.findMany({
			where: { id: { in: ids }, watchlist: { ownerId } },
			include: {
				watchlist: {
					select: { id: true, mutationVersion: true },
				},
			},
		})
		if (entries.length !== ids.length) {
			throw new Response('One or more entries were not found', { status: 404 })
		}
		const trackingStateIds = [
			...new Set(
				entries
					.map(entry => entry.trackingStateId)
					.filter((id): id is string => Boolean(id)),
			),
		]
		for (const trackingStateId of trackingStateIds) {
			await reconcileTrackingStateBeforeEntryDeletion(tx, trackingStateId, {
				id: { in: ids },
			})
		}
		await tx.entry.deleteMany({ where: { id: { in: ids } } })

		const watchlists = [
			...new Map(
				entries.map(entry => [entry.watchlist.id, entry.watchlist]),
			).values(),
		]
		for (const watchlist of watchlists) {
			await normalizeEntryPositions(tx, watchlist.id)
		}
		await claimWatchlistRevisions(tx, watchlists)
		for (const trackingStateId of trackingStateIds) {
			await deleteTrackingStateIfOrphan(tx, trackingStateId)
		}
		return { deleted: ids.length }
	})
}

export async function bulkMoveEntriesCommand(
	ownerId: string,
	entryIds: string[],
	destinationWatchlistId: string,
) {
	const ids = uniqueIds(entryIds)
	return prisma.$transaction(async tx => {
		const ownedCount = await tx.entry.count({
			where: { id: { in: ids }, watchlist: { ownerId } },
		})
		if (ownedCount !== ids.length) {
			throw new Response('One or more entries were not found', { status: 404 })
		}
		const moved = []
		for (const entryId of ids) {
			moved.push(
				await moveEntryToWatchlist(tx, {
					ownerId,
					entryId,
					destinationWatchlistId,
					position: null,
				}),
			)
		}
		return { moved: moved.length, entries: moved }
	})
}
