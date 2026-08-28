import { expect, test } from 'vitest'
import {
	externalMediaUrl,
	providerReleaseYear,
	legacyProgressUpdate,
	listTypeNameForMediaKind,
	progressUnitsForMediaKind,
	splitLegacyThumbnail,
	totalFromLegacyCounter,
} from './media-detail.ts'

test('maps canonical kinds to list types and progress units', () => {
	expect(listTypeNameForMediaKind('movie')).toBe('liveaction')
	expect(listTypeNameForMediaKind('manga')).toBe('manga')
	expect(progressUnitsForMediaKind('movie')).toEqual([])
	expect(progressUnitsForMediaKind('anime')).toEqual(['episode'])
	expect(progressUnitsForMediaKind('manga')).toEqual(['chapter', 'volume'])
})

test('builds safe display and provider links', () => {
	expect(splitLegacyThumbnail('cover.jpg|https://example.com/title')).toEqual({
		imageUrl: 'cover.jpg',
		externalUrl: 'https://example.com/title',
	})
	expect(splitLegacyThumbnail('cover.jpg')).toEqual({
		imageUrl: 'cover.jpg',
		externalUrl: null,
	})
	expect(
		externalMediaUrl({ provider: 'mal', kind: 'anime', externalId: '5114' }),
	).toBe('https://myanimelist.net/anime/5114')
	expect(totalFromLegacyCounter('3 / 12 eps')).toBe(12)
})

test('mirrors increased episode progress without duplicating unchanged activity', () => {
	const first = legacyProgressUpdate(
		{ history: null, length: '12 eps' },
		{
			unit: 'episode',
			current: 3,
			previousCurrent: 2,
			total: 12,
			now: 1000,
		},
	)
	expect(first.length).toBe('3 / 12 eps')
	expect(JSON.parse(first.history) as Record<string, unknown>).toEqual(
		expect.objectContaining({
			lastUpdated: 1000,
			progress: {
				3: { completed: true, finishDate: [1000] },
			},
		}),
	)

	const unchanged = legacyProgressUpdate(
		{ history: first.history, length: first.length },
		{
			unit: 'episode',
			current: 3,
			previousCurrent: 3,
			total: 12,
			now: 2000,
		},
	)
	const unchangedHistory = JSON.parse(unchanged.history) as any
	expect(unchangedHistory.progress[3].finishDate).toEqual([1000])
})

test('stores manga units independently and does not log downward corrections', () => {
	const chapter = legacyProgressUpdate(
		{ history: null, chapters: '100', volumes: '10' },
		{
			unit: 'chapter',
			current: 7,
			previousCurrent: 5,
			total: 100,
			now: 3000,
		},
	)
	expect(chapter.chapters).toBe('7 / 100')
	const chapterHistory = JSON.parse(chapter.history) as any
	expect(chapterHistory.progress.chapter[7].finishDate).toEqual([3000])

	const correction = legacyProgressUpdate(
		{ history: chapter.history, chapters: chapter.chapters },
		{
			unit: 'chapter',
			current: 4,
			previousCurrent: 7,
			total: 100,
			now: 4000,
		},
	)
	const correctionHistory = JSON.parse(correction.history) as any
	expect(correctionHistory.progress.chapter[4]).toBeUndefined()
})

test('a release year is the provider year, not the importing machine year', () => {
	// TMDB's release_date and MAL's start_date are date-only, so `new Date` gives
	// UTC midnight. Reading the year locally filed anything released on
	// 1 January under the previous year on every host west of UTC — and made the
	// catalogue depend on where the importer happened to run.
	expect(providerReleaseYear(new Date('2026-01-01'))).toBe(2026)
	expect(providerReleaseYear(new Date('2025-12-31'))).toBe(2025)
	expect(providerReleaseYear(new Date('2026-06-15'))).toBe(2026)
})

test('a missing or unparseable release date has no year', () => {
	expect(providerReleaseYear(null)).toBeNull()
	expect(providerReleaseYear(undefined)).toBeNull()
	expect(providerReleaseYear(new Date('not a date'))).toBeNull()
})
