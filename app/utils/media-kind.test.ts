import { expect, test } from 'vitest'
import {
	listTypeNameForMediaKind,
	mediaKindMatchesListType,
	providerMatchesMediaKind,
} from './media-kind.ts'

test('maps every supported media kind to its one compatible list type', () => {
	expect(
		['movie', 'tv', 'anime', 'manga'].map(kind => [
			kind,
			listTypeNameForMediaKind(kind),
		]),
	).toEqual([
		['movie', 'liveaction'],
		['tv', 'liveaction'],
		['anime', 'anime'],
		['manga', 'manga'],
	])
	expect(mediaKindMatchesListType('anime', 'liveaction')).toBe(false)
	expect(mediaKindMatchesListType('unknown', 'anime')).toBe(false)
})

test('accepts media kinds only from their canonical provider', () => {
	expect(providerMatchesMediaKind('tmdb', 'movie')).toBe(true)
	expect(providerMatchesMediaKind('tmdb', 'tv')).toBe(true)
	expect(providerMatchesMediaKind('mal', 'anime')).toBe(true)
	expect(providerMatchesMediaKind('mal', 'manga')).toBe(true)
	expect(providerMatchesMediaKind('tmdb', 'anime')).toBe(false)
	expect(providerMatchesMediaKind('mal', 'movie')).toBe(false)
})
