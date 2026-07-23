import { expect, test } from 'vitest'
import { safeMediaHref } from './column-functions.tsx'

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
