/**
 * Access-control tests for the watchlist "fetch" API helpers
 * (app/utils/lists/authorization.server.ts) — the 0.2 fix.
 *
 *   - resolveEntryModel: only the three allow-listed entry models resolve; anything else
 *     is rejected, so Prisma is never indexed with an untrusted, client-supplied string.
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
	requireWatchlistOwner,
	resolveEntryModel,
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

// ---------- resolveEntryModel (pure allow-list) ----------

test('resolveEntryModel resolves the three allow-listed entry types', () => {
	expect(resolveEntryModel(JSON.stringify({ header: 'LiveAction' }))).toBe(
		'liveActionEntry',
	)
	expect(resolveEntryModel(JSON.stringify({ header: 'Anime' }))).toBe(
		'animeEntry',
	)
	expect(resolveEntryModel(JSON.stringify({ header: 'Manga' }))).toBe(
		'mangaEntry',
	)
})

test('resolveEntryModel rejects a Prisma-model-injection attempt with 400', () => {
	// "User" would resolve to a non-entry delegate (userEntry) -> must be refused,
	// which is what stops `prisma[<client string>]` from reaching arbitrary models.
	const res = getThrown(() => resolveEntryModel(JSON.stringify({ header: 'User' })))
	expect(res).toBeInstanceOf(Response)
	expect((res as Response).status).toBe(400)
})

test('resolveEntryModel rejects malformed or missing listTypeData with 400', () => {
	expect((getThrown(() => resolveEntryModel(null)) as Response).status).toBe(400)
	expect(
		(getThrown(() => resolveEntryModel('not json')) as Response).status,
	).toBe(400)
	expect(
		(getThrown(() => resolveEntryModel(JSON.stringify({}))) as Response).status,
	).toBe(400)
})

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
