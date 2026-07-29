import { expect, test } from 'vitest'
import {
	PROFILE_HISTORY_CODE_UNIT_LIMIT,
	PROFILE_HISTORY_EVENT_LIMIT,
} from './profile-history-bounds.ts'
import { buildProfileHistory } from './profile-history.ts'

const animeType = {
	id: 'anime',
	columns: '{"length":"string"}',
	mediaType: '["episode"]',
	completionType: '{"past":"watched"}',
}

const animeWatchlist = {
	id: 'watching-anime',
	typeId: animeType.id,
	header: 'Watching',
}

test('returns the historical empty payload when a user has no watchlists', () => {
	expect(
		buildProfileHistory({
			listTypes: [animeType],
			watchlists: [],
			entries: [],
		}),
	).toEqual({ typedEntries: {}, typedHistory: {} })
})

test('parses entry history and builds newest-first activity without mutating the source', () => {
	const storedHistory = JSON.stringify({
		added: '2025-01-01T18:00:00.000Z',
		startedRewatch: '2025-01-02T18:00:00.000Z',
		lastUpdated: '2025-01-03T18:00:00.000Z',
	})
	const entry = {
		id: 'entry-1',
		watchlistId: animeWatchlist.id,
		title: 'Example Anime',
		history: storedHistory,
	}

	const result = buildProfileHistory({
		listTypes: [animeType],
		watchlists: [animeWatchlist],
		entries: [entry],
	})

	expect(entry.history).toBe(storedHistory)
	expect(result.typedEntries.anime?.[0]?.history).toEqual(
		JSON.parse(storedHistory),
	)
	expect(result.typedHistory.anime).toEqual([
		{
			type: 'Started Rewatch',
			time: new Date('2025-01-02T18:00:00.000Z'),
			index: 0,
		},
		{
			type: 'Added to Watching',
			time: new Date('2025-01-01T18:00:00.000Z'),
			index: 0,
		},
	])
})

test('normalizes missing and JSON-null histories for legacy chart consumers', () => {
	const result = buildProfileHistory({
		listTypes: [animeType],
		watchlists: [animeWatchlist],
		entries: [
			{ id: 'entry-1', watchlistId: animeWatchlist.id, history: null },
			{ id: 'entry-2', watchlistId: animeWatchlist.id, history: 'null' },
		],
	})

	const emptyHistory = {
		added: null,
		started: null,
		finished: null,
		progress: null,
		lastUpdated: null,
	}
	expect(result.typedEntries.anime?.map(entry => entry.history)).toEqual([
		emptyHistory,
		emptyHistory,
	])
	expect(result.typedHistory.anime).toEqual([])
})

test('groups length-based progress by local day and preserves entry indexes', () => {
	const result = buildProfileHistory({
		listTypes: [animeType],
		watchlists: [animeWatchlist],
		entries: [
			{ id: 'entry-1', watchlistId: animeWatchlist.id, history: null },
			{
				id: 'entry-2',
				watchlistId: animeWatchlist.id,
				history: JSON.stringify({
					progress: {
						1: { finishDate: ['2025-01-03T18:00:00.000Z'] },
						2: { finishDate: ['2025-01-03T20:00:00.000Z'] },
						3: { finishDate: ['2025-01-04T20:00:00.000Z'] },
					},
				}),
			},
		],
	})

	expect(result.typedHistory.anime).toEqual([
		{
			type: 'Watched Episode 3',
			time: new Date('2025-01-04T20:00:00.000Z'),
			index: 1,
		},
		{
			type: 'Watched Episodes 1 - 2',
			time: new Date('2025-01-03T20:00:00.000Z'),
			index: 1,
		},
	])
})

test('uses the latest same-day timestamp when one unit appears more than once', () => {
	const result = buildProfileHistory({
		listTypes: [animeType],
		watchlists: [animeWatchlist],
		entries: [
			{
				id: 'entry-1',
				watchlistId: animeWatchlist.id,
				history: JSON.stringify({
					progress: {
						1: {
							finishDate: [
								'2025-01-03T18:00:00.000Z',
								'2025-01-03T22:00:00.000Z',
							],
						},
					},
				}),
			},
		],
	})

	expect(result.typedHistory.anime).toEqual([
		{
			type: 'Watched Episode 1',
			time: new Date('2025-01-03T22:00:00.000Z'),
			index: 0,
		},
	])
})

test('does not duplicate a unit when stored timestamps are newest-first', () => {
	const result = buildProfileHistory({
		listTypes: [animeType],
		watchlists: [animeWatchlist],
		entries: [
			{
				id: 'entry-1',
				watchlistId: animeWatchlist.id,
				history: JSON.stringify({
					progress: {
						1: {
							finishDate: [
								'2025-01-03T22:00:00.000Z',
								'2025-01-03T18:00:00.000Z',
							],
						},
					},
				}),
			},
		],
	})

	expect(result.typedHistory.anime).toEqual([
		{
			type: 'Watched Episode 1',
			time: new Date('2025-01-03T22:00:00.000Z'),
			index: 0,
		},
	])
})

test('groups high-cardinality same-day progress in linear-keyed maps', () => {
	const base = Date.parse('2025-01-03T18:00:00.000Z')
	const progress = Object.fromEntries(
		Array.from({ length: 5_000 }, (_, index) => [
			String(index + 1),
			{ finishDate: [new Date(base + index).toISOString()] },
		]),
	)
	const result = buildProfileHistory({
		listTypes: [animeType],
		watchlists: [animeWatchlist],
		entries: [
			{
				id: 'high-cardinality',
				watchlistId: animeWatchlist.id,
				history: JSON.stringify({ progress }),
			},
		],
	})

	expect(result.typedHistory.anime).toEqual([
		{
			type: 'Watched Episodes 1 - 5000',
			time: new Date(base + 4_999),
			index: 0,
		},
	])
})

test('reads media-specific progress when the list type has no length column', () => {
	const mangaType = {
		id: 'manga',
		columns: '{"chapters":"string","volumes":"string"}',
		mediaType: '["chapter","volume"]',
		completionType: '{"past":"read"}',
	}
	const mangaWatchlist = {
		id: 'reading-manga',
		typeId: mangaType.id,
		header: 'Reading',
	}

	const result = buildProfileHistory({
		listTypes: [mangaType],
		watchlists: [mangaWatchlist],
		entries: [
			{
				id: 'entry-1',
				watchlistId: mangaWatchlist.id,
				history: JSON.stringify({
					progress: {
						chapter: {
							7: { finishDate: ['2025-02-01T18:00:00.000Z'] },
						},
						volume: {
							1: { finishDate: ['2025-02-01T20:00:00.000Z'] },
						},
					},
				}),
			},
		],
	})

	expect(result.typedHistory.manga).toEqual([
		{
			type: 'Read Volume 1',
			time: new Date('2025-02-01T20:00:00.000Z'),
			index: 0,
		},
		{
			type: 'Read Chapter 7',
			time: new Date('2025-02-01T18:00:00.000Z'),
			index: 0,
		},
	])
})

test('degrades malformed stored history and list settings safely', () => {
	const result = buildProfileHistory({
		listTypes: [
			{
				...animeType,
				mediaType: '{not-json}',
				completionType: '{not-json}',
			},
		],
		watchlists: [animeWatchlist],
		entries: [
			{
				id: 'entry-1',
				watchlistId: animeWatchlist.id,
				history: '{not-json}',
			},
			{
				id: 'entry-2',
				watchlistId: animeWatchlist.id,
				history: JSON.stringify({
					added: 'not-a-date',
					progress: { 1: { finishDate: ['also-not-a-date'] } },
				}),
			},
		],
	})

	expect(result.typedEntries.anime?.[0]?.history).toEqual({
		added: null,
		started: null,
		finished: null,
		progress: null,
		lastUpdated: null,
	})
	expect(result.typedHistory.anime).toEqual([])
})

test('rejects coercible non-scalar and zero history dates consistently', () => {
	const result = buildProfileHistory({
		listTypes: [animeType],
		watchlists: [animeWatchlist],
		entries: [
			{
				id: 'coercible-dates',
				watchlistId: animeWatchlist.id,
				history: JSON.stringify({
					booleanDate: false,
					arrayDate: [],
					objectDate: {},
					hugeDate: 1e100,
					zeroDate: 0,
					stringZeroDate: '0',
					progress: {
						1: {
							finishDate: [
								false,
								[],
								{},
								1e100,
								-1e100,
								0,
								'0',
								'1970-01-01T00:00:00.001Z',
							],
						},
					},
				}),
			},
		],
	})

	expect(result.typedHistory.anime).toEqual([
		{
			type: 'Watched Episode 1',
			time: new Date(1),
			index: 0,
		},
	])
})

test('rejects oversized and overly deep stored histories without throwing', () => {
	let deepHistory: Record<string, unknown> = {}
	const root = deepHistory
	for (let index = 0; index < 33; index += 1) {
		const child: Record<string, unknown> = {}
		deepHistory.next = child
		deepHistory = child
	}

	const result = buildProfileHistory({
		listTypes: [animeType],
		watchlists: [animeWatchlist],
		entries: [
			{
				id: 'oversized',
				watchlistId: animeWatchlist.id,
				history: `{"note":"${'x'.repeat(PROFILE_HISTORY_CODE_UNIT_LIMIT)}"}`,
			},
			{
				id: 'deep',
				watchlistId: animeWatchlist.id,
				history: JSON.stringify(root),
			},
		],
	})

	expect(result.typedEntries.anime?.map(entry => entry.history)).toEqual([
		{
			added: null,
			started: null,
			finished: null,
			progress: null,
			lastUpdated: null,
		},
		{
			added: null,
			started: null,
			finished: null,
			progress: null,
			lastUpdated: null,
		},
	])
	expect(result.typedHistory.anime).toEqual([])
	expect(result.diagnostic).toEqual({
		rejectedHistories: 2,
		truncatedHistories: 0,
		activityEventsTruncated: 0,
		perEntryEventLimit: PROFILE_HISTORY_EVENT_LIMIT,
	})
})

test('caps arbitrary legacy activity events per entry and reports truncation', () => {
	const history = Object.fromEntries(
		Array.from({ length: PROFILE_HISTORY_EVENT_LIMIT + 1 }, (_, index) => [
			`event${String(index).padStart(5, '0')}`,
			new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
		]),
	)
	const result = buildProfileHistory({
		listTypes: [animeType],
		watchlists: [animeWatchlist],
		entries: [
			{
				id: 'many-events',
				watchlistId: animeWatchlist.id,
				history: JSON.stringify(history),
			},
		],
	})

	expect(result.typedHistory.anime).toHaveLength(PROFILE_HISTORY_EVENT_LIMIT)
	expect(
		result.typedHistory.anime?.some(event => event.type === 'Event10000'),
	).toBe(true)
	expect(
		result.typedHistory.anime?.some(event => event.type === 'Event00000'),
	).toBe(false)
	expect(result.diagnostic).toEqual({
		rejectedHistories: 0,
		truncatedHistories: 0,
		activityEventsTruncated: 1,
		perEntryEventLimit: PROFILE_HISTORY_EVENT_LIMIT,
	})
})

test('retains newest progress activity when arbitrary keys fill the event cap', () => {
	const arbitraryHistory = Object.fromEntries(
		Array.from({ length: PROFILE_HISTORY_EVENT_LIMIT }, (_, index) => [
			`oldEvent${String(index).padStart(5, '0')}`,
			new Date(Date.UTC(2025, 0, 1, 0, 0, index)).toISOString(),
		]),
	)
	const newest = '2026-07-28T20:00:00.000Z'
	const result = buildProfileHistory({
		listTypes: [animeType],
		watchlists: [animeWatchlist],
		entries: [
			{
				id: 'mixed-events',
				watchlistId: animeWatchlist.id,
				history: JSON.stringify({
					...arbitraryHistory,
					progress: { 1: { finishDate: [newest] } },
				}),
			},
		],
	})

	expect(result.typedHistory.anime).toHaveLength(PROFILE_HISTORY_EVENT_LIMIT)
	expect(result.typedHistory.anime?.[0]).toEqual({
		type: 'Watched Episode 1',
		time: new Date(newest),
		index: 0,
	})
	expect(
		result.typedHistory.anime?.some(event => event.type === 'Old Event00000'),
	).toBe(false)
	expect(result.diagnostic?.activityEventsTruncated).toBe(1)
})

test('caps finish timestamps across an entry before generating activity', () => {
	const finishDates = Array.from(
		{ length: PROFILE_HISTORY_EVENT_LIMIT + 1 },
		(_, index) => new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
	)
	const result = buildProfileHistory({
		listTypes: [animeType],
		watchlists: [animeWatchlist],
		entries: [
			{
				id: 'many-finishes',
				watchlistId: animeWatchlist.id,
				history: JSON.stringify({
					progress: { 1: { finishDate: finishDates } },
				}),
			},
		],
	})

	expect(result.typedHistory.anime).toHaveLength(1)
	expect(result.diagnostic).toEqual({
		rejectedHistories: 0,
		truncatedHistories: 1,
		activityEventsTruncated: 1,
		perEntryEventLimit: PROFILE_HISTORY_EVENT_LIMIT,
	})
})
