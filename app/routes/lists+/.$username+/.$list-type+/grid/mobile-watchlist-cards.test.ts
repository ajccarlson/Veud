import { describe, expect, test } from 'vitest'
import {
	filterAndSortMobileEntries,
	mobileProgressForEntry,
} from './mobile-watchlist-cards.tsx'

describe('mobile watchlist cards', () => {
	test('prefers normalized progress and falls back to legacy counters', () => {
		expect(
			mobileProgressForEntry(
				{
					trackingState: {
						progress: [{ unit: 'episode', current: 4, total: 12 }],
					},
					length: '1 / 24 eps',
				},
				'anime',
			),
		).toBe('4 / 12')
		expect(mobileProgressForEntry({ chapters: '18 / 80' }, 'manga')).toBe(
			'18 / 80',
		)
		expect(mobileProgressForEntry({ length: 'Movie' }, 'liveaction')).toBeNull()
	})

	test('filters real entries and sorts without changing manual positions', () => {
		const entries = [
			{ id: '1', title: 'Zebra', type: 'Movie', position: 1 },
			{ id: '2', title: 'Alpha', type: 'TV Series', position: 2 },
			{ id: '3', title: 'Moon', type: 'Movie', position: 3 },
			{ title: ' ', type: 'Movie', position: 4 },
		]

		expect(
			filterAndSortMobileEntries(entries, '', {
				colId: 'title',
				sort: 'asc',
			}).map(entry => entry.title),
		).toEqual(['Alpha', 'Moon', 'Zebra'])
		expect(
			filterAndSortMobileEntries(entries, 'movie', {
				colId: 'position',
				sort: 'desc',
			}).map(entry => entry.title),
		).toEqual(['Moon', 'Zebra'])
		expect(entries.map(entry => entry.position)).toEqual([1, 2, 3, 4])
	})
})
