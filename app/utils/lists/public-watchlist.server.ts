const publicEntryBaseFields = new Set([
	'id',
	'watchlistId',
	'mediaId',
	'position',
	'thumbnail',
	'title',
	'type',
	'personal',
	'tmdbScore',
	'malScore',
	'media',
	'trackingState',
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
	if (
		['started', 'finished', 'added', 'lastUpdated'].some(field =>
			configuredFields.includes(field),
		)
	) {
		visibleFields.add('history')
	}

	return Object.fromEntries(
		Object.entries(entry).filter(
			([key]) => publicEntryBaseFields.has(key) || visibleFields.has(key),
		),
	) as Pick<TEntry, 'watchlistId' | 'position'> & Record<string, unknown>
}
