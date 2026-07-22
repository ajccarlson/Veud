import { faker } from '@faker-js/faker'
import { afterEach, expect, test, vi } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { loader } from './discover.tsx'

afterEach(() => {
	vi.unstubAllEnvs()
	vi.unstubAllGlobals()
})

async function createUser(prefix: string) {
	const suffix = faker.string.alphanumeric({ length: 10 }).toLowerCase()
	return prisma.user.create({
		data: {
			email: `${prefix}_${suffix}@example.com`,
			username: `${prefix}_${suffix}`,
		},
	})
}

async function cookieFor(userId: string) {
	const session = await prisma.session.create({
		data: { userId, expirationDate: getSessionExpirationDate() },
	})
	return getSessionCookieHeader(session)
}

test('anonymous discovery loads filters and falls back from personalized ranking', async () => {
	await prisma.media.create({
		data: { kind: 'movie', title: 'Anonymous Discovery', genres: 'Drama' },
	})

	const result = await loader({
		request: new Request(
			`${BASE_URL}/discover?q=Anonymous&kind=movie&sort=for-you`,
		),
		params: {},
	} as any)

	expect(result.data.isSignedIn).toBe(false)
	expect(result.data.filters).toEqual({
		q: 'Anonymous',
		mode: 'standard',
		kind: 'movie',
		genre: '',
		year: null,
		status: '',
		provider: 'all',
		sort: 'popular',
		page: 1,
	})
	expect(result.data.items).toEqual([
		expect.objectContaining({ title: 'Anonymous Discovery' }),
	])
	expect(result.data.genres).toEqual(['Drama'])
})

test('signed-in discovery returns unseen personalized results', async () => {
	const viewer = await createUser('discover_viewer')
	const listType = await prisma.listType.upsert({
		where: { name: 'anime' },
		update: {},
		create: {
			name: 'anime',
			header: 'Anime',
			columns: '{}',
			mediaType: '["episode"]',
			completionType: '{}',
		},
	})
	const watchlist = await prisma.watchlist.create({
		data: {
			ownerId: viewer.id,
			typeId: listType.id,
			name: 'completed',
			header: 'Completed',
		},
	})
	const [tracked, unseen] = await Promise.all([
		prisma.media.create({
			data: { kind: 'anime', title: 'Seen Fantasy', genres: 'Fantasy' },
		}),
		prisma.media.create({
			data: { kind: 'anime', title: 'Unseen Fantasy', genres: 'Fantasy' },
		}),
	])
	await prisma.trackingState.create({
		data: {
			ownerId: viewer.id,
			mediaId: tracked.id,
			status: 'completed',
			statusWatchlistId: watchlist.id,
			score: 9,
		},
	})
	const cookie = await cookieFor(viewer.id)
	const popular = await loader({
		request: new Request(`${BASE_URL}/discover`, { headers: { cookie } }),
		params: {},
	} as any)
	expect(popular.data.watchlists).toEqual([
		expect.objectContaining({ id: watchlist.id, name: 'completed' }),
	])
	expect(
		popular.data.items.find(item => item.id === tracked.id)?.viewerTracking,
	).toEqual({ status: 'completed', statusWatchlistId: watchlist.id })

	const result = await loader({
		request: new Request(`${BASE_URL}/discover?sort=for-you`, {
			headers: { cookie },
		}),
		params: {},
	} as any)

	expect(result.data.isSignedIn).toBe(true)
	expect(result.data.preferredGenres).toEqual(['Fantasy'])
	expect(result.data.items.map(item => item.id)).toEqual([unseen.id])
})

test('anonymous memory search stays catalog-local even when AI is configured', async () => {
	await Promise.all(
		Array.from({ length: 5 }, (_, index) =>
			prisma.media.create({
				data: {
					kind: 'movie',
					title: `Silver Observatory Match ${index + 1}`,
					description:
						'A child finds a silver observatory hidden beneath a desert town.',
					catalogPopularity: 100 - index,
				},
			}),
		),
	)
	vi.stubEnv('OPENAI_API_KEY', 'configured-key')
	const fetchMock = vi.fn<typeof fetch>()
	vi.stubGlobal('fetch', fetchMock)

	const result = await loader({
		request: new Request(
			`${BASE_URL}/discover?mode=memory&kind=movie&q=silver+observatory+under+a+desert+town`,
		),
		params: {},
	} as any)

	expect(fetchMock).not.toHaveBeenCalled()
	expect(result.data.aiSearchAvailable).toBe(false)
	expect(result.data.memorySearchSource).toBe('catalog-match')
	expect(result.data.memorySearchFallbackReason).toBe('sign-in-required')
	expect(result.data.items).toHaveLength(5)
	expect(result.data.items).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				title: 'Silver Observatory Match 1',
				memoryMatch: expect.objectContaining({
					matchedClues: expect.arrayContaining([
						'silver',
						'observatory',
						'desert',
					]),
				}),
			}),
		]),
	)
})
