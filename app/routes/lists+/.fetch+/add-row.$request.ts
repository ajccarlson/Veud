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
import { parseMediaRelationCandidates } from '#app/utils/media-relations.ts'
import { syncMediaRelations } from '#app/utils/media-relations.server.ts'
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
	const mediaRelations = mediaIdentity
		? parseMediaRelationCandidates(rowObj.mediaRelations, mediaIdentity)
		: null

	// Identity and relations are server-managed. The client may describe a provider
	// identity, but it cannot directly connect an entry to an arbitrary Media row.
	const data = stripProtectedFields(rowObj, [
		'id',
		'media',
		'mediaId',
		'mediaIdentity',
		'mediaRelations',
		'trackingState',
		'trackingStateId',
		'watchlist',
	])

	return await prisma.$transaction(async tx => {
		const entryCount = await tx.entry.count({
			where: { watchlistId: watchlist.id },
		})
		const requestedPosition =
			typeof data.position === 'number' && Number.isFinite(data.position)
				? Math.trunc(data.position)
				: entryCount + 1
		const position = Math.min(Math.max(requestedPosition, 1), entryCount + 1)
		await tx.entry.updateMany({
			where: { watchlistId: watchlist.id, position: { gte: position } },
			data: { position: { increment: 1 } },
		})

		const mediaId = mediaIdentity
			? await ensureMediaForIdentity(tx, mediaIdentity, data)
			: undefined
		if (mediaId && mediaIdentity && mediaRelations) {
			await syncMediaRelations(tx, {
				sourceMediaId: mediaId,
				sourceIdentity: mediaIdentity,
				relations: mediaRelations,
			})
		}
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
						recordActivity: true,
					})
				: undefined

		const entry = await tx.entry.create({
			data: { ...data, position, mediaId, trackingStateId } as any,
		})
		await tx.watchlist.update({
			where: { id: watchlist.id },
			data: { updatedAt: new Date() },
		})
		return entry
	})
}
