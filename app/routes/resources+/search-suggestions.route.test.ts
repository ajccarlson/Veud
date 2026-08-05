import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { prisma } from '#app/utils/db.server.ts'
import { BASE_URL } from '#tests/utils.ts'
import { loader } from './search-suggestions.ts'

async function catalog(prefix: string) {
	const tag = faker.string.alphanumeric({ length: 8 }).toLowerCase()
	const title = (name: string) => `${prefix}${tag} ${name}`
	const popular = await prisma.media.create({
		data: {
			kind: 'anime',
			title: title('Popular'),
			type: 'TV Series',
			startYear: '2019',
			catalogPopularity: 900,
			description: `A show about ${prefix}${tag} obscure things`,
		},
	})
	const obscure = await prisma.media.create({
		data: {
			kind: 'anime',
			title: title('Obscure'),
			type: 'TV Series',
			startYear: '2001',
			catalogPopularity: 1,
		},
	})
	const film = await prisma.media.create({
		data: {
			kind: 'movie',
			title: title('Film'),
			type: 'Movie',
			startYear: '2011',
			catalogPopularity: 500,
		},
	})
	// Only findable by an alternate title, which is how someone searches for a
	// show under the name they know it by.
	const aliased = await prisma.media.create({
		data: {
			kind: 'anime',
			title: `${tag} Sousou no Frieren`,
			type: 'TV Series',
			catalogPopularity: 700,
			titles: {
				create: {
					provider: 'mal',
					titleType: 'english',
					value: `${tag} Beyond Journeys End`,
					normalized: `${tag} beyond journeys end`,
				},
			},
		},
	})
	return { tag, popular, obscure, film, aliased }
}

async function suggest(params: Record<string, string>) {
	const url = new URL(`${BASE_URL}/resources/search-suggestions`)
	for (const [key, value] of Object.entries(params)) {
		url.searchParams.set(key, value)
	}
	const response = await loader({
		request: new Request(url),
		params: {},
	} as any)
	return (response as any).data.suggestions as Array<{
		id: string
		title: string
	}>
}

test('suggestions come back best-known first', async () => {
	const { tag, popular, obscure } = await catalog('Rank')
	const results = await suggest({ q: `Rank${tag}` })
	const ours = results.filter(item =>
		[popular.id, obscure.id].includes(item.id),
	)
	expect(ours.map(item => item.id)).toEqual([popular.id, obscure.id])
})

test('a media type narrows the list to that type', async () => {
	const { tag, film } = await catalog('Kind')
	const films = await suggest({ q: `Kind${tag}`, kind: 'movie' })
	expect(films.map(item => item.id)).toEqual([film.id])
	const manga = await suggest({ q: `Kind${tag}`, kind: 'manga' })
	expect(manga).toEqual([])
	// An unrecognised type widens rather than matching nothing.
	const bogus = await suggest({ q: `Kind${tag}`, kind: 'vhs' })
	expect(bogus.length).toBeGreaterThan(1)
})

test('an alternate title finds the work it belongs to', async () => {
	const { tag, aliased } = await catalog('Alias')
	const results = await suggest({ q: `${tag} Beyond Journeys` })
	expect(results.map(item => item.id)).toContain(aliased.id)
})

test('a description match is not offered as a title suggestion', async () => {
	// `/discover` may match on description; a title dropdown must not, or a row
	// with no visible relationship to what was typed appears in the list.
	const { tag } = await catalog('Desc')
	const results = await suggest({ q: `Desc${tag} obscure things` })
	expect(results).toEqual([])
})

test('a query too short to mean anything asks for nothing', async () => {
	await catalog('Short')
	expect(await suggest({ q: 'a' })).toEqual([])
	expect(await suggest({ q: '  ' })).toEqual([])
	expect(await suggest({})).toEqual([])
})

test('the caller cannot widen the list past its limit', async () => {
	const { tag } = await catalog('Limit')
	await Promise.all(
		Array.from({ length: 12 }, (_, index) =>
			prisma.media.create({
				data: {
					kind: 'anime',
					title: `Limit${tag} Filler ${index}`,
					catalogPopularity: 100 + index,
				},
			}),
		),
	)
	const results = await suggest({ q: `Limit${tag}`, limit: '500' })
	expect(results).toHaveLength(8)
	const fewer = await suggest({ q: `Limit${tag}`, limit: '3' })
	expect(fewer).toHaveLength(3)
})

test('the response can be shared, since it holds no viewer data', async () => {
	const { tag } = await catalog('Cache')
	const response = await loader({
		request: new Request(
			`${BASE_URL}/resources/search-suggestions?q=Cache${tag}`,
		),
		params: {},
	} as any)
	expect((response as any).init.headers['Cache-Control']).toBe(
		'public, max-age=30',
	)
})
