import { expect, test } from 'vitest'
import {
	buildScoreDistribution,
	buildStatusBreakdown,
} from './media-community.server.ts'

test('score distribution rounds decimal ratings into bounded ten-point buckets', () => {
	const distribution = buildScoreDistribution([
		{ score: 8.4, _count: { _all: 1 } },
		{ score: 8.5, _count: { _all: 2 } },
		{ score: 10, _count: { _all: 1 } },
		{ score: null, _count: { _all: 5 } },
		{ score: 11, _count: { _all: 5 } },
	])

	expect(distribution).toHaveLength(10)
	expect(distribution.find(bucket => bucket.score === 8)).toEqual({
		score: 8,
		count: 1,
		percentage: 25,
	})
	expect(distribution.find(bucket => bucket.score === 9)).toEqual({
		score: 9,
		count: 2,
		percentage: 50,
	})
	expect(distribution.find(bucket => bucket.score === 10)).toEqual({
		score: 10,
		count: 1,
		percentage: 25,
	})
})

test('status breakdown stays data-driven and ranks the largest groups first', () => {
	const breakdown = buildStatusBreakdown([
		{ status: 'plan-to-watch', _count: { _all: 2 } },
		{ status: 'watching', _count: { _all: 3 } },
		{ status: 'on_hold', _count: { _all: 1 } },
	])
	expect(breakdown.map(({ percentage: _, ...status }) => status)).toEqual([
		{ status: 'watching', label: 'Watching', count: 3 },
		{ status: 'plan-to-watch', label: 'Plan To Watch', count: 2 },
		{ status: 'on_hold', label: 'On Hold', count: 1 },
	])
	expect(breakdown[0]?.percentage).toBe(50)
	expect(breakdown[1]?.percentage).toBeCloseTo(100 / 3)
	expect(breakdown[2]?.percentage).toBeCloseTo(100 / 6)
})
