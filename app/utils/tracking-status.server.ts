import { type Prisma } from '@prisma/client'
import {
	authoritativeLegacyTrackingEntry,
	loadOwnerLegacyTrackingEntries,
	type LegacyTrackingEntry,
} from './legacy-tracking-entry.server.ts'
import {
	catalogCreateData,
	mediaCatalogSelect,
	resolveMediaCatalog,
} from './media-catalog.ts'
import { listTypeNameForMediaKind } from './media-detail.ts'
import { ensureTrackingStateForEntry } from './tracking-state.server.ts'
import { serializeUserLibraryMutation } from './watchlist-limits.ts'

async function renumberWatchlist(
	tx: Prisma.TransactionClient,
	watchlistId: string,
) {
	const entries = await tx.entry.findMany({
		where: { watchlistId },
		orderBy: [{ position: 'asc' }, { id: 'asc' }],
		select: { id: true, position: true },
	})
	for (const [index, entry] of entries.entries()) {
		if (entry.position === index + 1) continue
		await tx.entry.update({
			where: { id: entry.id },
			data: { position: index + 1 },
			select: { id: true },
		})
	}
}

/**
 * Set a member's status for a canonical title while keeping the legacy
 * watchlist entry, normalized TrackingState, and activity feed in sync.
 */
export async function setMediaTrackingStatus(
	tx: Prisma.TransactionClient,
	input: {
		ownerId: string
		mediaId: string
		watchlistId: string
		recordActivity?: boolean
		/**
		 * Where in the destination list the entry should land. Omitted, it goes to
		 * the end, which is what tracking a title from anywhere else should do.
		 * Supplied, the rows from there down shift by one inside this transaction,
		 * so the list is never briefly wrong.
		 */
		insertPosition?: number | null
	},
) {
	await serializeUserLibraryMutation(tx, input.ownerId)
	const media = await tx.media.findUnique({
		where: { id: input.mediaId },
		select: {
			id: true,
			kind: true,
			...mediaCatalogSelect,
		},
	})
	if (!media) throw new Response('Media not found', { status: 404 })

	const listTypeName = listTypeNameForMediaKind(media.kind)
	if (!listTypeName)
		throw new Response('Unsupported media kind', { status: 400 })
	const destination = await tx.watchlist.findFirst({
		where: {
			id: input.watchlistId,
			ownerId: input.ownerId,
			type: { name: listTypeName },
		},
		select: { id: true, name: true, header: true },
	})
	if (!destination) {
		throw new Response('Tracking status not found', { status: 400 })
	}

	const catalog = resolveMediaCatalog(media)
	const [state, destinationEntries] = await Promise.all([
		tx.trackingState.findUnique({
			where: {
				ownerId_mediaId: { ownerId: input.ownerId, mediaId: media.id },
			},
			select: { id: true, statusWatchlistId: true },
		}),
		loadOwnerLegacyTrackingEntries(tx, {
			ownerId: input.ownerId,
			mediaId: media.id,
			watchlistId: destination.id,
		}),
	])
	if (destinationEntries.overflowed) {
		throw new Response('Tracking data needs repair before editing', {
			status: 409,
		})
	}

	let target =
		authoritativeLegacyTrackingEntry(
			destinationEntries.entries,
			media.kind,
			destination.id,
		) ?? null
	if (!target) {
		const entryCount = await tx.entry.count({
			where: { watchlistId: destination.id },
		})
		const requestedPosition =
			typeof input.insertPosition === 'number' &&
			Number.isFinite(input.insertPosition)
				? Math.min(Math.max(Math.trunc(input.insertPosition), 1), entryCount + 1)
				: null
		const position = requestedPosition ?? entryCount + 1
		if (requestedPosition !== null) {
			// Make room before anything claims the position. Everything here shares
			// one transaction, so a failure leaves the list exactly as it was.
			await tx.entry.updateMany({
				where: {
					watchlistId: destination.id,
					position: { gte: requestedPosition },
				},
				data: { position: { increment: 1 } },
			})
		}
		let primary: LegacyTrackingEntry | undefined
		if (state?.statusWatchlistId) {
			const statusEntries = await loadOwnerLegacyTrackingEntries(tx, {
				ownerId: input.ownerId,
				mediaId: media.id,
				watchlistId: state.statusWatchlistId,
			})
			if (statusEntries.overflowed) {
				throw new Response('Tracking data needs repair before editing', {
					status: 409,
				})
			}
			primary = authoritativeLegacyTrackingEntry(
				statusEntries.entries,
				media.kind,
				state.statusWatchlistId,
			)
		}
		if (!primary) {
			const legacyEntries = await loadOwnerLegacyTrackingEntries(tx, {
				ownerId: input.ownerId,
				mediaId: media.id,
			})
			if (legacyEntries.overflowed) {
				throw new Response('Tracking data needs repair before editing', {
					status: 409,
				})
			}
			primary = authoritativeLegacyTrackingEntry(
				legacyEntries.entries,
				media.kind,
				state?.statusWatchlistId,
			)
		}
		if (primary) {
			const sourceWatchlistId = primary.watchlistId
			await tx.entry.update({
				where: { id: primary.id },
				data: { watchlistId: destination.id, position },
				select: { id: true },
			})
			target = {
				...primary,
				watchlistId: destination.id,
				watchlist: { id: destination.id, name: destination.name },
			}
			if (sourceWatchlistId !== destination.id) {
				await renumberWatchlist(tx, sourceWatchlistId)
			}
		} else {
			const now = Date.now()
			const history = JSON.stringify({
				added: now,
				started: null,
				finished: null,
				progress: null,
				lastUpdated: now,
			})
			const created = await tx.entry.create({
				data: {
					...catalogCreateData(catalog, media.kind),
					watchlistId: destination.id,
					mediaId: media.id,
					position,
					history,
				},
				select: { id: true },
			})
			target = {
				id: created.id,
				watchlistId: destination.id,
				personal: null,
				history,
				length: catalog?.length ?? null,
				chapters: catalog?.chapters ?? null,
				volumes: catalog?.volumes ?? null,
				watchlist: { id: destination.id, name: destination.name },
			}
		}
	}

	const trackingStateId = await ensureTrackingStateForEntry(tx, {
		ownerId: input.ownerId,
		mediaId: media.id,
		mediaKind: media.kind,
		status: destination.name,
		statusWatchlistId: destination.id,
		entry: target,
		mode: 'status',
		recordActivity: input.recordActivity ?? true,
	})
	await tx.entry.updateMany({
		where: { mediaId: media.id, watchlist: { ownerId: input.ownerId } },
		data: { trackingStateId },
	})

	return {
		mediaId: media.id,
		watchlistId: destination.id,
		status: destination.name,
		statusLabel: destination.header,
		trackingStateId,
	}
}
