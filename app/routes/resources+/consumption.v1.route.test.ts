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

test('consumption history exposes bounded filterable pages and event truncation', async () => {
	const { cookie, owner, media, state } = await fixture()
	await prisma.mediaInstallment.createMany({
		data: [
			...Array.from({ length: 104 }, (_, index) => ({
				mediaId: media.id,
				kind: 'episode',
				seasonNumber: index < 52 ? 1 : 2,
				number: (index % 52) + 1,
				absoluteNumber: index + 1,
				title: `Episode ${index + 1}`,
			})),
			{
				mediaId: media.id,
				kind: 'volume',
				seasonNumber: 2,
				number: 1,
				absoluteNumber: 1,
				title: 'Volume 1',
			},
		],
	})
	const expected = await prisma.mediaInstallment.findMany({
		where: { mediaId: media.id },
		orderBy: [{ kind: 'asc' }, { seasonNumber: 'asc' }, { number: 'asc' }],
		select: { id: true },
	})
	const repeatedInstallmentId = expected[0]?.id
	const otherRepeatedInstallmentId = expected[1]?.id
	if (!repeatedInstallmentId || !otherRepeatedInstallmentId) {
		throw new Error('Expected two installment fixtures')
	}
	const consumedAt = new Date('2026-08-28T12:00:00.000Z')
	await Promise.all(
		[repeatedInstallmentId, otherRepeatedInstallmentId].flatMap(installmentId =>
			Array.from({ length: 21 }, (_, repeatNumber) =>
				prisma.consumptionEvent.create({
					data: {
						ownerId: owner.id,
						mediaId: media.id,
						trackingStateId: state.id,
						installmentId,
						unit: 'episode',
						eventType: repeatNumber === 0 ? 'installment' : 'repeat',
						repeatNumber,
						consumedAt,
					},
				}),
			),
		),
	)
	const otherOwner = await prisma.user.create({
		data: {
			email: `other_${faker.string.alphanumeric({ length: 10 }).toLowerCase()}@example.com`,
			username: `other_${faker.string.alphanumeric({ length: 10 }).toLowerCase()}`,
		},
	})
	const privateEvent = await prisma.consumptionEvent.create({
		data: {
			ownerId: otherOwner.id,
			mediaId: media.id,
			installmentId: repeatedInstallmentId,
			unit: 'episode',
			eventType: 'repeat',
			repeatNumber: 999,
			consumedAt: new Date('2026-08-29T12:00:00.000Z'),
		},
	})
	const expectedEvents = await prisma.consumptionEvent.findMany({
		where: { ownerId: owner.id, installmentId: repeatedInstallmentId },
		orderBy: [{ consumedAt: 'desc' }, { id: 'desc' }],
		select: { id: true },
	})

	const load = (parameters: Record<string, string> = {}) => {
		const query = new URLSearchParams({ mediaId: media.id, ...parameters })
		return loader({
			request: new Request(`${BASE_URL}/resources/consumption/v1?${query}`, {
				headers: { cookie },
			}),
		} as any)
	}
	const first = await load()
	expect(first.data.ok).toBe(true)
	expect(first.data.data.media.installments).toHaveLength(100)
	expect(
		first.data.data.media.installments.map(installment => installment.id),
	).toEqual(expected.slice(0, 100).map(installment => installment.id))
	expect(first.data.pagination).toEqual({
		nextCursor: expected[99]?.id,
		truncated: true,
	})
	const repeated = first.data.data.media.installments[0]
	expect(repeated?.consumptionEvents).toHaveLength(20)
	expect(repeated?.consumptionEvents[0]?.repeatNumber).toEqual(
		expect.any(Number),
	)
	expect(repeated?.consumptionEvents[0]?.consumedAt).toEqual(expect.any(Date))
	expect(repeated?.consumptionEvents.map(event => event.id)).toEqual(
		expectedEvents.slice(0, 20).map(event => event.id),
	)
	expect(repeated?.consumptionEvents.map(event => event.id)).not.toContain(
		privateEvent.id,
	)
	expect(repeated?.consumptionEventsTruncated).toBe(true)
	const otherRepeated = first.data.data.media.installments[1]
	expect(otherRepeated?.consumptionEvents).toHaveLength(20)
	expect(otherRepeated?.consumptionEventsTruncated).toBe(true)
	expect(new Headers(first.init?.headers).get('cache-control')).toBe(
		'private, no-store',
	)

	const second = await load({ cursor: first.data.pagination.nextCursor ?? '' })
	expect(second.data.data.media.installments.map(row => row.id)).toEqual(
		expected.slice(100).map(row => row.id),
	)
	expect(second.data.pagination).toEqual({
		nextCursor: null,
		truncated: false,
	})

	const filtered = await load({ unit: 'volume', seasonNumber: '2' })
	expect(filtered.data.data.media.installments).toEqual([
		expect.objectContaining({ kind: 'volume', seasonNumber: 2, number: 1 }),
	])
	expect(filtered.data.pagination.truncated).toBe(false)

	const offFilterCursor = await load({
		unit: 'episode',
		cursor: filtered.data.data.media.installments[0]?.id ?? '',
	}).catch(error => error)
	expect(offFilterCursor).toBeInstanceOf(Response)
	expect((offFilterCursor as Response).status).toBe(400)

	const otherMedia = await prisma.media.create({
		data: { kind: 'anime', title: 'Foreign consumption cursor' },
	})
	const foreignInstallment = await prisma.mediaInstallment.create({
		data: {
			mediaId: otherMedia.id,
			kind: 'episode',
			seasonNumber: 1,
			number: 1,
		},
	})
	const foreignCursor = await load({ cursor: foreignInstallment.id }).catch(
		error => error,
	)
	expect(foreignCursor).toBeInstanceOf(Response)
	expect((foreignCursor as Response).status).toBe(400)

	const oversized = await load({ take: '251' }).catch(error => error)
	expect(oversized).toBeInstanceOf(Response)
	expect((oversized as Response).status).toBe(400)
})
