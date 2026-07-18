import { type ActionFunctionArgs } from 'react-router'
import { prisma } from '#app/utils/db.server.ts'
import {
	requireEntryOwner,
	stripProtectedFields,
} from '#app/utils/lists/authorization.server.ts'
import {
	ensureMediaForIdentity,
	hydrateMediaCatalog,
	parseMediaIdentityForListType,
} from '#app/utils/media.server.ts'
import {
	deleteTrackingStateIfOrphan,
	ensureTrackingStateForEntry,
} from '#app/utils/tracking-state.server.ts'

export async function action({ request, params }: ActionFunctionArgs) {
	const searchParams = new URLSearchParams(params.request)

	const rowIndex = searchParams.get('rowIndex')

	// The entry must belong to a watchlist the current user owns.
	const { userId, entry, watchlist } = await requireEntryOwner(
		request,
		rowIndex,
	)

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

	// A data update must not change identity/relations directly or move the row to
	// another watchlist. A validated provider identity can establish mediaId below.
	const data = stripProtectedFields(rowObj, [
		'id',
		'media',
		'mediaId',
		'mediaIdentity',
		'trackingState',
		'trackingStateId',
		'watchlist',
		'watchlistId',
	])

	return await prisma.$transaction(async tx => {
		const mediaId = mediaIdentity
			? await ensureMediaForIdentity(tx, mediaIdentity, data)
			: (entry.mediaId ?? undefined)
		const mediaKind = mediaIdentity
			? mediaIdentity.kind
			: mediaId
				? (
						await tx.media.findUnique({
							where: { id: mediaId },
							select: { kind: true },
						})
					)?.kind
				: undefined
		if (mediaId && !mediaIdentity) {
			await hydrateMediaCatalog(tx, mediaId, data)
		}
		const trackingStateId =
			mediaId && mediaKind
				? await ensureTrackingStateForEntry(tx, {
						ownerId: userId,
						mediaId,
						mediaKind,
						status: watchlist.name,
						statusWatchlistId: watchlist.id,
						entry: { ...entry, ...data },
						mode: 'all',
					})
				: undefined

		const updated = await tx.entry.update({
			where: { id: rowIndex as string },
			data: {
				...data,
				...(mediaId ? { mediaId } : {}),
				...(trackingStateId ? { trackingStateId } : {}),
			} as any,
		})
		if (entry.trackingStateId !== trackingStateId) {
			await deleteTrackingStateIfOrphan(tx, entry.trackingStateId)
		}
		return updated
	})
}
