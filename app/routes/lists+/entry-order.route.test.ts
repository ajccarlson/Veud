import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { prisma } from '#app/utils/db.server.ts'
import { deleteEntryCommand } from '#app/utils/lists/commands/delete-entry.server.ts'
import { moveEntryCommand } from '#app/utils/lists/commands/move-entry.server.ts'
import { reorderEntriesCommand } from '#app/utils/lists/commands/reorder-entries.server.ts'

async function createUser(prefix: string) {
	const suffix = faker.string.alphanumeric({ length: 10 }).toLowerCase()
	return prisma.user.create({
		data: {
			email: `${prefix}_${suffix}@example.com`,
			username: `${prefix}_${suffix}`,
		},
	})
}

async function fixture() {
	const [owner, other] = await Promise.all([
		createUser('order_owner'),
		createUser('order_other'),
	])
	const [animeType, movieType] = await Promise.all([
		prisma.listType.upsert({
			where: { name: 'anime' },
			update: {},
			create: {
				name: 'anime',
				header: 'Anime',
				columns: '{}',
				mediaType: '["episode"]',
				completionType: '{}',
			},
		}),
		prisma.listType.upsert({
			where: { name: 'liveaction' },
			update: {},
			create: {
				name: 'liveaction',
				header: 'Live Action',
				columns: '{}',
				mediaType: '["movie"]',
				completionType: '{}',
			},
		}),
	])
	const [source, destination, foreignDestination, incompatibleDestination] =
		await Promise.all([
			prisma.watchlist.create({
				data: {
					name: 'watching',
					header: 'Watching',
					ownerId: owner.id,
					typeId: animeType.id,
				},
			}),
			prisma.watchlist.create({
				data: {
					name: 'completed',
					header: 'Completed',
					ownerId: owner.id,
					typeId: animeType.id,
				},
			}),
			prisma.watchlist.create({
				data: {
					name: 'completed',
					header: 'Other completed',
					ownerId: other.id,
					typeId: animeType.id,
				},
			}),
			prisma.watchlist.create({
				data: {
					name: 'completed-movies',
					header: 'Completed movies',
					ownerId: owner.id,
					typeId: movieType.id,
				},
			}),
		])
	const media = await prisma.media.create({ data: { kind: 'anime' } })
	const trackingState = await prisma.trackingState.create({
		data: {
			ownerId: owner.id,
			mediaId: media.id,
			status: source.name,
			statusWatchlistId: source.id,
		},
	})
	const [first, moved, third, destinationFirst, destinationSecond] =
		await Promise.all([
			prisma.entry.create({
				data: { watchlistId: source.id, position: 1, title: 'First' },
			}),
			prisma.entry.create({
				data: {
					watchlistId: source.id,
					position: 2,
					title: 'Moved',
					mediaId: media.id,
					trackingStateId: trackingState.id,
				},
			}),
			prisma.entry.create({
				data: { watchlistId: source.id, position: 3, title: 'Third' },
			}),
			prisma.entry.create({
				data: {
					watchlistId: destination.id,
					position: 1,
					title: 'Destination first',
				},
			}),
			prisma.entry.create({
				data: {
					watchlistId: destination.id,
					position: 2,
					title: 'Destination second',
				},
			}),
		])
	return {
		owner,
		source,
		destination,
		foreignDestination,
		incompatibleDestination,
		first,
		moved,
		third,
		destinationFirst,
		destinationSecond,
		trackingState,
	}
}

function moveParams(
	entryId: string,
	destinationWatchlistId: string,
	position?: number,
) {
	return {
		entryId,
		destinationWatchlistId,
		position: position ?? null,
	}
}

async function orderedEntries(watchlistId: string) {
	return prisma.entry.findMany({
		where: { watchlistId },
		orderBy: { position: 'asc' },
		select: { id: true, position: true, title: true },
	})
}

test('atomically moves an existing entry and normalizes both lists', async () => {
	const data = await fixture()
	const beforeCount = await prisma.entry.count()

	const result = await moveEntryCommand(
		data.owner.id,
		moveParams(data.moved.id, data.destination.id, 2),
	)
	expect(result).toMatchObject({
		id: data.moved.id,
		watchlistId: data.destination.id,
		position: 2,
	})
	expect(await prisma.entry.count()).toBe(beforeCount)
	expect(await orderedEntries(data.source.id)).toEqual([
		{ id: data.first.id, position: 1, title: 'First' },
		{ id: data.third.id, position: 2, title: 'Third' },
	])
	expect(await orderedEntries(data.destination.id)).toEqual([
		{
			id: data.destinationFirst.id,
			position: 1,
			title: 'Destination first',
		},
		{ id: data.moved.id, position: 2, title: 'Moved' },
		{
			id: data.destinationSecond.id,
			position: 3,
			title: 'Destination second',
		},
	])
	expect(
		await prisma.trackingState.findUniqueOrThrow({
			where: { id: data.trackingState.id },
		}),
	).toMatchObject({
		status: data.destination.name,
		statusWatchlistId: data.destination.id,
	})
})

test('rejects unauthorized and incompatible targets without changing the source', async () => {
	const data = await fixture()
	for (const [watchlistId, status] of [
		[data.foreignDestination.id, 404],
		[data.incompatibleDestination.id, 400],
	] as const) {
		const response = await moveEntryCommand(
			data.owner.id,
			moveParams(data.moved.id, watchlistId),
		).catch(error => error)
		expect(response).toBeInstanceOf(Response)
		expect((response as Response).status).toBe(status)
		expect(
			await prisma.entry.findUniqueOrThrow({ where: { id: data.moved.id } }),
		).toMatchObject({ watchlistId: data.source.id, position: 2 })
	}
})

test('rejects a canonical media kind that does not match the destination type', async () => {
	const data = await fixture()
	const manga = await prisma.media.create({ data: { kind: 'manga' } })
	const incompatibleEntry = await prisma.entry.create({
		data: {
			watchlistId: data.source.id,
			position: 4,
			title: 'Manga in a legacy anime list',
			mediaId: manga.id,
		},
	})

	const response = await moveEntryCommand(
		data.owner.id,
		moveParams(incompatibleEntry.id, data.destination.id),
	).catch(error => error)
	expect(response).toBeInstanceOf(Response)
	expect((response as Response).status).toBe(400)
	expect(
		await prisma.entry.findUniqueOrThrow({
			where: { id: incompatibleEntry.id },
		}),
	).toMatchObject({ watchlistId: data.source.id, position: 4 })
})

test('moves an entry to a typed position within the same list', async () => {
	const data = await fixture()
	await moveEntryCommand(
		data.owner.id,
		moveParams(data.first.id, data.source.id, 3),
	)
	expect(await orderedEntries(data.source.id)).toEqual([
		{ id: data.moved.id, position: 1, title: 'Moved' },
		{ id: data.third.id, position: 2, title: 'Third' },
		{ id: data.first.id, position: 3, title: 'First' },
	])
})

test('persists a complete managed-drag order and rejects stale order payloads', async () => {
	const data = await fixture()
	await reorderEntriesCommand(data.owner.id, {
		watchlistId: data.source.id,
		entryIds: [data.third.id, data.first.id, data.moved.id],
	})
	expect(await orderedEntries(data.source.id)).toEqual([
		{ id: data.third.id, position: 1, title: 'Third' },
		{ id: data.first.id, position: 2, title: 'First' },
		{ id: data.moved.id, position: 3, title: 'Moved' },
	])

	const stale = await reorderEntriesCommand(data.owner.id, {
		watchlistId: data.source.id,
		entryIds: [data.first.id, data.moved.id],
	}).catch(error => error)
	expect(stale).toBeInstanceOf(Response)
	expect((stale as Response).status).toBe(400)
	expect((await orderedEntries(data.source.id)).map(entry => entry.id)).toEqual(
		[data.third.id, data.first.id, data.moved.id],
	)
})

test('deleting an entry closes its position gap in the same transaction', async () => {
	const data = await fixture()
	await deleteEntryCommand(data.owner.id, data.moved.id)
	expect(await orderedEntries(data.source.id)).toEqual([
		{ id: data.first.id, position: 1, title: 'First' },
		{ id: data.third.id, position: 2, title: 'Third' },
	])
	expect(
		await prisma.trackingState.findUnique({
			where: { id: data.trackingState.id },
		}),
	).toBeNull()
})
