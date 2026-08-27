import { expect, test } from 'vitest'
import { ALL_MEDIA_TYPES } from '#app/components/search-add-watchlist-entry.tsx'
import { tmdbSearchKind } from './tmdb.ts'

/**
 * Which TMDB endpoint a chosen search type reaches.
 *
 * `multi` is the only one that returns films and series together. Narrowing to
 * `movie` or `tv` makes the other kind unreachable — correct when someone asked
 * for it, a trap when they cannot ask for anything else.
 */

test('the default search type reaches both films and series', () => {
	// The whole point: there must be a reachable value that lands on `multi`.
	// Without one, a film sharing a name with a series simply cannot be found.
	expect(tmdbSearchKind(ALL_MEDIA_TYPES)).toBe('multi')
})

test('narrowing to one kind searches only that kind', () => {
	expect(tmdbSearchKind('Movie')).toBe('movie')
	expect(tmdbSearchKind('TV Series')).toBe('tv')
})

test('an unrecognised type widens rather than narrowing', () => {
	// Falling back to one endpoint would hide half the catalog on a typo.
	expect(tmdbSearchKind('')).toBe('multi')
	expect(tmdbSearchKind('Type')).toBe('multi')
	expect(tmdbSearchKind('anything else')).toBe('multi')
})
