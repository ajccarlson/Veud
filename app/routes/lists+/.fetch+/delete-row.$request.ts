import { type ActionFunctionArgs } from 'react-router'
import { prisma } from '#app/utils/db.server.ts'
import { requireEntryOwner } from '#app/utils/lists/authorization.server.ts'
import { normalizeEntryPositions } from '#app/utils/lists/entry-order.server.ts'
import { deleteTrackingStateIfOrphan } from '#app/utils/tracking-state.server.ts'

export async function action({ request, params }: ActionFunctionArgs) {
	const searchParams = new URLSearchParams(params.request)

	const id = searchParams.get('id')

	// The entry must belong to a watchlist the current user owns.
	await requireEntryOwner(request, id)

	return await prisma.$transaction(async tx => {
		const deleted = await tx.entry.delete({
			where: { id: id as string },
		})
		await normalizeEntryPositions(tx, deleted.watchlistId)
		await tx.watchlist.update({
			where: { id: deleted.watchlistId },
			data: { updatedAt: new Date() },
		})
		await deleteTrackingStateIfOrphan(tx, deleted.trackingStateId)
		return deleted
	})
}
