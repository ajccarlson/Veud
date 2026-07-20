import { expect, test } from 'vitest'
import {
	foldICalendarLine,
	serializeReleaseCalendar,
} from './release-calendar-ical.server.ts'
import { type ReleaseCalendarItem } from './release-calendar.server.ts'

function releaseItem(
	overrides: Partial<ReleaseCalendarItem> = {},
): ReleaseCalendarItem {
	return {
		id: 'media-1:next:2026-07-21T18:30:00.000Z',
		mediaId: 'media-1',
		title: 'A Show, Continued; Again',
		kind: 'anime',
		type: 'TV Series',
		imageUrl: null,
		releaseAt: new Date('2026-07-21T18:30:00.000Z'),
		allDay: false,
		eventType: 'episode',
		eventLabel: 'Season 2 · Episode 4',
		eventName: 'Line one\nLine two',
		trackerCount: 1,
		viewerTracking: {
			status: 'watching',
			statusLabel: 'Watching',
			score: 8,
		},
		viewerReminder: null,
		...overrides,
	}
}

test('serializes timed and all-day releases as portable iCalendar events', () => {
	const timed = releaseItem()
	const premiere = releaseItem({
		id: 'media-2:premiere:2026-07-22T00:00:00.000Z',
		mediaId: 'media-2',
		title: 'Feature Premiere',
		kind: 'movie',
		type: 'Movie',
		releaseAt: new Date('2026-07-22T00:00:00.000Z'),
		allDay: true,
		eventType: 'premiere',
		eventLabel: 'Premiere',
		eventName: null,
		trackerCount: 2,
		viewerTracking: null,
	})
	const body = serializeReleaseCalendar(
		{
			start: '2026-07-20',
			end: '2026-07-26',
			timeZone: 'America/Los_Angeles',
			filters: { kind: 'all', scope: 'mine' },
			days: [
				{ date: '2026-07-21', items: [timed] },
				{ date: '2026-07-22', items: [premiere] },
			],
		},
		{
			origin: 'https://veud.example/',
			generatedAt: new Date('2026-07-19T12:34:56.000Z'),
		},
	)

	expect(body).toContain('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')
	expect(body).toContain('X-WR-CALNAME:Veud · My releases')
	expect(body).toContain('X-WR-TIMEZONE:America/Los_Angeles')
	expect(body).toContain('DTSTAMP:20260719T123456Z')
	expect(body).toContain('DTSTART:20260721T183000Z')
	expect(body).toContain('DTSTART;VALUE=DATE:20260722')
	expect(body).toContain('DTEND;VALUE=DATE:20260723')
	expect(body).toContain(
		'SUMMARY:A Show\\, Continued\\; Again — Season 2 · Episode 4',
	)
	expect(body).toContain('Line one\\nLine two\\nTV Series')
	expect(body).toContain('URL:https://veud.example/media/media-1')
	expect(body.match(/BEGIN:VEVENT/g)).toHaveLength(2)
	expect(body.endsWith('END:VCALENDAR\r\n')).toBe(true)
})

test('folds UTF-8 content lines within the iCalendar 75-octet limit', () => {
	const folded = foldICalendarLine(`SUMMARY:${'作品 🎬 '.repeat(20)}`)
	const lines = folded.split('\r\n')

	expect(lines.length).toBeGreaterThan(1)
	expect(lines.slice(1).every(line => line.startsWith(' '))).toBe(true)
	for (const line of lines) {
		expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
	}
})
