import { type ActionFunctionArgs } from 'react-router'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import {
	EntryOrderError,
	moveEntryToWatchlist,
} from '#app/utils/lists/entry-order.server.ts'

export async function action({ request, params }: ActionFunctionArgs) {
	const userId = await requireUserId(request)
	const searchParams = new URLSearchParams(params.request)
	const entryId = searchParams.get('entryId')
	const destinationWatchlistId = searchParams.get('destinationWatchlistId')
	const rawPosition = searchParams.get('position')
	const position = rawPosition === null ? null : Number(rawPosition)
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
				ownerId: userId,
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
