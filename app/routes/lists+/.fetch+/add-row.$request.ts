import { type ActionFunctionArgs } from 'react-router'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { stripProtectedFields } from '#app/utils/lists/authorization.server.ts'
import {
	ensureMediaForIdentity,
	hydrateMediaCatalog,
	parseMediaIdentityForListType,
} from '#app/utils/media.server.ts'
import { parseMediaRelationCandidates } from '#app/utils/media-relations.ts'
import { syncMediaRelations } from '#app/utils/media-relations.server.ts'
import { ensureTrackingStateForEntry } from '#app/utils/tracking-state.server.ts'
import { claimWatchlistRevisions } from '#app/utils/lists/watchlist-revision.server.ts'
import { serializeUserLibraryMutation } from '#app/utils/watchlist-limits.ts'

export async function addEntryCommand(ownerId: string, row: unknown) {
	if (!row || typeof row !== 'object' || Array.isArray(row)) {
		throw new Response('Invalid row payload', { status: 400 })
	}
	const rowObj = row as Record<string, unknown>

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
		await serializeUserLibraryMutation(tx, ownerId)
		const watchlistId =
			typeof rowObj.watchlistId === 'string' ? rowObj.watchlistId : null
		const watchlist = watchlistId
			? await tx.watchlist.findFirst({
					where: { id: watchlistId, ownerId },
					include: { type: { select: { name: true } } },
				})
			: null
		if (!watchlist) throw new Response('Not found', { status: 404 })
		const mediaIdentity = parseMediaIdentityForListType(
			rowObj.mediaIdentity,
			watchlist.type.name,
			typeof rowObj.thumbnail === 'string' ? rowObj.thumbnail : null,
		)
		if (!mediaIdentity) {
			throw new Response('Choose a catalog title before adding it to a list', {
				status: 400,
			})
		}
		const mediaRelations = parseMediaRelationCandidates(
			rowObj.mediaRelations,
			mediaIdentity,
		)
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

		const mediaId = await ensureMediaForIdentity(tx, mediaIdentity)
		await hydrateMediaCatalog(tx, mediaId, data, {
			authoritativeFields: ['nextRelease'],
			syncLegacyFields: ['nextRelease'],
		})
		if (mediaRelations) {
			await syncMediaRelations(tx, {
				sourceMediaId: mediaId,
				sourceIdentity: mediaIdentity,
				relations: mediaRelations,
			})
		}
		const trackingStateId = await ensureTrackingStateForEntry(tx, {
			ownerId,
			mediaId,
			mediaKind: mediaIdentity.kind,
			status: watchlist.name,
			statusWatchlistId: watchlist.id,
			entry: data,
			mode: 'status',
			recordActivity: true,
		})

		const entry = await tx.entry.create({
			data: { ...data, position, mediaId, trackingStateId } as any,
		})
		await claimWatchlistRevisions(tx, [watchlist])
		return entry
	})
}

export async function action({ request, params }: ActionFunctionArgs) {
	const ownerId = await requireUserId(request)
	const searchParams = new URLSearchParams(params.request)
	let row: unknown
	try {
		row = JSON.parse(searchParams.get('row') ?? '')
	} catch {
		throw new Response('Invalid row payload', { status: 400 })
	}
	return addEntryCommand(ownerId, row)
}
