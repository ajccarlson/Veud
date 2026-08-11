import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { prisma } from '#app/utils/db.server.ts'
import { type SearchSuggestion } from '#app/utils/search-suggestions.ts'
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
	return (response as any).data.suggestions as SearchSuggestion[]
}

async function personWithCredits(name: string, creditCount: number) {
	const person = await prisma.person.create({
		data: {
			name,
			normalized: name.toLowerCase(),
			knownForDepartment: 'Acting',
		},
	})
	for (let index = 0; index < creditCount; index += 1) {
		const media = await prisma.media.create({
			data: { kind: 'movie', title: `${name} work ${index}` },
		})
		await prisma.mediaCredit.create({
			data: {
				mediaId: media.id,
				personId: person.id,
				provider: 'tmdb',
				creditType: 'cast',
				role: `Role ${index}`,
			},
		})
	}
	return person
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

test('people are grouped into the shared result contract and ranked by credits', async () => {
	const tag = faker.string.alphanumeric({ length: 8 }).toLowerCase()
	const lead = await personWithCredits(`${tag} Lead`, 4)
	const extra = await personWithCredits(`${tag} Extra`, 1)

	const results = await suggest({ q: tag })
	const people = results.filter(result => result.resultType === 'person')
	expect(people.map(person => person.id)).toEqual([lead.id, extra.id])
	expect(people[0]).toMatchObject({
		label: `${tag} Lead`,
		name: `${tag} Lead`,
		knownForDepartment: 'Acting',
		creditCount: 4,
	})

	// Choosing a media kind means media of that kind, not untyped people.
	const movies = await suggest({ q: tag, kind: 'movie' })
	expect(movies.every(result => result.resultType === 'media')).toBe(true)
})

test('the shared cap reserves room for people without hiding title results', async () => {
	const tag = faker.string.alphanumeric({ length: 8 }).toLowerCase()
	await Promise.all(
		Array.from({ length: 8 }, (_, index) =>
			prisma.media.create({
				data: {
					kind: 'movie',
					title: `${tag} title ${index}`,
					catalogPopularity: 1_000 - index,
				},
			}),
		),
	)
	for (let index = 0; index < 4; index += 1) {
		await personWithCredits(`${tag} person ${index}`, 1)
	}

	const results = await suggest({ q: tag })
	expect(results).toHaveLength(8)
	expect(results.filter(result => result.resultType === 'media')).toHaveLength(
		5,
	)
	expect(results.filter(result => result.resultType === 'person')).toHaveLength(
		3,
	)
})

test('people search folds punctuation and omits identities with no credits', async () => {
	const tag = faker.string.alphanumeric({ length: 8 }).toLowerCase()
	const credited = await prisma.person.create({
		data: {
			name: `Léa ${tag}-Seydoux`,
			normalized: `lea ${tag} seydoux`,
		},
	})
	const media = await prisma.media.create({
		data: { kind: 'movie', title: `Unrelated ${faker.string.uuid()}` },
	})
	await prisma.mediaCredit.create({
		data: {
			mediaId: media.id,
			personId: credited.id,
			provider: 'tmdb',
			creditType: 'cast',
			role: 'Lead',
		},
	})
	const orphan = await prisma.person.create({
		data: {
			name: `Lea ${tag} Orphan`,
			normalized: `lea ${tag} orphan`,
		},
	})

	const results = await suggest({ q: `Lea ${tag} Seydoux` })
	expect(results.map(result => result.id)).toContain(credited.id)
	expect(results.map(result => result.id)).not.toContain(orphan.id)
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

test('a title that starts with the query beats popular interior matches', async () => {
	// Nine matches for an eight-row list. The eight popular ones match only
	// inside a longer word; the ninth starts with the query and is the least
	// popular of them all. It has to be fetched *and* ranked to be seen: taking
	// only eight rows from the database would leave it behind, and ranking
	// nothing would leave it last.
	const tag = faker.string.alphanumeric({ length: 8 }).toLowerCase()
	await Promise.all([
		...Array.from({ length: 8 }, (_, index) =>
			prisma.media.create({
				data: {
					kind: 'anime',
					title: `pre${tag} Filler ${index}`,
					catalogPopularity: 900 + index,
				},
			}),
		),
		prisma.media.create({
			data: { kind: 'anime', title: `${tag} Prefix Hit`, catalogPopularity: 1 },
		}),
	])

	const results = await suggest({ q: tag })
	expect(results).toHaveLength(8)
	expect(results[0]).toMatchObject({
		resultType: 'media',
		title: `${tag} Prefix Hit`,
	})
})
