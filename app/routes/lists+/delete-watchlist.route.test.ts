/**
 * Route-level access-control test for a representative watchlist mutation
 * (app/routes/lists+/.fetch+/delete-watchlist.$request.ts) — proves the 0.2 fix
 * end-to-end: the action authenticates and checks ownership before mutating, and the
 * route exposes only an `action` (so a GET is a 405, not the old unauthenticated path).
 */
import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import * as deleteWatchlistRoute from '#app/routes/lists+/.fetch+/delete-watchlist.$request.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'

const { action } = deleteWatchlistRoute

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

async function seedOwnedWatchlist() {
	const suffix = faker.string.alphanumeric({ length: 12 }).toLowerCase()
	const owner = await prisma.user.create({
		data: {
			email: `${suffix}@example.com`,
			username: `u_${suffix}`,
			watchlists: {
				create: {
					name: faker.lorem.words(2),
					header: 'LiveAction',
					type: {
						create: {
							name: `LiveAction ${suffix}`,
							header: 'LiveAction',
							columns: '[]',
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
	return { userId: owner.id, watchlistId: wl.id, listTypeId: wl.typeId }
}

// Mirrors what the client sends: the route reads params.request as a query string that
// carries the watchlist id and the JSON list-type descriptor.
function requestParamFor(watchlistId: string, listTypeId: string) {
	const listTypeData = JSON.stringify({ header: 'LiveAction', id: listTypeId })
	return new URLSearchParams({ id: watchlistId, listTypeData }).toString()
}

test('delete-watchlist exposes only an action (a GET is 405, not an open endpoint)', () => {
	expect(typeof action).toBe('function')
	// No loader export -> Remix answers GET with 405, closing the old unauthenticated read.
	expect(
		(deleteWatchlistRoute as Record<string, unknown>).loader,
	).toBeUndefined()
})

test('the owner can delete their own watchlist', async () => {
	const { userId, watchlistId, listTypeId } = await seedOwnedWatchlist()
	const request = await authedRequestFor(userId)

	const result = await action({
		request,
		params: { request: requestParamFor(watchlistId, listTypeId) },
	} as any)

	expect(result).toBe(true)
	const gone = await prisma.watchlist.findUnique({ where: { id: watchlistId } })
	expect(gone).toBeNull()
})

test('deleting the current list restores a surviving private tracking status', async () => {
	const { userId, watchlistId, listTypeId } = await seedOwnedWatchlist()
	const privateList = await prisma.watchlist.create({
		data: {
			ownerId: userId,
			typeId: listTypeId,
			name: 'private-backlog',
			header: 'Private backlog',
			position: 2,
			isPublic: false,
		},
	})
	const media = await prisma.media.create({
		data: { kind: 'movie', title: 'Deletion privacy title' },
	})
	const state = await prisma.trackingState.create({
		data: {
			ownerId: userId,
			mediaId: media.id,
			status: 'public-current',
			statusWatchlistId: watchlistId,
		},
	})
	await prisma.entry.createMany({
		data: [
			{
				watchlistId,
				mediaId: media.id,
				trackingStateId: state.id,
				position: 1,
				title: media.title ?? 'Deletion privacy title',
			},
			{
				watchlistId: privateList.id,
				mediaId: media.id,
				trackingStateId: state.id,
				position: 1,
				title: media.title ?? 'Deletion privacy title',
			},
		],
	})

	await action({
		request: await authedRequestFor(userId),
		params: { request: requestParamFor(watchlistId, listTypeId) },
	} as any)

	const reconciled = await prisma.trackingState.findUniqueOrThrow({
		where: { id: state.id },
	})
	expect(reconciled.statusWatchlistId).toBe(privateList.id)
	expect(reconciled.status).toBe(privateList.name)
	const event = await prisma.activityEvent.findFirstOrThrow({
		where: { trackingStateId: state.id },
		orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
	})
	expect(event).toEqual(
		expect.objectContaining({
			statusWatchlistId: privateList.id,
			previousStatusLabel: 'LiveAction',
			previousStatusWatchlistId: null,
			isPublic: false,
		}),
	)
})

test('a logged-in non-owner cannot delete the watchlist (404, and it survives)', async () => {
	const { watchlistId, listTypeId } = await seedOwnedWatchlist()
	const other = await createUserRecord()
	const request = await authedRequestFor(other.id)

	const res = await action({
		request,
		params: { request: requestParamFor(watchlistId, listTypeId) },
	} as any).catch(e => e)

	expect(res).toBeInstanceOf(Response)
	expect((res as Response).status).toBe(404)
	const survived = await prisma.watchlist.findUnique({
		where: { id: watchlistId },
	})
	expect(survived).not.toBeNull()
})

test('an unauthenticated caller cannot delete the watchlist', async () => {
	const { watchlistId, listTypeId } = await seedOwnedWatchlist()

	const res = await action({
		request: new Request(BASE_URL, { method: 'POST' }),
		params: { request: requestParamFor(watchlistId, listTypeId) },
	} as any).catch(e => e)

	expect(res).toBeInstanceOf(Response)
	const status = (res as Response).status
	expect(status).toBeGreaterThanOrEqual(300)
	expect(status).toBeLessThan(400)
	const survived = await prisma.watchlist.findUnique({
		where: { id: watchlistId },
	})
	expect(survived).not.toBeNull()
})
