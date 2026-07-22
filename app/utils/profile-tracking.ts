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
	status: string
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

function numberOrNull(value: unknown) {
	const number = Number(value)
	return Number.isFinite(number) && number > 0 ? number : null
}

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

/**
 * Build profile-level totals from normalized tracking rows. Entries without a
 * TrackingState remain readable during rollout and are deduplicated by Media
 * when canonical identity is already available.
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
	const watchlistById = new Map(
		watchlists.map(watchlist => [watchlist.id, watchlist]),
	)
	const items = new Map<
		string,
		SummaryItem & { sourceUpdatedAt: number; sourceId: string }
	>()

	for (const entry of entries) {
		const entryWatchlist = watchlistById.get(entry.watchlistId)
		if (!entryWatchlist) continue

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
			if (items.get(key)?.sourceUpdatedAt === Infinity) continue
			const legacySnapshot = trackingStateFromEntry(entry, {
				status: state.status,
				statusWatchlistId: state.statusWatchlistId,
				mediaKind: entry.media?.kind ?? 'unknown',
			})
			const recoveredProgress = new Map(
				state.progress.map(progress => [
					progress.unit,
					Math.max(0, progress.current),
				]),
			)
			for (const progress of legacySnapshot.progress) {
				const current = recoveredProgress.get(progress.unit)
				if (
					current === undefined ||
					(current === 0 && progress.current > current)
				) {
					recoveredProgress.set(progress.unit, progress.current)
				}
			}
			items.set(key, {
				typeId: statusWatchlist.typeId,
				statusKey: statusWatchlist.id,
				status: state.status,
				score: numberOrNull(state.score),
				repeatCount: Math.max(0, state.repeatCount),
				progress: [...recoveredProgress].map(([unit, current]) => ({
					unit,
					current,
				})),
				sourceUpdatedAt: Infinity,
				sourceId: entry.id,
			})
			continue
		}

		const snapshot = trackingStateFromEntry(entry, {
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
			continue
		items.set(key, {
			typeId: entryWatchlist.typeId,
			statusKey: entryWatchlist.id,
			status: snapshot.status,
			score: snapshot.score,
			repeatCount: snapshot.repeatCount,
			progress: snapshot.progress.map(progress => ({
				unit: progress.unit,
				current: progress.current,
			})),
			sourceUpdatedAt: snapshot.sourceUpdatedAt,
			sourceId: entry.id,
		})
	}

	const summaries: Record<string, ProfileTrackingSummary> = {}
	for (const listType of listTypes) {
		const typeItems = [...items.values()].filter(
			item => item.typeId === listType.id,
		)
		const scored = typeItems
			.map(item => item.score)
			.filter((score): score is number => score !== null)
		const progressByUnit = new Map<string, number>()
		for (const item of typeItems) {
			for (const progress of item.progress) {
				progressByUnit.set(
					progress.unit,
					(progressByUnit.get(progress.unit) ?? 0) + progress.current,
				)
			}
		}

		const typeWatchlists = watchlists
			.filter(watchlist => watchlist.typeId === listType.id)
			.slice()
			.sort(
				(a, b) => a.position - b.position || a.header.localeCompare(b.header),
			)
		const configuredStatusKeys = new Set(
			typeWatchlists.map(status => status.id),
		)
		const statuses = typeWatchlists.map(watchlist => ({
			key: watchlist.id,
			label: watchlist.header,
			count: typeItems.filter(item => item.statusKey === watchlist.id).length,
		}))
		const unconfiguredStatuses = new Map<string, number>()
		for (const item of typeItems) {
			if (configuredStatusKeys.has(item.statusKey)) continue
			unconfiguredStatuses.set(
				item.status,
				(unconfiguredStatuses.get(item.status) ?? 0) + 1,
			)
		}
		for (const [status, count] of unconfiguredStatuses) {
			statuses.push({
				key: `status:${status}`,
				label: labelFromStatus(status),
				count,
			})
		}

		summaries[listType.id] = {
			totalTitles: typeItems.length,
			meanScore: scored.length
				? scored.reduce((total, score) => total + score, 0) / scored.length
				: null,
			repeatCount: typeItems.reduce(
				(total, item) => total + item.repeatCount,
				0,
			),
			progress: [...progressByUnit]
				.map(([unit, current]) => ({ unit, current }))
				.sort((a, b) => compareUnits(a.unit, b.unit)),
			statuses,
		}
	}

	return summaries
}
