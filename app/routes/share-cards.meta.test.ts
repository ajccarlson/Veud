import { expect, test } from 'vitest'
import { meta as collectionMeta } from './collections+/$collectionId.tsx'
import { meta as personMeta } from './people+/$personId.tsx'

const origin = 'https://veud.test'
const matches = [{ id: 'root', loaderData: { requestInfo: { origin } } }]

/** Meta functions are typed against their route's loader; fixtures stand in. */
function metaTagsFor(fn: unknown, loaderData: unknown) {
	const call = fn as (input: {
		loaderData: unknown
		matches: unknown
	}) => Array<Record<string, unknown>>
	return call({ loaderData, matches })
}

function tag(tags: Array<Record<string, unknown>>, key: string, name: string) {
	return tags.find(entry => entry[key] === name)?.content
}

function jsonLd(tags: Array<Record<string, unknown>>) {
	const entry = tags.find(item => 'script:ld+json' in item)
	return entry?.['script:ld+json'] as Record<string, unknown> | undefined
}

const collection = {
	id: 'coll-1',
	title: 'Films to rewatch',
	description: 'The ones that hold up.',
	isPublic: true,
	createdAt: new Date('2026-01-02T00:00:00.000Z'),
	updatedAt: new Date('2026-02-03T00:00:00.000Z'),
	owner: { id: 'u1', username: 'ana', name: 'Ana Lead' },
	items: [
		{ media: { id: 'm1', title: 'First Film', thumbnail: '/img/first.jpg' } },
		{ media: { id: 'm2', title: 'Second Film', thumbnail: '/img/second.jpg' } },
	],
}

test('a shared collection carries a card with the first title as artwork', () => {
	const tags = metaTagsFor(collectionMeta, { collection })

	expect(tag(tags, 'property', 'og:title')).toBe('Films to rewatch · Veud')
	expect(tag(tags, 'property', 'og:description')).toBe('The ones that hold up.')
	expect(tag(tags, 'property', 'og:url')).toBe(`${origin}/collections/coll-1`)
	expect(tag(tags, 'property', 'og:image')).toBe(`${origin}/img/first.jpg`)
	// Artwork is what turns a small summary into a large card.
	expect(tag(tags, 'name', 'twitter:card')).toBe('summary_large_image')
})

test('a collection with no description says what it is instead', () => {
	const tags = metaTagsFor(collectionMeta, {
		collection: { ...collection, description: null },
	})
	expect(tag(tags, 'property', 'og:description')).toBe(
		'2 titles collected by Ana Lead on Veud.',
	)
})

test('a private collection is never advertised as structured data', () => {
	// Structured data tells search engines a page exists and is worth indexing.
	// The viewer can still share the link; we just do not do it for them.
	const tags = metaTagsFor(collectionMeta, {
		collection: { ...collection, isPublic: false },
	})

	expect(jsonLd(tags)).toBeUndefined()
	// The card itself still works for the person who can see it.
	expect(tag(tags, 'property', 'og:title')).toBe('Films to rewatch · Veud')
})

test('a public collection lists its titles in order', () => {
	const data = jsonLd(metaTagsFor(collectionMeta, { collection }))
	expect(data?.['@type']).toBe('CollectionPage')
	const list = data?.mainEntity as Record<string, unknown>
	expect(list.numberOfItems).toBe(2)
	expect(list.itemListElement).toEqual([
		{
			'@type': 'ListItem',
			position: 1,
			url: `${origin}/media/m1`,
			name: 'First Film',
		},
		{
			'@type': 'ListItem',
			position: 2,
			url: `${origin}/media/m2`,
			name: 'Second Film',
		},
	])
})

const person = {
	id: 'p1',
	name: 'Ana Performer',
	imageUrl: 'https://cdn.test/ana.jpg',
	knownForDepartment: 'Acting',
	biography: 'A performer.',
	birthday: new Date('1980-04-05T00:00:00.000Z'),
	deathday: null,
	placeOfBirth: 'Lyon, France',
	homepage: 'https://ana.example',
}

test('a shared person page carries a portrait card and Person data', () => {
	const tags = metaTagsFor(personMeta, { person })

	expect(tag(tags, 'property', 'og:title')).toBe('Ana Performer | Veud')
	expect(tag(tags, 'property', 'og:type')).toBe('profile')
	expect(tag(tags, 'property', 'og:image')).toBe('https://cdn.test/ana.jpg')

	const data = jsonLd(tags)
	expect(data).toMatchObject({
		'@type': 'Person',
		name: 'Ana Performer',
		url: `${origin}/people/p1`,
		jobTitle: 'Acting',
		birthDate: '1980-04-05',
		birthPlace: 'Lyon, France',
		sameAs: ['https://ana.example'],
	})
	// Nobody has died here, so no date is claimed.
	expect(data).not.toHaveProperty('deathDate')
})

test('a person the catalog knows little about still gets a usable card', () => {
	const tags = metaTagsFor(personMeta, {
		person: {
			...person,
			imageUrl: null,
			biography: null,
			knownForDepartment: null,
			birthday: null,
			placeOfBirth: null,
			homepage: null,
		},
	})

	expect(tag(tags, 'property', 'og:description')).toBe(
		"Everything Ana Performer is credited on, across Veud's catalog.",
	)
	// No artwork means the small card, not a broken large one.
	expect(tag(tags, 'name', 'twitter:card')).toBe('summary')
	expect(jsonLd(tags)).toEqual({
		'@context': 'https://schema.org',
		'@type': 'Person',
		name: 'Ana Performer',
		url: `${origin}/people/p1`,
		description:
			"Everything Ana Performer is credited on, across Veud's catalog.",
	})
})
