import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { prisma } from '#app/utils/db.server.ts'
import { addEntryCommand } from '#app/utils/lists/commands/add-entry.server.ts'
import { addFavoriteCommand } from '#app/utils/lists/commands/add-favorite.server.ts'
import { deleteEntryCommand } from '#app/utils/lists/commands/delete-entry.server.ts'
import { updateEntryCellCommand } from '#app/utils/lists/commands/update-entry-cell.server.ts'
import { updateEntryCommand } from '#app/utils/lists/commands/update-entry.server.ts'

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
			columns: JSON.stringify({
				id: 'string',
				watchlistId: 'string',
				position: 'number',
				thumbnail: 'string',
				title: 'string',
				type: 'string',
				length: 'string',
				chapters: 'string',
				volumes: 'string',
				personal: 'number',
				startDate: 'history',
				finishedDate: 'history',
			}),
			mediaType:
				listTypeName === 'manga' ? '["chapter","volume"]' : '["episode"]',
			completionType: JSON.stringify({
				present: 'watch',
				past: 'watched',
				continuous: 'watching',
			}),
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
	return {
		ownerId: owner.id,
		listTypeId: listType.id,
		watchlistId: watchlist.id,
	}
}

function commandParams(
	_key: 'row' | 'favorite',
	value: Record<string, unknown>,
) {
	return value
}

type CommandCall = {
	ownerId: string
	params: Record<string, unknown>
}

function addRow({ ownerId, params }: CommandCall) {
	return addEntryCommand(ownerId, params)
}

function addFavorite({ ownerId, params }: CommandCall) {
	return addFavoriteCommand(ownerId, params)
}

test('new rows reuse sparse canonical media while saving user-owned snapshots', async () => {
	const owner = await createOwner('liveaction')
	const unrelatedMedia = await prisma.media.create({
		data: { kind: 'movie' },
		select: { id: true },
	})
	const thumbnail =
		'https://image.tmdb.org/poster.jpg|https://www.themoviedb.org/movie/278'

	const first = await addRow({
		ownerId: owner.ownerId,
		params: commandParams('row', {
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
		ownerId: owner.ownerId,
		params: commandParams('row', {
			watchlistId: owner.watchlistId,
			position: 2,
			title: 'The same work in another row',
			thumbnail,
		}),
	} as any)

	expect(first.id).not.toBe('client-chosen-id')
	expect(first.mediaId).not.toBe(unrelatedMedia.id)
	expect(second.mediaId).toBe(first.mediaId)
	expect(first).toEqual(
		expect.objectContaining({
			title: 'The Shawshank Redemption',
			thumbnail,
		}),
	)
	expect(second).toEqual(
		expect.objectContaining({
			title: 'The same work in another row',
			thumbnail,
		}),
	)
	expect(
		await prisma.media.findUniqueOrThrow({
			where: { id: first.mediaId as string },
		}),
	).toEqual(
		expect.objectContaining({
			title: null,
			thumbnail: null,
		}),
	)
	expect(await prisma.mediaExternalId.findMany()).toEqual([
		expect.objectContaining({
			provider: 'tmdb',
			kind: 'movie',
			externalId: '278',
			mediaId: first.mediaId,
			hydrationReason: 'user-demand',
			hydrationRequestedAt: expect.any(Date),
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
			statusWatchlistId: owner.watchlistId,
			isPublic: true,
			publicEligible: true,
		}),
	])
})

test('tracking activity created from a private list stays private', async () => {
	const owner = await createOwner('anime')
	await prisma.watchlist.update({
		where: { id: owner.watchlistId },
		data: { isPublic: false },
	})
	const entry = await addRow({
		ownerId: owner.ownerId,
		params: commandParams('row', {
			watchlistId: owner.watchlistId,
			position: 1,
			title: 'Private tracking title',
			type: 'TV Series',
			thumbnail:
				'https://cdn.myanimelist.net/private.jpg|https://myanimelist.net/anime/99991',
		}),
	} as any)
	const event = await prisma.activityEvent.findFirstOrThrow({
		where: { actorId: owner.ownerId, mediaId: entry.mediaId as string },
	})
	expect(event).toEqual(
		expect.objectContaining({
			statusWatchlistId: owner.watchlistId,
			isPublic: false,
			publicEligible: false,
		}),
	)
})

test('deleting the current public entry restores a surviving private status', async () => {
	const owner = await createOwner('anime')
	const privateList = await prisma.watchlist.create({
		data: {
			name: 'private-backlog',
			header: 'Private backlog',
			position: 2,
			ownerId: owner.ownerId,
			typeId: owner.listTypeId,
			isPublic: false,
		},
	})
	const mediaIdentity = {
		provider: 'mal',
		kind: 'anime',
		externalId: '99992',
	}
	const privateEntry = await addRow({
		ownerId: owner.ownerId,
		params: commandParams('row', {
			watchlistId: privateList.id,
			position: 1,
			title: 'Private fallback title',
			type: 'TV Series',
			mediaIdentity,
		}),
	} as any)
	const publicEntry = await addRow({
		ownerId: owner.ownerId,
		params: commandParams('row', {
			watchlistId: owner.watchlistId,
			position: 1,
			title: 'Private fallback title',
			type: 'TV Series',
			mediaIdentity,
		}),
	} as any)

	await deleteEntryCommand(owner.ownerId, publicEntry.id)

	const state = await prisma.trackingState.findUniqueOrThrow({
		where: { id: privateEntry.trackingStateId as string },
	})
	expect(state.statusWatchlistId).toBe(privateList.id)
	expect(state.status).toBe(privateList.name)
	const latestEvent = await prisma.activityEvent.findFirstOrThrow({
		where: { trackingStateId: state.id },
		orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
	})
	expect(latestEvent).toEqual(
		expect.objectContaining({
			statusWatchlistId: privateList.id,
			previousStatusWatchlistId: owner.watchlistId,
			isPublic: false,
			publicEligible: false,
		}),
	)
})

test('new rows insert atomically without duplicate positions', async () => {
	const owner = await createOwner('anime')
	const oldUpdatedAt = new Date('2020-01-01T00:00:00.000Z')
	await prisma.watchlist.update({
		where: { id: owner.watchlistId },
		data: { updatedAt: oldUpdatedAt },
	})

	for (const [index, title] of ['First row', 'Inserted row'].entries()) {
		await addRow({
			ownerId: owner.ownerId,
			params: commandParams('row', {
				watchlistId: owner.watchlistId,
				position: 1,
				title,
				type: 'TV Series',
				mediaIdentity: {
					provider: 'mal',
					kind: 'anime',
					externalId: String(80_000 + index),
				},
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
		ownerId: owner.ownerId,
		params: commandParams('row', {
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

test('provider identities reject noncanonical and unsafe external IDs', async () => {
	const owner = await createOwner('liveaction')

	for (const externalId of [
		'0',
		'01',
		'+1',
		'-1',
		' 1',
		'1 ',
		'9007199254740992',
	]) {
		const result = await addRow({
			ownerId: owner.ownerId,
			params: commandParams('row', {
				watchlistId: owner.watchlistId,
				position: 1,
				title: 'Noncanonical catalog identity',
				mediaIdentity: {
					provider: 'tmdb',
					kind: 'movie',
					externalId,
				},
			}),
		} as any).catch(error => error)

		expect(result).toBeInstanceOf(Response)
		expect((result as Response).status).toBe(400)
	}
	expect(await prisma.entry.count()).toBe(0)
	expect(await prisma.media.count()).toBe(0)
})

test('new MAL rows ignore client-supplied canonical relations and target metadata', async () => {
	const owner = await createOwner('anime')
	const entry = await addRow({
		ownerId: owner.ownerId,
		params: commandParams('row', {
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

	expect(entry).toEqual(expect.objectContaining({ title: 'First season' }))
	expect(await prisma.mediaRelation.count()).toBe(0)
	expect(
		await prisma.mediaExternalId.findUnique({
			where: {
				provider_kind_externalId: {
					provider: 'mal',
					kind: 'anime',
					externalId: '101',
				},
			},
		}),
	).toBeNull()
	expect(
		await prisma.media.findUniqueOrThrow({
			where: { id: entry.mediaId as string },
			select: { title: true, thumbnail: true },
		}),
	).toEqual({ title: null, thumbnail: null })
})

test('new TMDB rows ignore client-supplied canonical franchise data', async () => {
	const owner = await createOwner('liveaction')
	const entry = await addRow({
		ownerId: owner.ownerId,
		params: commandParams('row', {
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

	expect(entry.title).toBe('First franchise movie')
	expect(await prisma.mediaRelation.count()).toBe(0)
	expect(
		await prisma.mediaExternalId.findUnique({
			where: {
				provider_kind_externalId: {
					provider: 'tmdb',
					kind: 'movie',
					externalId: '301',
				},
			},
		}),
	).toBeNull()
})

test('invalid cross-provider client relation metadata is ignored', async () => {
	const owner = await createOwner('anime')
	const entry = await addRow({
		ownerId: owner.ownerId,
		params: commandParams('row', {
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
	} as any)

	expect(entry.title).toBe('Invalid relation source')
	expect(await prisma.entry.count()).toBe(1)
	expect(await prisma.media.count()).toBe(1)
	expect(await prisma.mediaRelation.count()).toBe(0)
})

test('favorites use session ownership and validated canonical identity', async () => {
	const owner = await createOwner('manga')
	const unrelatedMedia = await prisma.media.create({
		data: { kind: 'manga' },
		select: { id: true },
	})

	const favorite = await addFavorite({
		ownerId: owner.ownerId,
		params: commandParams('favorite', {
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
			mediaRelations: [
				{
					relationType: 'adaptation',
					targetIdentity: {
						provider: 'mal',
						kind: 'anime',
						externalId: '5114',
					},
					targetCatalog: { title: 'Forged adaptation' },
				},
			],
		}),
	} as any)

	expect(favorite.ownerId).toBe(owner.ownerId)
	expect(favorite.mediaId).not.toBe(unrelatedMedia.id)
	expect(favorite.title).toBe('Berserk')
	expect(
		await prisma.media.findUniqueOrThrow({
			where: { id: favorite.mediaId as string },
		}),
	).toEqual(expect.objectContaining({ title: null, thumbnail: null }))
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
	).toEqual(
		expect.objectContaining({
			mediaId: favorite.mediaId,
			hydrationReason: 'user-demand',
			hydrationRequestedAt: expect.any(Date),
		}),
	)
	expect(await prisma.mediaRelation.count()).toBe(0)
	expect(
		await prisma.mediaExternalId.findFirst({
			where: { externalId: '5114' },
		}),
	).toBeNull()
})

test('add, update, and favorite payloads cannot overwrite trusted canonical media', async () => {
	const owner = await createOwner('anime')
	const trustedSchedule = JSON.stringify({
		source: 'mal',
		releaseDate: '2026-10-01',
		episode: 12,
	})
	const forgedSchedule = JSON.stringify({
		source: 'client',
		releaseDate: '2099-01-01',
		episode: 999,
	})
	const target = await prisma.media.create({
		data: { kind: 'anime', title: 'Trusted sequel' },
	})
	const canonical = await prisma.media.create({
		data: {
			kind: 'anime',
			title: 'Trusted canonical title',
			thumbnail: 'https://provider.example/trusted.jpg',
			description: 'Trusted provider description',
			genres: 'Drama',
			nextRelease: trustedSchedule,
			externalIds: {
				create: {
					provider: 'mal',
					kind: 'anime',
					externalId: '44001',
				},
			},
			outgoingRelations: {
				create: {
					targetMediaId: target.id,
					relationType: 'sequel',
					provider: 'mal',
				},
			},
		},
	})
	const identity = {
		provider: 'mal',
		kind: 'anime',
		externalId: '44001',
	}

	const entry = await addRow({
		ownerId: owner.ownerId,
		params: commandParams('row', {
			watchlistId: owner.watchlistId,
			position: 1,
			title: 'Private row title',
			thumbnail: 'https://member.example/private.jpg',
			description: 'Private row description',
			genres: 'Forged genre',
			nextRelease: forgedSchedule,
			mediaIdentity: identity,
			mediaRelations: [],
		}),
	} as any)

	expect(entry).toEqual(
		expect.objectContaining({
			mediaId: canonical.id,
			title: 'Private row title',
			thumbnail: 'https://member.example/private.jpg',
			description: 'Private row description',
			nextRelease: forgedSchedule,
		}),
	)
	expect(
		await prisma.media.findUniqueOrThrow({
			where: { id: canonical.id },
			select: {
				title: true,
				thumbnail: true,
				description: true,
				genres: true,
				nextRelease: true,
			},
		}),
	).toEqual({
		title: 'Trusted canonical title',
		thumbnail: 'https://provider.example/trusted.jpg',
		description: 'Trusted provider description',
		genres: 'Drama',
		nextRelease: trustedSchedule,
	})
	expect(await prisma.mediaRelation.count()).toBe(1)

	const updated = await updateEntryCommand(owner.ownerId, entry.id, {
		title: 'Updated private row title',
		thumbnail: 'https://member.example/updated.jpg',
		description: 'Updated private row description',
		genres: 'Another forged genre',
		nextRelease: null,
		mediaIdentity: identity,
		mediaRelations: [
			{
				relationType: 'prequel',
				targetIdentity: {
					provider: 'mal',
					kind: 'anime',
					externalId: '44002',
				},
				targetCatalog: { title: 'Forged prequel' },
			},
		],
	})
	expect(updated).toEqual(
		expect.objectContaining({
			title: 'Updated private row title',
			thumbnail: 'https://member.example/updated.jpg',
			description: 'Updated private row description',
			nextRelease: null,
		}),
	)

	const favorite = await addFavorite({
		ownerId: owner.ownerId,
		params: commandParams('favorite', {
			position: 1,
			title: 'Private favorite title',
			thumbnail: 'https://member.example/favorite.jpg',
			typeId: owner.listTypeId,
			mediaType: 'TV Series',
			startYear: '2099',
			mediaIdentity: identity,
			mediaRelations: [],
		}),
	} as any)
	expect(favorite).toEqual(
		expect.objectContaining({
			mediaId: canonical.id,
			title: 'Private favorite title',
			thumbnail: 'https://member.example/favorite.jpg',
			startYear: '2099',
		}),
	)

	expect(
		await prisma.media.findUniqueOrThrow({
			where: { id: canonical.id },
			select: {
				title: true,
				thumbnail: true,
				description: true,
				genres: true,
				nextRelease: true,
			},
		}),
	).toEqual({
		title: 'Trusted canonical title',
		thumbnail: 'https://provider.example/trusted.jpg',
		description: 'Trusted provider description',
		genres: 'Drama',
		nextRelease: trustedSchedule,
	})
	expect(await prisma.mediaRelation.findMany()).toEqual([
		expect.objectContaining({
			sourceMediaId: canonical.id,
			targetMediaId: target.id,
			relationType: 'sequel',
			provider: 'mal',
		}),
	])
	expect(
		await prisma.mediaExternalId.findUniqueOrThrow({
			where: {
				provider_kind_externalId: identity,
			},
		}),
	).toEqual(
		expect.objectContaining({
			hydrationReason: 'user-demand',
			hydrationRequestedAt: expect.any(Date),
		}),
	)
	expect(
		await prisma.mediaExternalId.findFirst({
			where: { externalId: '44002' },
		}),
	).toBeNull()
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

	const updated = await updateEntryCommand(owner.ownerId, entry.id, {
		title: 'Fullmetal Alchemist: Brotherhood',
		position: 99,
		mediaIdentity: {
			provider: 'mal',
			kind: 'anime',
			externalId: '5114',
		},
	})

	expect(updated.title).toBe('Fullmetal Alchemist: Brotherhood')
	expect(updated.position).toBe(1)
	expect(updated.mediaId).toEqual(expect.any(String))
	expect(updated.trackingStateId).toEqual(expect.any(String))
	expect(
		await prisma.mediaExternalId.findFirst({
			where: { externalId: '5114' },
		}),
	).toEqual(expect.objectContaining({ mediaId: updated.mediaId }))
})

test('client schedule edits remain user-owned and never update sibling snapshots', async () => {
	const owner = await createOwner('anime')
	const memberSchedule = JSON.stringify({
		releaseDate: '2026-09-01T12:00:00.000Z',
		episode: 9,
	})
	const trustedSchedule = JSON.stringify({
		source: 'mal',
		releaseDate: '2026-10-01T12:00:00.000Z',
		episode: 10,
	})
	const added = await addRow({
		ownerId: owner.ownerId,
		params: commandParams('row', {
			watchlistId: owner.watchlistId,
			position: 1,
			title: 'Schedule refresh title',
			type: 'TV Series',
			nextRelease: memberSchedule,
			mediaIdentity: {
				provider: 'mal',
				kind: 'anime',
				externalId: '55114',
			},
		}),
	} as any)
	await prisma.media.update({
		where: { id: added.mediaId as string },
		data: { nextRelease: trustedSchedule },
	})
	const sibling = await prisma.entry.create({
		data: {
			watchlistId: owner.watchlistId,
			position: 2,
			title: 'Legacy sibling snapshot',
			type: 'TV Series',
			nextRelease: memberSchedule,
			mediaId: added.mediaId,
		},
	})

	await updateEntryCommand(owner.ownerId, added.id, {
		title: 'Failed provider refresh preserves schedule',
		nextRelease: null,
		mediaIdentity: {
			provider: 'mal',
			kind: 'anime',
			externalId: '55114',
		},
	})
	expect(
		await prisma.media.findUniqueOrThrow({
			where: { id: added.mediaId as string },
			select: { nextRelease: true },
		}),
	).toEqual({ nextRelease: trustedSchedule })
	expect(
		await prisma.entry.findMany({
			where: { id: { in: [added.id, sibling.id] } },
			orderBy: { position: 'asc' },
			select: { nextRelease: true },
		}),
	).toEqual([{ nextRelease: null }, { nextRelease: memberSchedule }])
})

test('correcting canonical identity removes the superseded orphan state', async () => {
	const owner = await createOwner('anime')
	const added = await addRow({
		ownerId: owner.ownerId,
		params: commandParams('row', {
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

	const updated = await updateEntryCommand(owner.ownerId, added.id, {
		...added,
		title: 'Corrected identity',
		mediaIdentity: {
			provider: 'mal',
			kind: 'anime',
			externalId: '2',
		},
	})

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
		ownerId: owner.ownerId,
		params: commandParams('row', {
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

	const cellParams = (columnId: string, value: string) => ({
		entryId: added.id,
		columnId,
		value,
	})

	await updateEntryCellCommand(owner.ownerId, cellParams('personal', '9'))
	await updateEntryCellCommand(
		owner.ownerId,
		cellParams('length', '3 / 12 eps'),
	)
	await updateEntryCellCommand(
		owner.ownerId,
		cellParams('started', '2026-01-02'),
	)
	await updateEntryCellCommand(
		owner.ownerId,
		cellParams('finished', '2026-01-12'),
	)

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
		ownerId: owner.ownerId,
		params: commandParams('row', {
			watchlistId: owner.watchlistId,
			position: 1,
			title: 'Fullmetal Alchemist: Brotherhood',
			personal: 8,
			mediaIdentity: identity,
		}),
	} as any)
	const moved = await addRow({
		ownerId: owner.ownerId,
		params: commandParams('row', {
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

	await deleteEntryCommand(owner.ownerId, source.id)
	expect(await prisma.trackingState.count()).toBe(1)

	await deleteEntryCommand(owner.ownerId, moved.id)
	expect(await prisma.trackingState.count()).toBe(0)
})
