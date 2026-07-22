export const watchlistSortDirections = ['asc', 'desc'] as const

export type WatchlistSortDirection = (typeof watchlistSortDirections)[number]

const columnAliases: Record<string, string> = {
	startDate: 'started',
	finishedDate: 'finished',
	dateAdded: 'added',
}

const sortableGridColumns = new Set([
	'title',
	'type',
	'airYear',
	'startSeason',
	'startYear',
	'releaseStart',
	'releaseEnd',
	'length',
	'chapters',
	'volumes',
	'rating',
	'started',
	'finished',
	'added',
	'lastUpdated',
	'genres',
	'studios',
	'serialization',
	'authors',
	'language',
	'priority',
	'story',
	'character',
	'presentation',
	'sound',
	'performance',
	'enjoyment',
	'averaged',
	'personal',
	'differencePersonal',
	'tmdbScore',
	'malScore',
	'differenceObjective',
	'description',
	'notes',
])

export function getSortableWatchlistColumns(columns: string) {
	try {
		const parsed = JSON.parse(columns) as unknown
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
			return []
		return [
			...new Set(
				Object.keys(parsed)
					.map(column => columnAliases[column] ?? column)
					.filter(column => sortableGridColumns.has(column)),
			),
		]
	} catch {
		return []
	}
}

export function watchlistColumnLabel(column: string) {
	if (column === 'started') return 'Start Date'
	if (column === 'finished') return 'Finished Date'
	if (column === 'added') return 'Date Added'
	return column
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replace(/^./, character => character.toUpperCase())
}

export function normalizeWatchlistSortDirection(
	value: unknown,
): WatchlistSortDirection | null {
	return typeof value === 'string' &&
		watchlistSortDirections.includes(value as WatchlistSortDirection)
		? (value as WatchlistSortDirection)
		: null
}

export function normalizeWatchlistSortColumn(
	value: unknown,
	columns: string[],
) {
	if (value === null || value === '' || value === 'manual') return null
	return typeof value === 'string' && columns.includes(value)
		? value
		: undefined
}

export function getWatchlistDefaultSortModel(
	watchlist: {
		defaultSortColumn?: string | null
		defaultSortDirection?: string | null
	},
	columns: string[],
) {
	const column = normalizeWatchlistSortColumn(
		watchlist.defaultSortColumn,
		columns,
	)
	const direction = normalizeWatchlistSortDirection(
		watchlist.defaultSortDirection,
	)
	if (!column || !direction) return []
	return [{ colId: column, sort: direction }]
}
