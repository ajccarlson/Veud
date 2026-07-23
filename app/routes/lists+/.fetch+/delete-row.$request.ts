import { type ActionFunctionArgs } from 'react-router'
import { prisma } from '#app/utils/db.server.ts'
import { requireEntryOwner } from '#app/utils/lists/authorization.server.ts'
import { normalizeEntryPositions } from '#app/utils/lists/entry-order.server.ts'
import { claimWatchlistRevisions } from '#app/utils/lists/watchlist-revision.server.ts'
import {
	deleteTrackingStateIfOrphan,
	reconcileTrackingStateBeforeEntryDeletion,
} from '#app/utils/tracking-state.server.ts'

export async function action({ request, params }: ActionFunctionArgs) {
	const searchParams = new URLSearchParams(params.request)

	const id = searchParams.get('id')

	// The entry must belong to a watchlist the current user owns.
	const { entry, watchlist } = await requireEntryOwner(request, id)

	return await prisma.$transaction(async tx => {
		await reconcileTrackingStateBeforeEntryDeletion(tx, entry.trackingStateId, {
			id: entry.id,
		})
		const deleted = await tx.entry.delete({
			where: { id: entry.id },
		})
		await normalizeEntryPositions(tx, deleted.watchlistId)
		await claimWatchlistRevisions(tx, [watchlist])
		await deleteTrackingStateIfOrphan(tx, deleted.trackingStateId)
		return deleted
	})
}
