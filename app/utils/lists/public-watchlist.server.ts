import {
	entryCatalogMetadataFields,
	type MediaCatalogSnapshot,
} from '#app/utils/media-catalog.ts'
import {
	resolveDisplayTitle,
	type TitleLanguage,
} from '#app/utils/media-title.ts'
import { profileHistoryTimestamp } from '#app/utils/profile-history-bounds.ts'

const PUBLIC_HISTORY_CODE_UNIT_LIMIT = 64 * 1024

const publicEntryBaseFields = new Set([
	'id',
	'watchlistId',
	'mediaId',
	'position',
	'thumbnail',
	'title',
	'media',
])

const publicEntryFields = new Set([
	'airYear',
	'authors',
	'averaged',
	'chapters',
	'character',
	'description',
	'differenceObjective',
	'differencePersonal',
	'enjoyment',
	'genres',
	'language',
	'length',
	'malScore',
	'nextRelease',
	'notes',
	'performance',
	'personal',
	'presentation',
	'priority',
	'rating',
	'releaseEnd',
	'releaseStart',
	'serialization',
	'sound',
	'startSeason',
	'startYear',
	'story',
	'studios',
	'thumbnail',
	'title',
	'tmdbScore',
	'type',
	'volumes',
])

const publicHistoryFields = [
	'started',
	'finished',
	'added',
	'lastUpdated',
] as const

const privateMirroredTrackingFields = [
	'personal',
	'differencePersonal',
	'differenceObjective',
	'history',
	'length',
	'chapters',
	'volumes',
] as const

type TrackingStateVisibilityProbe = Record<string, unknown> & {
	ownerId: string
	mediaId: string
	statusWatchlistId: string | null
	statusWatchlist: { ownerId: string; isPublic: boolean } | null
}

type WatchlistEntryVisibilityProbe = Record<string, unknown> & {
	mediaId: string | null
	trackingState: TrackingStateVisibilityProbe | null
	personal: unknown
	differencePersonal: unknown
	differenceObjective: unknown
	history: unknown
	length: unknown
	chapters: unknown
	volumes: unknown
}

type PublicTrackingState<TEntry extends WatchlistEntryVisibilityProbe> = Omit<
	NonNullable<TEntry['trackingState']>,
	| 'ownerId'
	| 'mediaId'
	| 'owner'
	| 'media'
	| 'statusWatchlistId'
	| 'statusWatchlist'
> & {
	statusWatchlistId?: NonNullable<TEntry['trackingState']>['statusWatchlistId']
}

type PreparedWatchlistEntry<TEntry extends WatchlistEntryVisibilityProbe> =
	Omit<TEntry, 'trackingState'> & {
		trackingState: PublicTrackingState<TEntry> | null
	}

type LinkedCatalogMedia = MediaCatalogSnapshot & {
	kind: string
	externalIds?: unknown
}

function withoutVisibilityProbe<TEntry extends WatchlistEntryVisibilityProbe>(
	trackingState: NonNullable<TEntry['trackingState']>,
	keepStatusWatchlistId: boolean,
): PublicTrackingState<TEntry> {
	const publicState: Record<string, unknown> = { ...trackingState }
	delete publicState.ownerId
	delete publicState.mediaId
	delete publicState.owner
	delete publicState.media
	delete publicState.statusWatchlist
	if (!keepStatusWatchlistId) delete publicState.statusWatchlistId
	return publicState as PublicTrackingState<TEntry>
}

/**
 * Remove the relation fields fetched only to enforce public-list privacy.
 *
 * A public duplicate can still point at the owner's canonical TrackingState
 * whose current status lives on a private list. In that case the Entry's
 * mirrored score/history/progress fields are private too and must not become
 * normalization fallbacks.
 */
export function prepareWatchlistEntryForViewer<
	TEntry extends WatchlistEntryVisibilityProbe,
>(
	entry: TEntry,
	watchlistOwnerId: string,
	isOwner: boolean,
): PreparedWatchlistEntry<TEntry> {
	const trackingState = entry.trackingState
	const validIdentity =
		trackingState &&
		trackingState.ownerId === watchlistOwnerId &&
		entry.mediaId !== null &&
		trackingState.mediaId === entry.mediaId
	const trackingStateVisible =
		validIdentity &&
		(isOwner ||
			trackingState.statusWatchlistId === null ||
			(trackingState.statusWatchlist?.ownerId === watchlistOwnerId &&
				trackingState.statusWatchlist.isPublic))

	const prepared = {
		...entry,
		trackingState: trackingState
			? withoutVisibilityProbe<TEntry>(trackingState, isOwner)
			: null,
	} as PreparedWatchlistEntry<TEntry>

	if (!trackingState || trackingStateVisible) return prepared

	prepared.trackingState = null
	for (const field of privateMirroredTrackingFields) {
		;(prepared as Record<string, unknown>)[field] = null
	}
	return prepared
}

/**
 * Linked Entry catalog fields are compatibility snapshots, not a trusted
 * public source. Always overlay them from canonical Media before returning
 * either an owner or visitor payload. Unlinked legacy rows retain their local
 * snapshot until they can be matched to a canonical title.
 */
export function canonicalizeLinkedWatchlistEntry<
	TEntry extends Record<string, unknown> & {
		media: LinkedCatalogMedia | null
	},
>(entry: TEntry, titleLanguage: TitleLanguage = 'default'): TEntry {
	if (!entry.media) return entry

	const canonical = { ...entry } as Record<string, unknown>
	for (const field of entryCatalogMetadataFields) {
		if (field in canonical) canonical[field] = entry.media[field] ?? null
	}
	// Every watchlist surface overlays canonical Media here, so this is the one
	// place a viewer's title preference has to be applied for all of them. The
	// snapshot on Entry stays canonical: it is a global column, so it could
	// never be per-viewer anyway.
	canonical.title = resolveDisplayTitle(entry.media, titleLanguage)
	const externalIds = Array.isArray(entry.media.externalIds)
		? entry.media.externalIds
		: undefined
	canonical.media = {
		kind: entry.media.kind,
		tmdbScore: entry.media.tmdbScore ?? null,
		malScore: entry.media.malScore ?? null,
		...(externalIds === undefined ? {} : { externalIds }),
	}
	return canonical as TEntry
}

export const publicListOwnerSelect = {
	id: true,
	username: true,
} as const

export const publicListTypeSelect = {
	id: true,
	name: true,
	header: true,
	columns: true,
	mediaType: true,
} as const

export const publicWatchlistSelect = {
	id: true,
	typeId: true,
	name: true,
	header: true,
	position: true,
	displayedColumns: true,
	description: true,
	defaultSortColumn: true,
	defaultSortDirection: true,
	isPublic: true,
	createdAt: true,
	updatedAt: true,
} as const

export function publicEntryPayload<
	TEntry extends Record<string, unknown> & {
		watchlistId: string
		position: number
	},
>(entry: TEntry, displayedColumns: string | null) {
	const configuredFields = (displayedColumns ?? '')
		.split(',')
		.map(field => field.trim())
	const visibleFields = new Set(
		configuredFields.filter(field => publicEntryFields.has(field)),
	)
	const payload = Object.fromEntries(
		Object.entries(entry).filter(
			([key]) => publicEntryBaseFields.has(key) || visibleFields.has(key),
		),
	) as Pick<TEntry, 'watchlistId' | 'position'> & Record<string, unknown>

	const visibleHistoryFields = publicHistoryFields.filter(field =>
		configuredFields.includes(field),
	)
	if (visibleHistoryFields.length) {
		let legacyHistory: Record<string, unknown> = {}
		if (
			typeof entry.history === 'string' &&
			entry.history.length <= PUBLIC_HISTORY_CODE_UNIT_LIMIT
		) {
			try {
				const parsed = JSON.parse(entry.history) as unknown
				if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
					legacyHistory = parsed as Record<string, unknown>
				}
			} catch {
				// Invalid legacy history is represented by null values below.
			}
		}
		const trackingState =
			entry.trackingState &&
			typeof entry.trackingState === 'object' &&
			!Array.isArray(entry.trackingState)
				? (entry.trackingState as Record<string, unknown>)
				: null
		const history = Object.fromEntries(
			visibleHistoryFields.map(field => {
				const canonical =
					field === 'started'
						? trackingState?.startedAt
						: field === 'finished'
							? trackingState?.completedAt
							: null
				const timestamp = profileHistoryTimestamp(
					canonical ?? legacyHistory[field],
				)
				return [
					field,
					timestamp === null ? null : new Date(timestamp).toISOString(),
				]
			}),
		)
		payload.history = JSON.stringify(history)
	}

	return payload
}
