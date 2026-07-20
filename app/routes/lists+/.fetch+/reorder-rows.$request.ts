import { type ActionFunctionArgs } from 'react-router'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import {
	EntryOrderError,
	setWatchlistEntryOrder,
} from '#app/utils/lists/entry-order.server.ts'

export async function action({ request, params }: ActionFunctionArgs) {
	const userId = await requireUserId(request)
	const searchParams = new URLSearchParams(params.request)
	const watchlistId = searchParams.get('watchlistId')
	let entryIds: unknown
	try {
		entryIds = JSON.parse(searchParams.get('entryIds') ?? '')
	} catch {
		throw new Response('Invalid entry order', { status: 400 })
	}
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
				ownerId: userId,
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
