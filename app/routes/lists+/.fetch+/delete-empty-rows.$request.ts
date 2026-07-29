import { type ActionFunctionArgs } from 'react-router'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { normalizeEntryPositions } from '#app/utils/lists/entry-order.server.ts'
import { claimWatchlistRevisions } from '#app/utils/lists/watchlist-revision.server.ts'
import {
	deleteTrackingStateIfOrphan,
	reconcileTrackingStateBeforeEntryDeletion,
} from '#app/utils/tracking-state.server.ts'
import { serializeUserLibraryMutation } from '#app/utils/watchlist-limits.ts'

export async function deleteEmptyEntriesCommand(
	ownerId: string,
	watchlistId: string | null,
) {
	return prisma.$transaction(async tx => {
		await serializeUserLibraryMutation(tx, ownerId)
		const watchlist = watchlistId
			? await tx.watchlist.findFirst({
					where: { id: watchlistId, ownerId },
				})
			: null
		if (!watchlist) throw new Response('Not found', { status: 404 })
		const entries = await tx.entry.findMany({
			where: { watchlistId: watchlist.id },
		})

		// An "empty" row has neither a meaningful title nor type.
		const removedEntries = entries.filter(
			entry =>
				(!entry.title || entry.title.replace(/\W/g, '') === '') &&
				(!entry.type || entry.type.replace(/\W/g, '') === ''),
		)

		if (removedEntries.length > 0) {
			const removedEntryIds = removedEntries.map(entry => entry.id)
			for (const trackingStateId of new Set(
				removedEntries.map(entry => entry.trackingStateId).filter(Boolean),
			)) {
				await reconcileTrackingStateBeforeEntryDeletion(tx, trackingStateId, {
					id: { in: removedEntryIds },
				})
			}
			await tx.entry.deleteMany({
				where: { id: { in: removedEntryIds } },
			})
			await normalizeEntryPositions(tx, watchlist.id)
			await claimWatchlistRevisions(tx, [watchlist])
			for (const trackingStateId of new Set(
				removedEntries.map(entry => entry.trackingStateId).filter(Boolean),
			)) {
				await deleteTrackingStateIfOrphan(tx, trackingStateId)
			}
		}
		return removedEntries
	})
}

export async function action({ request, params }: ActionFunctionArgs) {
	const ownerId = await requireUserId(request)
	const searchParams = new URLSearchParams(params.request)
	return deleteEmptyEntriesCommand(
		ownerId,
		searchParams.get('watchlistId')?.toLowerCase() ?? null,
	)
}
