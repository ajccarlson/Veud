import { expect, test } from 'vitest'
import { normalizeTitleLanguage, resolveDisplayTitle } from './media-title.ts'

const anime = {
	kind: 'anime',
	title: 'Shingeki no Kyojin',
	englishTitle: 'Attack on Titan',
}

test('the preference is honoured for the kinds that have an alternate', () => {
	expect(resolveDisplayTitle(anime, 'english')).toBe('Attack on Titan')
	expect(resolveDisplayTitle(anime, 'default')).toBe('Shingeki no Kyojin')
	// No preference means the provider's own title.
	expect(resolveDisplayTitle(anime)).toBe('Shingeki no Kyojin')
})

test('a film keeps its title whatever the preference says', () => {
	// TMDB already stores films and series under their English title, so there is
	// nothing to prefer. The column is carried anyway to prove the kind guard is
	// what decides — a null here would pass even if the guard were gone.
	const film = {
		kind: 'movie',
		title: 'Doctor Zhivago',
		englishTitle: 'Something Else Entirely',
	}
	expect(resolveDisplayTitle(film, 'english')).toBe('Doctor Zhivago')
	expect(
		resolveDisplayTitle(
			{ kind: 'tv', title: 'A Series', englishTitle: 'Not This' },
			'english',
		),
	).toBe('A Series')
})

test('a missing English title falls back rather than blanking the row', () => {
	// MAL supplies one for some titles and not others, so this is the common
	// case, not the exception.
	expect(resolveDisplayTitle({ ...anime, englishTitle: null }, 'english')).toBe(
		'Shingeki no Kyojin',
	)
	expect(
		resolveDisplayTitle({ ...anime, englishTitle: '   ' }, 'english'),
	).toBe('Shingeki no Kyojin')
})

test('a row with no title at all still reads as something', () => {
	expect(resolveDisplayTitle({ kind: 'manga', title: null })).toBe(
		'Untitled manga',
	)
	expect(resolveDisplayTitle({ kind: 'anime', title: '  ' }, 'english')).toBe(
		'Untitled anime',
	)
})

test('an unrecognised preference shows the provider title', () => {
	// A stored value from an older release, or anything unexpected, must not
	// change what anybody sees.
	expect(normalizeTitleLanguage('english')).toBe('english')
	expect(normalizeTitleLanguage('romaji')).toBe('default')
	expect(normalizeTitleLanguage(undefined)).toBe('default')
	expect(normalizeTitleLanguage(null)).toBe('default')
})
