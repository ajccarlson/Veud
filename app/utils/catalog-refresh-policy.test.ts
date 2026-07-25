import { expect, test } from 'vitest'
import {
	catalogRefreshAfter,
	catalogRefreshDays,
	catalogRefreshIsOverdue,
} from './catalog-refresh-policy.ts'

const now = new Date('2026-07-25T12:00:00.000Z')

test('leaves untracked provider inventory on its normal refresh interval', () => {
	expect(
		catalogRefreshDays({
			defaultDays: 180,
			entryCount: 0,
			releaseStatus: 'Currently Airing',
			now,
		}),
	).toBe(180)
})

test('refreshes actively tracked and recently completed titles more often', () => {
	expect(
		catalogRefreshDays({
			defaultDays: 180,
			entryCount: 1,
			releaseStatus: 'Currently Airing',
			now,
		}),
	).toBe(2)
	expect(
		catalogRefreshDays({
			defaultDays: 150,
			entryCount: 1,
			releaseStatus: 'Released',
			releaseEnd: new Date('2026-07-01T00:00:00.000Z'),
			now,
		}),
	).toBe(7)
	expect(
		catalogRefreshDays({
			defaultDays: 150,
			entryCount: 1,
			releaseStatus: 'Released',
			releaseEnd: new Date('2020-01-01T00:00:00.000Z'),
			now,
		}),
	).toBe(30)
	expect(
		catalogRefreshDays({
			defaultDays: 180,
			entryCount: 1,
			releaseStatus: 'Finished Airing',
			now,
		}),
	).toBe(30)
})

test('recognizes future release payloads and expedites an older provider row', () => {
	expect(
		catalogRefreshAfter({
			defaultDays: 150,
			entryCount: 2,
			nextRelease: JSON.stringify({
				releaseDate: '2026-07-27T18:00:00.000Z',
			}),
			fetchedAt: now,
			now,
		}),
	).toEqual(new Date('2026-07-27T12:00:00.000Z'))

	expect(
		catalogRefreshIsOverdue({
			defaultDays: 150,
			entryCount: 1,
			releaseStatus: 'Returning Series',
			lastFetchedAt: new Date('2026-07-20T00:00:00.000Z'),
			refreshAfter: new Date('2026-12-17T00:00:00.000Z'),
			now,
		}),
	).toBe(true)
})
