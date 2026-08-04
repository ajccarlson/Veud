import { expect, test } from 'vitest'
import {
	normalizeWatchProviders,
	offersForRegion,
	watchAvailabilityExpiry,
} from './tmdb-watch-providers.server.ts'

// Shape taken from a live /watch/providers response.
const live = {
	id: 238,
	results: {
		US: {
			link: 'https://www.themoviedb.org/movie/238-the-godfather/watch?locale=US',
			flatrate: [
				{
					provider_id: 257,
					provider_name: 'fuboTV',
					logo_path: '/9Bga.jpg',
					display_priority: 10,
				},
			],
			buy: [
				{
					provider_id: 2,
					provider_name: 'Apple TV',
					logo_path: '/apple.jpg',
					display_priority: 3,
				},
			],
		},
	},
}

test('a live payload flattens into attributed regional offers', () => {
	const offers = normalizeWatchProviders(live)
	expect(offers).toHaveLength(2)
	// flatrate is a more useful answer than buy, so it sorts first.
	expect(offers.map(offer => offer.offerKind)).toEqual(['flatrate', 'buy'])
	expect(offers[0]).toMatchObject({
		region: 'US',
		providerId: 257,
		providerName: 'fuboTV',
		link: live.results.US.link,
	})
})

test('a region with no attributed link is dropped entirely', () => {
	// TMDB supplies this data from JustWatch and requires their link be the
	// destination. Listing providers we cannot legitimately link to would be
	// worse than showing nothing.
	for (const link of [
		undefined,
		null,
		'',
		'not a url',
		'http://www.themoviedb.org/movie/238/watch',
		'https://example.com/watch',
		'https://evil.example/themoviedb.org',
	]) {
		const offers = normalizeWatchProviders({
			results: { US: { ...live.results.US, link } },
		})
		expect(offers, `link ${String(link)} must not produce offers`).toEqual([])
	}
})

test('anime is covered like anything else', () => {
	// Verified against TMDB: Frieren returns Netflix, Hulu and Crunchyroll. The
	// gap for anime is that Veud rows carry no TMDB id, not that JustWatch
	// lacks the content.
	const offers = normalizeWatchProviders({
		results: {
			US: {
				link: 'https://www.themoviedb.org/tv/209867/watch?locale=US',
				flatrate: [
					{
						provider_id: 283,
						provider_name: 'Crunchyroll',
						display_priority: 2,
					},
					{ provider_id: 8, provider_name: 'Netflix', display_priority: 1 },
				],
			},
		},
	})
	expect(offers.map(offer => offer.providerName)).toEqual([
		'Netflix',
		'Crunchyroll',
	])
})

test('malformed providers and regions are skipped, not guessed at', () => {
	const offers = normalizeWatchProviders({
		results: {
			US: {
				link: live.results.US.link,
				flatrate: [
					{ provider_id: 0, provider_name: 'Zero' },
					{ provider_id: 5, provider_name: '  ' },
					{ provider_name: 'No id' },
					'nonsense',
				],
			},
			// Not a region code.
			WORLD: {
				link: live.results.US.link,
				flatrate: [{ provider_id: 9, provider_name: 'X' }],
			},
		},
	})
	expect(offers).toEqual([])
})

test('the same provider is never listed twice for one offer kind', () => {
	const offers = normalizeWatchProviders({
		results: {
			US: {
				link: live.results.US.link,
				flatrate: [
					{ provider_id: 8, provider_name: 'Netflix', display_priority: 1 },
					{ provider_id: 8, provider_name: 'Netflix', display_priority: 1 },
				],
				buy: [
					{ provider_id: 8, provider_name: 'Netflix', display_priority: 1 },
				],
			},
		},
	})
	// Once as a subscription, once as a purchase: distinct answers, no repeats.
	expect(offers).toHaveLength(2)
	expect(offers.map(offer => offer.offerKind)).toEqual(['flatrate', 'buy'])
})

test('availability expires so a stale row never shows', () => {
	const observedAt = new Date('2026-07-30T00:00:00.000Z')
	expect(watchAvailabilityExpiry(observedAt).getTime()).toBeGreaterThan(
		observedAt.getTime(),
	)
})

test('offers can be narrowed to one region', () => {
	const offers = normalizeWatchProviders({
		results: {
			US: {
				link: live.results.US.link,
				flatrate: [{ provider_id: 8, provider_name: 'Netflix' }],
			},
			GB: {
				link: 'https://www.themoviedb.org/movie/238/watch?locale=GB',
				flatrate: [{ provider_id: 9, provider_name: 'Prime Video' }],
			},
		},
	})
	expect(
		offersForRegion(offers, 'gb').map(offer => offer.providerName),
	).toEqual(['Prime Video'])
})

test('a payload with no results is not an error', () => {
	for (const payload of [null, undefined, {}, { results: null }, [], 'x']) {
		expect(normalizeWatchProviders(payload)).toEqual([])
	}
})
