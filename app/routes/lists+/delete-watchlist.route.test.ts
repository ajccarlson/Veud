import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { prisma } from '#app/utils/db.server.ts'
import { deleteWatchlistCommand } from '#app/utils/lists/commands/delete-watchlist.server.ts'
import { updateWatchlistSettingsCommand } from '#app/utils/lists/commands/update-watchlist-settings.server.ts'
import { publicActivityEventWhere } from '#app/utils/lists/visibility.ts'

async function createUserRecord() {
	const suffix = faker.string.alphanumeric({ length: 12 }).toLowerCase()
	return prisma.user.create({
		data: { email: `${suffix}@example.com`, username: `u_${suffix}` },
		select: { id: true },
	})
}

async function seedOwnedWatchlist() {
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
		select: { id: true, watchlists: { select: { id: true, typeId: true } } },
	})
	const wl = owner.watchlists[0]
	if (!wl) throw new Error('test setup: watchlist was not created')
	return { userId: owner.id, watchlistId: wl.id, listTypeId: wl.typeId }
}

test('the owner can delete their own watchlist', async () => {
	const { userId, watchlistId } = await seedOwnedWatchlist()

	const result = await deleteWatchlistCommand(userId, watchlistId)

	expect(result).toBe(true)
	const gone = await prisma.watchlist.findUnique({ where: { id: watchlistId } })
	expect(gone).toBeNull()
})

test('deleting the current list restores a surviving private tracking status', async () => {
	const { userId, watchlistId, listTypeId } = await seedOwnedWatchlist()
	const privateList = await prisma.watchlist.create({
		data: {
			ownerId: userId,
			typeId: listTypeId,
			name: 'private-backlog',
			header: 'Private backlog',
			position: 2,
			isPublic: false,
		},
	})
	const media = await prisma.media.create({
		data: { kind: 'movie', title: 'Deletion privacy title' },
	})
	const state = await prisma.trackingState.create({
		data: {
			ownerId: userId,
			mediaId: media.id,
			status: 'public-current',
			statusWatchlistId: watchlistId,
		},
	})
	await prisma.entry.createMany({
		data: [
			{
				watchlistId,
				mediaId: media.id,
				trackingStateId: state.id,
				position: 1,
				title: media.title ?? 'Deletion privacy title',
			},
			{
				watchlistId: privateList.id,
				mediaId: media.id,
				trackingStateId: state.id,
				position: 1,
				title: media.title ?? 'Deletion privacy title',
			},
		],
	})

	await deleteWatchlistCommand(userId, watchlistId)

	const reconciled = await prisma.trackingState.findUniqueOrThrow({
		where: { id: state.id },
	})
	expect(reconciled.statusWatchlistId).toBe(privateList.id)
	expect(reconciled.status).toBe(privateList.name)
	const event = await prisma.activityEvent.findFirstOrThrow({
		where: { trackingStateId: state.id },
		orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
	})
	expect(event).toEqual(
		expect.objectContaining({
			statusWatchlistId: privateList.id,
			previousStatusLabel: 'LiveAction',
			previousStatusWatchlistId: null,
			isPublic: false,
		}),
	)
})

test('deleting a list quarantines linked activity across later header reuse', async () => {
	const { userId, watchlistId, listTypeId } = await seedOwnedWatchlist()
	const media = await prisma.media.create({
		data: { kind: 'movie', title: 'Deleted provenance fixture' },
	})
	const event = await prisma.activityEvent.create({
		data: {
			type: 'score',
			actorId: userId,
			mediaId: media.id,
			statusWatchlistId: watchlistId,
			statusLabel: 'LiveAction',
			score: 8,
			isPublic: true,
			publicEligible: true,
		},
	})

	await deleteWatchlistCommand(userId, watchlistId)

	expect(
		await prisma.activityEvent.findUniqueOrThrow({
			where: { id: event.id },
			select: {
				statusWatchlistId: true,
				isPublic: true,
				publicEligible: true,
			},
		}),
	).toEqual({
		statusWatchlistId: null,
		isPublic: false,
		publicEligible: true,
	})

	const replacement = await prisma.watchlist.create({
		data: {
			ownerId: userId,
			typeId: listTypeId,
			name: 'replacement',
			header: 'LiveAction',
			position: 1,
			isPublic: false,
		},
	})
	await updateWatchlistSettingsCommand(userId, replacement.id, {
		isPublic: true,
	})

	expect(
		await prisma.activityEvent.findUniqueOrThrow({
			where: { id: event.id },
			select: { statusWatchlistId: true, isPublic: true },
		}),
	).toEqual({ statusWatchlistId: null, isPublic: false })
	expect(
		await prisma.activityEvent.findFirst({
			where: { id: event.id, AND: [publicActivityEventWhere] },
		}),
	).toBeNull()
})

test('a logged-in non-owner cannot delete the watchlist (404, and it survives)', async () => {
	const { watchlistId } = await seedOwnedWatchlist()
	const other = await createUserRecord()

	const res = await deleteWatchlistCommand(other.id, watchlistId).catch(e => e)

	expect(res).toBeInstanceOf(Response)
	expect((res as Response).status).toBe(404)
	const survived = await prisma.watchlist.findUnique({
		where: { id: watchlistId },
	})
	expect(survived).not.toBeNull()
})
