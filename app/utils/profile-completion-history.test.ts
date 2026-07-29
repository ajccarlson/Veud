import { expect, test } from 'vitest'
import { buildCompletionHistoryFromDays } from './profile-completion-history.ts'

test('builds the compatibility month index from sparse aggregated days', () => {
	expect(
		buildCompletionHistoryFromDays([
			{ day: '2025-12-31', value: 1 },
			{ day: '2025-12-31', value: 2 },
			{ day: 'invalid', value: 50 },
			{ day: '2026-01-01', value: 0 },
		]),
	).toEqual({
		days: [{ day: '2025-12-31', value: 3 }],
	})
})

test('an old sparse completion does not expand into empty month payloads', () => {
	const history = buildCompletionHistoryFromDays([
		{ day: '1870-01-01', value: 1 },
	])

	expect(history).toEqual({ days: [{ day: '1870-01-01', value: 1 }] })
	expect(Buffer.byteLength(JSON.stringify(history))).toBeLessThan(128)
})
