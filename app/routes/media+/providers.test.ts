/**
 * Unit tests for the client-side media provider helpers (`tmdb.ts` / `mal.ts`). Each helper
 * builds an upstream URL, fetches it through the `/media/fetch-data` proxy, and transforms the
 * result. `fetch` is mocked here; the proxy's contract is that it returns a 2-element array
 * `[response, data]` (which the helpers merge or index), so the mocks return that shape.
 *
 * Coverage targets the behaviors most worth locking in:
 *   - TMDB/MAL media-type handling and result slicing,
 *   - the `encodeURIComponent` search-term escaping that closed the 2.3 query-param injection,
 *   - the AniList schedule -> `nextRelease` derivation the home-page "Upcoming" widget depends on.
 *
 * NOTE: authored in a sandbox without vitest; run `npm run test` to confirm.
 */
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
	animeStatusHasUpcomingSchedule,
	formatMangaInfo,
	getAnilistSchedule,
	searchMAL,
} from './mal.ts'
import { getTMDBInfo, searchTMDB } from './tmdb.ts'

let fetchMock: any

beforeEach(() => {
	fetchMock = vi.spyOn(globalThis, 'fetch')
})

afterEach(() => {
	vi.restoreAllMocks()
})

// The proxy returns `[response, data]`; the helpers read `res.json()` as that array.
function proxyJson(data: unknown) {
	return new Response(JSON.stringify([{}, data]), {
		status: 200,
		headers: { 'Content-Type': 'application/json' },
	})
}

// The helpers fetch `/media/fetch-data/<encodeURIComponent(URLSearchParams)>`. Recover the
// upstream URL the proxy would have been asked to hit, so we can assert on it.
function upstreamUrl(call: any): URL {
	const path = String(call[0]).replace('/media/fetch-data/', '')
	const params = new URLSearchParams(decodeURIComponent(path))
	return new URL(params.get('url') ?? '')
}

// ---- searchTMDB ----

test('searchTMDB maps the type, hits TMDB search, and slices to numResults', async () => {
	fetchMock.mockResolvedValue(
		proxyJson({ results: [{ id: 1 }, { id: 2 }, { id: 3 }] }),
	)

	const results = await searchTMDB('cowboy bebop', 'TV Series', 2)

	expect(fetchMock).toHaveBeenCalledTimes(1)
	const url = upstreamUrl(fetchMock.mock.calls[0])
	expect(url.hostname).toBe('api.themoviedb.org')
	expect(url.pathname).toBe('/3/search/tv')
	expect(results).toEqual([{ id: 1 }, { id: 2 }])
})

test('searchTMDB returns all results when numResults is omitted', async () => {
	fetchMock.mockResolvedValue(proxyJson({ results: [{ id: 1 }, { id: 2 }] }))

	const results = await searchTMDB('dune', 'movie')

	expect(upstreamUrl(fetchMock.mock.calls[0]).pathname).toBe('/3/search/movie')
	expect(results).toEqual([{ id: 1 }, { id: 2 }])
})

test('searchTMDB falls back to the multi endpoint for an unrecognized type', async () => {
	fetchMock.mockResolvedValue(proxyJson({ results: [] }))

	await searchTMDB('inception', 'something-else')

	expect(upstreamUrl(fetchMock.mock.calls[0]).pathname).toBe('/3/search/multi')
})

test('searchTMDB escapes the query so it cannot inject extra params', async () => {
	fetchMock.mockResolvedValue(proxyJson({ results: [] }))

	await searchTMDB('a&api_key=evil', 'movie', 5)

	const url = upstreamUrl(fetchMock.mock.calls[0])
	// the entire term stays inside the single `query` param; no `api_key` leaks in as its own
	expect(url.searchParams.get('query')).toBe('a&api_key=evil')
	expect(url.searchParams.get('api_key')).toBeNull()
})

test('searchTMDB returns undefined when the fetch fails', async () => {
	fetchMock.mockRejectedValueOnce(new Error('network down'))
	const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

	const results = await searchTMDB('x', 'movie')

	expect(results).toBeUndefined()
	consoleError.mockRestore()
})

test('TMDB movie details hydrate other titles in the same collection', async () => {
	fetchMock
		.mockResolvedValueOnce(
			proxyJson({
				id: 10,
				title: 'First Franchise Movie',
				poster_path: '/first.jpg',
				overview: 'The first entry.',
				release_date: '2020-01-01',
				runtime: 120,
				vote_average: 8,
				original_language: 'en',
				genres: [],
				belongs_to_collection: { id: 55, name: 'Franchise Collection' },
			}),
		)
		.mockResolvedValueOnce(
			proxyJson({
				id: 55,
				parts: [
					{ id: 10, title: 'First Franchise Movie' },
					{
						id: 11,
						title: 'Second Franchise Movie',
						poster_path: '/second.jpg',
						release_date: '2023-06-01',
					},
				],
			}),
		)
		.mockResolvedValueOnce(proxyJson({ results: [] }))

	const result = (await getTMDBInfo(10, 'movie')) as any

	expect(fetchMock).toHaveBeenCalledTimes(3)
	expect(upstreamUrl(fetchMock.mock.calls[0]).pathname).toBe('/3/movie/10')
	expect(upstreamUrl(fetchMock.mock.calls[1]).pathname).toBe('/3/collection/55')
	expect(upstreamUrl(fetchMock.mock.calls[2]).pathname).toBe(
		'/3/movie/10/release_dates',
	)
	expect(result.mediaRelations).toEqual([
		{
			relationType: 'franchise',
			targetIdentity: {
				provider: 'tmdb',
				kind: 'movie',
				externalId: '11',
			},
			targetCatalog: {
				title: 'Second Franchise Movie',
				type: 'Movie',
				releaseStart: new Date('2023-06-01'),
				thumbnail:
					'https://www.themoviedb.org/t/p/w600_and_h900_bestv2/second.jpg|https://www.themoviedb.org/movie/11',
			},
		},
	])
})

// ---- searchMAL ----

test('searchMAL unwraps node objects, slices, and hits the MAL search endpoint', async () => {
	fetchMock.mockResolvedValue(
		proxyJson({
			data: [{ node: { id: 1 } }, { node: { id: 2 } }, { node: { id: 3 } }],
		}),
	)

	const results = await searchMAL('naruto', 'anime', 2)

	const url = upstreamUrl(fetchMock.mock.calls[0])
	expect(url.hostname).toBe('api.myanimelist.net')
	expect(url.pathname).toBe('/v2/anime')
	expect(results).toEqual([{ id: 1 }, { id: 2 }])
})

test('searchMAL escapes the query so it cannot inject extra params', async () => {
	fetchMock.mockResolvedValue(proxyJson({ data: [] }))

	await searchMAL('a&limit=999', 'anime', 5)

	const url = upstreamUrl(fetchMock.mock.calls[0])
	expect(url.searchParams.get('q')).toBe('a&limit=999')
	// the effective limit is the one the helper set (5), not the injected 999
	expect(url.searchParams.get('limit')).toBe('5')
})

test('MAL detail formatting preserves canonical related-work identities', async () => {
	const result = await formatMangaInfo(
		{
			id: 1,
			title: 'Source manga',
			media_type: 'manga',
			start_date: '2020-01-01',
			main_picture: { large: 'https://example.com/source.jpg' },
			genres: [],
			serialization: [],
			authors: [],
			num_chapters: 10,
			num_volumes: 2,
			mean: 8,
			synopsis: 'A source story.',
			related_anime: [
				{
					relation_type: 'adaptation',
					node: {
						id: 2,
						title: 'Anime adaptation',
						main_picture: { medium: 'https://example.com/anime.jpg' },
					},
				},
			],
			related_manga: [],
		},
		false,
	)

	expect(result.mediaRelations).toEqual([
		{
			relationType: 'adaptation',
			targetIdentity: {
				provider: 'mal',
				kind: 'anime',
				externalId: '2',
			},
			targetCatalog: {
				title: 'Anime adaptation',
				thumbnail:
					'https://example.com/anime.jpg|https://myanimelist.net/anime/2',
			},
		},
	])
})

// ---- getAnilistSchedule ----

test('only current and announced anime request an upcoming schedule', () => {
	expect(animeStatusHasUpcomingSchedule('currently_airing')).toBe(true)
	expect(animeStatusHasUpcomingSchedule('not_yet_aired')).toBe(true)
	expect(animeStatusHasUpcomingSchedule('finished_airing')).toBe(false)
	expect(animeStatusHasUpcomingSchedule(undefined)).toBe(false)
})

test('getAnilistSchedule derives nextRelease from nextAiringEpisode', async () => {
	const media = {
		nextAiringEpisode: {
			airingAt: 0,
			timeUntilAiring: 3600,
			episode: 12,
			mediaId: 999,
		},
		streamingEpisodes: [
			{ title: 'Episode 12 - The One', thumbnail: '', url: '', site: '' },
		],
		duration: 24,
		coverImage: {
			extraLarge: 'https://img/xl.jpg',
			large: '',
			medium: '',
			color: '',
		},
	}
	fetchMock.mockResolvedValue(proxyJson({ data: { Media: media } }))

	const next = (await getAnilistSchedule(999)) as any

	expect(next.episode).toBe(12)
	expect(next.id).toBe(999)
	expect(next.name).toBe('Episode 12 - The One')
	expect(next.runtime).toBe(24)
	expect(next.releaseDate).toBeInstanceOf(Date)
	// timeUntilAiring is 3600s, so releaseDate should be ~1 hour out (wide tolerance for timing)
	const deltaMs = next.releaseDate.getTime() - Date.now()
	expect(deltaMs).toBeGreaterThan(3_500_000)
	expect(deltaMs).toBeLessThan(3_700_000)
})
