import { expect, test } from 'vitest'
import {
	mediaIdentityForMal,
	mediaIdentityForTmdb,
	mediaIdentityFromThumbnail,
	mediaIdentityKey,
	mediaIdentityMatchesListType,
} from './media-identity.ts'

test('constructs normalized TMDB and MAL identities', () => {
	expect(mediaIdentityForTmdb(278, 'Movie')).toEqual({
		provider: 'tmdb',
		kind: 'movie',
		externalId: '278',
	})
	expect(mediaIdentityForTmdb('94605', 'TV Series')).toEqual({
		provider: 'tmdb',
		kind: 'tv',
		externalId: '94605',
	})
	expect(mediaIdentityForMal(5114, 'anime')).toEqual({
		provider: 'mal',
		kind: 'anime',
		externalId: '5114',
	})
	expect(mediaIdentityForTmdb(1, 'person')).toBeNull()
	expect(
		mediaIdentityKey({
			provider: 'mal',
			kind: 'anime',
			externalId: '5114',
		}),
	).toBe('mal:anime:5114')
})

test('extracts identities from legacy thumbnail links', () => {
	expect(
		mediaIdentityFromThumbnail(
			'https://image.example/poster.jpg|https://www.themoviedb.org/movie/278',
		),
	).toEqual({ provider: 'tmdb', kind: 'movie', externalId: '278' })
	expect(
		mediaIdentityFromThumbnail(
			'https://image.example/poster.jpg|https://myanimelist.net/anime/5114/5114/episode',
		),
	).toEqual({ provider: 'mal', kind: 'anime', externalId: '5114' })
	expect(
		mediaIdentityFromThumbnail(
			'https://image.example/poster.jpg|https://myanimelist.net/manga/2',
		),
	).toEqual({ provider: 'mal', kind: 'manga', externalId: '2' })
})

test('rejects malformed, unsupported, and mismatched identities', () => {
	expect(
		mediaIdentityFromThumbnail('https://image.example/poster.jpg'),
	).toBeNull()
	expect(
		mediaIdentityFromThumbnail(
			'https://image.example/poster.jpg|https://example.com/movie/278',
		),
	).toBeNull()
	expect(
		mediaIdentityFromThumbnail(
			'https://image.example/poster.jpg|https://themoviedb.org/movie/not-a-number',
		),
	).toBeNull()

	expect(
		mediaIdentityMatchesListType(
			{ provider: 'tmdb', kind: 'tv', externalId: '1' },
			'liveaction',
		),
	).toBe(true)
	expect(
		mediaIdentityMatchesListType(
			{ provider: 'mal', kind: 'anime', externalId: '1' },
			'manga',
		),
	).toBe(false)
})
