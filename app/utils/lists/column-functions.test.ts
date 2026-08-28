import { expect, test } from 'vitest'
import {
	dateFormatter,
	dateOnlyFormatter,
	safeMediaHref,
} from './column-functions.tsx'

test.each([
	['/media/example', '/media/example'],
	['https://example.com/title', 'https://example.com/title'],
	['http://example.com/title', 'http://example.com/title'],
	['javascript:alert(1)', '/discover'],
	['data:text/html,unsafe', '/discover'],
	['//evil.example/title', '/discover'],
	['not a URL', '/discover'],
])('normalizes media links safely: %s', (input, expected) => {
	expect(safeMediaHref(input)).toBe(expected)
})

test('a calendar date is shown as the date it is, not the viewer local day', () => {
	// Release, started and finished dates are stored as UTC midnight. Formatting
	// them in the viewer's zone showed the day before for everyone west of UTC:
	// a film released on the 27th read "2/26" in California.
	const utcMidnight = Date.UTC(2026, 1, 27)
	expect(dateOnlyFormatter(utcMidnight)).toBe('2/27/26')
	expect(dateOnlyFormatter(new Date(utcMidnight).toISOString())).toBe('2/27/26')
})

test('an instant is still shown in the viewer own day', () => {
	// When a row was added is a moment in time, and the reader's own day is the
	// right reading for that — so this one deliberately stays local.
	const noon = new Date('2026-02-27T12:00:00.000Z')
	expect(dateFormatter(noon)).toBe(
		`${noon.getMonth() + 1}/${noon.getDate()}/${String(noon.getFullYear()).slice(2)}`,
	)
})

test('an empty date is still blank', () => {
	expect(dateOnlyFormatter(null)).toBe(' ')
	expect(dateOnlyFormatter(0)).toBe(' ')
	expect(dateOnlyFormatter('1970-01-01T00:00:00.000Z')).toBe(' ')
})
