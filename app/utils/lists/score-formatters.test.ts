import { describe, expect, test } from 'vitest'
import {
	averageScores,
	formatDifference,
	formatScore,
	providedScore,
	scoreDifference,
} from './score-formatters.ts'

describe('list score formatting', () => {
	test.each([undefined, null, '', 'null', 'NULL', 0, Number.NaN, Infinity])(
		'leaves a missing or invalid score blank: %s',
		value => {
			expect(providedScore(value)).toBeNull()
			expect(formatScore(value, 1)).toBe('')
		},
	)

	test('formats provided scores and finite differences', () => {
		expect(formatScore('8.25', 1)).toBe('8.3')
		expect(formatDifference(1.25)).toBe('+1.25')
		expect(formatDifference(-0.5)).toBe('-0.50')
		expect(formatDifference(0)).toBe('0.00')
	})

	test('averages only provided category scores', () => {
		expect(averageScores([8, 0, null, 6, Number.NaN])).toBe(7)
		expect(averageScores([0, null, Number.NaN])).toBeNull()
	})

	test('requires both scores before calculating a difference', () => {
		expect(scoreDifference(8, 6.5)).toBe(1.5)
		expect(scoreDifference(8, 0)).toBeNull()
		expect(scoreDifference(Number.NaN, 6)).toBeNull()
	})
})
