import { type ActionFunctionArgs } from 'react-router'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import {
	requireOwnedEntry,
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

export async function updateEntryCommand(
	ownerId: string,
	entryId: string | null,
	row: unknown,
) {
	const { entry, watchlist } = await requireOwnedEntry(ownerId, entryId)
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
		'position',
	])

	return await prisma.$transaction(async tx => {
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
		if (mediaId) {
			await hydrateMediaCatalog(tx, mediaId, data, {
				authoritativeFields: mediaIdentity ? ['nextRelease'] : undefined,
				syncLegacyFields: mediaIdentity ? ['nextRelease'] : undefined,
			})
		}
		const trackingStateId =
			mediaId && mediaKind
				? await ensureTrackingStateForEntry(tx, {
						ownerId,
						mediaId,
						mediaKind,
						status: watchlist.name,
						statusWatchlistId: watchlist.id,
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

export async function action({ request, params }: ActionFunctionArgs) {
	const ownerId = await requireUserId(request)
	const searchParams = new URLSearchParams(params.request)
	let row: unknown
	try {
		row = JSON.parse(searchParams.get('row') ?? '')
	} catch {
		throw new Response('Invalid row payload', { status: 400 })
	}
	return updateEntryCommand(ownerId, searchParams.get('rowIndex'), row)
}
