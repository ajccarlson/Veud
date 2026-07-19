import { type Prisma } from '@prisma/client'
import {
	catalogCreateData,
	mediaCatalogSelect,
	resolveMediaCatalog,
} from './media-catalog.ts'
import { listTypeNameForMediaKind } from './media-detail.ts'
import { ensureTrackingStateForEntry } from './tracking-state.server.ts'
import {
	trackingStateFromEntry,
	type TrackingEntryLike,
} from './tracking-state.ts'

const catalogEntrySelect = {
	id: true,
	thumbnail: true,
	title: true,
	type: true,
	releaseStart: true,
	releaseEnd: true,
	nextRelease: true,
	genres: true,
	description: true,
	airYear: true,
	startSeason: true,
	startYear: true,
	length: true,
	chapters: true,
	volumes: true,
	rating: true,
	language: true,
	studios: true,
	serialization: true,
	authors: true,
	tmdbScore: true,
	malScore: true,
} satisfies Prisma.EntrySelect

type CatalogEntry = Prisma.EntryGetPayload<{
	select: typeof catalogEntrySelect
}>

function catalogRichness(entry: CatalogEntry) {
	return (
		(entry.thumbnail ? 4 : 0) +
		(entry.description?.length ?? 0) +
		(entry.genres ? 2 : 0) +
		(entry.releaseStart ? 2 : 0) +
		(entry.length || entry.chapters || entry.volumes ? 2 : 0)
	)
}

function representativeEntry(entries: CatalogEntry[]) {
	return entries
		.slice()
		.sort(
			(a, b) =>
				catalogRichness(b) - catalogRichness(a) || a.id.localeCompare(b.id),
		)[0]
}

function authoritativeEntry<
	T extends TrackingEntryLike & {
		id: string
		watchlistId: string
		watchlist: { id: string; name: string }
	},
>(entries: T[], mediaKind: string, statusWatchlistId?: string | null) {
	const statusEntry = statusWatchlistId
		? entries.find(entry => entry.watchlistId === statusWatchlistId)
		: null
	if (statusEntry) return statusEntry
	return entries.slice().sort((a, b) => {
		const aUpdated = trackingStateFromEntry(a, {
			status: a.watchlist.name,
			statusWatchlistId: a.watchlist.id,
			mediaKind,
		}).sourceUpdatedAt
		const bUpdated = trackingStateFromEntry(b, {
			status: b.watchlist.name,
			statusWatchlistId: b.watchlist.id,
			mediaKind,
		}).sourceUpdatedAt
		return bUpdated - aUpdated || a.id.localeCompare(b.id)
	})[0]
}

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
		})
	}
}

/**
 * Set a member's status for a canonical title while keeping the legacy
 * watchlist entry, normalized TrackingState, and activity feed in sync.
 */
export async function setMediaTrackingStatus(
	tx: Prisma.TransactionClient,
	input: { ownerId: string; mediaId: string; watchlistId: string },
) {
	const media = await tx.media.findUnique({
		where: { id: input.mediaId },
		select: {
			id: true,
			kind: true,
			...mediaCatalogSelect,
			entries: { select: catalogEntrySelect },
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

	const catalog = resolveMediaCatalog(media, representativeEntry(media.entries))
	const entries = await tx.entry.findMany({
		where: { mediaId: media.id, watchlist: { ownerId: input.ownerId } },
		include: { watchlist: true, media: true },
	})
	const state = await tx.trackingState.findUnique({
		where: {
			ownerId_mediaId: { ownerId: input.ownerId, mediaId: media.id },
		},
		select: { id: true, statusWatchlistId: true },
	})

	let target = entries.find(entry => entry.watchlistId === destination.id)
	if (!target) {
		const maxPosition = await tx.entry.aggregate({
			where: { watchlistId: destination.id },
			_max: { position: true },
		})
		const position = (maxPosition._max.position ?? 0) + 1
		const primary = authoritativeEntry(
			entries,
			media.kind,
			state?.statusWatchlistId,
		)
		if (primary) {
			const sourceWatchlistId = primary.watchlistId
			target = await tx.entry.update({
				where: { id: primary.id },
				data: { watchlistId: destination.id, position },
				include: { watchlist: true, media: true },
			})
			if (sourceWatchlistId !== destination.id) {
				await renumberWatchlist(tx, sourceWatchlistId)
			}
		} else {
			const now = Date.now()
			target = await tx.entry.create({
				data: {
					...catalogCreateData(catalog, media.kind),
					watchlistId: destination.id,
					mediaId: media.id,
					position,
					history: JSON.stringify({
						added: now,
						started: null,
						finished: null,
						progress: null,
						lastUpdated: now,
					}),
				},
				include: { watchlist: true, media: true },
			})
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
		recordActivity: true,
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
