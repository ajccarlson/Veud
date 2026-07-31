import { expect, test } from 'vitest'
import { buildStatusBreakdown } from './media-community.server.ts'

const groups = (statuses: Array<[string, number]>) =>
	statuses.map(([status, count]) => ({
		status,
		_count: { _all: count },
	})) as Parameters<typeof buildStatusBreakdown>[0]

test('status labels come from the watchlist header members already see', () => {
	// Stored status keys are the watchlist machine name, which is squashed. Seven
	// of the ten real production statuses render wrong without the header:
	// "currentlyreading" became "Currentlyreading", "plantowatchtv" became
	// "Plantowatchtv".
	const labels = new Map([
		['currentlyreading', 'Currently Reading'],
		['plantowatchtv', 'Plan to Watch (TV)'],
		['onhold', 'On-Hold'],
	])
	const breakdown = buildStatusBreakdown(
		groups([
			['currentlyreading', 5],
			['plantowatchtv', 3],
			['onhold', 1],
		]),
		labels,
	)
	expect(breakdown.map(entry => entry.label)).toEqual([
		'Currently Reading',
		'Plan to Watch (TV)',
		'On-Hold',
	])
})

test('a status with no watchlist behind it still gets a tidy label', () => {
	const breakdown = buildStatusBreakdown(groups([['completed', 2]]), new Map())
	expect(breakdown[0]!.label).toBe('Completed')
})

test('counts and percentages are unaffected by labelling', () => {
	const breakdown = buildStatusBreakdown(
		groups([
			['currentlyreading', 3],
			['completed', 1],
		]),
		new Map([['currentlyreading', 'Currently Reading']]),
	)
	expect(breakdown[0]).toMatchObject({
		status: 'currentlyreading',
		label: 'Currently Reading',
		count: 3,
		percentage: 75,
	})
	expect(breakdown[1]).toMatchObject({ status: 'completed', count: 1 })
})
