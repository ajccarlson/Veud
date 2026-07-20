import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { action as addFavorite } from '#app/routes/lists+/.fetch+/add-favorite.$request.ts'
import { action as addRow } from '#app/routes/lists+/.fetch+/add-row.$request.ts'
import { action as deleteRow } from '#app/routes/lists+/.fetch+/delete-row.$request.ts'
import { action as updateCell } from '#app/routes/lists+/.fetch+/update-cell.$request.ts'
import { action as updateRow } from '#app/routes/lists+/.fetch+/update-row.$request.ts'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'

async function createOwner(listTypeName: 'liveaction' | 'anime' | 'manga') {
	const suffix = faker.string.alphanumeric({ length: 12 }).toLowerCase()
	const owner = await prisma.user.create({
		data: {
			email: `${suffix}@example.com`,
			username: `u_${suffix}`,
		},
		select: { id: true },
	})
	const listType = await prisma.listType.upsert({
		where: { name: listTypeName },
		update: {},
		create: {
			name: listTypeName,
			header: listTypeName,
			columns: '[]',
			mediaType: listTypeName,
			completionType: 'watched',
		},
		select: { id: true },
	})
	const watchlist = await prisma.watchlist.create({
		data: {
			name: 'watching',
			header: 'Watching',
			ownerId: owner.id,
			typeId: listType.id,
		},
		select: { id: true },
	})
	const session = await prisma.session.create({
		data: { userId: owner.id, expirationDate: getSessionExpirationDate() },
		select: { id: true },
	})
	const cookie = await getSessionCookieHeader(session)

	return {
		ownerId: owner.id,
		listTypeId: listType.id,
		watchlistId: watchlist.id,
		request: new Request(BASE_URL, {
			method: 'POST',
			headers: { cookie },
		}),
	}
}

function routeParams(key: 'row' | 'favorite', value: Record<string, unknown>) {
	return {
		request: new URLSearchParams({ [key]: JSON.stringify(value) }).toString(),
	}
}

test('new rows reuse canonical media and ignore client-supplied relation ids', async () => {
	const owner = await createOwner('liveaction')
	const unrelatedMedia = await prisma.media.create({
		data: { kind: 'movie' },
		select: { id: true },
	})
	const thumbnail =
		'https://image.tmdb.org/poster.jpg|https://www.themoviedb.org/movie/278'

	const first = await addRow({
		request: owner.request,
		params: routeParams('row', {
			id: 'client-chosen-id',
			watchlistId: owner.watchlistId,
			position: 1,
			title: 'The Shawshank Redemption',
			thumbnail,
			mediaId: unrelatedMedia.id,
			mediaIdentity: {
				provider: 'tmdb',
				kind: 'movie',
				externalId: '278',
			},
		}),
	} as any)

	const second = await addRow({
		request: owner.request,
		params: routeParams('row', {
			watchlistId: owner.watchlistId,
			position: 2,
			title: 'The same work in another row',
			thumbnail,
		}),
	} as any)

	expect(first.id).not.toBe('client-chosen-id')
	expect(first.mediaId).not.toBe(unrelatedMedia.id)
	expect(second.mediaId).toBe(first.mediaId)
	expect(
		await prisma.media.findUniqueOrThrow({
			where: { id: first.mediaId as string },
		}),
	).toEqual(
		expect.objectContaining({
			title: 'The Shawshank Redemption',
			thumbnail,
		}),
	)
	expect(await prisma.mediaExternalId.findMany()).toEqual([
		expect.objectContaining({
			provider: 'tmdb',
			kind: 'movie',
			externalId: '278',
			mediaId: first.mediaId,
		}),
	])
	expect(await prisma.media.count()).toBe(2)
	expect(await prisma.trackingState.findMany()).toEqual([
		expect.objectContaining({
			ownerId: owner.ownerId,
			mediaId: first.mediaId,
			status: 'watching',
			statusWatchlistId: owner.watchlistId,
		}),
	])
	expect(await prisma.activityEvent.findMany()).toEqual([
		expect.objectContaining({
			type: 'status',
			actorId: owner.ownerId,
			mediaId: first.mediaId,
			status: 'watching',
			statusLabel: 'Watching',
		}),
	])
})

test('new rows insert atomically without duplicate positions', async () => {
	const owner = await createOwner('anime')
	const oldUpdatedAt = new Date('2020-01-01T00:00:00.000Z')
	await prisma.watchlist.update({
		where: { id: owner.watchlistId },
		data: { updatedAt: oldUpdatedAt },
	})

	for (const title of ['First row', 'Inserted row']) {
		await addRow({
			request: owner.request,
			params: routeParams('row', {
				watchlistId: owner.watchlistId,
				position: 1,
				title,
				type: 'TV Series',
			}),
		} as any)
	}

	expect(
		await prisma.entry.findMany({
			where: { watchlistId: owner.watchlistId },
			orderBy: { position: 'asc' },
			select: { title: true, position: true },
		}),
	).toEqual([
		{ title: 'Inserted row', position: 1 },
		{ title: 'First row', position: 2 },
	])
	expect(
		(
			await prisma.watchlist.findUniqueOrThrow({
				where: { id: owner.watchlistId },
			})
		).updatedAt.getTime(),
	).toBeGreaterThan(oldUpdatedAt.getTime())
})

test('provider identity must agree with the destination list type', async () => {
	const owner = await createOwner('liveaction')

	const result = await addRow({
		request: owner.request,
		params: routeParams('row', {
			watchlistId: owner.watchlistId,
			position: 1,
			title: 'Wrong catalog',
			mediaIdentity: {
				provider: 'mal',
				kind: 'anime',
				externalId: '5114',
			},
		}),
	} as any).catch(error => error)

	expect(result).toBeInstanceOf(Response)
	expect((result as Response).status).toBe(400)
	expect(await prisma.entry.count()).toBe(0)
	expect(await prisma.media.count()).toBe(0)
})

test('new MAL rows ingest validated canonical related titles', async () => {
	const owner = await createOwner('anime')
	const entry = await addRow({
		request: owner.request,
		params: routeParams('row', {
			watchlistId: owner.watchlistId,
			position: 1,
			title: 'First season',
			mediaIdentity: {
				provider: 'mal',
				kind: 'anime',
				externalId: '100',
			},
			mediaRelations: [
				{
					relationType: 'Sequel',
					targetIdentity: {
						provider: 'mal',
						kind: 'anime',
						externalId: '101',
					},
					targetCatalog: {
						title: 'Second season',
						thumbnail:
							'https://example.com/second.jpg|https://myanimelist.net/anime/101',
					},
				},
			],
		}),
	} as any)

	const relation = await prisma.mediaRelation.findFirstOrThrow({
		include: { targetMedia: { include: { externalIds: true } } },
	})
	expect(relation).toMatchObject({
		sourceMediaId: entry.mediaId,
		relationType: 'sequel',
		provider: 'mal',
		targetMedia: {
			title: 'Second season',
			externalIds: [
				expect.objectContaining({
					provider: 'mal',
					kind: 'anime',
					externalId: '101',
				}),
			],
		},
	})
})

test('new TMDB rows ingest canonical franchise titles', async () => {
	const owner = await createOwner('liveaction')
	const entry = await addRow({
		request: owner.request,
		params: routeParams('row', {
			watchlistId: owner.watchlistId,
			position: 1,
			title: 'First franchise movie',
			mediaIdentity: {
				provider: 'tmdb',
				kind: 'movie',
				externalId: '300',
			},
			mediaRelations: [
				{
					relationType: 'franchise',
					targetIdentity: {
						provider: 'tmdb',
						kind: 'movie',
						externalId: '301',
					},
					targetCatalog: { title: 'Second franchise movie' },
				},
			],
		}),
	} as any)

	const relation = await prisma.mediaRelation.findFirstOrThrow({
		include: { targetMedia: true },
	})
	expect(relation).toMatchObject({
		sourceMediaId: entry.mediaId,
		relationType: 'franchise',
		provider: 'tmdb',
		targetMedia: { kind: 'movie', title: 'Second franchise movie' },
	})
})

test('relation metadata cannot cross providers', async () => {
	const owner = await createOwner('anime')
	const result = await addRow({
		request: owner.request,
		params: routeParams('row', {
			watchlistId: owner.watchlistId,
			position: 1,
			title: 'Invalid relation source',
			mediaIdentity: {
				provider: 'mal',
				kind: 'anime',
				externalId: '100',
			},
			mediaRelations: [
				{
					relationType: 'sequel',
					targetIdentity: {
						provider: 'tmdb',
						kind: 'tv',
						externalId: '101',
					},
				},
			],
		}),
	} as any).catch(error => error)

	expect(result).toBeInstanceOf(Response)
	expect((result as Response).status).toBe(400)
	expect(await prisma.entry.count()).toBe(0)
	expect(await prisma.media.count()).toBe(0)
})

test('favorites use session ownership and validated canonical identity', async () => {
	const owner = await createOwner('manga')
	const unrelatedMedia = await prisma.media.create({
		data: { kind: 'manga' },
		select: { id: true },
	})

	const favorite = await addFavorite({
		request: owner.request,
		params: routeParams('favorite', {
			position: 1,
			title: 'Berserk',
			typeId: owner.listTypeId,
			ownerId: 'client-chosen-owner',
			mediaId: unrelatedMedia.id,
			mediaIdentity: {
				provider: 'mal',
				kind: 'manga',
				externalId: '2',
			},
		}),
	} as any)

	expect(favorite.ownerId).toBe(owner.ownerId)
	expect(favorite.mediaId).not.toBe(unrelatedMedia.id)
	expect(
		await prisma.media.findUniqueOrThrow({
			where: { id: favorite.mediaId as string },
		}),
	).toEqual(expect.objectContaining({ title: 'Berserk' }))
	expect(
		await prisma.mediaExternalId.findUnique({
			where: {
				provider_kind_externalId: {
					provider: 'mal',
					kind: 'manga',
					externalId: '2',
				},
			},
		}),
	).toEqual(expect.objectContaining({ mediaId: favorite.mediaId }))
})

test('refreshing a legacy row can establish its canonical identity', async () => {
	const owner = await createOwner('anime')
	const entry = await prisma.entry.create({
		data: {
			watchlistId: owner.watchlistId,
			position: 1,
			title: 'Old title',
		},
		select: { id: true },
	})

	const updated = await updateRow({
		request: owner.request,
		params: {
			request: new URLSearchParams({
				rowIndex: entry.id,
				row: JSON.stringify({
					title: 'Fullmetal Alchemist: Brotherhood',
					mediaIdentity: {
						provider: 'mal',
						kind: 'anime',
						externalId: '5114',
					},
				}),
			}).toString(),
		},
	} as any)

	expect(updated.title).toBe('Fullmetal Alchemist: Brotherhood')
	expect(updated.mediaId).toEqual(expect.any(String))
	expect(updated.trackingStateId).toEqual(expect.any(String))
	expect(
		await prisma.mediaExternalId.findFirst({
			where: { externalId: '5114' },
		}),
	).toEqual(expect.objectContaining({ mediaId: updated.mediaId }))
})

test('correcting canonical identity removes the superseded orphan state', async () => {
	const owner = await createOwner('anime')
	const added = await addRow({
		request: owner.request,
		params: routeParams('row', {
			watchlistId: owner.watchlistId,
			position: 1,
			title: 'Incorrect identity',
			mediaIdentity: {
				provider: 'mal',
				kind: 'anime',
				externalId: '1',
			},
		}),
	} as any)

	const updated = await updateRow({
		request: owner.request,
		params: {
			request: new URLSearchParams({
				rowIndex: added.id,
				row: JSON.stringify({
					...added,
					title: 'Corrected identity',
					mediaIdentity: {
						provider: 'mal',
						kind: 'anime',
						externalId: '2',
					},
				}),
			}).toString(),
		},
	} as any)

	expect(updated.mediaId).not.toBe(added.mediaId)
	expect(updated.trackingStateId).not.toBe(added.trackingStateId)
	expect(
		await prisma.trackingState.findUnique({
			where: { id: added.trackingStateId as string },
		}),
	).toBeNull()
})

test('cell edits synchronize score, dates, and episode progress', async () => {
	const owner = await createOwner('anime')
	const added = await addRow({
		request: owner.request,
		params: routeParams('row', {
			watchlistId: owner.watchlistId,
			position: 1,
			title: 'Progress title',
			length: '12 eps',
			personal: 7,
			history: JSON.stringify({
				added: Date.now(),
				started: null,
				finished: null,
				progress: null,
				lastUpdated: Date.now(),
			}),
			mediaIdentity: {
				provider: 'mal',
				kind: 'anime',
				externalId: '9253',
			},
		}),
	} as any)

	const cellParams = (colId: string, newValue: string, type: string) => ({
		request: new URLSearchParams({
			rowIndex: added.id,
			colId,
			newValue,
			type,
			filter: type,
			listTypeData: JSON.stringify({ mediaType: '["episode"]' }),
		}).toString(),
	})

	await updateCell({
		request: owner.request,
		params: cellParams('personal', '9', 'number'),
	} as any)
	await updateCell({
		request: owner.request,
		params: cellParams('length', '3 / 12 eps', 'string'),
	} as any)
	await updateCell({
		request: owner.request,
		params: cellParams('started', '2026-01-02', 'history'),
	} as any)
	await updateCell({
		request: owner.request,
		params: cellParams('finished', '2026-01-12', 'history'),
	} as any)

	const state = await prisma.trackingState.findUniqueOrThrow({
		where: { id: added.trackingStateId as string },
		include: { progress: true },
	})
	expect(Number(state.score)).toBe(9)
	expect(state.startedAt?.toISOString()).toBe('2026-01-02T00:00:00.000Z')
	expect(state.completedAt?.toISOString()).toBe('2026-01-12T00:00:00.000Z')
	expect(state.progress).toEqual([
		expect.objectContaining({ unit: 'episode', current: 3, total: 12 }),
	])
})

test('moving a row updates canonical status and deletion cleans up orphan state', async () => {
	const owner = await createOwner('anime')
	const destination = await prisma.watchlist.create({
		data: {
			name: 'completed',
			header: 'Completed',
			ownerId: owner.ownerId,
			typeId: owner.listTypeId,
		},
		select: { id: true },
	})
	const identity = { provider: 'mal', kind: 'anime', externalId: '5114' }
	const source = await addRow({
		request: owner.request,
		params: routeParams('row', {
			watchlistId: owner.watchlistId,
			position: 1,
			title: 'Fullmetal Alchemist: Brotherhood',
			personal: 8,
			mediaIdentity: identity,
		}),
	} as any)
	const moved = await addRow({
		request: owner.request,
		params: routeParams('row', {
			watchlistId: destination.id,
			position: 1,
			title: source.title,
			personal: 0,
			mediaIdentity: identity,
			trackingStateId: 'client-chosen-state',
		}),
	} as any)

	const stateAfterMove = await prisma.trackingState.findUniqueOrThrow({
		where: { id: source.trackingStateId as string },
	})
	expect(moved.trackingStateId).toBe(source.trackingStateId)
	expect(stateAfterMove.status).toBe('completed')
	expect(stateAfterMove.statusWatchlistId).toBe(destination.id)
	expect(Number(stateAfterMove.score)).toBe(8)

	await deleteRow({
		request: owner.request,
		params: {
			request: new URLSearchParams({ id: source.id }).toString(),
		},
	} as any)
	expect(await prisma.trackingState.count()).toBe(1)

	await deleteRow({
		request: owner.request,
		params: {
			request: new URLSearchParams({ id: moved.id }).toString(),
		},
	} as any)
	expect(await prisma.trackingState.count()).toBe(0)
})
