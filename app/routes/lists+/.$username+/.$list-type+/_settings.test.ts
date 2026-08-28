import { expect, test } from 'vitest'
import { getCheckedWatchlistColumns } from './_settings.tsx'

test('resolves displayed columns by membership instead of saved order', () => {
	const columns = [
		'id',
		'watchlistId',
		'watchlist',
		'position',
		'thumbnail',
		'title',
		'personalScore',
		'notes',
	]

	expect(
		getCheckedWatchlistColumns(columns, [
			'notes',
			'unknownLegacyColumn',
			'title',
			'id',
			'notes',
		]),
	).toEqual(['title', 'notes'])
})

test('returns no checked columns when the saved selection is empty', () => {
	expect(getCheckedWatchlistColumns(['position', 'title'], [])).toEqual([])
})
