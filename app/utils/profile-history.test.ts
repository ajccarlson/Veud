import { expect, test } from 'vitest'
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
