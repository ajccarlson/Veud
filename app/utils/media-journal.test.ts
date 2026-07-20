import { expect, test } from 'vitest'
import { journalTerms, parseDiaryDate } from './media-journal.ts'

test('diary dates are parsed as exact UTC calendar dates', () => {
	expect(parseDiaryDate('2026-07-19')?.toISOString()).toBe(
		'2026-07-19T00:00:00.000Z',
	)
	expect(parseDiaryDate('2026-02-29')).toBeNull()
	expect(parseDiaryDate('not-a-date')).toBeNull()
})

test('journal copy distinguishes reading media', () => {
	expect(journalTerms('manga')).toEqual({
		action: 'read',
		repeat: 'Reread',
		past: 'Read',
	})
	expect(journalTerms('movie').action).toBe('watch')
})
