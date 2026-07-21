import { expect, test } from 'vitest'
import { trackingStateFromEntry } from './tracking-state.ts'

test('normalizes anime status, score, dates, progress, and repeat evidence', () => {
	const snapshot = trackingStateFromEntry(
		{
			personal: '8.5',
			length: '12 eps',
			history: JSON.stringify({
				added: '2025-01-01T00:00:00.000Z',
				started: '2025-01-02T00:00:00.000Z',
				finished: '2025-01-12T00:00:00.000Z',
				lastUpdated: '2025-01-13T00:00:00.000Z',
				progress: {
					3: { completed: true, finishDate: [100] },
					4: { completed: true, finishDate: [200, 300] },
				},
			}),
		},
		{
			status: 'completed',
			statusWatchlistId: 'completed-list',
			mediaKind: 'anime',
		},
	)

	expect(snapshot).toMatchObject({
		status: 'completed',
		statusWatchlistId: 'completed-list',
		score: 8.5,
		repeatCount: 1,
		progress: [{ unit: 'episode', current: 4, total: 12 }],
	})
	expect(snapshot.startedAt?.toISOString()).toBe('2025-01-02T00:00:00.000Z')
	expect(snapshot.completedAt?.toISOString()).toBe('2025-01-12T00:00:00.000Z')
	expect(snapshot.sourceUpdatedAt).toBe(
		new Date('2025-01-13T00:00:00.000Z').getTime(),
	)
})

test('keeps independent manga chapter and volume counters', () => {
	const snapshot = trackingStateFromEntry(
		{
			chapters: '25 / 100',
			volumes: '3 / 12',
			history: JSON.stringify({
				progress: {
					chapter: {
						24: { completed: true, finishDate: [100] },
					},
					volume: {
						2: { completed: true, finishDate: [200] },
					},
				},
			}),
		},
		{ status: 'currentlyreading', mediaKind: 'manga' },
	)

	expect(snapshot.progress).toEqual([
		{ unit: 'chapter', current: 25, total: 100 },
		{ unit: 'volume', current: 3, total: 12 },
	])
})

test('uses the most recent history event when the display field has no numerator', () => {
	const snapshot = trackingStateFromEntry(
		{
			length: '24 eps',
			history: JSON.stringify({
				progress: {
					12: { completed: true, finishDate: [100] },
					2: { completed: true, finishDate: [200] },
				},
			}),
		},
		{ status: 'watching', mediaKind: 'tv' },
	)

	expect(snapshot.progress).toEqual([
		{ unit: 'episode', current: 2, total: 24 },
	])
})

test('an explicit repeat count overrides inferred legacy repeat evidence', () => {
	const snapshot = trackingStateFromEntry(
		{
			length: '4 / 12 eps',
			history: JSON.stringify({
				repeatCount: 0,
				progress: {
					4: { completed: true, finishDate: [100, 200, 300] },
				},
			}),
		},
		{ status: 'watching', mediaKind: 'anime' },
	)

	expect(snapshot.repeatCount).toBe(0)
})

test('treats malformed history and zero scores as empty state', () => {
	const snapshot = trackingStateFromEntry(
		{ personal: 0, length: '2h 22m', history: '{broken' },
		{ status: '  ', mediaKind: 'movie' },
	)

	expect(snapshot).toMatchObject({
		status: 'tracked',
		score: null,
		startedAt: null,
		completedAt: null,
		repeatCount: 0,
		progress: [],
		sourceUpdatedAt: 0,
	})
})
