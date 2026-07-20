import { expect, test } from 'vitest'
import { searchResultPreview } from './search-add-watchlist-entry.tsx'

test('normalizes rich TMDB search result metadata', () => {
	expect(
		searchResultPreview(
			{
				id: 278,
				title: 'The Shawshank Redemption',
				poster_path: '/poster.jpg',
				release_date: '1994-09-23',
			},
			'liveaction',
			'Movie',
		),
	).toEqual({
		identity: { provider: 'tmdb', kind: 'movie', externalId: '278' },
		title: 'The Shawshank Redemption',
		imageUrl: 'https://www.themoviedb.org/t/p/w300_and_h450_bestv2/poster.jpg',
		year: '1994',
		mediaType: 'Movie',
		provider: 'TMDB',
	})
})

test('normalizes rich MAL search result metadata', () => {
	expect(
		searchResultPreview(
			{
				id: 5114,
				title: 'Fullmetal Alchemist: Brotherhood',
				main_picture: { large: 'https://example.com/fmab.jpg' },
				start_date: '2009-04-05',
				media_type: 'tv',
				start_season: { year: 2009, season: 'spring' },
			},
			'anime',
			'Type',
		),
	).toEqual({
		identity: { provider: 'mal', kind: 'anime', externalId: '5114' },
		title: 'Fullmetal Alchemist: Brotherhood',
		imageUrl: 'https://example.com/fmab.jpg',
		year: '2009',
		mediaType: 'TV Series',
		provider: 'MAL',
	})
})
