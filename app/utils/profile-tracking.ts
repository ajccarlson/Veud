import { preferredScore } from './lists/watchlist-entry-scores.server.ts'
import { parseBoundedProfileHistory } from './profile-history-bounds.ts'
import {
	trackingStateFromEntry,
	type TrackingEntryLike,
} from './tracking-state.ts'

export type ProfileTrackingProgressSummary = {
	unit: string
	current: number
}

export type ProfileTrackingStatusSummary = {
	key: string
	label: string
	count: number
}

export type ProfileTrackingSummary = {
	totalTitles: number
	meanScore: number | null
	repeatCount: number
	progress: ProfileTrackingProgressSummary[]
	statuses: ProfileTrackingStatusSummary[]
}

type TrackingListType = {
	id: string
}

type TrackingWatchlist = {
	id: string
	typeId: string
	name: string
	header: string
	position: number
}

type NormalizedState = {
	id: string
	/** Compatibility-only input; aggregation derives the bounded list name. */
	status?: string
	statusWatchlistId: string | null
	score: unknown
	repeatCount: number
	progress: Array<{ unit: string; current: number }>
}

export type ProfileTrackingEntry = TrackingEntryLike & {
	id: string
	watchlistId: string
	mediaId: string | null
	media: { kind: string } | null
	trackingState: NormalizedState | null
}

type SummaryItem = {
	typeId: string
	statusKey: string
	status: string
	score: number | null
	repeatCount: number
	progress: Array<{ unit: string; current: number }>
}

const preferredUnitOrder = ['episode', 'chapter', 'volume']
const supportedProgressUnits = new Set(preferredUnitOrder)

function labelFromStatus(status: string) {
	return status
		.replace(/([a-z])([A-Z])/g, '$1 $2')
		.replace(/[-_]+/g, ' ')
		.replace(/\b\w/g, character => character.toUpperCase())
}

function compareUnits(a: string, b: string) {
	const aIndex = preferredUnitOrder.indexOf(a)
	const bIndex = preferredUnitOrder.indexOf(b)
	if (aIndex >= 0 || bIndex >= 0) {
		return (aIndex < 0 ? Infinity : aIndex) - (bIndex < 0 ? Infinity : bIndex)
	}
	return a.localeCompare(b)
}

function supportedProgressUnit(value: unknown) {
	if (typeof value !== 'string') return null
	const normalized = value.toLowerCase().replace(/[^a-z]/g, '')
	const singular =
		normalized === 'episodes'
			? 'episode'
			: normalized === 'chapters'
				? 'chapter'
				: normalized === 'volumes'
					? 'volume'
					: normalized
	return supportedProgressUnits.has(singular) ? singular : null
}

function boundedHistory(value: unknown) {
	const parsed = parseBoundedProfileHistory(value)
	return parsed.history
}

function supportedProgress(
	progress: Iterable<{ unit: string; current: number }>,
) {
	const result = new Map<string, number>()
	for (const item of progress) {
		const unit = supportedProgressUnit(item.unit)
		const current = Number(item.current)
		if (!unit || !Number.isFinite(current)) continue
		result.set(unit, Math.max(result.get(unit) ?? 0, Math.max(0, current)))
	}
	return result
}

/**
 * Incrementally builds profile-level totals from normalized tracking rows.
 * Callers may feed deterministic database pages without retaining the full
 * Entry result set in memory. The compact item map is required to preserve the
 * rollout rule that a normalized state wins over every legacy snapshot and
 * that the newest canonical legacy snapshot wins otherwise.
 */
export function createProfileTrackingAccumulator({
	listTypes,
	watchlists,
}: {
	listTypes: TrackingListType[]
	watchlists: TrackingWatchlist[]
}) {
	const watchlistById = new Map(
		watchlists.map(watchlist => [watchlist.id, watchlist]),
	)
	const items = new Map<
		string,
		SummaryItem & { sourceUpdatedAt: number; sourceId: string }
	>()

	function add(entry: ProfileTrackingEntry) {
		const entryWatchlist = watchlistById.get(entry.watchlistId)
		if (!entryWatchlist) return
		const boundedEntry = {
			...entry,
			history: boundedHistory(entry.history),
		}

		if (entry.trackingState) {
			const state = entry.trackingState
			const stateWatchlist = state.statusWatchlistId
				? watchlistById.get(state.statusWatchlistId)
				: null
			const statusWatchlist =
				stateWatchlist?.typeId === entryWatchlist.typeId
					? stateWatchlist
					: entryWatchlist
			const key = entry.mediaId ? `media:${entry.mediaId}` : `state:${state.id}`
			if (items.get(key)?.sourceUpdatedAt === Infinity) return
			const legacySnapshot = trackingStateFromEntry(boundedEntry, {
				status: statusWatchlist.name,
				statusWatchlistId: state.statusWatchlistId,
				mediaKind: entry.media?.kind ?? 'unknown',
			})
			const recoveredProgress = supportedProgress(state.progress)
			for (const progress of legacySnapshot.progress) {
				const unit = supportedProgressUnit(progress.unit)
				if (!unit) continue
				const current = recoveredProgress.get(unit)
				if (
					current === undefined ||
					(current === 0 && progress.current > current)
				) {
					recoveredProgress.set(unit, progress.current)
				}
			}
			items.set(key, {
				typeId: statusWatchlist.typeId,
				statusKey: statusWatchlist.id,
				status: statusWatchlist.name,
				score: preferredScore(state.score, boundedEntry.personal),
				repeatCount: Math.max(0, state.repeatCount),
				progress: [...recoveredProgress].map(([unit, current]) => ({
					unit,
					current,
				})),
				sourceUpdatedAt: Infinity,
				sourceId: entry.id,
			})
			return
		}

		const snapshot = trackingStateFromEntry(boundedEntry, {
			status: entryWatchlist.name,
			statusWatchlistId: entryWatchlist.id,
			mediaKind: entry.media?.kind ?? 'unknown',
		})
		const key = entry.mediaId ? `media:${entry.mediaId}` : `entry:${entry.id}`
		const previous = items.get(key)
		if (
			previous &&
			(previous.sourceUpdatedAt > snapshot.sourceUpdatedAt ||
				(previous.sourceUpdatedAt === snapshot.sourceUpdatedAt &&
					previous.sourceId <= entry.id))
		)
			return
		items.set(key, {
			typeId: entryWatchlist.typeId,
			statusKey: entryWatchlist.id,
			status: snapshot.status,
			score: snapshot.score,
			repeatCount: snapshot.repeatCount,
			progress: [...supportedProgress(snapshot.progress)].map(
				([unit, current]) => ({ unit, current }),
			),
			sourceUpdatedAt: snapshot.sourceUpdatedAt,
			sourceId: entry.id,
		})
	}

	function addMany(entries: Iterable<ProfileTrackingEntry>) {
		for (const entry of entries) add(entry)
	}

	function finish(): Record<string, ProfileTrackingSummary> {
		const aggregateByType = new Map(
			listTypes.map(listType => [
				listType.id,
				{
					totalTitles: 0,
					scoreTotal: 0,
					scoreCount: 0,
					repeatCount: 0,
					progress: new Map<string, number>(),
					statusCounts: new Map<string, number>(),
					unconfiguredStatusCounts: new Map<string, number>(),
				},
			]),
		)

		const configuredStatusKeysByType = new Map<string, Set<string>>()
		for (const listType of listTypes) {
			configuredStatusKeysByType.set(
				listType.id,
				new Set(
					watchlists
						.filter(watchlist => watchlist.typeId === listType.id)
						.map(watchlist => watchlist.id),
				),
			)
		}

		for (const item of items.values()) {
			const aggregate = aggregateByType.get(item.typeId)
			if (!aggregate) continue
			aggregate.totalTitles += 1
			if (item.score !== null) {
				aggregate.scoreTotal += item.score
				aggregate.scoreCount += 1
			}
			aggregate.repeatCount += item.repeatCount
			for (const progress of item.progress) {
				aggregate.progress.set(
					progress.unit,
					(aggregate.progress.get(progress.unit) ?? 0) + progress.current,
				)
			}
			if (configuredStatusKeysByType.get(item.typeId)?.has(item.statusKey)) {
				aggregate.statusCounts.set(
					item.statusKey,
					(aggregate.statusCounts.get(item.statusKey) ?? 0) + 1,
				)
			} else {
				aggregate.unconfiguredStatusCounts.set(
					item.status,
					(aggregate.unconfiguredStatusCounts.get(item.status) ?? 0) + 1,
				)
			}
		}

		const summaries: Record<string, ProfileTrackingSummary> = {}
		for (const listType of listTypes) {
			const aggregate = aggregateByType.get(listType.id)
			if (!aggregate) continue
			const typeWatchlists = watchlists
				.filter(watchlist => watchlist.typeId === listType.id)
				.slice()
				.sort(
					(a, b) => a.position - b.position || a.header.localeCompare(b.header),
				)
			const statuses = typeWatchlists.map(watchlist => ({
				key: watchlist.id,
				label: watchlist.header,
				count: aggregate.statusCounts.get(watchlist.id) ?? 0,
			}))
			for (const [status, count] of aggregate.unconfiguredStatusCounts) {
				statuses.push({
					key: `status:${status}`,
					label: labelFromStatus(status),
					count,
				})
			}

			summaries[listType.id] = {
				totalTitles: aggregate.totalTitles,
				meanScore: aggregate.scoreCount
					? aggregate.scoreTotal / aggregate.scoreCount
					: null,
				repeatCount: aggregate.repeatCount,
				progress: [...aggregate.progress]
					.map(([unit, current]) => ({ unit, current }))
					.sort((a, b) => compareUnits(a.unit, b.unit)),
				statuses,
			}
		}

		return summaries
	}

	return { add, addMany, finish }
}

/**
 * Compatibility wrapper for callers that already have a row array. New
 * database callers should prefer `createProfileTrackingAccumulator`.
 */
export function buildProfileTrackingSummaries({
	listTypes,
	watchlists,
	entries,
}: {
	listTypes: TrackingListType[]
	watchlists: TrackingWatchlist[]
	entries: ProfileTrackingEntry[]
}): Record<string, ProfileTrackingSummary> {
	const accumulator = createProfileTrackingAccumulator({
		listTypes,
		watchlists,
	})
	accumulator.addMany(entries)
	return accumulator.finish()
}
