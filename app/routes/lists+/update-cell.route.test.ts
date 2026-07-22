/**
 * Route-level test for the update-cell action
 * (app/routes/lists+/.fetch+/update-cell.$request.ts).
 *
 * Covers the 0.2 access control on this route and the 2.1 error-handling fix: auth/ownership
 * failures surface as real statuses (401/404) and bad input as 400 — never swallowed into a
 * 200 body.
 */
import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { action } from '#app/routes/lists+/.fetch+/update-cell.$request.ts'
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
							columns: JSON.stringify({
								title: 'string',
								personal: 'number',
								watchlistId: 'string',
							}),
							mediaType: '["movie"]',
							completionType: 'watched',
						},
					},
					entries: {
						create: { position: 1, title: 'Original Title' },
					},
				},
			},
		},
		select: {
			id: true,
			watchlists: {
				select: { typeId: true, entries: { select: { id: true } } },
			},
		},
	})
	const wl = owner.watchlists[0]
	const entryId = wl?.entries[0]?.id
	if (!wl || !entryId) throw new Error('test setup: entry was not created')
	return { userId: owner.id, entryId }
}

function updateTitleParams(entryId: string, newValue: string) {
	return new URLSearchParams({
		rowIndex: entryId,
		colId: 'title',
		newValue,
	}).toString()
}

test('the owner can update a cell', async () => {
	const { userId, entryId } = await createOwnerWithEntry()
	const request = await authedRequestFor(userId)

	const result = await action({
		request,
		params: { request: updateTitleParams(entryId, 'Updated Title') },
	} as any)

	expect((result as { title?: string }).title).toBe('Updated Title')
})

test('a logged-in non-owner cannot update the cell (404)', async () => {
	const { entryId } = await createOwnerWithEntry()
	const other = await createUserRecord()
	const request = await authedRequestFor(other.id)

	const res = await action({
		request,
		params: { request: updateTitleParams(entryId, 'Hacked') },
	} as any).catch(e => e)

	expect(res).toBeInstanceOf(Response)
	expect((res as Response).status).toBe(404)
})

test('an unauthenticated caller cannot update the cell', async () => {
	const { entryId } = await createOwnerWithEntry()

	const res = await action({
		request: new Request(BASE_URL, { method: 'POST' }),
		params: { request: updateTitleParams(entryId, 'Hacked') },
	} as any).catch(e => e)

	expect(res).toBeInstanceOf(Response)
	const status = (res as Response).status
	expect(status).toBeGreaterThanOrEqual(300)
	expect(status).toBeLessThan(400)
})

test('protected columns cannot be changed through the generic cell endpoint', async () => {
	const { userId, entryId } = await createOwnerWithEntry()
	const request = await authedRequestFor(userId)

	const params = new URLSearchParams({
		rowIndex: entryId,
		colId: 'watchlistId',
		newValue: 'attacker-controlled-watchlist',
	}).toString()

	const res = await action({
		request,
		params: { request: params },
	} as any).catch(e => e)
	expect(res).toBeInstanceOf(Response)
	expect((res as Response).status).toBe(400)
})

test('column values are cast from the server schema and reject invalid numbers', async () => {
	const { userId, entryId } = await createOwnerWithEntry()
	const request = await authedRequestFor(userId)
	const params = new URLSearchParams({
		rowIndex: entryId,
		colId: 'personal',
		newValue: 'not-a-number',
		type: 'string',
	}).toString()

	const res = await action({
		request,
		params: { request: params },
	} as any).catch(error => error)
	expect(res).toBeInstanceOf(Response)
	expect((res as Response).status).toBe(400)
})
