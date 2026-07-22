/**
 * Route test for update-settings
 * (app/routes/lists+/.fetch+/update-settings.$request.ts).
 *
 * Verifies the 2.3 mass-assignment fix: whitelisted fields (name, header, …) are applied,
 * while any other client-supplied key (ownerId, id, typeId, …) is ignored, so a client
 * can't reassign ownership or otherwise mutate system fields through the settings form.
 */
import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { action } from '#app/routes/lists+/.fetch+/update-settings.$request.ts'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'

async function createUserRecord() {
	const suffix = faker.string.alphanumeric({ length: 12 }).toLowerCase()
	return prisma.user.create({
		data: { email: `${suffix}@example.com`, username: `u_${suffix}` },
		select: { id: true },
	})
}

async function authedRequestFor(userId: string) {
	const session = await prisma.session.create({
		data: { userId, expirationDate: getSessionExpirationDate() },
		select: { id: true },
	})
	const cookie = await getSessionCookieHeader(session)
	return new Request(BASE_URL, { method: 'POST', headers: { cookie } })
}

// Owner + one watchlist with a known starting name, so changes are observable.
async function seedOwnedWatchlist() {
	const suffix = faker.string.alphanumeric({ length: 12 }).toLowerCase()
	const owner = await prisma.user.create({
		data: {
			email: `${suffix}@example.com`,
			username: `u_${suffix}`,
			watchlists: {
				create: {
					name: 'original-name',
					header: 'Original Header',
					type: {
						create: {
							name: `LiveAction ${suffix}`,
							header: 'LiveAction',
							columns: JSON.stringify({ position: 'number', title: 'string' }),
							mediaType: 'liveAction',
							completionType: 'watched',
						},
					},
				},
			},
		},
		select: { id: true, watchlists: { select: { id: true, typeId: true } } },
	})
	const wl = owner.watchlists[0]
	if (!wl) throw new Error('test setup: watchlist was not created')
	return { userId: owner.id, watchlistId: wl.id }
}

function settingsParams(listId: string, pairs: Array<[string, unknown]>) {
	return new URLSearchParams({
		listId,
		settings: JSON.stringify(pairs),
	}).toString()
}

test('applies whitelisted settings', async () => {
	const { userId, watchlistId } = await seedOwnedWatchlist()
	const request = await authedRequestFor(userId)

	await action({
		request,
		params: {
			request: settingsParams(watchlistId, [
				['name', 'renamed'],
				['header', 'New Header'],
				['isPublic', false],
				['defaultSortColumn', 'title'],
				['defaultSortDirection', 'desc'],
			]),
		},
	} as any)

	const wl = await prisma.watchlist.findUnique({ where: { id: watchlistId } })
	expect(wl?.name).toBe('renamed')
	expect(wl?.header).toBe('New Header')
	expect(wl?.isPublic).toBe(false)
	expect(wl?.defaultSortColumn).toBe('title')
	expect(wl?.defaultSortDirection).toBe('desc')
})

test.each([
	['defaultSortColumn', 'ownerId', 'Invalid default sort column'],
	['defaultSortDirection', 'sideways', 'Invalid default sort direction'],
] as const)('rejects invalid %s values', async (key, value, message) => {
	const { userId, watchlistId } = await seedOwnedWatchlist()
	const request = await authedRequestFor(userId)

	const response = await action({
		request,
		params: {
			request: settingsParams(watchlistId, [[key, value]]),
		},
	} as any).catch(error => error)

	expect(response).toBeInstanceOf(Response)
	expect((response as Response).status).toBe(400)
	expect(await (response as Response).text()).toBe(message)
})

test('visibility changes hide linked and legacy list activity', async () => {
	const { userId, watchlistId } = await seedOwnedWatchlist()
	const request = await authedRequestFor(userId)
	const watchlist = await prisma.watchlist.findUniqueOrThrow({
		where: { id: watchlistId },
	})
	const media = await prisma.media.create({
		data: { kind: 'movie', title: 'Private activity fixture' },
	})
	const state = await prisma.trackingState.create({
		data: {
			ownerId: userId,
			mediaId: media.id,
			status: 'watching',
			statusWatchlistId: watchlistId,
		},
	})
	const [linked, legacy] = await Promise.all([
		prisma.activityEvent.create({
			data: {
				type: 'status',
				actorId: userId,
				mediaId: media.id,
				trackingStateId: state.id,
				statusLabel: watchlist.header,
				statusWatchlistId: watchlistId,
			},
		}),
		prisma.activityEvent.create({
			data: {
				type: 'score',
				actorId: userId,
				mediaId: media.id,
				trackingStateId: state.id,
				statusLabel: watchlist.header,
			},
		}),
	])

	await action({
		request,
		params: {
			request: settingsParams(watchlistId, [['isPublic', false]]),
		},
	} as any)
	expect(
		await prisma.activityEvent.findMany({
			where: { id: { in: [linked.id, legacy.id] } },
			orderBy: { id: 'asc' },
			select: { isPublic: true },
		}),
	).toEqual([{ isPublic: false }, { isPublic: false }])

	await action({
		request,
		params: {
			request: settingsParams(watchlistId, [['isPublic', true]]),
		},
	} as any)
	expect(
		await prisma.activityEvent.findUniqueOrThrow({
			where: { id: linked.id },
			select: { isPublic: true },
		}),
	).toEqual({ isPublic: true })
	expect(
		await prisma.activityEvent.findUniqueOrThrow({
			where: { id: legacy.id },
			select: { isPublic: true },
		}),
	).toEqual({ isPublic: false })
})

test('rejects non-boolean visibility values', async () => {
	const { userId, watchlistId } = await seedOwnedWatchlist()
	const request = await authedRequestFor(userId)
	const response = await action({
		request,
		params: {
			request: settingsParams(watchlistId, [['isPublic', 'false']]),
		},
	} as any).catch(error => error)
	expect(response).toBeInstanceOf(Response)
	expect((response as Response).status).toBe(400)
})

test('ignores non-whitelisted fields so ownership/id cannot be reassigned', async () => {
	const { userId, watchlistId } = await seedOwnedWatchlist()
	const attacker = await createUserRecord()
	const request = await authedRequestFor(userId)

	await action({
		request,
		params: {
			request: settingsParams(watchlistId, [
				['name', 'renamed'],
				['ownerId', attacker.id],
				['id', 'hacked-id'],
			]),
		},
	} as any)

	// findUnique by the ORIGINAL id still resolves — proving id was not rewritten — and the
	// owner is unchanged, while the whitelisted name change did go through.
	const wl = await prisma.watchlist.findUnique({ where: { id: watchlistId } })
	expect(wl?.id).toBe(watchlistId)
	expect(wl?.ownerId).toBe(userId)
	expect(wl?.name).toBe('renamed')
})

test('a logged-in non-owner cannot change settings (404)', async () => {
	const { watchlistId } = await seedOwnedWatchlist()
	const other = await createUserRecord()
	const request = await authedRequestFor(other.id)

	const res = await action({
		request,
		params: {
			request: settingsParams(watchlistId, [['name', 'hacked']]),
		},
	} as any).catch(e => e)

	expect(res).toBeInstanceOf(Response)
	expect((res as Response).status).toBe(404)

	const wl = await prisma.watchlist.findUnique({ where: { id: watchlistId } })
	expect(wl?.name).toBe('original-name')
})
