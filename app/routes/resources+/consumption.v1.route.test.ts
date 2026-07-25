import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { action, loader } from './consumption.v1.ts'

async function fixture(kind: 'anime' | 'manga' = 'anime') {
	const suffix = faker.string.alphanumeric({ length: 10 }).toLowerCase()
	const owner = await prisma.user.create({
		data: {
			email: `consumption_${suffix}@example.com`,
			username: `consumption_${suffix}`,
		},
	})
	const listType = await prisma.listType.create({
		data: {
			name: `consumption_${kind}_${suffix}`,
			header: kind,
			columns: '{}',
			mediaType: kind === 'manga' ? '["chapter","volume"]' : '["episode"]',
			completionType: 'completed',
		},
	})
	const media = await prisma.media.create({
		data: {
			kind,
			title: 'Installment history fixture',
			episodeCount: kind === 'anime' ? 24 : null,
			chapterCount: kind === 'manga' ? 100 : null,
			volumeCount: kind === 'manga' ? 10 : null,
		},
	})
	const watchlist = await prisma.watchlist.create({
		data: {
			ownerId: owner.id,
			typeId: listType.id,
			name: 'watching',
			header: 'Watching',
		},
	})
	const state = await prisma.trackingState.create({
		data: {
			ownerId: owner.id,
			mediaId: media.id,
			status: watchlist.name,
			statusWatchlistId: watchlist.id,
			progress: {
				create: {
					unit: kind === 'manga' ? 'chapter' : 'episode',
					current: 2,
					total: kind === 'manga' ? 100 : 24,
				},
			},
		},
	})
	const entry = await prisma.entry.create({
		data: {
			watchlistId: watchlist.id,
			mediaId: media.id,
			trackingStateId: state.id,
			position: 1,
			title: media.title!,
			length: kind === 'anime' ? '2 / 24 eps' : null,
			chapters: kind === 'manga' ? '2 / 100' : null,
		},
	})
	const session = await prisma.session.create({
		data: { userId: owner.id, expirationDate: getSessionExpirationDate() },
	})
	return {
		owner,
		media,
		state,
		entry,
		cookie: await getSessionCookieHeader(session),
	}
}

function request(
	cookie: string,
	body: Record<string, unknown>,
	method = 'POST',
) {
	return new Request(`${BASE_URL}/resources/consumption/v1`, {
		method,
		headers: { cookie, 'content-type': 'application/json' },
		body: JSON.stringify(body),
	})
}

test('an exact check-in advances progress and keeps repeat history', async () => {
	const { cookie, media, state, entry } = await fixture()
	const first = await action({
		request: request(cookie, {
			mediaId: media.id,
			unit: 'episode',
			seasonNumber: 1,
			number: 3,
			absoluteNumber: 3,
		}),
	} as any)
	expect(first.data).toEqual({
		ok: true,
		data: expect.objectContaining({
			repeatNumber: 0,
			progress: expect.objectContaining({ current: 3, total: 24 }),
		}),
	})

	await action({
		request: request(cookie, {
			mediaId: media.id,
			unit: 'episode',
			seasonNumber: 1,
			number: 3,
			absoluteNumber: 3,
		}),
	} as any)

	expect(
		await prisma.consumptionEvent.findMany({
			where: { trackingStateId: state.id },
			orderBy: { createdAt: 'asc' },
			select: {
				eventType: true,
				repeatNumber: true,
				progressFrom: true,
				progressTo: true,
			},
		}),
	).toEqual([
		{
			eventType: 'installment',
			repeatNumber: 0,
			progressFrom: 2,
			progressTo: 3,
		},
		{
			eventType: 'repeat',
			repeatNumber: 1,
			progressFrom: 3,
			progressTo: 3,
		},
	])
	expect(
		await prisma.entry.findUniqueOrThrow({
			where: { id: entry.id },
			select: { length: true },
		}),
	).toEqual({ length: '3 / 24 eps' })
})

test('consumption history is private and validates media units', async () => {
	const { cookie, media } = await fixture('manga')
	const invalid = await action({
		request: request(cookie, {
			mediaId: media.id,
			unit: 'episode',
			number: 3,
		}),
	} as any).catch(error => error)
	expect(invalid).toBeInstanceOf(Response)
	expect((invalid as Response).status).toBe(400)

	const unauthenticated = await loader({
		request: new Request(
			`${BASE_URL}/resources/consumption/v1?mediaId=${media.id}`,
		),
	} as any).catch(error => error)
	expect(unauthenticated).toBeInstanceOf(Response)
	expect((unauthenticated as Response).status).toBeGreaterThanOrEqual(300)
})
