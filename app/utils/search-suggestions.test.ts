import { expect, test } from 'vitest'
import {
	allResultsHref,
	clampSuggestionLimit,
	MIN_SUGGESTION_QUERY,
	moveSuggestionIndex,
	normalizeSuggestionKind,
	normalizeSuggestionQuery,
	rankSuggestions,
	suggestionHref,
	suggestionMeta,
	SUGGESTION_LIMIT,
} from './search-suggestions.ts'

test('a query is only worth running once it is long enough to mean something', () => {
	expect(normalizeSuggestionQuery('a')).toBeNull()
	expect(normalizeSuggestionQuery(' ')).toBeNull()
	expect(normalizeSuggestionQuery('')).toBeNull()
	expect(normalizeSuggestionQuery('fr')).toBe('fr')
	expect(MIN_SUGGESTION_QUERY).toBe(2)
})

test('whitespace is collapsed so the same query is not asked for twice', () => {
	expect(normalizeSuggestionQuery('  attack   on  titan ')).toBe(
		'attack on titan',
	)
	expect(normalizeSuggestionQuery('one\tpiece\n')).toBe('one piece')
})

test('a query longer than any real title is truncated, not refused', () => {
	const long = 'a'.repeat(400)
	expect(normalizeSuggestionQuery(long)).toHaveLength(100)
})

test('anything that is not text has no query in it', () => {
	for (const value of [null, undefined, 42, {}, ['frieren']]) {
		expect(normalizeSuggestionQuery(value)).toBeNull()
	}
})

test('an unknown media type widens to all rather than matching nothing', () => {
	expect(normalizeSuggestionKind('anime')).toBe('anime')
	expect(normalizeSuggestionKind('movie')).toBe('movie')
	expect(normalizeSuggestionKind('books')).toBe('all')
	expect(normalizeSuggestionKind(null)).toBe('all')
	expect(normalizeSuggestionKind(7)).toBe('all')
})

test('the caller cannot ask for more rows than the list shows', () => {
	expect(SUGGESTION_LIMIT).toBe(8)
	expect(clampSuggestionLimit(500)).toBe(8)
	expect(clampSuggestionLimit(3)).toBe(3)
	expect(clampSuggestionLimit(0)).toBe(1)
	expect(clampSuggestionLimit(-4)).toBe(1)
	expect(clampSuggestionLimit('5')).toBe(5)
	expect(clampSuggestionLimit('nonsense')).toBe(8)
})

test('an absent limit means the default, in all three of its spellings', () => {
	// A query string that omits the parameter reads as null and a blank one as
	// '', both of which Number() turns into 0 — which would clamp to one row and
	// still look like a working search bar.
	expect(clampSuggestionLimit(null)).toBe(8)
	expect(clampSuggestionLimit('')).toBe(8)
	expect(clampSuggestionLimit(undefined)).toBe(8)
})

test('arrowing down walks the list and comes back to the typed text', () => {
	expect(moveSuggestionIndex(-1, 3, 1)).toBe(0)
	expect(moveSuggestionIndex(0, 3, 1)).toBe(1)
	expect(moveSuggestionIndex(2, 3, 1)).toBe(-1)
})

test('arrowing up from the first row returns to the typed text, not the end', () => {
	// The text someone typed is never more than one key away.
	expect(moveSuggestionIndex(0, 3, -1)).toBe(-1)
	expect(moveSuggestionIndex(-1, 3, -1)).toBe(2)
	expect(moveSuggestionIndex(2, 3, -1)).toBe(1)
})

test('an empty list has nothing to highlight', () => {
	expect(moveSuggestionIndex(-1, 0, 1)).toBe(-1)
	expect(moveSuggestionIndex(0, 0, -1)).toBe(-1)
})

test('a suggestion opens its own media page, with the id escaped', () => {
	expect(suggestionHref({ id: 'abc123' })).toBe('/media/abc123')
	expect(suggestionHref({ id: 'a/b?c' })).toBe('/media/a%2Fb%3Fc')
})

test('the last row keeps the query and the chosen media type', () => {
	expect(allResultsHref('attack on titan', 'all')).toBe(
		'/discover?q=attack+on+titan',
	)
	expect(allResultsHref('frieren', 'anime')).toBe(
		'/discover?q=frieren&kind=anime',
	)
})

test('the meta line falls back to the kind when there is no type', () => {
	expect(
		suggestionMeta({
			id: '1',
			title: 'X',
			kind: 'anime',
			type: 'TV Series',
			year: '2023',
			thumbnail: null,
		}),
	).toBe('TV Series · 2023')
	expect(
		suggestionMeta({
			id: '1',
			title: 'X',
			kind: 'anime',
			type: null,
			year: null,
			thumbnail: null,
		}),
	).toBe('anime')
})

test('titles that begin with the query come first', () => {
	// The real case: searching "frieren" offered the 1998 film Savior, because
	// it carries the alternate title "Befrieren".
	const ranked = rankSuggestions(
		[
			{ title: 'Savior' },
			{ title: 'Frieren: Beyond Journeys End' },
			{ title: 'Sousou no Frieren' },
		],
		'frieren',
	)
	expect(ranked.map(item => item.title)).toEqual([
		'Frieren: Beyond Journeys End',
		'Sousou no Frieren',
		'Savior',
	])
})

test('a query starting a later word outranks one buried in a word', () => {
	const ranked = rankSuggestions(
		[{ title: 'Masterpiece Theatre' }, { title: 'One Piece' }],
		'piece',
	)
	expect(ranked.map(item => item.title)).toEqual([
		'One Piece',
		'Masterpiece Theatre',
	])
})

test('ranking reorders but never drops', () => {
	const items = [{ title: 'Alpha' }, { title: 'Beta' }, { title: 'Gamma' }]
	expect(rankSuggestions(items, 'zzz')).toHaveLength(3)
	expect(rankSuggestions(items, '')).toEqual(items)
	expect(rankSuggestions([], 'anything')).toEqual([])
})

test('within a tier the order it was given survives', () => {
	// Popularity decides among equals, and that order arrives from the database.
	const ranked = rankSuggestions(
		[
			{ title: 'Frieren Popular' },
			{ title: 'Frieren Obscure' },
			{ title: 'Frieren Rare' },
		],
		'frieren',
	)
	expect(ranked.map(item => item.title)).toEqual([
		'Frieren Popular',
		'Frieren Obscure',
		'Frieren Rare',
	])
})

test('case and punctuation do not decide the tier', () => {
	const ranked = rankSuggestions(
		[{ title: 'The One Piece' }, { title: 'ONE PIECE FILM' }],
		'one piece',
	)
	expect(ranked[0]!.title).toBe('ONE PIECE FILM')
})
