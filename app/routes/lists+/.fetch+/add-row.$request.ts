import { type ActionFunctionArgs } from 'react-router'
import { prisma } from '#app/utils/db.server.ts'
import {
	requireWatchlistOwner,
	stripProtectedFields,
} from '#app/utils/lists/authorization.server.ts'
import {
	ensureMediaForIdentity,
	parseMediaIdentityForListType,
} from '#app/utils/media.server.ts'
import { ensureTrackingStateForEntry } from '#app/utils/tracking-state.server.ts'

export async function action({ request, params }: ActionFunctionArgs) {
	const searchParams = new URLSearchParams(params.request)

	let row: unknown
	try {
		row = JSON.parse(searchParams.get('row') ?? '')
	} catch {
		throw new Response('Invalid row payload', { status: 400 })
	}
	if (!row || typeof row !== 'object' || Array.isArray(row)) {
		throw new Response('Invalid row payload', { status: 400 })
	}
	const rowObj = row as Record<string, unknown>

	// The row may only be added to a watchlist the current user owns.
	const { userId, watchlist } = await requireWatchlistOwner(
		request,
		rowObj.watchlistId as string | null | undefined,
	)

	const listType = await prisma.listType.findUnique({
		where: { id: watchlist.typeId },
		select: { name: true },
	})
	if (!listType) throw new Response('List type not found', { status: 400 })
	const mediaIdentity = parseMediaIdentityForListType(
		rowObj.mediaIdentity,
		listType.name,
		typeof rowObj.thumbnail === 'string' ? rowObj.thumbnail : null,
	)

	// Identity and relations are server-managed. The client may describe a provider
	// identity, but it cannot directly connect an entry to an arbitrary Media row.
	const data = stripProtectedFields(rowObj, [
		'id',
		'media',
		'mediaId',
		'mediaIdentity',
		'trackingState',
		'trackingStateId',
		'watchlist',
	])

	return await prisma.$transaction(async tx => {
		const mediaId = mediaIdentity
			? await ensureMediaForIdentity(tx, mediaIdentity, data)
			: undefined
		const trackingStateId =
			mediaId && mediaIdentity
				? await ensureTrackingStateForEntry(tx, {
						ownerId: userId,
						mediaId,
						mediaKind: mediaIdentity.kind,
						status: watchlist.name,
						statusWatchlistId: watchlist.id,
						entry: data,
						mode: 'status',
					})
				: undefined

		return tx.entry.create({
			data: { ...data, mediaId, trackingStateId } as any,
		})
	})
}
