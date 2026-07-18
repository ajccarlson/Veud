import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { action, loader } from '#app/routes/media+/$mediaId.tsx'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'

async function user(prefix: string) {
	const suffix = faker.string.alphanumeric({ length: 10 }).toLowerCase()
	return prisma.user.create({
		data: {
			email: `${prefix}_${suffix}@example.com`,
			username: `${prefix}_${suffix}`,
		},
	})
}

async function fixture() {
	const [catalogOwner, tracker, otherUser] = await Promise.all([
		user('catalog'),
		user('tracker'),
		user('other'),
	])
	const listType = await prisma.listType.upsert({
		where: { name: 'anime' },
		update: {},
		create: {
			name: 'anime',
			header: 'Anime',
			columns: '{"length":"string"}',
			mediaType: '["episode"]',
			completionType: '{"past":"watched"}',
		},
	})
	const [catalogList, watching, completed, otherList] = await Promise.all([
		prisma.watchlist.create({
			data: {
				name: 'watching',
				header: 'Watching',
				ownerId: catalogOwner.id,
				typeId: listType.id,
			},
		}),
		prisma.watchlist.create({
			data: {
				name: 'watching',
				header: 'Watching',
				position: 1,
				ownerId: tracker.id,
				typeId: listType.id,
			},
		}),
		prisma.watchlist.create({
			data: {
				name: 'completed',
				header: 'Completed',
				position: 2,
				ownerId: tracker.id,
				typeId: listType.id,
			},
		}),
		prisma.watchlist.create({
			data: {
				name: 'watching',
				header: 'Watching',
				ownerId: otherUser.id,
				typeId: listType.id,
			},
		}),
	])
	const media = await prisma.media.create({
		data: {
			kind: 'anime',
			externalIds: {
				create: { provider: 'mal', kind: 'anime', externalId: '5114' },
			},
		},
	})
	await prisma.entry.create({
		data: {
			watchlistId: catalogList.id,
			mediaId: media.id,
			position: 1,
			title: 'Fullmetal Alchemist: Brotherhood',
			type: 'TV',
			thumbnail:
				'https://example.com/fmab.jpg|https://myanimelist.net/anime/5114',
			length: '12 eps',
			description: 'Two brothers search for the Philosopher’s Stone.',
		},
	})
	const session = await prisma.session.create({
		data: {
			userId: tracker.id,
			expirationDate: getSessionExpirationDate(),
		},
	})
	const cookie = await getSessionCookieHeader(session)
	return { media, tracker, watching, completed, otherList, cookie }
}

function actionRequest(
	mediaId: string,
	cookie: string,
	data: Record<string, string>,
) {
	return new Request(`${BASE_URL}/media/${mediaId}`, {
		method: 'POST',
		headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams(data),
	})
}

test('public media loader exposes representative catalog and community data', async () => {
	const { media } = await fixture()
	const result = await loader({
		request: new Request(`${BASE_URL}/media/${media.id}`),
		params: { mediaId: media.id },
	} as any)

	expect(result.data.media).toEqual(
		expect.objectContaining({
			id: media.id,
			kind: 'anime',
			title: 'Fullmetal Alchemist: Brotherhood',
			imageUrl: 'https://example.com/fmab.jpg',
		}),
	)
	expect(result.data.media.externalLinks).toEqual([
		expect.objectContaining({
			provider: 'mal',
			url: 'https://myanimelist.net/anime/5114',
		}),
	])
	expect(result.data.community).toEqual({
		trackers: 0,
		ratings: 0,
		meanScore: null,
	})
	expect(result.data.viewer).toBeNull()
})

test('tracking controls create and dual-write status, score, and progress', async () => {
	const { media, tracker, watching, completed, cookie } = await fixture()
	await action({
		request: actionRequest(media.id, cookie, {
			intent: 'status',
			watchlistId: watching.id,
		}),
		params: { mediaId: media.id },
	} as any)

	let entry = await prisma.entry.findFirstOrThrow({
		where: { mediaId: media.id, watchlist: { ownerId: tracker.id } },
	})
	let state = await prisma.trackingState.findUniqueOrThrow({
		where: { ownerId_mediaId: { ownerId: tracker.id, mediaId: media.id } },
	})
	expect(entry.watchlistId).toBe(watching.id)
	expect(entry.trackingStateId).toBe(state.id)
	expect(state.status).toBe('watching')

	await action({
		request: actionRequest(media.id, cookie, {
			intent: 'score',
			score: '8.5',
		}),
		params: { mediaId: media.id },
	} as any)
	await action({
		request: actionRequest(media.id, cookie, {
			intent: 'progress',
			unit: 'episode',
			current: '3',
		}),
		params: { mediaId: media.id },
	} as any)
	await action({
		request: actionRequest(media.id, cookie, {
			intent: 'status',
			watchlistId: completed.id,
		}),
		params: { mediaId: media.id },
	} as any)

	entry = await prisma.entry.findUniqueOrThrow({ where: { id: entry.id } })
	const finalState = await prisma.trackingState.findUniqueOrThrow({
		where: { id: state.id },
		include: { progress: true },
	})
	expect(entry.watchlistId).toBe(completed.id)
	expect(Number(entry.personal)).toBe(8.5)
	expect(entry.length).toBe('3 / 12 eps')
	expect(
		(JSON.parse(entry.history ?? '{}') as any).progress[3].finishDate,
	).toHaveLength(1)
	expect(finalState.status).toBe('completed')
	expect(finalState.statusWatchlistId).toBe(completed.id)
	expect(Number(finalState.score)).toBe(8.5)
	expect(finalState.progress).toEqual([
		expect.objectContaining({ unit: 'episode', current: 3, total: 12 }),
	])

	const loaded = await loader({
		request: new Request(`${BASE_URL}/media/${media.id}`, {
			headers: { cookie },
		}),
		params: { mediaId: media.id },
	} as any)
	expect(loaded.data.community).toEqual({
		trackers: 1,
		ratings: 1,
		meanScore: 8.5,
	})
	expect(loaded.data.viewer?.tracking).toEqual(
		expect.objectContaining({
			status: 'completed',
			score: 8.5,
			progress: [expect.objectContaining({ unit: 'episode', current: 3 })],
		}),
	)
})

test('status action rejects a watchlist owned by someone else', async () => {
	const { media, tracker, otherList, cookie } = await fixture()
	const result = await action({
		request: actionRequest(media.id, cookie, {
			intent: 'status',
			watchlistId: otherList.id,
		}),
		params: { mediaId: media.id },
	} as any).catch(error => error)

	expect(result).toBeInstanceOf(Response)
	expect((result as Response).status).toBe(400)
	expect(
		await prisma.entry.count({
			where: { mediaId: media.id, watchlist: { ownerId: tracker.id } },
		}),
	).toBe(0)
})
