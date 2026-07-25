import { type ActionFunctionArgs } from 'react-router'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { requireOwnedEntry } from '#app/utils/lists/authorization.server.ts'
import { normalizeEntryPositions } from '#app/utils/lists/entry-order.server.ts'
import { claimWatchlistRevisions } from '#app/utils/lists/watchlist-revision.server.ts'
import {
	deleteTrackingStateIfOrphan,
	reconcileTrackingStateBeforeEntryDeletion,
} from '#app/utils/tracking-state.server.ts'

export async function deleteEntryCommand(
	ownerId: string,
	entryId: string | null,
) {
	const { entry, watchlist } = await requireOwnedEntry(ownerId, entryId)

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

export async function action({ request, params }: ActionFunctionArgs) {
	const ownerId = await requireUserId(request)
	const searchParams = new URLSearchParams(params.request)
	return deleteEntryCommand(ownerId, searchParams.get('id'))
}
