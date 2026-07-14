/**
 * Route test for delete-empty-rows
 * (app/routes/lists+/.fetch+/delete-empty-rows.$request.jsx).
 *
 * Verifies the 2.2 refactor: empty rows (no meaningful title/type) are removed in a single
 * atomic deleteMany, non-empty rows are kept, the removed rows are returned, and only the
 * owner can run it.
 */
import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { action } from '#app/routes/lists+/.fetch+/delete-empty-rows.$request.jsx'
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

// Seeds a watchlist with two "empty" rows (blank / whitespace-only title, no type) and one
// real row, so we can assert exactly which rows the action removes.
async function seedWatchlistWithEntries() {
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
					liveActionEntries: {
						create: [
							{ position: 1, title: '' },
							{ position: 2, title: 'Kept Movie' },
							{ position: 3, title: '   ' },
						],
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

function paramsFor(watchlistId: string, listTypeId: string) {
	return new URLSearchParams({
		watchlistId,
		listTypeData: JSON.stringify({ header: 'LiveAction', id: listTypeId }),
	}).toString()
}

test('removes only the empty rows and keeps the real one', async () => {
	const { userId, watchlistId, listTypeId } = await seedWatchlistWithEntries()
	const request = await authedRequestFor(userId)

	const removed = await action({
		request,
		params: { request: paramsFor(watchlistId, listTypeId) },
	} as any)

	expect(Array.isArray(removed)).toBe(true)
	expect((removed as unknown[]).length).toBe(2)

	const remaining = await prisma.liveActionEntry.findMany({
		where: { watchlistId },
	})
	expect(remaining.length).toBe(1)
	expect(remaining[0]?.title).toBe('Kept Movie')
})

test('a logged-in non-owner cannot delete rows (404, nothing removed)', async () => {
	const { watchlistId, listTypeId } = await seedWatchlistWithEntries()
	const other = await createUserRecord()
	const request = await authedRequestFor(other.id)

	const res = await action({
		request,
		params: { request: paramsFor(watchlistId, listTypeId) },
	} as any).catch(e => e)

	expect(res).toBeInstanceOf(Response)
	expect((res as Response).status).toBe(404)

	const remaining = await prisma.liveActionEntry.findMany({
		where: { watchlistId },
	})
	expect(remaining.length).toBe(3)
})
