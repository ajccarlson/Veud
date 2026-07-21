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
			name: 'watching',
			header: 'Watching',
			ownerId: owner.id,
			typeId: listType.id,
		},
	})
	const destination = await prisma.watchlist.create({
		data: {
			name: 'completed',
			header: 'Completed',
			position: 2,
			ownerId: owner.id,
			typeId: listType.id,
		},
	})
	const media = await prisma.media.create({ data: { kind: 'anime' } })
	const trackingState = await prisma.trackingState.create({
		data: {
			ownerId: owner.id,
			mediaId: media.id,
			status: watchlist.name,
			statusWatchlistId: watchlist.id,
			progress: {
				create: { unit: 'episode', current: 1, total: 12 },
			},
		},
	})
	const entry = await prisma.entry.create({
		data: {
			watchlistId: watchlist.id,
			mediaId: media.id,
			trackingStateId: trackingState.id,
			position: 1,
			title: 'Advanced edit entry',
			length: '1 / 12 eps',
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
		destination,
		trackingState,
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

test('owner can atomically edit hidden fields and normalized tracking state', async () => {
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
			destinationWatchlistId: setup.destination.id,
			repeatCount: 2,
			progress: { episode: 4 },
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
	expect(entry.watchlistId).toBe(setup.destination.id)
	expect(entry.position).toBe(1)
	expect(entry.length).toBe('4 / 12 eps')
	expect(history.started).toBe('2026-07-01T00:00:00.000Z')
	expect(history.finished).toBe('2026-07-18T00:00:00.000Z')
	expect(history.repeatCount).toBe(2)
	const tracking = await prisma.trackingState.findUniqueOrThrow({
		where: { id: setup.trackingState.id },
		include: { progress: true },
	})
	expect(tracking).toMatchObject({
		status: setup.destination.name,
		statusWatchlistId: setup.destination.id,
		repeatCount: 2,
	})
	expect(Number(tracking.score)).toBe(8.5)
	expect(tracking.startedAt?.toISOString()).toBe('2026-07-01T00:00:00.000Z')
	expect(tracking.completedAt?.toISOString()).toBe(
		'2026-07-18T00:00:00.000Z',
	)
	expect(tracking.progress).toEqual([
		expect.objectContaining({ unit: 'episode', current: 4, total: 12 }),
	])
	expect(
		await prisma.activityEvent.count({
			where: { trackingStateId: setup.trackingState.id },
		}),
	).toBe(3)
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

	for (const fields of [
		{ repeatCount: -1 },
		{ progress: { episode: 13 } },
		{ progress: { chapter: 1 } },
	]) {
		const rejected = await action({
			request: request(setup.request, setup.entry.id, fields),
			params: {},
		} as any).catch(error => error)
		expect(rejected).toBeInstanceOf(Response)
		expect((rejected as Response).status).toBe(400)
	}
})
