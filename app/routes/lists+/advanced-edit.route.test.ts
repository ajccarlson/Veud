import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { action } from '#app/routes/lists+/.fetch+/advanced-edit.$request.ts'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'

async function createOwnerWithEntry() {
	const suffix = faker.string.alphanumeric({ length: 12 }).toLowerCase()
	const owner = await prisma.user.create({
		data: { email: `${suffix}@example.com`, username: `u_${suffix}` },
	})
	const listType = await prisma.listType.create({
		data: {
			name: `anime-${suffix}`,
			header: 'Anime',
			columns: '{}',
			mediaType: '["episode"]',
			completionType: '{}',
		},
	})
	const watchlist = await prisma.watchlist.create({
		data: {
			name: 'watching',
			header: 'Watching',
			ownerId: owner.id,
			typeId: listType.id,
		},
	})
	const entry = await prisma.entry.create({
		data: {
			watchlistId: watchlist.id,
			position: 1,
			title: 'Advanced edit entry',
			history: JSON.stringify({
				added: Date.now(),
				started: null,
				finished: null,
				progress: null,
			}),
		},
	})
	const session = await prisma.session.create({
		data: { userId: owner.id, expirationDate: getSessionExpirationDate() },
	})
	const cookie = await getSessionCookieHeader(session)
	return {
		entry,
		watchlist,
		request: new Request(BASE_URL, {
			method: 'POST',
			headers: { cookie, 'Content-Type': 'application/json' },
		}),
	}
}

function request(
	request: Request,
	entryId: string,
	fields: Record<string, unknown>,
) {
	return new Request(request, {
		body: JSON.stringify({ entryId, fields }),
	})
}

test('owner can atomically edit hidden personal fields', async () => {
	const setup = await createOwnerWithEntry()
	const beforeUpdatedAt = setup.watchlist.updatedAt

	await action({
		request: request(setup.request, setup.entry.id, {
			story: 9,
			personal: 8.5,
			priority: 'High',
			notes: 'Watch the director commentary.',
			started: '2026-07-01',
			finished: '2026-07-18',
		}),
		params: {},
	} as any)

	const entry = await prisma.entry.findUniqueOrThrow({
		where: { id: setup.entry.id },
	})
	const history = JSON.parse(entry.history ?? '{}') as Record<string, unknown>
	expect(Number(entry.personal)).toBe(8.5)
	expect(entry.story).toBe(9)
	expect(entry.priority).toBe('High')
	expect(entry.notes).toBe('Watch the director commentary.')
	expect(history.started).toBe('2026-07-01T00:00:00.000Z')
	expect(history.finished).toBe('2026-07-18T00:00:00.000Z')
	expect(
		(
			await prisma.watchlist.findUniqueOrThrow({
				where: { id: setup.watchlist.id },
			})
		).updatedAt.getTime(),
	).toBeGreaterThanOrEqual(beforeUpdatedAt.getTime())
})

test('advanced edit rejects non-owners and invalid scores', async () => {
	const setup = await createOwnerWithEntry()
	const otherSuffix = faker.string.alphanumeric({ length: 12 }).toLowerCase()
	const other = await prisma.user.create({
		data: {
			email: `${otherSuffix}@example.com`,
			username: `u_${otherSuffix}`,
		},
	})
	const otherSession = await prisma.session.create({
		data: { userId: other.id, expirationDate: getSessionExpirationDate() },
	})
	const otherCookie = await getSessionCookieHeader(otherSession)

	const forbidden = await action({
		request: new Request(BASE_URL, {
			method: 'POST',
			headers: {
				cookie: otherCookie,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				entryId: setup.entry.id,
				fields: { personal: 10 },
			}),
		}),
		params: {},
	} as any).catch(error => error)
	expect(forbidden).toBeInstanceOf(Response)
	expect((forbidden as Response).status).toBe(404)

	const invalid = await action({
		request: request(setup.request, setup.entry.id, { personal: 11 }),
		params: {},
	} as any).catch(error => error)
	expect(invalid).toBeInstanceOf(Response)
	expect((invalid as Response).status).toBe(400)
})
