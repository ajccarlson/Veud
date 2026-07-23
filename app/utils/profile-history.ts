import { type ListType, type Watchlist } from '@prisma/client'
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

function parseEntryHistory(history: string | null): ParsedEntryHistory {
	if (!history || history === 'null') return emptyEntryHistory()
	try {
		const parsed = JSON.parse(history)
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
			? (parsed as ParsedEntryHistory)
			: emptyEntryHistory()
	} catch {
		return emptyEntryHistory()
	}
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
	const date = new Date(value as string | number | Date)
	return Number.isFinite(date.getTime()) ? date : null
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
		const entriesForType = entries
			.filter(entry => typeByWatchlist.get(entry.watchlistId) === listType.id)
			.map(entry => ({
				...entry,
				history: parseEntryHistory(entry.history),
			})) as ParsedHistoryEntry<TEntry>[]

		typedEntries[listType.id] = entriesForType
		typedHistory[listType.id] = []

		for (const [index, entry] of entriesForType.entries()) {
			for (const [historyKey, historyValue] of Object.entries(entry.history)) {
				if (historyValue == null || historyValue === 'null') continue
				if (historyKey === 'lastUpdated') continue

				if (historyKey === 'progress') {
					const mediaTypes = parseMediaTypes(listType.mediaType)
					const completionPast = parseCompletionPast(listType.completionType)

					for (const mediaType of mediaTypes) {
						const progressByMedia = historyValue as Record<string, unknown>
						const progressObject = listType.columns.includes('length')
							? progressByMedia
							: (progressByMedia[mediaType] as
									Record<string, unknown> | undefined)

						if (!progressObject) continue

						const dayGroups: Record<
							string,
							Array<{ date: Date; progressKey: string }>
						> = {}

						for (const [progressKey, progressValue] of Object.entries(
							progressObject,
						)) {
							const finishDates = (progressValue as { finishDate?: unknown })
								.finishDate
							if (!finishDates) continue

							for (const dateCompleted of finishDates as unknown[]) {
								const date = dateOrNull(dateCompleted)
								if (!date) continue
								const dayKey = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
								const dayGroup = (dayGroups[dayKey] ??= [])
								const duplicate = dayGroup.find(
									completion => completion.progressKey === progressKey,
								)

								// Match the existing history semantics: for a later repeat of
								// the same unit on a day, retain its latest timestamp.
								if (duplicate) {
									if (duplicate.date < date) duplicate.date = date
									continue
								}

								dayGroup.push({ date, progressKey })
							}
						}

						for (const groupedCompletions of Object.values(dayGroups)) {
							if (groupedCompletions.length > 1) {
								const latest = groupedCompletions.reduce((max, completion) =>
									max.date > completion.date ? max : completion,
								)
								const oldest = groupedCompletions.reduce((min, completion) =>
									min.date < completion.date ? min : completion,
								)

								typedHistory[listType.id].push({
									type: `${toTitleCase(completionPast)} ${toTitleCase(mediaType)}s ${oldest.progressKey} - ${latest.progressKey}`,
									time: new Date(latest.date),
									index,
								})
							} else {
								const completion = groupedCompletions[0]
								if (!completion) continue

								typedHistory[listType.id].push({
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
				typedHistory[listType.id].push({
					type:
						historyKey === 'added'
							? `Added to ${watchlist?.header ?? ''}`
							: toTitleCase(historyKey),
					time: eventTime,
					index,
				})
			}
		}

		typedHistory[listType.id].sort(
			(a, b) => b.time.getTime() - a.time.getTime(),
		)
	}

	return { typedEntries, typedHistory }
}
