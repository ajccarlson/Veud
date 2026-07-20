import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { action } from './quick-track.ts'

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

function request(
	values: { mediaId: string; watchlistId: string },
	cookie?: string,
) {
	return new Request(`${BASE_URL}/resources/quick-track`, {
		method: 'POST',
		headers: {
			...(cookie ? { cookie } : {}),
			'content-type': 'application/x-www-form-urlencoded',
		},
		body: new URLSearchParams(values),
	})
}

async function fixture() {
	const [owner, other] = await Promise.all([
		createUser('quick_owner'),
		createUser('quick_other'),
	])
	const [animeType, liveActionType] = await Promise.all([
		prisma.listType.upsert({
			where: { name: 'anime' },
			update: {},
			create: {
				name: 'anime',
				header: 'Anime',
				columns: '{}',
				mediaType: '["episode"]',
				completionType: '{}',
			},
		}),
		prisma.listType.upsert({
			where: { name: 'liveaction' },
			update: {},
			create: {
				name: 'liveaction',
				header: 'Live Action',
				columns: '{}',
				mediaType: '["episode"]',
				completionType: '{}',
			},
		}),
	])
	const [watching, completed, wrongKind, otherList] = await Promise.all([
		prisma.watchlist.create({
			data: {
				ownerId: owner.id,
				typeId: animeType.id,
				name: 'watching',
				header: 'Watching',
				position: 1,
			},
		}),
		prisma.watchlist.create({
			data: {
				ownerId: owner.id,
				typeId: animeType.id,
				name: 'completed',
				header: 'Completed',
				position: 2,
			},
		}),
		prisma.watchlist.create({
			data: {
				ownerId: owner.id,
				typeId: liveActionType.id,
				name: 'watching',
				header: 'Watching movies',
			},
		}),
		prisma.watchlist.create({
			data: {
				ownerId: other.id,
				typeId: animeType.id,
				name: 'watching',
				header: 'Other watching',
			},
		}),
	])
	const media = await prisma.media.create({
		data: {
			kind: 'anime',
			title: 'Quick Track Fixture',
			description: 'Canonical metadata copied into the legacy list row.',
			genres: 'Adventure',
			length: '12 eps',
		},
	})
	return {
		owner,
		media,
		watching,
		completed,
		wrongKind,
		otherList,
		cookie: await cookieFor(owner.id),
	}
}

test('quick tracking requires authentication and an owned compatible watchlist', async () => {
	const { media, wrongKind, otherList, cookie } = await fixture()

	const anonymous = await action({
		request: request({ mediaId: media.id, watchlistId: otherList.id }),
		params: {},
	} as any).catch(error => error)
	expect(anonymous).toBeInstanceOf(Response)
	expect((anonymous as Response).status).toBe(302)

	for (const watchlistId of [otherList.id, wrongKind.id]) {
		const denied = await action({
			request: request({ mediaId: media.id, watchlistId }, cookie),
			params: {},
		} as any).catch(error => error)
		expect(denied).toBeInstanceOf(Response)
		expect((denied as Response).status).toBe(400)
	}
	expect(await prisma.trackingState.count()).toBe(0)
	expect(await prisma.entry.count({ where: { mediaId: media.id } })).toBe(0)
})

test('quick tracking creates a canonical list row and reuses it for status changes', async () => {
	const { owner, media, watching, completed, cookie } = await fixture()

	const created = await action({
		request: request({ mediaId: media.id, watchlistId: watching.id }, cookie),
		params: {},
	} as any)
	expect(created.data).toEqual(
		expect.objectContaining({
			ok: true,
			tracking: expect.objectContaining({
				mediaId: media.id,
				watchlistId: watching.id,
				status: 'watching',
			}),
		}),
	)
	const entry = await prisma.entry.findFirstOrThrow({
		where: { mediaId: media.id, watchlist: { ownerId: owner.id } },
	})
	expect(entry).toEqual(
		expect.objectContaining({
			watchlistId: watching.id,
			title: 'Quick Track Fixture',
			description: 'Canonical metadata copied into the legacy list row.',
			trackingStateId: expect.any(String),
		}),
	)
	const firstState = await prisma.trackingState.findUniqueOrThrow({
		where: { ownerId_mediaId: { ownerId: owner.id, mediaId: media.id } },
	})
	expect(firstState).toEqual(
		expect.objectContaining({
			status: 'watching',
			statusWatchlistId: watching.id,
		}),
	)

	await action({
		request: request({ mediaId: media.id, watchlistId: completed.id }, cookie),
		params: {},
	} as any)
	const [movedEntry, movedState] = await Promise.all([
		prisma.entry.findUniqueOrThrow({ where: { id: entry.id } }),
		prisma.trackingState.findUniqueOrThrow({ where: { id: firstState.id } }),
	])
	expect(movedEntry.watchlistId).toBe(completed.id)
	expect(movedEntry.trackingStateId).toBe(firstState.id)
	expect(movedState.status).toBe('completed')
	expect(movedState.statusWatchlistId).toBe(completed.id)
	expect(
		await prisma.activityEvent.count({
			where: { actorId: owner.id, mediaId: media.id, type: 'status' },
		}),
	).toBe(2)
})
