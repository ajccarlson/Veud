import { expect, test } from 'vitest'
import {
	getSortableWatchlistColumns,
	getWatchlistDefaultSortModel,
	normalizeWatchlistSortColumn,
	normalizeWatchlistSortDirection,
	watchlistColumnLabel,
} from './default-sort.ts'

test('extracts only user-facing list columns', () => {
	expect(
		getSortableWatchlistColumns(
			JSON.stringify({
				id: 'string',
				watchlistId: 'string',
				position: 'number',
				thumbnail: 'string',
				title: 'string',
				startDate: 'history',
				differencePersonal: 'number',
			}),
		),
	).toEqual(['title', 'started', 'differencePersonal'])
	expect(getSortableWatchlistColumns('invalid json')).toEqual([])
	expect(watchlistColumnLabel('differencePersonal')).toBe('Difference Personal')
	expect(watchlistColumnLabel('started')).toBe('Start Date')
})

test('manual ordering produces no grid sort model', () => {
	const columns = ['position', 'title']
	expect(normalizeWatchlistSortColumn('manual', columns)).toBeNull()
	expect(
		getWatchlistDefaultSortModel(
			{ defaultSortColumn: null, defaultSortDirection: 'asc' },
			columns,
		),
	).toEqual([])
})

test('valid saved defaults become a single-column initial sort', () => {
	const columns = ['position', 'title']
	expect(normalizeWatchlistSortDirection('sideways')).toBeNull()
	expect(normalizeWatchlistSortColumn('unknown', columns)).toBeUndefined()
	expect(
		getWatchlistDefaultSortModel(
			{ defaultSortColumn: 'title', defaultSortDirection: 'desc' },
			columns,
		),
	).toEqual([{ colId: 'title', sort: 'desc' }])
})
