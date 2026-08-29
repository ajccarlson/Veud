import { prisma } from '#app/utils/db.server.ts'
import {
	EntryOrderError,
	moveEntryToWatchlist,
} from '#app/utils/lists/entry-order.server.ts'

export async function moveEntryCommand(
	ownerId: string,
	input: {
		entryId: string | null
		destinationWatchlistId: string | null
		position: number | null
	},
) {
	const { entryId, destinationWatchlistId, position } = input
	if (
		!entryId ||
		!destinationWatchlistId ||
		(position !== null && (!Number.isInteger(position) || position < 1))
	) {
		throw new Response('Invalid move request', { status: 400 })
	}

	try {
		return await prisma.$transaction(transaction =>
			moveEntryToWatchlist(transaction, {
				ownerId,
				entryId,
				destinationWatchlistId,
				position,
			}),
		)
	} catch (error) {
		if (error instanceof EntryOrderError) {
			throw new Response(error.message, { status: error.status })
		}
		throw error
	}
}
