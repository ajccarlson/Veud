import { expect, test } from 'vitest'
import {
	dateKeyInTimeZone,
	isPlausibleNextRelease,
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
				source: 'anilist',
				observedAt: '2026-07-20T12:00:00.000Z',
				season: 2,
				episode: 4,
				name: 'The next step',
			}),
		),
	).toMatchObject({
		releaseAt: new Date('2026-07-21T18:30:00.000Z'),
		allDay: false,
		source: 'anilist',
		observedAt: new Date('2026-07-20T12:00:00.000Z'),
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
	expect(
		parseStoredNextRelease(
			JSON.stringify({
				releaseDate: '2026-07-21T18:30:00.000Z',
				source: 'anilist',
			}),
		),
	).toBeNull()
	expect(
		parseStoredNextRelease(
			JSON.stringify({ releaseDate: '2026-07-22T00:00:00.000Z' }),
		),
	).toMatchObject({ allDay: false })
})

test('rejects schedules that contradict completed or long-ended media', () => {
	const next = parseStoredNextRelease(
		JSON.stringify({
			releaseDate: '2026-07-21T18:30:00.000Z',
			episode: 2,
		}),
	)
	expect(next).not.toBeNull()
	if (!next) return

	expect(
		isPlausibleNextRelease(
			next,
			{
				kind: 'anime',
				releaseStart: new Date('2005-01-07T00:00:00.000Z'),
				releaseEnd: new Date('2005-04-01T00:00:00.000Z'),
				releaseStatus: null,
			},
			new Date('2026-07-20T12:00:00.000Z'),
		),
	).toBe(false)
	expect(
		isPlausibleNextRelease(
			next,
			{
				kind: 'anime',
				releaseStart: new Date('2026-04-01T00:00:00.000Z'),
				releaseEnd: new Date('2026-07-14T00:00:00.000Z'),
				releaseStatus: 'Currently Airing',
			},
			new Date('2026-07-20T12:00:00.000Z'),
		),
	).toBe(true)
	expect(
		isPlausibleNextRelease(
			next,
			{
				kind: 'anime',
				releaseStart: new Date('2026-04-01T00:00:00.000Z'),
				releaseEnd: new Date('2026-07-14T00:00:00.000Z'),
				releaseStatus: 'Finished Airing',
			},
			new Date('2026-07-20T12:00:00.000Z'),
		),
	).toBe(false)
})

test('expires provider-observed schedules that have not been refreshed', () => {
	const next = parseStoredNextRelease(
		JSON.stringify({
			releaseDate: '2026-08-20T18:30:00.000Z',
			episode: 8,
			source: 'anilist',
			observedAt: '2026-07-01T12:00:00.000Z',
		}),
	)
	expect(next).not.toBeNull()
	if (!next) return
	const media = {
		kind: 'anime',
		releaseStart: new Date('2026-04-01T00:00:00.000Z'),
		releaseEnd: null,
		releaseStatus: 'Currently Airing',
	}

	expect(
		isPlausibleNextRelease(next, media, new Date('2026-07-10T12:00:00.000Z')),
	).toBe(true)
	expect(
		isPlausibleNextRelease(next, media, new Date('2026-07-20T12:00:00.000Z')),
	).toBe(false)
})
