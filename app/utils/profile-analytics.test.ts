import { expect, test } from 'vitest'
import {
	createProfileAnalyticsAccumulator,
	createProfileAnalyticsCategoryAccumulator,
	finalizeProfileAnalytics,
	PROFILE_COMPONENT_SCORE_FIELDS,
	PROFILE_ANALYTICS_CATEGORY_CANDIDATE_LIMIT,
	PROFILE_ANALYTICS_CATEGORY_SOURCE_CODE_UNIT_LIMIT,
	PROFILE_ANALYTICS_COMPLETION_DAY_LIMIT,
	PROFILE_ANALYTICS_ENTRY_LIMIT,
	type ProfileAnalyticsEntry,
} from './profile-analytics.ts'
import {
	PROFILE_HISTORY_CODE_UNIT_LIMIT,
	PROFILE_HISTORY_EVENT_LIMIT,
} from './profile-history-bounds.ts'

const listTypes = [
	{ id: 'live', name: 'liveaction' },
	{ id: 'anime', name: 'anime' },
	{ id: 'manga', name: 'manga' },
]
const watchlists = [
	{ id: 'live-list', typeId: 'live' },
	{ id: 'anime-list', typeId: 'anime' },
	{ id: 'manga-list', typeId: 'manga' },
]

function entry(
	watchlistId: string,
	overrides: Omit<Partial<ProfileAnalyticsEntry>, 'watchlistId'> = {},
): ProfileAnalyticsEntry {
	return { watchlistId, ...overrides }
}

function aggregate(
	entries: ProfileAnalyticsEntry[],
	options: { entryLimit?: number; now?: Date } = {},
) {
	const firstAccumulator = createProfileAnalyticsAccumulator({
		listTypes,
		watchlists,
		...options,
	})
	firstAccumulator.addMany(entries)
	const firstPass = firstAccumulator.finish()
	const categoryAccumulator = createProfileAnalyticsCategoryAccumulator({
		listTypes,
		watchlists,
		plan: firstPass.categoryPlan,
		entryLimit: options.entryLimit,
	})
	categoryAccumulator.addMany(entries)
	const categories = categoryAccumulator.finish()
	return {
		firstPass,
		categories,
		result: finalizeProfileAnalytics(firstPass, categories),
	}
}

test('aggregates fixed score buckets and decimal objective summaries by provider', () => {
	const { result } = aggregate([
		entry('live-list', {
			story: 1,
			character: 9.9,
			personal: 8.1,
			tmdbScore: 10,
			malScore: 2,
		}),
		entry('live-list', {
			story: 1.9,
			personal: 8.2,
			tmdbScore: 10,
		}),
		entry('live-list', {
			personal: 10,
			tmdbScore: 9.9,
		}),
		entry('anime-list', {
			personal: 4.5,
			tmdbScore: 8,
			malScore: 10,
		}),
		entry('manga-list', {
			personal: 7.4,
			tmdbScore: 7,
			malScore: 6,
		}),
	])

	expect(result.listTypeCounts).toEqual({ live: 3, anime: 1, manga: 1 })
	expect(result.scoreBuckets.live.story).toEqual([2, 0, 0, 0, 0, 0, 0, 0, 0, 0])
	expect(result.scoreBuckets.live.character).toEqual([
		0, 0, 0, 0, 0, 0, 0, 0, 1, 0,
	])
	expect(result.scoreBuckets.live.personal).toEqual([
		0, 0, 0, 0, 0, 0, 0, 2, 0, 1,
	])
	expect(result.providerScoreBuckets.live.tmdbScore).toEqual([
		0, 0, 0, 0, 0, 0, 0, 0, 1, 2,
	])
	for (const field of PROFILE_COMPONENT_SCORE_FIELDS) {
		expect(result.scoreBuckets.anime[field]).toHaveLength(10)
	}

	expect(result.objectiveScores.live.source).toBe('tmdbScore')
	expect(result.objectiveScores.live.groups).toEqual([
		{
			score: 9,
			min: 10,
			q1: 10,
			median: 10,
			q3: 10,
			max: 10,
			mean: 10,
			count: 1,
		},
		{
			score: 10,
			min: 8.1,
			q1: 8.125,
			median: 8.15,
			q3: 8.175,
			max: 8.2,
			mean: 8.15,
			count: 2,
		},
	])
	expect(result.objectiveScores.anime).toEqual({
		source: 'malScore',
		groups: [
			{
				score: 10,
				min: 4.5,
				q1: 4.5,
				median: 4.5,
				q3: 4.5,
				max: 4.5,
				mean: 4.5,
				count: 1,
			},
		],
	})
	expect(result.objectiveScores.manga.source).toBe('malScore')
	expect(result.objectiveScores.manga.groups[0]?.score).toBe(6)
})

test('bounds release and finished-year series while deduplicating exact entry timestamps', () => {
	const now = new Date('2026-07-28T12:00:00.000Z')
	const { result } = aggregate(
		[
			entry('live-list', {
				airYear: '1869',
				history: { finished: '1869-01-01T00:00:00.000Z' },
			}),
			entry('live-list', {
				airYear: 'Released in 1870',
				history: {
					finished: '1870-01-01T00:00:00.000Z',
					progress: {
						1: {
							finishDate: [
								'1870-01-01T00:00:00.000Z',
								'1870-01-01T01:00:00.000Z',
							],
						},
					},
				},
			}),
			entry('live-list', {
				airYear: '2031',
				history: JSON.stringify({
					finished: '2031-01-01T00:00:00.000Z',
				}),
			}),
			entry('live-list', {
				airYear: '2032',
				history: { finished: '2032-01-01T00:00:00.000Z' },
			}),
			entry('anime-list', {
				startSeason: null,
				releaseStart: '2024-04-01T00:00:00.000Z',
				history: {
					finished: '2026-01-03T12:00:00.000Z',
					progress: {
						episode: {
							1: {
								finishDate: [
									'2026-01-03T12:00:00.000Z',
									'2026-01-03T18:00:00.000Z',
								],
							},
						},
					},
				},
			}),
			entry('anime-list', {
				history: {
					finished: '2026-01-03T12:00:00.000Z',
				},
			}),
		],
		{ now },
	)

	expect(result.releaseYears.live).toEqual([
		{ year: 1870, count: 1 },
		{ year: 2031, count: 1 },
	])
	expect(result.releaseYears.anime).toEqual([{ year: 2024, count: 1 }])
	expect(result.completionYears.live).toEqual([
		{ year: 1870, count: 1 },
		{ year: 2031, count: 1 },
	])
	expect(result.completionYears.anime).toEqual([{ year: 2026, count: 2 }])
	expect(
		result.completionDays.find(day => day.day === '1870-01-01')?.value,
	).toBe(2)
	expect(
		result.completionDays.find(day => day.day === '2026-01-03')?.value,
	).toBe(3)
	expect(result.completionDays.some(day => day.day.startsWith('1869'))).toBe(
		false,
	)
	expect(result.completionDays.some(day => day.day.startsWith('2032'))).toBe(
		false,
	)
})

test('rejects coercible non-date history values from completion analytics', () => {
	const { result } = aggregate(
		[false, [], {}, 0, '0'].map(value =>
			entry('anime-list', {
				releaseStart: value,
				history: {
					finished: value,
					progress: { 1: { finishDate: [value] } },
				},
			}),
		),
	)

	expect(result.releaseYears.anime).toEqual([])
	expect(result.completionYears.anime).toEqual([])
	expect(result.completionDays).toEqual([])
})

test('retains only the latest 1000 sparse UTC completion days and reports truncation', () => {
	const start = Date.UTC(2000, 0, 1)
	const entries = Array.from(
		{ length: PROFILE_ANALYTICS_COMPLETION_DAY_LIMIT + 2 },
		(_, index) =>
			entry('anime-list', {
				history: {
					finished: new Date(start + index * 86_400_000).toISOString(),
				},
			}),
	)
	const accumulator = createProfileAnalyticsAccumulator({
		listTypes,
		watchlists,
		now: new Date('2026-07-28T12:00:00.000Z'),
	})
	accumulator.addMany(entries)
	const result = accumulator.finish()

	expect(result.completionDays).toHaveLength(
		PROFILE_ANALYTICS_COMPLETION_DAY_LIMIT,
	)
	expect(result.completionDays[0]?.day).toBe('2000-01-03')
	expect(result.completionDays.at(-1)?.day).toBe(
		new Date(start + (PROFILE_ANALYTICS_COMPLETION_DAY_LIMIT + 1) * 86_400_000)
			.toISOString()
			.slice(0, 10),
	)
	expect(result.diagnostic.completionDaysTruncated).toBe(true)
})

test('uses a bounded candidate pass then produces exact top counts and matrices', () => {
	const categoryEntries = [
		entry('anime-list', {
			genres: 'Action, Drama, action',
			type: 'TV',
		}),
		entry('anime-list', { genres: 'action', type: 'tv' }),
		entry('anime-list', { genres: 'Action', type: 'Movie' }),
		entry('anime-list', { genres: 'Drama', type: 'OVA' }),
		...Array.from({ length: 25 }, (_, index) =>
			entry('anime-list', {
				genres: `Genre ${String(index).padStart(2, '0')}`,
				type: `Type ${String(index).padStart(2, '0')}`,
			}),
		),
	]
	const { categories, result } = aggregate(categoryEntries)
	const genreCounts = categories.genreCounts.anime
	const mediaTypeCounts = result.mediaTypeCounts.anime

	expect(genreCounts.slice(0, 2)).toEqual([
		{ key: 'action', label: 'Action', count: 3 },
		{ key: 'drama', label: 'Drama', count: 2 },
	])
	expect(genreCounts).toHaveLength(25)
	expect(genreCounts.at(-1)).toEqual({
		key: '__veud_category_rollup__',
		label: 'All other genres',
		count: 3,
		isRollup: true,
	})
	expect(mediaTypeCounts[0]).toEqual({ key: 'tv', label: 'TV', count: 2 })
	expect(mediaTypeCounts.at(-1)).toEqual({
		key: '__veud_category_rollup__',
		label: 'All other types',
		count: 4,
		isRollup: true,
	})

	const matrix = result.genreMatrices.anime
	const action = matrix.labels.indexOf('Action')
	const drama = matrix.labels.indexOf('Drama')
	expect(matrix.values[action]?.[action]).toBe(0)
	expect(matrix.values[action]?.[drama]).toBe(1)
	expect(matrix.values[drama]?.[action]).toBe(1)
	expect(matrix.values[drama]?.[drama]).toBe(0)
	expect(matrix.labels).toHaveLength(24)
	expect(result.diagnostic.categoryCandidatesApproximate).toBe(false)
	expect(result.diagnostic.categoryCandidatesTruncated).toBe(false)
})

test('enforces the server processing ceiling and rejects mismatched passes', () => {
	expect(PROFILE_ANALYTICS_ENTRY_LIMIT).toBe(100_000)
	const firstAccumulator = createProfileAnalyticsAccumulator({
		listTypes,
		watchlists,
		entryLimit: 2,
	})
	expect(
		firstAccumulator.addMany([
			entry('live-list'),
			entry('anime-list'),
			entry('manga-list'),
		]),
	).toBe(2)
	const firstPass = firstAccumulator.finish()

	expect(firstPass.diagnostic).toEqual({
		processed: 2,
		truncated: true,
		limit: 2,
		completionDaysTruncated: false,
		categoryCandidatesApproximate: false,
		categoryCandidatesTruncated: false,
		historyEntriesRejected: 0,
		historyFinishEventsTruncated: 0,
	})
	const categoryAccumulator = createProfileAnalyticsCategoryAccumulator({
		listTypes,
		watchlists,
		plan: firstPass.categoryPlan,
		entryLimit: 2,
	})
	categoryAccumulator.add(entry('live-list'))
	const categories = categoryAccumulator.finish()
	expect(() => finalizeProfileAnalytics(firstPass, categories)).toThrow(
		/did not process the same bounded entry window/,
	)
})

test('overview mode skips stats aggregation while retaining completion days', () => {
	const accumulator = createProfileAnalyticsAccumulator({
		listTypes,
		watchlists,
		mode: 'overview',
		now: new Date('2026-07-28T12:00:00.000Z'),
	})
	accumulator.add(
		entry('anime-list', {
			personal: 9,
			malScore: 8,
			startSeason: 'Spring 2026',
			type: 'TV',
			genres: 'Action',
			history: {
				finished: '2026-01-03T12:00:00.000Z',
				progress: {
					episode: {
						1: { finishDate: ['2026-01-04T12:00:00.000Z'] },
					},
				},
			},
		}),
	)
	const result = accumulator.finish()

	expect(result.completionDays).toEqual([
		{ day: '2026-01-03', value: 1 },
		{ day: '2026-01-04', value: 1 },
	])
	expect(result.listTypeCounts).toEqual({ live: 0, anime: 0, manga: 0 })
	expect(result.releaseYears.anime).toEqual([])
	expect(result.completionYears.anime).toEqual([])
	expect(result.categoryPlan.genres.anime).toEqual([])
	expect(result.objectiveScores.anime.groups).toEqual([])
})

test('stats mode skips completion-day expansion but keeps completion years', () => {
	const accumulator = createProfileAnalyticsAccumulator({
		listTypes,
		watchlists,
		mode: 'stats',
		now: new Date('2026-07-28T12:00:00.000Z'),
	})
	accumulator.add(
		entry('anime-list', {
			personal: 9,
			malScore: 8,
			startSeason: 'Spring 2026',
			type: 'TV',
			genres: 'Action',
			history: {
				finished: '2026-01-03T12:00:00.000Z',
				progress: {
					episode: {
						1: { finishDate: ['2026-01-04T12:00:00.000Z'] },
					},
				},
			},
		}),
	)
	const result = accumulator.finish()

	expect(result.completionDays).toEqual([])
	expect(result.diagnostic.completionDaysTruncated).toBe(false)
	expect(result.listTypeCounts.anime).toBe(1)
	expect(result.releaseYears.anime).toEqual([{ year: 2026, count: 1 }])
	expect(result.completionYears.anime).toEqual([{ year: 2026, count: 1 }])
	expect(result.categoryPlan.genres.anime).toEqual([
		{ key: 'action', label: 'Action' },
	])
	expect(result.objectiveScores.anime.groups).toHaveLength(1)
})

test('reports when bounded category candidates become approximate', () => {
	const accumulator = createProfileAnalyticsAccumulator({
		listTypes,
		watchlists,
		mode: 'stats',
	})
	accumulator.addMany(
		Array.from(
			{ length: PROFILE_ANALYTICS_CATEGORY_CANDIDATE_LIMIT + 1 },
			(_, index) =>
				entry('anime-list', {
					genres: `Genre ${index}`,
					type: `Type ${index}`,
				}),
		),
	)
	const result = accumulator.finish()

	expect(result.categoryPlan.genres.anime).toHaveLength(
		PROFILE_ANALYTICS_CATEGORY_CANDIDATE_LIMIT,
	)
	expect(result.categoryPlan.mediaTypes.anime).toHaveLength(
		PROFILE_ANALYTICS_CATEGORY_CANDIDATE_LIMIT,
	)
	expect(result.diagnostic.categoryCandidatesApproximate).toBe(true)
	expect(result.diagnostic.categoryCandidatesTruncated).toBe(true)
})

test('bounds hostile category input and keeps a real Other distinct from rollup', () => {
	const entries = [
		...Array.from({ length: 3 }, () =>
			entry('anime-list', {
				type: 'Other',
				genres: Array.from(
					{ length: 10_000 },
					(_, index) => `Genre ${index}`,
				).join(','),
				categorySourceTruncated: true,
			}),
		),
		...Array.from({ length: 25 }, (_, index) =>
			entry('anime-list', {
				type: `Type ${index}`,
				genres: `Genre ${index}`,
			}),
		),
	]
	const { result } = aggregate(entries)

	expect(result.diagnostic.categoryCandidatesTruncated).toBe(true)
	expect(result.mediaTypeCounts.anime).toContainEqual({
		key: 'other',
		label: 'Other',
		count: 3,
	})
	expect(result.mediaTypeCounts.anime).toContainEqual({
		key: '__veud_category_rollup__',
		label: 'All other types',
		count: 2,
		isRollup: true,
	})
	expect(PROFILE_ANALYTICS_CATEGORY_SOURCE_CODE_UNIT_LIMIT).toBe(8 * 1024)
})

test('uses a collision-safe identity for synthetic category rollups', () => {
	const { result } = aggregate([
		entry('anime-list', { type: '__veud_category_rollup__' }),
		entry('anime-list', { type: '__veud_category_rollup__' }),
		...Array.from({ length: 25 }, (_, index) =>
			entry('anime-list', { type: `Reserved fixture ${index}` }),
		),
	])
	const categories = result.mediaTypeCounts.anime
	const real = categories.find(
		category => category.label === '__veud_category_rollup__',
	)
	const rollup = categories.find(category => category.isRollup)

	expect(real).toMatchObject({
		key: '__veud_category_rollup__',
		count: 2,
	})
	expect(real?.isRollup).toBeUndefined()
	expect(rollup).toMatchObject({
		key: '__veud_category_rollup___',
		label: 'All other types',
		isRollup: true,
	})
})

test('rejects oversized history and caps finish traversal with diagnostics', () => {
	const finishDates = Array.from(
		{ length: PROFILE_HISTORY_EVENT_LIMIT + 1 },
		(_, index) => new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
	)
	const accumulator = createProfileAnalyticsAccumulator({
		listTypes,
		watchlists,
		mode: 'overview',
		now: new Date('2026-07-28T12:00:00.000Z'),
	})
	accumulator.addMany([
		entry('anime-list', {
			history: `{"note":"${'x'.repeat(PROFILE_HISTORY_CODE_UNIT_LIMIT)}"}`,
		}),
		entry('anime-list', {
			history: { progress: { 1: { finishDate: finishDates } } },
		}),
	])
	const result = accumulator.finish()

	expect(result.diagnostic.historyEntriesRejected).toBe(1)
	expect(result.diagnostic.historyFinishEventsTruncated).toBe(1)
	expect(
		result.completionDays.reduce((total, day) => total + day.value, 0),
	).toBe(PROFILE_HISTORY_EVENT_LIMIT)
})
