import { expect, test } from 'vitest'
import { malBroadcastNextRelease } from './mal-catalog-hydration.server.ts'
import { parseStoredNextRelease } from './release-occurrences.server.ts'

const airing = (broadcast: unknown, status = 'currently_airing') => ({
	status,
	broadcast,
})

// 2026-07-30T12:00:00Z is Thursday 21:00 JST.
const observedAt = new Date('2026-07-30T12:00:00.000Z')

/** The stored payload is JSON, so give the parsed shape a type to assert on. */
function storedSchedule(value: string | null) {
	expect(value).toBeTruthy()
	return JSON.parse(value!) as { releaseDate: string; source: string }
}

test('a weekly slot later this week resolves to that day in UTC', () => {
	const stored = malBroadcastNextRelease(
		airing({ day_of_the_week: 'friday', start_time: '23:00' }),
		'anime',
		observedAt,
	)
	// Friday 23:00 JST is Friday 14:00 UTC.
	expect(storedSchedule(stored).releaseDate).toBe('2026-07-31T14:00:00.000Z')
})

test('a slot already past today rolls to next week, not back in time', () => {
	// Thursday 20:00 JST is before the observed 21:00 JST, so it already aired.
	const stored = malBroadcastNextRelease(
		airing({ day_of_the_week: 'thursday', start_time: '20:00' }),
		'anime',
		observedAt,
	)
	const releaseDate = new Date(storedSchedule(stored).releaseDate)
	expect(releaseDate.getTime()).toBeGreaterThan(observedAt.getTime())
	expect(releaseDate.toISOString()).toBe('2026-08-06T11:00:00.000Z')
})

test('a slot still ahead today stays today', () => {
	const stored = malBroadcastNextRelease(
		airing({ day_of_the_week: 'thursday', start_time: '23:30' }),
		'anime',
		observedAt,
	)
	expect(storedSchedule(stored).releaseDate).toBe('2026-07-30T14:30:00.000Z')
})

test('the result is understood by the shared schedule parser', () => {
	// The payload has to satisfy the same contract TMDB schedules do, or the
	// calendar silently ignores it.
	const stored = malBroadcastNextRelease(
		airing({ day_of_the_week: 'monday', start_time: '01:05' }),
		'anime',
		observedAt,
	)
	const parsed = parseStoredNextRelease(stored)
	expect(parsed).not.toBeNull()
	expect(parsed!.source).toBe('mal')
	expect(parsed!.allDay).toBe(false)
	expect(parsed!.observedAt?.toISOString()).toBe(observedAt.toISOString())
	// The episode number is not in MAL's payload and must not be invented.
	expect(parsed!.episode).toBeNull()
})

test('no schedule is derived without a usable broadcast slot', () => {
	for (const payload of [
		airing(null),
		airing({}),
		airing({ day_of_the_week: 'friday' }),
		airing({ start_time: '23:00' }),
		airing({ day_of_the_week: 'notaday', start_time: '23:00' }),
		airing({ day_of_the_week: 'friday', start_time: '25:00' }),
		airing({ day_of_the_week: 'friday', start_time: '23:70' }),
		airing({ day_of_the_week: 'friday', start_time: 'evening' }),
	]) {
		expect(malBroadcastNextRelease(payload, 'anime', observedAt)).toBeNull()
	}
})

test('only currently airing anime get a derived schedule', () => {
	const slot = { day_of_the_week: 'friday', start_time: '23:00' }
	for (const status of ['finished_airing', 'not_yet_aired', '']) {
		expect(
			malBroadcastNextRelease(airing(slot, status), 'anime', observedAt),
		).toBeNull()
	}
	// Manga has no broadcast schedule at all.
	expect(malBroadcastNextRelease(airing(slot), 'manga', observedAt)).toBeNull()
})
