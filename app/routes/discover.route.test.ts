import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { loader } from './discover.tsx'

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
