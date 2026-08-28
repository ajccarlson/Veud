import { expect, test } from 'vitest'
import { mediaFacts } from './media-facts.ts'

test('builds compact movie facts and formats large currency values safely', () => {
	expect(
		mediaFacts('movie', {
			title: 'Localized title',
			originalTitle: 'Titre original',
			type: 'Movie',
			releaseStatus: 'Released',
			language: 'French',
			runtimeMinutes: 125,
			rating: 'PG-13',
			studios: 'Studio One, Studio Two',
			budget: '150000000',
			revenue: '2923706026',
			keywords: 'future, ocean',
		}),
	).toEqual(
		expect.arrayContaining([
			{ label: 'Original title', value: 'Titre original' },
			{ label: 'Runtime', value: '2h 5m' },
			{ label: 'Revenue', value: '$2,923,706,026' },
		]),
	)
})

test('reads linked MAL names and labels episodic runtime', () => {
	const facts = mediaFacts('anime', {
		title: 'Example',
		originalTitle: 'Example',
		runtimeMinutes: 24,
		episodeCount: 12,
		studios: JSON.stringify([
			'Studio Example|https://myanimelist.net/anime/producer/7',
		]),
		authors: JSON.stringify(['Ada Artist|https://example.test/ada']),
	})
	expect(facts).toContainEqual({ label: 'Runtime', value: '24m per episode' })
	expect(facts).toContainEqual({ label: 'Studios', value: 'Studio Example' })
	expect(facts).not.toContainEqual(
		expect.objectContaining({ label: 'Original title' }),
	)
})

test('omits malformed, empty, zero, and unsafe values', () => {
	expect(
		mediaFacts('movie', {
			runtimeMinutes: -1,
			episodeCount: 0,
			budget: 'not-money',
			revenue: '0',
			studios: '[]',
		}),
	).toEqual([])
})

test('an anime film is not labelled per episode', () => {
	// Anime films are kind 'anime' like the series are, so gating the label on
	// kind alone put "2h 5m per episode" on every one of them.
	expect(
		mediaFacts('anime', {
			title: 'Example Film',
			type: 'Movie',
			runtimeMinutes: 125,
		}),
	).toContainEqual({ label: 'Runtime', value: '2h 5m' })
})

test('a one-shot special is not labelled per episode', () => {
	// A single instalment has no "per episode" to speak of, whatever its format.
	expect(
		mediaFacts('anime', {
			title: 'Example Special',
			type: 'Special',
			runtimeMinutes: 45,
			episodeCount: 1,
		}),
	).toContainEqual({ label: 'Runtime', value: '45m' })
})

test('a series with an unknown episode count is still labelled per episode', () => {
	// A currently-airing series often has no count yet. It is still episodic.
	expect(
		mediaFacts('tv', {
			title: 'Example Series',
			type: 'Scripted',
			runtimeMinutes: 42,
		}),
	).toContainEqual({ label: 'Runtime', value: '42m per episode' })
})

test('a multi-part anime film is labelled per part', () => {
	// MAL files these as "Movie": 5 Centimeters per Second is three parts,
	// Genius Party seven, Die Neue These twelve. The stored runtime is one
	// part's, so presenting it as the whole work's is simply wrong — the format
	// must not outrank an instalment count that says otherwise.
	expect(
		mediaFacts('anime', {
			title: 'Byousoku 5 Centimeter',
			type: 'Movie',
			runtimeMinutes: 21,
			episodeCount: 3,
		}),
	).toContainEqual({ label: 'Runtime', value: '21m per episode' })
})

test('a single-part anime film is still the whole work', () => {
	expect(
		mediaFacts('anime', {
			title: 'Example Film',
			type: 'Movie',
			runtimeMinutes: 125,
			episodeCount: 1,
		}),
	).toContainEqual({ label: 'Runtime', value: '2h 5m' })
})
