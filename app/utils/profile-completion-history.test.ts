import { expect, test } from 'vitest'
import { buildCompletionHistory } from './profile-completion-history.ts'

test('completion history stays empty without valid finish dates', () => {
	expect(
		buildCompletionHistory(
			{
				anime: [
					{ history: null },
					{ history: '{invalid' },
					{ history: { progress: { episode: {} } } },
				],
			},
			new Date(2026, 2, 20),
		),
	).toEqual({ days: [], months: {} })
})

test('completion history deduplicates each entry and aggregates shared days', () => {
	const history = buildCompletionHistory(
		{
			anime: [
				{
					history: {
						finished: '2026-01-03T12:00:00.000Z',
						progress: {
							episode: {
								1: {
									finishDate: [
										'2026-01-03T12:00:00.000Z',
										'2026-01-04T12:00:00.000Z',
									],
								},
							},
						},
					},
				},
				{
					history: JSON.stringify({
						progress: {
							episode: {
								1: { finishDate: ['2026-01-03T18:00:00.000Z'] },
							},
						},
					}),
				},
			],
		},
		new Date(2026, 2, 20),
	)

	expect(history.days).toEqual([
		{ day: '2026-01-03', value: 2 },
		{ day: '2026-01-04', value: 1 },
	])
	expect(history.months).toEqual({
		2026: {
			1: { from: '2026-01-01', to: '2026-01-31' },
			2: { from: '2026-02-01', to: '2026-02-28' },
			3: { from: '2026-03-01', to: '2026-03-31' },
		},
	})
})
