import { expect, test } from 'vitest'
import {
	buildProfileTrackingSummaries,
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
