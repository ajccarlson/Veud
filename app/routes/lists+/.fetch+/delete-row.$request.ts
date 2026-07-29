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

export async function deleteEntryCommand(
	ownerId: string,
	entryId: string | null,
) {
	return await prisma.$transaction(async tx => {
		await serializeUserLibraryMutation(tx, ownerId)
		const entry = entryId
			? await tx.entry.findUnique({
					where: { id: entryId },
					include: { watchlist: true },
				})
			: null
		if (!entry || entry.watchlist.ownerId !== ownerId) {
			throw new Response('Not found', { status: 404 })
		}
		await reconcileTrackingStateBeforeEntryDeletion(tx, entry.trackingStateId, {
			id: entry.id,
		})
		const deleted = await tx.entry.delete({
			where: { id: entry.id },
		})
		await normalizeEntryPositions(tx, deleted.watchlistId)
		await claimWatchlistRevisions(tx, [entry.watchlist])
		await deleteTrackingStateIfOrphan(tx, deleted.trackingStateId)
		return deleted
	})
}

export async function action({ request, params }: ActionFunctionArgs) {
	const ownerId = await requireUserId(request)
	const searchParams = new URLSearchParams(params.request)
	return deleteEntryCommand(ownerId, searchParams.get('id'))
}
