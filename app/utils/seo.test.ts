import { expect, test } from 'vitest'
import {
	absoluteUrl,
	isoDate,
	MAX_SOCIAL_DESCRIPTION,
	openGraphType,
	originFromMatches,
	schemaTypeForKind,
	socialDescription,
	socialMeta,
	splitGenres,
	structuredData,
	withoutEmptyValues,
} from './seo.ts'

function contentOf(tags: ReturnType<typeof socialMeta>, key: string) {
	const tag = tags.find(
		candidate =>
			(candidate as { property?: string }).property === key ||
			(candidate as { name?: string }).name === key,
	)
	return (tag as { content?: string } | undefined)?.content
}

test('a card carries the same facts in both vocabularies', () => {
	// Most chat apps read OpenGraph and several read only Twitter's tags, so
	// both are emitted — and they must not be able to disagree.
	const tags = socialMeta({
		title: 'Frieren | Veud',
		description: 'An elf outlives her party.',
		url: 'https://veud.example/media/abc',
		image: 'https://cdn.example/cover.jpg',
	})
	for (const [og, twitter] of [
		['og:title', 'twitter:title'],
		['og:description', 'twitter:description'],
		['og:image', 'twitter:image'],
	]) {
		expect(contentOf(tags, og)).toBe(contentOf(tags, twitter))
		expect(contentOf(tags, og)).toBeTruthy()
	}
})

test('artwork decides whether the card is large or small', () => {
	// A card with artwork is shown large; one without is a small summary, and
	// claiming the large form with no image renders as a broken box.
	expect(
		contentOf(
			socialMeta({ title: 't', description: 'd', url: null, image: null }),
			'twitter:card',
		),
	).toBe('summary')
	expect(
		contentOf(
			socialMeta({
				title: 't',
				description: 'd',
				url: null,
				image: 'https://cdn.example/a.jpg',
			}),
			'twitter:card',
		),
	).toBe('summary_large_image')
})

test('no image means no image tags at all, never an empty one', () => {
	const tags = socialMeta({
		title: 't',
		description: 'd',
		url: 'https://veud.example/x',
		image: null,
	})
	expect(contentOf(tags, 'og:image')).toBeUndefined()
	expect(contentOf(tags, 'twitter:image')).toBeUndefined()
})

test('a canonical link accompanies the url, and neither appears without it', () => {
	// The same page is reachable with tracking parameters attached, and every
	// one of those is a duplicate as far as a search engine is concerned.
	const withUrl = socialMeta({
		title: 't',
		description: 'd',
		url: 'https://veud.example/media/abc',
	})
	expect(withUrl).toContainEqual({
		tagName: 'link',
		rel: 'canonical',
		href: 'https://veud.example/media/abc',
	})

	const withoutUrl = socialMeta({ title: 't', description: 'd', url: null })
	expect(
		withoutUrl.some(tag => (tag as { tagName?: string }).tagName === 'link'),
	).toBe(false)
	expect(contentOf(withoutUrl, 'og:url')).toBeUndefined()
})

test('provider markup does not reach a card as literal angle brackets', () => {
	expect(
		socialDescription('A synopsis.<br><br>Then more &mdash; and more.', 'x'),
	).toBe('A synopsis. Then more — and more.')
})

test('a description is cut at a word boundary and marked', () => {
	const long = `${'word '.repeat(100)}end`
	const result = socialDescription(long, 'fallback')
	expect(result.length).toBeLessThanOrEqual(MAX_SOCIAL_DESCRIPTION + 1)
	expect(result.endsWith('…')).toBe(true)
	expect(result).not.toMatch(/wor…$/)
})

test('an empty description falls back rather than going out blank', () => {
	// A card with no description looks broken; a generic one only looks plain.
	expect(socialDescription(null, 'fallback')).toBe('fallback')
	expect(socialDescription('   ', 'fallback')).toBe('fallback')
	expect(socialDescription('<p></p>', 'fallback')).toBe('fallback')
})

test('urls are made absolute, and only ones a crawler would fetch', () => {
	const origin = 'https://veud.example'
	expect(absoluteUrl(origin, '/media/abc')).toBe(
		'https://veud.example/media/abc',
	)
	// Provider artwork already arrives absolute and is passed through.
	expect(absoluteUrl(origin, 'https://cdn.example/a.jpg')).toBe(
		'https://cdn.example/a.jpg',
	)
	expect(absoluteUrl(origin, null)).toBeNull()
	expect(absoluteUrl(origin, '')).toBeNull()
	// Not something to hand to a crawler, whoever wrote the row.
	expect(absoluteUrl(origin, 'javascript:alert(1)')).toBeNull()
	expect(absoluteUrl(origin, 'data:text/html,<script>')).toBeNull()
})

test('the origin comes from the root match, and its absence is not a crash', () => {
	expect(
		originFromMatches([
			{ id: 'routes/media+/$mediaId', loaderData: {} },
			{
				id: 'root',
				loaderData: { requestInfo: { origin: 'https://veud.example' } },
			},
		]),
	).toBe('https://veud.example')
	// An error boundary renders with no root loader data.
	expect(originFromMatches([{ id: 'root' }])).toBe('')
	expect(originFromMatches([])).toBe('')
})

test('kinds map to the vocabulary each consumer understands', () => {
	expect(schemaTypeForKind('movie')).toBe('Movie')
	expect(schemaTypeForKind('tv')).toBe('TVSeries')
	expect(schemaTypeForKind('manga')).toBe('Book')
	expect(openGraphType('movie')).toBe('video.movie')
	expect(openGraphType('tv')).toBe('video.tv_show')
	expect(openGraphType('manga')).toBe('book')
})

test('an anime film is a film, whatever the kind says', () => {
	// The kind records how a title was catalogued, not what shape it is.
	expect(schemaTypeForKind('anime', 'Movie')).toBe('Movie')
	expect(openGraphType('anime', 'Movie')).toBe('video.movie')
	expect(schemaTypeForKind('anime', 'TV')).toBe('TVSeries')
	expect(schemaTypeForKind('anime', null)).toBe('TVSeries')
	// A live-action series stays a series even if its type mentions a film.
	expect(schemaTypeForKind('tv', 'Movie')).toBe('TVSeries')
})

test('genres arrive as one string and leave as a list', () => {
	expect(splitGenres('Action, Fantasy ,Drama')).toEqual([
		'Action',
		'Fantasy',
		'Drama',
	])
	expect(splitGenres('')).toEqual([])
	expect(splitGenres(null)).toEqual([])
	expect(splitGenres(' , , ')).toEqual([])
})

test('a date becomes a date, and an unparseable one becomes nothing', () => {
	expect(isoDate(new Date('2024-09-29T12:00:00Z'))).toBe('2024-09-29')
	// Loader data arrives serialized, not as a Date.
	expect(isoDate('2024-09-29T12:00:00.000Z')).toBe('2024-09-29')
	expect(isoDate(null)).toBeNull()
	expect(isoDate('not a date')).toBeNull()
})

test('structured data says nothing rather than saying nothing loudly', () => {
	// A machine reads an empty string as a claim. Omitting the key is honest;
	// publishing `""` is not.
	expect(
		withoutEmptyValues({
			name: 'Frieren',
			description: '',
			datePublished: null,
			genre: [],
			aggregateRating: undefined,
			ratingCount: 0,
		}),
	).toEqual({ name: 'Frieren', ratingCount: 0 })
})

test('a JSON-LD block declares its context', () => {
	expect(structuredData({ '@type': 'Movie', name: 'x' })).toEqual({
		'script:ld+json': {
			'@context': 'https://schema.org',
			'@type': 'Movie',
			name: 'x',
		},
	})
})
