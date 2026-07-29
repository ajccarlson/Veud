import { type ListType, type Watchlist } from '@prisma/client'
import {
	parseBoundedProfileHistory,
	profileHistoryTimestamp,
	PROFILE_HISTORY_EVENT_LIMIT,
} from '#app/utils/profile-history-bounds.ts'
import { type ActivityItem } from '#app/utils/profile.ts'

type HistoryListType = Pick<
	ListType,
	'id' | 'columns' | 'mediaType' | 'completionType'
>

type HistoryWatchlist = Pick<Watchlist, 'id' | 'typeId' | 'header'>

type HistorySourceEntry = {
	watchlistId: string
	history: string | null
}

export type ParsedEntryHistory = Record<string, unknown> & {
	added?: unknown
	started?: unknown
	finished?: unknown
	progress?: unknown
	lastUpdated?: unknown
}

export type ParsedHistoryEntry<TEntry extends HistorySourceEntry> = Omit<
	TEntry,
	'history'
> & {
	history: ParsedEntryHistory
}

type ComputedActivityItem = Omit<ActivityItem, 'time'> & { time: Date }

type BuildProfileHistoryArgs<TEntry extends HistorySourceEntry> = {
	listTypes: HistoryListType[]
	watchlists: HistoryWatchlist[]
	entries: TEntry[]
}

type BuildProfileHistoryResult<TEntry extends HistorySourceEntry> = {
	typedEntries: Record<string, ParsedHistoryEntry<TEntry>[]>
	typedHistory: Record<string, ComputedActivityItem[]>
	diagnostic?: {
		rejectedHistories: number
		truncatedHistories: number
		activityEventsTruncated: number
		perEntryEventLimit: number
	}
}

const emptyEntryHistory = (): ParsedEntryHistory => ({
	added: null,
	started: null,
	finished: null,
	progress: null,
	lastUpdated: null,
})

function toTitleCase(input: string) {
	return input
		.replace(/([a-z])([A-Z])/g, '$1 $2')
		.split(' ')
		.map(word => word.charAt(0).toUpperCase() + word.slice(1))
		.join(' ')
}

function parseMediaTypes(value: string) {
	try {
		const parsed = JSON.parse(value)
		return Array.isArray(parsed)
			? parsed.filter(
					(mediaType): mediaType is string =>
						typeof mediaType === 'string' && mediaType.length > 0,
				)
			: []
	} catch {
		return []
	}
}

function parseCompletionPast(value: string) {
	try {
		const parsed = JSON.parse(value)
		const completion =
			parsed && typeof parsed === 'object'
				? (parsed as Record<string, unknown>)
				: null
		return parsed &&
			completion &&
			typeof completion.past === 'string' &&
			completion.past.length > 0
			? completion.past
			: 'completed'
	} catch {
		return 'completed'
	}
}

function dateOrNull(value: unknown) {
	const timestamp = profileHistoryTimestamp(value)
	return timestamp === null ? null : new Date(timestamp)
}

function compareComputedActivity(
	left: ComputedActivityItem,
	right: ComputedActivityItem,
) {
	return (
		right.time.getTime() - left.time.getTime() ||
		left.type.localeCompare(right.type) ||
		left.index - right.index
	)
}

/**
 * Groups a profile's entries by list type and turns their stored history JSON
 * into newest-first activity rows. Activity indexes always point to the same
 * entry in the corresponding `typedEntries[typeId]` array.
 */
export function buildProfileHistory<TEntry extends HistorySourceEntry>({
	listTypes,
	watchlists,
	entries,
}: BuildProfileHistoryArgs<TEntry>): BuildProfileHistoryResult<TEntry> {
	const typedEntries: Record<string, ParsedHistoryEntry<TEntry>[]> = {}
	const typedHistory: Record<string, ComputedActivityItem[]> = {}
	let rejectedHistories = 0
	let truncatedHistories = 0
	let activityEventsTruncated = 0

	// Preserve the profile loader's empty-state payload: it historically omits
	// per-type keys until the user has at least one watchlist.
	if (watchlists.length === 0) return { typedEntries, typedHistory }

	const typeByWatchlist = new Map(
		watchlists.map(watchlist => [watchlist.id, watchlist.typeId]),
	)
	const watchlistById = new Map(
		watchlists.map(watchlist => [watchlist.id, watchlist]),
	)

	for (const listType of listTypes) {
		const historyBounds: Array<{
			finishEventsTruncated: boolean
		}> = []
		const entriesForType = entries
			.filter(entry => typeByWatchlist.get(entry.watchlistId) === listType.id)
			.map(entry => {
				const parsed = parseBoundedProfileHistory(entry.history)
				if (parsed.rejected) rejectedHistories += 1
				if (parsed.finishEventsTruncated) truncatedHistories += 1
				historyBounds.push({
					finishEventsTruncated: parsed.finishEventsTruncated,
				})
				return {
					...entry,
					history: (parsed.history ??
						emptyEntryHistory()) as ParsedEntryHistory,
				}
			}) as ParsedHistoryEntry<TEntry>[]

		typedEntries[listType.id] = entriesForType
		typedHistory[listType.id] = []

		for (const [index, entry] of entriesForType.entries()) {
			const eventCandidates: ComputedActivityItem[] = []
			let entryEventsTruncated =
				historyBounds[index]?.finishEventsTruncated ?? false
			const addActivity = (activity: ComputedActivityItem) => {
				eventCandidates.push(activity)
			}

			for (const [historyKey, historyValue] of Object.entries(entry.history)) {
				if (historyValue == null || historyValue === 'null') continue
				if (historyKey === 'lastUpdated') continue

				if (historyKey === 'progress') {
					const mediaTypes = parseMediaTypes(listType.mediaType)
					const completionPast = parseCompletionPast(listType.completionType)

					for (const mediaType of mediaTypes) {
						if (
							!historyValue ||
							typeof historyValue !== 'object' ||
							Array.isArray(historyValue)
						) {
							continue
						}
						const progressByMedia = historyValue as Record<string, unknown>
						const progressObject = listType.columns.includes('length')
							? progressByMedia
							: (progressByMedia[mediaType] as
									Record<string, unknown> | undefined)

						if (
							!progressObject ||
							typeof progressObject !== 'object' ||
							Array.isArray(progressObject)
						) {
							continue
						}

						const dayGroups = new Map<string, Map<string, Date>>()

						for (const [progressKey, progressValue] of Object.entries(
							progressObject,
						)) {
							if (
								!progressValue ||
								typeof progressValue !== 'object' ||
								Array.isArray(progressValue)
							) {
								continue
							}
							const finishDates = (progressValue as { finishDate?: unknown })
								.finishDate
							if (!Array.isArray(finishDates)) continue

							for (const dateCompleted of finishDates) {
								const date = dateOrNull(dateCompleted)
								if (!date) continue
								const dayKey = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
								const dayGroup =
									dayGroups.get(dayKey) ?? new Map<string, Date>()
								const previous = dayGroup.get(progressKey)

								// Match the existing history semantics: for a later repeat of
								// the same unit on a day, retain its latest timestamp.
								if (!previous || previous < date) {
									dayGroup.set(progressKey, date)
								}
								dayGroups.set(dayKey, dayGroup)
							}
						}

						for (const groupedCompletionMap of dayGroups.values()) {
							let oldest: { date: Date; progressKey: string } | null = null
							let latest: { date: Date; progressKey: string } | null = null
							let completionCount = 0
							for (const [progressKey, date] of groupedCompletionMap) {
								const completion = { date, progressKey }
								completionCount += 1
								if (
									!oldest ||
									oldest.date > date ||
									(oldest.date.getTime() === date.getTime() &&
										oldest.progressKey.localeCompare(progressKey) > 0)
								) {
									oldest = completion
								}
								if (
									!latest ||
									latest.date < date ||
									(latest.date.getTime() === date.getTime() &&
										latest.progressKey.localeCompare(progressKey) < 0)
								) {
									latest = completion
								}
							}
							if (completionCount > 1 && oldest && latest) {
								addActivity({
									type: `${toTitleCase(completionPast)} ${toTitleCase(mediaType)}s ${oldest.progressKey} - ${latest.progressKey}`,
									time: new Date(latest.date),
									index,
								})
							} else {
								const completion = oldest
								if (!completion) continue

								addActivity({
									type: `${toTitleCase(completionPast)} ${toTitleCase(mediaType)} ${completion.progressKey}`,
									time: new Date(completion.date),
									index,
								})
							}
						}
					}

					continue
				}

				const watchlist = watchlistById.get(entry.watchlistId)
				const eventTime = dateOrNull(historyValue)
				if (!eventTime) continue
				addActivity({
					type:
						historyKey === 'added'
							? `Added to ${watchlist?.header ?? ''}`
							: toTitleCase(historyKey),
					time: eventTime,
					index,
				})
			}
			eventCandidates.sort(compareComputedActivity)
			if (eventCandidates.length > PROFILE_HISTORY_EVENT_LIMIT) {
				entryEventsTruncated = true
			}
			typedHistory[listType.id].push(
				...eventCandidates.slice(0, PROFILE_HISTORY_EVENT_LIMIT),
			)
			if (entryEventsTruncated) activityEventsTruncated += 1
		}

		typedHistory[listType.id].sort(compareComputedActivity)
	}

	const result: BuildProfileHistoryResult<TEntry> = {
		typedEntries,
		typedHistory,
	}
	if (
		rejectedHistories > 0 ||
		truncatedHistories > 0 ||
		activityEventsTruncated > 0
	) {
		result.diagnostic = {
			rejectedHistories,
			truncatedHistories,
			activityEventsTruncated,
			perEntryEventLimit: PROFILE_HISTORY_EVENT_LIMIT,
		}
	}
	return result
}
