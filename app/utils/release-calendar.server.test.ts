import { expect, test } from 'vitest'
import {
	dateKeyInTimeZone,
	normalizeTimeZone,
	parseReleaseCalendarQuery,
	parseStoredNextRelease,
} from './release-calendar.server.ts'

test('normalizes calendar filters and defaults to the current UTC week', () => {
	expect(
		parseReleaseCalendarQuery(
			new URLSearchParams('kind=anime&scope=mine'),
			new Date('2026-07-22T18:00:00.000Z'),
		),
	).toEqual({ start: '2026-07-20', kind: 'anime', scope: 'mine' })
	expect(
		parseReleaseCalendarQuery(
			new URLSearchParams('start=2026-02-30&kind=podcast&scope=friends'),
			new Date('2026-07-22T18:00:00.000Z'),
		),
	).toEqual({ start: '2026-07-20', kind: 'all', scope: 'all' })
})

test('uses local calendar dates for default weeks and rejects invalid timezones', () => {
	expect(
		parseReleaseCalendarQuery(
			new URLSearchParams(),
			new Date('2026-07-20T01:00:00.000Z'),
			'America/Los_Angeles',
		),
	).toEqual({ start: '2026-07-13', kind: 'all', scope: 'all' })
	expect(
		dateKeyInTimeZone(
			new Date('2026-07-20T01:00:00.000Z'),
			'America/Los_Angeles',
		),
	).toBe('2026-07-19')
	expect(normalizeTimeZone('not/a-timezone')).toBe('UTC')
})

test('parses stored episode and chapter schedule payloads safely', () => {
	expect(
		parseStoredNextRelease(
			JSON.stringify({
				releaseDate: '2026-07-21T18:30:00.000Z',
				season: 2,
				episode: 4,
				name: 'The next step',
			}),
		),
	).toMatchObject({
		releaseAt: new Date('2026-07-21T18:30:00.000Z'),
		allDay: false,
		season: 2,
		episode: 4,
		name: 'The next step',
	})
	expect(
		parseStoredNextRelease(
			JSON.stringify({
				releaseDate: '2026-07-22',
				volume: 3,
				chapter: 21,
			}),
		),
	).toMatchObject({ allDay: true, volume: 3, chapter: 21 })
	expect(parseStoredNextRelease('{not-json')).toBeNull()
	expect(parseStoredNextRelease('null')).toBeNull()
})
