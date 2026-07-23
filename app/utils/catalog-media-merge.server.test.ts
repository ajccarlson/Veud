import { expect, test } from 'vitest'
import {
	applyCatalogMediaMerge,
	buildCatalogMediaMergePreflight,
	prepareCatalogMediaMerge,
	revertCatalogMediaMerge,
} from './catalog-media-merge.server.ts'
import {
	expectedCatalogMergeConfirmation,
	expectedCatalogMergeReversal,
} from './catalog-media-merge.ts'
import { prisma } from './db.server.ts'

const now = new Date('2026-07-23T18:00:00.000Z')

async function seedBase() {
	const [admin, owner, otherOwner, listType] = await Promise.all([
		prisma.user.create({
			data: {
				id: 'merge-admin',
				email: 'merge-admin@example.com',
				username: 'merge-admin',
			},
		}),
		prisma.user.create({
			data: {
				id: 'merge-owner',
				email: 'merge-owner@example.com',
				username: 'merge-owner',
			},
		}),
		prisma.user.create({
			data: {
				id: 'merge-other-owner',
				email: 'merge-other-owner@example.com',
				username: 'merge-other-owner',
			},
		}),
		prisma.listType.create({
			data: {
				id: 'merge-list-type',
				name: 'Merge Movies',
				header: 'Movies',
				columns: '[]',
				mediaType: 'live_action',
				completionType: 'episodes',
			},
		}),
	])
	const [sourceList, targetList, collection] = await Promise.all([
		prisma.watchlist.create({
			data: {
				id: 'merge-source-list',
				name: 'Source list',
				header: 'Source',
				ownerId: owner.id,
				typeId: listType.id,
			},
		}),
		prisma.watchlist.create({
			data: {
				id: 'merge-target-list',
				name: 'Target list',
				header: 'Target',
				ownerId: otherOwner.id,
				typeId: listType.id,
			},
		}),
		prisma.mediaCollection.create({
			data: {
				id: 'merge-collection',
				title: 'Merge collection',
				ownerId: owner.id,
			},
		}),
	])
	await prisma.media.createMany({
		data: [
			{
				id: 'merge-source',
				kind: 'movie',
				title: 'Shared title',
				description: 'Source description',
				releaseStart: new Date('2024-01-01T00:00:00.000Z'),
			},
			{
				id: 'merge-target',
				kind: 'movie',
				title: 'Different target title',
				description: null,
				releaseStart: new Date('2024-01-01T00:00:00.000Z'),
			},
			{
				id: 'merge-third',
				kind: 'movie',
				title: 'Related work',
			},
		],
	})
	const issue = await prisma.catalogQualityIssue.create({
		data: {
			id: 'merge-issue',
			fingerprint: 'merge-issue-fingerprint',
			issueType: 'possible_duplicate',
			status: 'confirmed',
			severity: 'warning',
			summary: 'Reviewed duplicate candidate',
			primaryMediaId: 'merge-source',
			secondaryMediaId: 'merge-target',
			reviewedById: admin.id,
			reviewedAt: now,
		},
	})
	return {
		admin,
		owner,
		otherOwner,
		listType,
		sourceList,
		targetList,
		collection,
		issue,
	}
}

async function seedSafeRelationInventory() {
	const base = await seedBase()
	const tracking = await prisma.trackingState.create({
		data: {
			id: 'merge-tracking',
			status: 'watching',
			ownerId: base.owner.id,
			mediaId: 'merge-source',
			statusWatchlistId: base.sourceList.id,
		},
	})
	await Promise.all([
		prisma.mediaExternalId.create({
			data: {
				id: 'merge-source-external',
				provider: 'tmdb',
				kind: 'movie',
				externalId: '9001',
				mediaId: 'merge-source',
			},
		}),
		prisma.mediaTitle.createMany({
			data: [
				{
					id: 'merge-source-title-duplicate',
					provider: 'tmdb',
					language: 'en',
					titleType: 'localized',
					value: 'Shared provider title',
					normalized: 'shared provider title',
					isPrimary: true,
					mediaId: 'merge-source',
				},
				{
					id: 'merge-target-title-duplicate',
					provider: 'tmdb',
					language: 'en',
					titleType: 'localized',
					value: 'Shared provider title',
					normalized: 'shared provider title',
					isPrimary: true,
					mediaId: 'merge-target',
				},
				{
					id: 'merge-source-title-move',
					provider: 'tmdb',
					language: '',
					titleType: 'original',
					value: 'Source original title',
					normalized: 'source original title',
					mediaId: 'merge-source',
				},
			],
		}),
		prisma.catalogFeedItem.createMany({
			data: [
				{
					id: 'merge-source-feed-duplicate',
					provider: 'tmdb',
					kind: 'movie',
					feed: 'popular',
					rank: 2,
					observedAt: now,
					mediaId: 'merge-source',
				},
				{
					id: 'merge-target-feed-duplicate',
					provider: 'tmdb',
					kind: 'movie',
					feed: 'popular',
					rank: 1,
					observedAt: now,
					mediaId: 'merge-target',
				},
				{
					id: 'merge-source-feed-move',
					provider: 'tmdb',
					kind: 'movie',
					feed: 'trending',
					rank: 4,
					observedAt: now,
					mediaId: 'merge-source',
				},
			],
		}),
		prisma.entry.create({
			data: {
				id: 'merge-entry',
				watchlistId: base.sourceList.id,
				mediaId: 'merge-source',
				trackingStateId: tracking.id,
				position: 1,
				title: 'Shared title',
			},
		}),
		prisma.userFavorite.create({
			data: {
				id: 'merge-favorite',
				position: 1,
				title: 'Shared title',
				typeId: base.listType.id,
				ownerId: base.owner.id,
				mediaId: 'merge-source',
			},
		}),
		prisma.activityEvent.create({
			data: {
				id: 'merge-activity',
				type: 'tracking-created',
				actorId: base.owner.id,
				mediaId: 'merge-source',
				trackingStateId: tracking.id,
			},
		}),
		prisma.review.create({
			data: {
				id: 'merge-review',
				body: 'Source review',
				authorId: base.owner.id,
				mediaId: 'merge-source',
			},
		}),
		prisma.diaryEntry.create({
			data: {
				id: 'merge-diary',
				loggedOn: now,
				ownerId: base.owner.id,
				mediaId: 'merge-source',
			},
		}),
		prisma.mediaCollectionItem.create({
			data: {
				id: 'merge-collection-item',
				position: 1,
				collectionId: base.collection.id,
				mediaId: 'merge-source',
			},
		}),
		prisma.releaseReminder.create({
			data: {
				id: 'merge-reminder',
				ownerId: base.owner.id,
				mediaId: 'merge-source',
			},
		}),
		prisma.mediaRelation.createMany({
			data: [
				{
					id: 'merge-self-relation',
					relationType: 'related',
					sourceMediaId: 'merge-source',
					targetMediaId: 'merge-target',
				},
				{
					id: 'merge-source-relation-duplicate',
					relationType: 'sequel',
					sourceMediaId: 'merge-source',
					targetMediaId: 'merge-third',
				},
				{
					id: 'merge-target-relation-duplicate',
					relationType: 'sequel',
					sourceMediaId: 'merge-target',
					targetMediaId: 'merge-third',
				},
			],
		}),
		prisma.catalogQualityIssue.create({
			data: {
				id: 'merge-secondary-quality',
				fingerprint: 'merge-secondary-quality-fingerprint',
				issueType: 'missing_image',
				status: 'open',
				severity: 'info',
				summary: 'Source image missing',
				primaryMediaId: 'merge-source',
			},
		}),
	])
	return base
}

test('applies and reverses a complete safe relation inventory without data loss', async () => {
	const { admin, issue } = await seedSafeRelationInventory()
	const preflight = await buildCatalogMediaMergePreflight(prisma, {
		issueId: issue.id,
		targetMediaId: 'merge-target',
		now,
	})
	expect(preflight.safe).toBe(true)
	expect(preflight.prunes).toEqual({
		titles: 1,
		catalogFeedItems: 1,
		relations: 2,
	})
	expect(preflight.targetFills).toContain('description')
	expect(preflight.targetConflicts).toContain('title')

	const prepared = await prepareCatalogMediaMerge(prisma, {
		issueId: issue.id,
		targetMediaId: 'merge-target',
		actorId: admin.id,
		now,
	})
	const applied = await applyCatalogMediaMerge(prisma, {
		mergeId: prepared.merge.id,
		actorId: admin.id,
		confirmation: expectedCatalogMergeConfirmation(
			'merge-source',
			'merge-target',
		),
		now: new Date(now.getTime() + 1_000),
	})
	expect(applied.merge.status).toBe('applied')
	expect(
		await prisma.media.findUnique({ where: { id: 'merge-source' } }),
	).toBeNull()
	expect(
		await prisma.media.findUniqueOrThrow({
			where: { id: 'merge-target' },
			select: { description: true },
		}),
	).toEqual({ description: 'Source description' })
	expect(
		await prisma.mediaExternalId.findUniqueOrThrow({
			where: { id: 'merge-source-external' },
			select: { mediaId: true },
		}),
	).toEqual({ mediaId: 'merge-target' })
	expect(
		await prisma.catalogQualityIssue.findUniqueOrThrow({
			where: { id: issue.id },
			select: {
				status: true,
				primaryMediaId: true,
				secondaryMediaId: true,
			},
		}),
	).toEqual({
		status: 'resolved',
		primaryMediaId: 'merge-target',
		secondaryMediaId: null,
	})
	expect(await prisma.mediaTitle.count()).toBe(2)
	expect(await prisma.catalogFeedItem.count()).toBe(2)
	expect(await prisma.mediaRelation.count()).toBe(1)

	const reverted = await revertCatalogMediaMerge(prisma, {
		mergeId: prepared.merge.id,
		actorId: admin.id,
		confirmation: expectedCatalogMergeReversal(prepared.merge.id),
		now: new Date(now.getTime() + 2_000),
	})
	expect(reverted.status).toBe('reverted')
	expect(
		await prisma.media.findUniqueOrThrow({
			where: { id: 'merge-source' },
			select: { description: true },
		}),
	).toEqual({ description: 'Source description' })
	expect(
		await prisma.media.findUniqueOrThrow({
			where: { id: 'merge-target' },
			select: { description: true },
		}),
	).toEqual({ description: null })
	expect(
		await prisma.mediaExternalId.findUniqueOrThrow({
			where: { id: 'merge-source-external' },
			select: { mediaId: true },
		}),
	).toEqual({ mediaId: 'merge-source' })
	expect(await prisma.mediaTitle.count()).toBe(3)
	expect(await prisma.catalogFeedItem.count()).toBe(3)
	expect(await prisma.mediaRelation.count()).toBe(3)
	expect(
		await prisma.catalogQualityIssue.findUniqueOrThrow({
			where: { id: issue.id },
			select: {
				status: true,
				primaryMediaId: true,
				secondaryMediaId: true,
			},
		}),
	).toEqual({
		status: 'confirmed',
		primaryMediaId: 'merge-source',
		secondaryMediaId: 'merge-target',
	})
	expect(
		await prisma.catalogMediaMergeEvent.findMany({
			where: { mergeId: prepared.merge.id },
			orderBy: { createdAt: 'asc' },
			select: { action: true, nextStatus: true },
		}),
	).toEqual([
		{ action: 'prepare', nextStatus: 'planned' },
		{ action: 'apply', nextStatus: 'applied' },
		{ action: 'revert', nextStatus: 'reverted' },
	])
})

test('preflight reports every ambiguous member-owned collision and apply refuses', async () => {
	const base = await seedBase()
	await Promise.all([
		prisma.entry.createMany({
			data: [
				{
					id: 'collision-source-entry',
					watchlistId: base.sourceList.id,
					mediaId: 'merge-source',
					position: 1,
					title: 'Source',
				},
				{
					id: 'collision-target-entry',
					watchlistId: base.sourceList.id,
					mediaId: 'merge-target',
					position: 2,
					title: 'Target',
				},
			],
		}),
		prisma.userFavorite.createMany({
			data: [
				{
					id: 'collision-source-favorite',
					position: 1,
					title: 'Source',
					typeId: base.listType.id,
					ownerId: base.owner.id,
					mediaId: 'merge-source',
				},
				{
					id: 'collision-target-favorite',
					position: 2,
					title: 'Target',
					typeId: base.listType.id,
					ownerId: base.owner.id,
					mediaId: 'merge-target',
				},
			],
		}),
		prisma.trackingState.createMany({
			data: [
				{
					id: 'collision-source-tracking',
					status: 'watching',
					ownerId: base.owner.id,
					mediaId: 'merge-source',
				},
				{
					id: 'collision-target-tracking',
					status: 'completed',
					ownerId: base.owner.id,
					mediaId: 'merge-target',
				},
			],
		}),
		prisma.review.createMany({
			data: [
				{
					id: 'collision-source-review',
					body: 'Source',
					authorId: base.owner.id,
					mediaId: 'merge-source',
				},
				{
					id: 'collision-target-review',
					body: 'Target',
					authorId: base.owner.id,
					mediaId: 'merge-target',
				},
			],
		}),
		prisma.mediaCollectionItem.createMany({
			data: [
				{
					id: 'collision-source-collection',
					position: 1,
					collectionId: base.collection.id,
					mediaId: 'merge-source',
				},
				{
					id: 'collision-target-collection',
					position: 2,
					collectionId: base.collection.id,
					mediaId: 'merge-target',
				},
			],
		}),
		prisma.releaseReminder.createMany({
			data: [
				{
					id: 'collision-source-reminder',
					ownerId: base.owner.id,
					mediaId: 'merge-source',
				},
				{
					id: 'collision-target-reminder',
					ownerId: base.owner.id,
					mediaId: 'merge-target',
				},
			],
		}),
	])
	const prepared = await prepareCatalogMediaMerge(prisma, {
		issueId: base.issue.id,
		targetMediaId: 'merge-target',
		actorId: base.admin.id,
		now,
	})
	expect(prepared.preflight.safe).toBe(false)
	expect(prepared.preflight.blockers.map(blocker => blocker.code)).toEqual(
		expect.arrayContaining([
			'watchlist-entry-collision',
			'favorite-collision',
			'tracking-state-collision',
			'review-collision',
			'collection-item-collision',
			'release-reminder-collision',
		]),
	)
	await expect(
		applyCatalogMediaMerge(prisma, {
			mergeId: prepared.merge.id,
			actorId: base.admin.id,
			confirmation: expectedCatalogMergeConfirmation(
				'merge-source',
				'merge-target',
			),
			now: new Date(now.getTime() + 1_000),
		}),
	).rejects.toThrow('blocked')
	expect(
		await prisma.catalogMediaMerge.findUniqueOrThrow({
			where: { id: prepared.merge.id },
			select: { status: true },
		}),
	).toEqual({ status: 'planned' })
	expect(await prisma.media.count()).toBe(3)
})

test('apply rejects a preflight when the relation inventory changes', async () => {
	const base = await seedBase()
	const prepared = await prepareCatalogMediaMerge(prisma, {
		issueId: base.issue.id,
		targetMediaId: 'merge-target',
		actorId: base.admin.id,
		now,
	})
	await prisma.diaryEntry.create({
		data: {
			id: 'merge-late-diary',
			loggedOn: now,
			ownerId: base.owner.id,
			mediaId: 'merge-source',
		},
	})
	await expect(
		applyCatalogMediaMerge(prisma, {
			mergeId: prepared.merge.id,
			actorId: base.admin.id,
			confirmation: expectedCatalogMergeConfirmation(
				'merge-source',
				'merge-target',
			),
			now: new Date(now.getTime() + 1_000),
		}),
	).rejects.toThrow('stale')
	expect(
		await prisma.catalogMediaMerge.findUniqueOrThrow({
			where: { id: prepared.merge.id },
			select: { status: true },
		}),
	).toEqual({ status: 'planned' })
})

test('preparation refuses to overwrite a claimed merge state', async () => {
	const { admin, issue } = await seedBase()
	const prepared = await prepareCatalogMediaMerge(prisma, {
		issueId: issue.id,
		targetMediaId: 'merge-target',
		actorId: admin.id,
		now,
	})
	await prisma.catalogMediaMerge.update({
		where: { id: prepared.merge.id },
		data: { status: 'applying' },
	})

	await expect(
		prepareCatalogMediaMerge(prisma, {
			issueId: issue.id,
			targetMediaId: 'merge-source',
			actorId: admin.id,
			now,
		}),
	).rejects.toThrow('merge in progress')
	expect(
		await prisma.catalogMediaMerge.findUniqueOrThrow({
			where: { id: prepared.merge.id },
			select: { status: true, sourceMediaId: true, targetMediaId: true },
		}),
	).toEqual({
		status: 'applying',
		sourceMediaId: 'merge-source',
		targetMediaId: 'merge-target',
	})
})

test('reversal refuses to overwrite target metadata changed after apply', async () => {
	const base = await seedBase()
	const prepared = await prepareCatalogMediaMerge(prisma, {
		issueId: base.issue.id,
		targetMediaId: 'merge-target',
		actorId: base.admin.id,
		now,
	})
	await applyCatalogMediaMerge(prisma, {
		mergeId: prepared.merge.id,
		actorId: base.admin.id,
		confirmation: expectedCatalogMergeConfirmation(
			'merge-source',
			'merge-target',
		),
		now: new Date(now.getTime() + 1_000),
	})
	await prisma.media.update({
		where: { id: 'merge-target' },
		data: { description: 'Provider refreshed after merge' },
	})
	await expect(
		revertCatalogMediaMerge(prisma, {
			mergeId: prepared.merge.id,
			actorId: base.admin.id,
			confirmation: expectedCatalogMergeReversal(prepared.merge.id),
			now: new Date(now.getTime() + 2_000),
		}),
	).rejects.toThrow('description changed')
	expect(
		await prisma.media.findUnique({ where: { id: 'merge-source' } }),
	).toBeNull()
	expect(
		await prisma.catalogMediaMerge.findUniqueOrThrow({
			where: { id: prepared.merge.id },
			select: { status: true },
		}),
	).toEqual({ status: 'applied' })
})
