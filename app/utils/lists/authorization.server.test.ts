/**
 * Access-control tests for the watchlist "fetch" API helpers
 * (app/utils/lists/authorization.server.ts) — the 0.2 fix.
 *
 *   - requireWatchlistOwner: the logged-in user must own the record. A non-owner gets 404
 *     (not 403) so a watchlist's existence isn't disclosed; an anonymous caller is
 *     redirected to login. (requireEntryOwner / requireFavoriteOwner share this shape and
 *     are the next tests to add.)
 */
import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import {
	requireEntryOwner,
	requireFavoriteOwner,
	requireWatchlistOwner,
	stripProtectedFields,
} from '#app/utils/lists/authorization.server.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'

// Capture a value thrown by a synchronous call.
function getThrown(fn: () => unknown): unknown {
	try {
		fn()
	} catch (e) {
		return e
	}
	throw new Error('expected the function to throw, but it returned normally')
}

// ---------- requireWatchlistOwner (session + ownership) ----------

async function createUserRecord() {
	const suffix = faker.string.alphanumeric({ length: 12 }).toLowerCase()
	return prisma.user.create({
		data: { email: `${suffix}@example.com`, username: `u_${suffix}` },
		select: { id: true },
	})
}

// Owner + their watchlist + its list type, created in a single atomic nested write.
async function createOwnerWithWatchlist() {
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
		select: { id: true, watchlists: { select: { id: true } } },
	})
	const watchlistId = owner.watchlists[0]?.id
	if (!watchlistId) throw new Error('test setup: watchlist was not created')
	return { userId: owner.id, watchlistId }
}

async function authedRequestFor(userId: string) {
	const session = await prisma.session.create({
		data: { userId, expirationDate: getSessionExpirationDate() },
		select: { id: true },
	})
	const cookie = await getSessionCookieHeader(session)
	return new Request(BASE_URL, { headers: { cookie } })
}

test('requireWatchlistOwner returns the watchlist for its owner', async () => {
	const { userId, watchlistId } = await createOwnerWithWatchlist()
	const request = await authedRequestFor(userId)

	const result = await requireWatchlistOwner(request, watchlistId)
	expect(result.userId).toBe(userId)
	expect(result.watchlist.id).toBe(watchlistId)
})

test('requireWatchlistOwner returns 404 for a logged-in non-owner', async () => {
	const { watchlistId } = await createOwnerWithWatchlist()
	const other = await createUserRecord()
	const request = await authedRequestFor(other.id)

	const res = await requireWatchlistOwner(request, watchlistId).catch(e => e)
	expect(res).toBeInstanceOf(Response)
	expect((res as Response).status).toBe(404)
})

test('requireWatchlistOwner refuses an unauthenticated caller (redirect to login)', async () => {
	const { watchlistId } = await createOwnerWithWatchlist()

	const res = await requireWatchlistOwner(
		new Request(BASE_URL),
		watchlistId,
	).catch(e => e)
	expect(res).toBeInstanceOf(Response)
	const status = (res as Response).status
	expect(status).toBeGreaterThanOrEqual(300)
	expect(status).toBeLessThan(400)
	expect((res as Response).headers.get('location')).toContain('/login')
})

// ---------- requireEntryOwner (entry -> its watchlist -> owner) ----------

async function createOwnerWithEntry() {
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
					entries: {
						create: { position: 1, title: faker.lorem.words(2) },
					},
				},
			},
		},
		select: {
			id: true,
			watchlists: { select: { entries: { select: { id: true } } } },
		},
	})
	const entryId = owner.watchlists[0]?.entries[0]?.id
	if (!entryId) throw new Error('test setup: entry was not created')
	return { userId: owner.id, entryId }
}

test('requireEntryOwner returns the entry for the owner of its watchlist', async () => {
	const { userId, entryId } = await createOwnerWithEntry()
	const request = await authedRequestFor(userId)

	const result = await requireEntryOwner(request, entryId)
	expect(result.userId).toBe(userId)
	expect(result.entry.id).toBe(entryId)
})

test('requireEntryOwner returns 404 for a logged-in non-owner', async () => {
	const { entryId } = await createOwnerWithEntry()
	const other = await createUserRecord()
	const request = await authedRequestFor(other.id)

	const res = await requireEntryOwner(request, entryId).catch(e => e)
	expect(res).toBeInstanceOf(Response)
	expect((res as Response).status).toBe(404)
})

test('requireEntryOwner returns 404 when the entry does not exist', async () => {
	const owner = await createUserRecord()
	const request = await authedRequestFor(owner.id)

	const res = await requireEntryOwner(request, 'does-not-exist').catch(e => e)
	expect(res).toBeInstanceOf(Response)
	expect((res as Response).status).toBe(404)
})

// ---------- requireFavoriteOwner ----------

async function createOwnerWithFavorite() {
	const suffix = faker.string.alphanumeric({ length: 12 }).toLowerCase()
	const owner = await prisma.user.create({
		data: {
			email: `${suffix}@example.com`,
			username: `u_${suffix}`,
			userFavorites: {
				create: {
					position: 1,
					title: faker.lorem.words(2),
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
		select: { id: true, userFavorites: { select: { id: true } } },
	})
	const favoriteId = owner.userFavorites[0]?.id
	if (!favoriteId) throw new Error('test setup: favorite was not created')
	return { userId: owner.id, favoriteId }
}

test('requireFavoriteOwner returns the favorite for its owner', async () => {
	const { userId, favoriteId } = await createOwnerWithFavorite()
	const request = await authedRequestFor(userId)

	const result = await requireFavoriteOwner(request, favoriteId)
	expect(result.userId).toBe(userId)
	expect(result.favorite.id).toBe(favoriteId)
})

test('requireFavoriteOwner returns 404 for a logged-in non-owner', async () => {
	const { favoriteId } = await createOwnerWithFavorite()
	const other = await createUserRecord()
	const request = await authedRequestFor(other.id)

	const res = await requireFavoriteOwner(request, favoriteId).catch(e => e)
	expect(res).toBeInstanceOf(Response)
	expect((res as Response).status).toBe(404)
})

test('requireFavoriteOwner returns 404 when the favorite does not exist', async () => {
	const owner = await createUserRecord()
	const request = await authedRequestFor(owner.id)

	const res = await requireFavoriteOwner(request, 'does-not-exist').catch(e => e)
	expect(res).toBeInstanceOf(Response)
	expect((res as Response).status).toBe(404)
})

// ---------- stripProtectedFields ----------

test('stripProtectedFields drops protected keys and keeps the rest', () => {
	const cleaned = stripProtectedFields(
		{ title: 'ok', id: 'x', watchlistId: 'y', rating: '8' },
		['id', 'watchlistId'],
	)
	expect(cleaned).toEqual({ title: 'ok', rating: '8' })
	expect('id' in cleaned).toBe(false)
	expect('watchlistId' in cleaned).toBe(false)
})

test('stripProtectedFields returns a copy and does not mutate the input', () => {
	const input = { a: 1, id: 'x' }
	const cleaned = stripProtectedFields(input, ['id'])
	expect(cleaned).toEqual({ a: 1 })
	expect(input).toEqual({ a: 1, id: 'x' })
})
