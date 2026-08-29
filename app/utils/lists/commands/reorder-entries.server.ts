import { prisma } from '#app/utils/db.server.ts'
import {
	EntryOrderError,
	setWatchlistEntryOrder,
} from '#app/utils/lists/entry-order.server.ts'

export async function reorderEntriesCommand(
	ownerId: string,
	input: { watchlistId: string | null; entryIds: unknown },
) {
	const { watchlistId, entryIds } = input
	if (
		!watchlistId ||
		!Array.isArray(entryIds) ||
		entryIds.some(id => typeof id !== 'string' || !id)
	) {
		throw new Response('Invalid entry order', { status: 400 })
	}
	const validatedEntryIds = entryIds as string[]

	try {
		return await prisma.$transaction(transaction =>
			setWatchlistEntryOrder(transaction, {
				ownerId,
				watchlistId,
				entryIds: validatedEntryIds,
			}),
		)
	} catch (error) {
		if (error instanceof EntryOrderError) {
			throw new Response(error.message, { status: error.status })
		}
		throw error
	}
}
