import { prisma } from '#app/utils/db.server.ts'
import { stripProtectedFields } from '#app/utils/lists/authorization.server.ts'
import {
	ensureMediaForIdentity,
	parseMediaIdentityForListType,
} from '#app/utils/media.server.ts'
import {
	deleteTrackingStateIfOrphan,
	ensureTrackingStateForEntry,
} from '#app/utils/tracking-state.server.ts'
import { serializeUserLibraryMutation } from '#app/utils/watchlist-limits.ts'

export async function updateEntryCommand(
	ownerId: string,
	entryId: string | null,
	row: unknown,
) {
	if (!row || typeof row !== 'object' || Array.isArray(row)) {
		throw new Response('Invalid row payload', { status: 400 })
	}

	const rowObj = row as Record<string, unknown>

	// A data update must not change identity/relations directly or move the row to
	// another watchlist. A validated provider identity can establish mediaId below.
	const data = stripProtectedFields(rowObj, [
		'id',
		'media',
		'mediaId',
		'mediaIdentity',
		'mediaRelations',
		'trackingState',
		'trackingStateId',
		'watchlist',
		'watchlistId',
		'position',
	])

	return await prisma.$transaction(async tx => {
		await serializeUserLibraryMutation(tx, ownerId)
		const entry = entryId
			? await tx.entry.findUnique({
					where: { id: entryId },
					include: {
						watchlist: {
							select: {
								id: true,
								name: true,
								ownerId: true,
								type: { select: { name: true } },
							},
						},
					},
				})
			: null
		if (!entry || entry.watchlist.ownerId !== ownerId) {
			throw new Response('Not found', { status: 404 })
		}
		const mediaIdentity = parseMediaIdentityForListType(
			rowObj.mediaIdentity,
			entry.watchlist.type.name,
			typeof rowObj.thumbnail === 'string' ? rowObj.thumbnail : null,
		)
		const mediaId = mediaIdentity
			? await ensureMediaForIdentity(tx, mediaIdentity)
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
		const trackingStateId =
			mediaId && mediaKind
				? await ensureTrackingStateForEntry(tx, {
						ownerId,
						mediaId,
						mediaKind,
						status: entry.watchlist.name,
						statusWatchlistId: entry.watchlist.id,
						entry: { ...entry, ...data },
						mode: 'all',
						recordActivity: true,
					})
				: undefined

		const updated = await tx.entry.update({
			where: { id: entry.id },
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
