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
