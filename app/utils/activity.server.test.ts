import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import {
	getTrackingActivityState,
	recordTrackingActivityDiff,
} from './activity.server.ts'
import { prisma } from './db.server.ts'
import { publicActivityEventWhere } from './lists/visibility.ts'

async function user(prefix: string) {
	const suffix = faker.string.alphanumeric({ length: 12 }).toLowerCase()
	return prisma.user.create({
		data: {
			email: `${prefix}-${suffix}@example.com`,
			username: `${prefix}_${suffix}`,
		},
	})
}

test('tracking activity rejects cross-owner watchlist provenance', async () => {
	const [actor, other] = await Promise.all([user('actor'), user('other')])
	const listType = await prisma.listType.create({
		data: {
			name: `activity-${faker.string.uuid()}`,
			header: 'Activity',
			columns: '[]',
			mediaType: 'liveAction',
			completionType: 'watched',
		},
	})
	const foreignList = await prisma.watchlist.create({
		data: {
			ownerId: other.id,
			typeId: listType.id,
			name: 'foreign',
			header: 'Foreign list',
			position: 1,
			isPublic: true,
		},
	})
	const media = await prisma.media.create({
		data: { kind: 'movie', title: 'Cross-owner provenance fixture' },
	})
	const state = await prisma.trackingState.create({
		data: {
			ownerId: actor.id,
			mediaId: media.id,
			status: 'watching',
			statusWatchlistId: foreignList.id,
		},
	})

	await prisma.$transaction(async tx => {
		const after = await getTrackingActivityState(tx, actor.id, media.id)
		if (!after) throw new Error('test setup: tracking state was not created')
		await recordTrackingActivityDiff(tx, {
			actorId: actor.id,
			mediaId: media.id,
			before: null,
			after,
		})
	})

	expect(
		await prisma.activityEvent.findFirstOrThrow({
			where: { actorId: actor.id, trackingStateId: state.id },
			select: {
				statusLabel: true,
				statusWatchlistId: true,
				isPublic: true,
				publicEligible: true,
			},
		}),
	).toEqual({
		statusLabel: null,
		statusWatchlistId: foreignList.id,
		isPublic: false,
		publicEligible: false,
	})
})

test('tracking activity rejects cross-owner previous-list provenance', async () => {
	const [actor, other] = await Promise.all([
		user('move_actor'),
		user('move_other'),
	])
	const listType = await prisma.listType.create({
		data: {
			name: `move-activity-${faker.string.uuid()}`,
			header: 'Move activity',
			columns: '[]',
			mediaType: 'liveAction',
			completionType: 'watched',
		},
	})
	const [ownedList, foreignList] = await Promise.all([
		prisma.watchlist.create({
			data: {
				ownerId: actor.id,
				typeId: listType.id,
				name: 'owned',
				header: 'Owned list',
				position: 1,
			},
		}),
		prisma.watchlist.create({
			data: {
				ownerId: other.id,
				typeId: listType.id,
				name: 'foreign',
				header: 'Foreign previous list',
				position: 1,
			},
		}),
	])
	const media = await prisma.media.create({
		data: { kind: 'movie', title: 'Cross-owner previous fixture' },
	})
	await prisma.trackingState.create({
		data: {
			ownerId: actor.id,
			mediaId: media.id,
			status: 'watching',
			statusWatchlistId: ownedList.id,
		},
	})

	await prisma.$transaction(async tx => {
		const after = await getTrackingActivityState(tx, actor.id, media.id)
		if (!after) throw new Error('test setup: tracking state was not created')
		await recordTrackingActivityDiff(tx, {
			actorId: actor.id,
			mediaId: media.id,
			before: {
				...after,
				status: 'planned',
				statusWatchlistId: foreignList.id,
			},
			after,
		})
	})

	expect(
		await prisma.activityEvent.findFirstOrThrow({
			where: { actorId: actor.id, mediaId: media.id },
			select: {
				statusLabel: true,
				previousStatusLabel: true,
				previousStatusWatchlistId: true,
				isPublic: true,
				publicEligible: true,
			},
		}),
	).toEqual({
		statusLabel: ownedList.header,
		previousStatusLabel: null,
		previousStatusWatchlistId: foreignList.id,
		isPublic: false,
		publicEligible: false,
	})
})

test('genuinely listless tracking activity is public-eligible', async () => {
	const actor = await user('listless_actor')
	const media = await prisma.media.create({
		data: { kind: 'movie', title: 'Listless provenance fixture' },
	})
	await prisma.trackingState.create({
		data: {
			ownerId: actor.id,
			mediaId: media.id,
			status: 'planned',
		},
	})

	await prisma.$transaction(async tx => {
		const after = await getTrackingActivityState(tx, actor.id, media.id)
		if (!after) throw new Error('test setup: tracking state was not created')
		await recordTrackingActivityDiff(tx, {
			actorId: actor.id,
			mediaId: media.id,
			before: null,
			after,
		})
	})

	expect(
		await prisma.activityEvent.findFirstOrThrow({
			where: { actorId: actor.id, AND: [publicActivityEventWhere] },
			select: {
				statusLabel: true,
				statusWatchlistId: true,
				isPublic: true,
				publicEligible: true,
			},
		}),
	).toEqual({
		statusLabel: null,
		statusWatchlistId: null,
		isPublic: true,
		publicEligible: true,
	})
})

test('tracking activity created on a private list is never public-eligible', async () => {
	const actor = await user('private_actor')
	const listType = await prisma.listType.create({
		data: {
			name: `private-activity-${faker.string.uuid()}`,
			header: 'Private activity',
			columns: '[]',
			mediaType: 'liveAction',
			completionType: 'watched',
		},
	})
	const privateList = await prisma.watchlist.create({
		data: {
			ownerId: actor.id,
			typeId: listType.id,
			name: 'private',
			header: 'Private history label',
			position: 1,
			isPublic: false,
		},
	})
	const media = await prisma.media.create({
		data: { kind: 'movie', title: 'Private provenance fixture' },
	})
	await prisma.trackingState.create({
		data: {
			ownerId: actor.id,
			mediaId: media.id,
			status: 'watching',
			statusWatchlistId: privateList.id,
		},
	})

	await prisma.$transaction(async tx => {
		const after = await getTrackingActivityState(tx, actor.id, media.id)
		if (!after) throw new Error('test setup: tracking state was not created')
		await recordTrackingActivityDiff(tx, {
			actorId: actor.id,
			mediaId: media.id,
			before: null,
			after,
		})
	})

	expect(
		await prisma.activityEvent.findFirstOrThrow({
			where: { actorId: actor.id, mediaId: media.id },
			select: { statusLabel: true, isPublic: true, publicEligible: true },
		}),
	).toEqual({
		statusLabel: privateList.header,
		isPublic: false,
		publicEligible: false,
	})
})

test('score and progress labels fail closed across a direct watchlist deletion', async () => {
	const actor = await user('delete_actor')
	const listType = await prisma.listType.create({
		data: {
			name: `delete-activity-${faker.string.uuid()}`,
			header: 'Delete activity',
			columns: '[]',
			mediaType: 'liveAction',
			completionType: 'watched',
		},
	})
	const publicList = await prisma.watchlist.create({
		data: {
			ownerId: actor.id,
			typeId: listType.id,
			name: 'watching',
			header: 'Public history label',
			position: 1,
			isPublic: true,
		},
	})
	const media = await prisma.media.create({
		data: { kind: 'movie', title: 'Deletion race fixture' },
	})
	await prisma.trackingState.create({
		data: {
			ownerId: actor.id,
			mediaId: media.id,
			status: 'watching',
			statusWatchlistId: publicList.id,
			score: 8,
			progress: { create: { unit: 'episode', current: 2, total: 12 } },
		},
	})

	await prisma.$transaction(async tx => {
		const after = await getTrackingActivityState(tx, actor.id, media.id)
		if (!after) throw new Error('test setup: tracking state was not created')
		await recordTrackingActivityDiff(tx, {
			actorId: actor.id,
			mediaId: media.id,
			before: {
				...after,
				score: null,
				progress: [{ unit: 'episode', current: 0, total: 12 }],
			},
			after,
		})
	})

	await prisma.watchlist.delete({ where: { id: publicList.id } })

	expect(
		await prisma.activityEvent.findMany({
			where: { actorId: actor.id, type: { in: ['score', 'progress'] } },
			orderBy: { type: 'asc' },
			select: {
				type: true,
				statusLabel: true,
				statusWatchlistId: true,
				isPublic: true,
				publicEligible: true,
			},
		}),
	).toEqual([
		{
			type: 'progress',
			statusLabel: publicList.header,
			statusWatchlistId: null,
			isPublic: true,
			publicEligible: true,
		},
		{
			type: 'score',
			statusLabel: publicList.header,
			statusWatchlistId: null,
			isPublic: true,
			publicEligible: true,
		},
	])
	expect(
		await prisma.activityEvent.findMany({
			where: { actorId: actor.id, AND: [publicActivityEventWhere] },
		}),
	).toEqual([])
})
