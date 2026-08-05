import { expect, test } from 'vitest'
import {
	chooseUniqueTmdbMatch,
	normalizeTitle,
	searchTitles,
	type TmdbCandidate,
} from './tmdb-anime-match.server.ts'

function candidate(overrides: Partial<TmdbCandidate> & { id: number }) {
	return {
		name: null,
		originalName: null,
		firstAirYear: null,
		...overrides,
	} satisfies TmdbCandidate
}

test('normalizes punctuation, case and accents so titles still compare equal', () => {
	expect(normalizeTitle("Frieren: Beyond Journey's End")).toBe(
		'frieren beyond journey s end',
	)
	expect(normalizeTitle('Pokémon')).toBe(normalizeTitle('Pokemon'))
	expect(normalizeTitle('  Gintama°  ')).toBe('gintama')
})

test('matches an alternate title, not only the canonical one', () => {
	const match = chooseUniqueTmdbMatch(
		['Sousou no Frieren', "Frieren: Beyond Journey's End"],
		'2023',
		[
			candidate({
				id: 209867,
				name: "Frieren: Beyond Journey's End",
				firstAirYear: '2023',
			}),
		],
	)
	expect(match).toEqual({
		tmdbId: 209867,
		name: "Frieren: Beyond Journey's End",
	})
})

test('refuses a candidate whose year disagrees', () => {
	expect(
		chooseUniqueTmdbMatch(['Vinland Saga'], '2019', [
			candidate({ id: 1, name: 'Vinland Saga', firstAirYear: '2023' }),
		]),
	).toBeNull()
})

test('accepts a candidate when either side has no year to disagree with', () => {
	expect(
		chooseUniqueTmdbMatch(['Vinland Saga'], '2019', [
			candidate({ id: 1, name: 'Vinland Saga', firstAirYear: null }),
		]),
	).toEqual({ tmdbId: 1, name: 'Vinland Saga' })
	expect(
		chooseUniqueTmdbMatch(['Vinland Saga'], null, [
			candidate({ id: 1, name: 'Vinland Saga', firstAirYear: '2019' }),
		]),
	).toEqual({ tmdbId: 1, name: 'Vinland Saga' })
})

test('refuses when two distinct entries both match, rather than picking one', () => {
	expect(
		chooseUniqueTmdbMatch(['Ranma ½'], '1989', [
			candidate({ id: 1, name: 'Ranma ½', firstAirYear: '1989' }),
			candidate({ id: 2, name: 'Ranma 1/2', firstAirYear: '1989' }),
		]),
	).toBeNull()
})

test('the same entry found through several titles is still one match', () => {
	expect(
		chooseUniqueTmdbMatch(['Attack on Titan', 'Shingeki no Kyojin'], '2013', [
			candidate({ id: 1429, name: 'Attack on Titan', firstAirYear: '2013' }),
			candidate({
				id: 1429,
				name: 'Attack on Titan',
				originalName: '進撃の巨人',
				firstAirYear: '2013',
			}),
		]),
	).toEqual({ tmdbId: 1429, name: 'Attack on Titan' })
})

test('refuses a partial title match, so a sequel never matches its parent', () => {
	expect(
		chooseUniqueTmdbMatch(['Fruits Basket 1st Season'], '2019', [
			candidate({ id: 1, name: 'Fruits Basket', firstAirYear: '2019' }),
		]),
	).toBeNull()
})

test('refuses when there is nothing to match on', () => {
	expect(chooseUniqueTmdbMatch([], '2019', [])).toBeNull()
	expect(chooseUniqueTmdbMatch(['   '], '2019', [])).toBeNull()
	expect(chooseUniqueTmdbMatch(['Vinland Saga'], '2019', [])).toBeNull()
})

test('refuses a candidate whose id could not be a TMDB id', () => {
	// One at a time: together they would be three distinct ids and be refused as
	// ambiguous even without the check being made.
	for (const id of [0, -3, 1.5, Number.NaN]) {
		expect(
			chooseUniqueTmdbMatch(['Vinland Saga'], null, [
				candidate({ id, name: 'Vinland Saga' }),
			]),
		).toBeNull()
	}
})

test('matches on the original name when the display name differs', () => {
	expect(
		chooseUniqueTmdbMatch(['Sousou no Frieren'], null, [
			candidate({
				id: 7,
				name: "Frieren: Beyond Journey's End",
				originalName: 'Sousou no Frieren',
			}),
		]),
	).toEqual({ tmdbId: 7, name: "Frieren: Beyond Journey's End" })
})

test('search titles keep the canonical first and drop equivalent repeats', () => {
	expect(
		searchTitles('Sousou no Frieren', [
			'  sousou no frieren  ',
			"Frieren: Beyond Journey's End",
			'',
			'葬送のフリーレン',
		]),
	).toEqual([
		'Sousou no Frieren',
		"Frieren: Beyond Journey's End",
		'葬送のフリーレン',
	])
})

test('keeps Japanese titles intact, including voiced marks', () => {
	expect(normalizeTitle('葬送のフリーレン')).toBe('葬送のフリーレン')
	// NFKD splits the dakuten off as a combining mark, which is neither a letter
	// nor a digit; without recomposing, ゴ would be torn into コ plus a gap.
	expect(normalizeTitle('ドラゴンボール')).toBe('ドラゴンボール')
})

test('matches on a native-language alternate title', () => {
	expect(
		chooseUniqueTmdbMatch(['Shingeki no Kyojin', '進撃の巨人'], '2013', [
			candidate({
				id: 1429,
				name: 'Attack on Titan',
				originalName: '進撃の巨人',
				firstAirYear: '2013',
			}),
		]),
	).toEqual({ tmdbId: 1429, name: 'Attack on Titan' })
})
