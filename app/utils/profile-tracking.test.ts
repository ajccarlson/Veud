import { expect, test } from 'vitest'
import { PROFILE_HISTORY_CODE_UNIT_LIMIT } from './profile-history-bounds.ts'
import {
	buildProfileTrackingSummaries,
	createProfileTrackingAccumulator,
	type ProfileTrackingEntry,
} from './profile-tracking.ts'

const listTypes = [{ id: 'anime' }, { id: 'manga' }]
const watchlists = [
	{
		id: 'watching',
		typeId: 'anime',
		name: 'watching',
		header: 'Watching',
		position: 1,
	},
	{
		id: 'completed',
		typeId: 'anime',
		name: 'completed',
		header: 'Completed',
		position: 2,
	},
	{
		id: 'reading',
		typeId: 'manga',
		name: 'currentlyreading',
		header: 'Currently Reading',
		position: 1,
	},
]

function entry(
	overrides: Partial<ProfileTrackingEntry> = {},
): ProfileTrackingEntry {
	return {
		id: 'entry-1',
		watchlistId: 'watching',
		mediaId: 'media-1',
		media: { kind: 'anime' },
		trackingState: null,
		personal: 0,
		history: null,
		length: '12 eps',
		chapters: null,
		volumes: null,
		...overrides,
	}
}

test('uses one normalized state for duplicate entry snapshots', () => {
	const trackingState = {
		id: 'state-1',
		status: 'completed',
		statusWatchlistId: 'completed',
		score: '9.5',
		repeatCount: 2,
		progress: [{ unit: 'episode', current: 12 }],
	}
	const summaries = buildProfileTrackingSummaries({
		listTypes,
		watchlists,
		entries: [
			entry({ trackingState, personal: 2 }),
			entry({
				id: 'entry-2',
				watchlistId: 'completed',
				trackingState,
				personal: 4,
			}),
		],
	})

	expect(summaries.anime).toEqual({
		totalTitles: 1,
		meanScore: 9.5,
		repeatCount: 2,
		progress: [{ unit: 'episode', current: 12 }],
		statuses: [
			{ key: 'watching', label: 'Watching', count: 0 },
			{ key: 'completed', label: 'Completed', count: 1 },
		],
	})
})

test.each([null, 0])(
	'falls back to a legacy personal score when canonical score is %s',
	score => {
		const summaries = buildProfileTrackingSummaries({
			listTypes,
			watchlists,
			entries: [
				entry({
					personal: 7.5,
					trackingState: {
						id: 'state-score-fallback',
						status: 'watching',
						statusWatchlistId: 'watching',
						score,
						repeatCount: 0,
						progress: [],
					},
				}),
			],
		})

		expect(summaries.anime?.meanScore).toBe(7.5)
	},
)

test('normalized state wins over an unlinked legacy row for the same media', () => {
	const summaries = buildProfileTrackingSummaries({
		listTypes,
		watchlists,
		entries: [
			entry({
				id: 'legacy-row',
				personal: 3,
				history: JSON.stringify({ lastUpdated: '2026-01-01' }),
			}),
			entry({
				id: 'normalized-row',
				watchlistId: 'completed',
				trackingState: {
					id: 'state-1',
					status: 'completed',
					statusWatchlistId: 'completed',
					score: 9,
					repeatCount: 0,
					progress: [{ unit: 'episode', current: 10 }],
				},
			}),
		],
	})

	expect(summaries.anime).toEqual(
		expect.objectContaining({
			totalTitles: 1,
			meanScore: 9,
			progress: [{ unit: 'episode', current: 10 }],
		}),
	)
})

test('deduplicates canonical legacy entries using the most recently updated row', () => {
	const summaries = buildProfileTrackingSummaries({
		listTypes,
		watchlists,
		entries: [
			entry({
				personal: 5,
				history: JSON.stringify({ lastUpdated: '2025-01-01', progress: null }),
			}),
			entry({
				id: 'entry-2',
				watchlistId: 'completed',
				personal: 8,
				history: JSON.stringify({
					lastUpdated: '2025-02-01',
					progress: {
						12: { finishDate: ['2025-02-01T12:00:00.000Z'] },
					},
				}),
			}),
		],
	})

	expect(summaries.anime).toEqual({
		totalTitles: 1,
		meanScore: 8,
		repeatCount: 0,
		progress: [{ unit: 'episode', current: 12 }],
		statuses: [
			{ key: 'watching', label: 'Watching', count: 0 },
			{ key: 'completed', label: 'Completed', count: 1 },
		],
	})
})

test('aggregates manga chapter and volume progress independently', () => {
	const summaries = buildProfileTrackingSummaries({
		listTypes,
		watchlists,
		entries: [
			entry({
				id: 'manga-1',
				watchlistId: 'reading',
				mediaId: 'manga-media-1',
				media: { kind: 'manga' },
				trackingState: {
					id: 'manga-state-1',
					status: 'currentlyreading',
					statusWatchlistId: 'reading',
					score: null,
					repeatCount: 0,
					progress: [
						{ unit: 'chapter', current: 27 },
						{ unit: 'volume', current: 4 },
					],
				},
			}),
		],
	})

	expect(summaries.manga?.progress).toEqual([
		{ unit: 'chapter', current: 27 },
		{ unit: 'volume', current: 4 },
	])
	expect(summaries.manga?.totalTitles).toBe(1)
	expect(summaries.anime?.totalTitles).toBe(0)
})

test('recovers completed totals from legacy metadata when normalized progress is stale', () => {
	const summaries = buildProfileTrackingSummaries({
		listTypes,
		watchlists,
		entries: [
			entry({
				watchlistId: 'completed',
				length: '26 eps',
				trackingState: {
					id: 'stale-state',
					status: 'completed',
					statusWatchlistId: 'completed',
					score: null,
					repeatCount: 0,
					progress: [{ unit: 'episode', current: 0 }],
				},
			}),
		],
	})

	expect(summaries.anime?.progress).toEqual([{ unit: 'episode', current: 26 }])
})

test('incremental pages preserve normalized and legacy deduplication semantics', () => {
	const accumulator = createProfileTrackingAccumulator({
		listTypes,
		watchlists,
	})
	accumulator.addMany([
		entry({
			id: 'older-legacy',
			personal: 4,
			history: JSON.stringify({ lastUpdated: '2025-01-01' }),
		}),
		entry({
			id: 'newer-legacy',
			watchlistId: 'completed',
			personal: 7,
			history: JSON.stringify({ lastUpdated: '2025-02-01' }),
		}),
	])
	accumulator.add(
		entry({
			id: 'normalized',
			trackingState: {
				id: 'state-1',
				status: 'watching',
				statusWatchlistId: 'watching',
				score: 8.5,
				repeatCount: 1,
				progress: [{ unit: 'episode', current: 6 }],
			},
		}),
	)

	expect(accumulator.finish().anime).toEqual({
		totalTitles: 1,
		meanScore: 8.5,
		repeatCount: 1,
		progress: [{ unit: 'episode', current: 6 }],
		statuses: [
			{ key: 'watching', label: 'Watching', count: 1 },
			{ key: 'completed', label: 'Completed', count: 0 },
		],
	})
})

test('retains only supported episode, chapter, and volume progress dimensions', () => {
	const summaries = buildProfileTrackingSummaries({
		listTypes,
		watchlists,
		entries: [
			entry({
				trackingState: {
					id: 'state-1',
					status: 'watching',
					statusWatchlistId: 'watching',
					score: null,
					repeatCount: 0,
					progress: [
						{ unit: 'seasons', current: 2 },
						{ unit: 'custom-field', current: 999 },
						{ unit: 'Episodes', current: 4 },
						{ unit: 'episode', current: 6 },
						{ unit: 'chapters', current: 3 },
						{ unit: 'volume', current: 1 },
					],
				},
			}),
		],
	})

	expect(summaries.anime?.progress).toEqual([
		{ unit: 'episode', current: 6 },
		{ unit: 'chapter', current: 3 },
		{ unit: 'volume', current: 1 },
	])
})

test('filters arbitrary legacy history units from profile summaries', () => {
	const summaries = buildProfileTrackingSummaries({
		listTypes,
		watchlists,
		entries: [
			entry({
				history: JSON.stringify({
					progress: {
						seasons: {
							2: { finishDate: ['2026-01-01T00:00:00.000Z'] },
						},
						episode: {
							5: { finishDate: ['2026-01-02T00:00:00.000Z'] },
						},
					},
				}),
			}),
		],
	})

	expect(summaries.anime?.progress).toEqual([{ unit: 'episode', current: 5 }])
})

test('rejects oversized and cyclic histories before legacy tracking traversal', () => {
	const cyclic: Record<string, unknown> = {}
	cyclic.progress = cyclic

	expect(() =>
		buildProfileTrackingSummaries({
			listTypes,
			watchlists,
			entries: [
				entry({
					id: 'oversized',
					mediaId: 'oversized',
					length: null,
					history: `{"note":"${'x'.repeat(PROFILE_HISTORY_CODE_UNIT_LIMIT)}"}`,
				}),
				entry({
					id: 'cyclic',
					mediaId: 'cyclic',
					length: null,
					history: cyclic,
				}),
			],
		}),
	).not.toThrow()

	const summaries = buildProfileTrackingSummaries({
		listTypes,
		watchlists,
		entries: [
			entry({
				id: 'oversized',
				mediaId: 'oversized',
				length: null,
				history: `{"note":"${'x'.repeat(PROFILE_HISTORY_CODE_UNIT_LIMIT)}"}`,
			}),
			entry({
				id: 'cyclic',
				mediaId: 'cyclic',
				length: null,
				history: cyclic,
			}),
		],
	})
	expect(summaries.anime?.totalTitles).toBe(2)
	expect(summaries.anime?.progress).toEqual([])
})
