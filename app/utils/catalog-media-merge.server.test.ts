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
const sourceNextRelease = JSON.stringify({
	source: 'tmdb',
	observedAt: now.toISOString(),
	releaseDate: '2026-07-30T18:00:00.000Z',
	episode: 3,
})

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
				nextRelease: sourceNextRelease,
				runtimeMinutes: 96,
				episodeCount: 12,
				chapterCount: 50,
				volumeCount: 8,
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
	const season = await prisma.mediaSeason.create({
		data: {
			id: 'merge-season',
			number: 1,
			title: 'Source season',
			mediaId: 'merge-source',
		},
	})
	const installment = await prisma.mediaInstallment.create({
		data: {
			id: 'merge-installment',
			kind: 'episode',
			seasonNumber: 1,
			number: 1,
			title: 'Source episode',
			mediaId: 'merge-source',
			seasonId: season.id,
		},
	})
	const importBatch = await prisma.libraryImportBatch.create({
		data: {
			id: 'merge-import-batch',
			provider: 'mal',
			fileName: 'merge-test.xml',
			itemCount: 1,
			matchedCount: 1,
			ambiguousCount: 0,
			unmatchedCount: 0,
			conflictCount: 0,
			ownerId: base.owner.id,
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
				publicEligible: true,
			},
		}),
		prisma.consumptionEvent.create({
			data: {
				id: 'merge-consumption',
				unit: 'episodes',
				progressFrom: 0,
				progressTo: 1,
				ownerId: base.owner.id,
				mediaId: 'merge-source',
				trackingStateId: tracking.id,
				installmentId: installment.id,
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
		prisma.releaseOccurrence.createMany({
			data: [
				{
					id: 'merge-source-next-occurrence',
					source: 'tmdb',
					sourceKey: 'next',
					eventType: 'episode',
					releaseAt: new Date('2026-07-30T18:00:00.000Z'),
					episode: 3,
					observedAt: now,
					expiresAt: new Date('2026-08-06T18:00:00.000Z'),
					mediaId: 'merge-source',
				},
				{
					id: 'merge-source-release-occurrence',
					source: 'tmdb',
					sourceKey: 'episode:season-1:episode-2',
					eventType: 'episode',
					releaseAt: new Date('2026-08-06T18:00:00.000Z'),
					season: 1,
					episode: 2,
					observedAt: now,
					expiresAt: new Date('2026-08-20T18:00:00.000Z'),
					mediaId: 'merge-source',
				},
			],
		}),
		prisma.catalogMetricSnapshot.create({
			data: {
				id: 'merge-metric-snapshot',
				provider: 'tmdb',
				kind: 'movie',
				observedAt: now,
				audience: 500,
				mediaId: 'merge-source',
			},
		}),
		prisma.recommendationFeedback.create({
			data: {
				id: 'merge-recommendation-feedback',
				feedbackType: 'not-interested',
				ownerId: base.owner.id,
				mediaId: 'merge-source',
			},
		}),
		prisma.libraryImportItem.create({
			data: {
				id: 'merge-import-item',
				sourceKey: 'source-item',
				payload: '{}',
				matchState: 'matched',
				batchId: importBatch.id,
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
	expect(preflight.moves).toMatchObject({
		seasons: 1,
		installments: 1,
		consumptionEvents: 1,
		releaseOccurrences: 1,
		catalogMetricSnapshots: 1,
		recommendationFeedback: 1,
		libraryImportItems: 1,
	})
	expect(preflight.targetFills).toContain('description')
	expect(preflight.targetFills).toEqual(
		expect.arrayContaining([
			'runtimeMinutes',
			'episodeCount',
			'chapterCount',
			'volumeCount',
		]),
	)
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
			select: {
				description: true,
				nextRelease: true,
				nextReleaseAt: true,
				runtimeMinutes: true,
				episodeCount: true,
				chapterCount: true,
				volumeCount: true,
			},
		}),
	).toEqual({
		description: 'Source description',
		nextRelease: sourceNextRelease,
		nextReleaseAt: new Date('2026-07-30T18:00:00.000Z'),
		runtimeMinutes: 96,
		episodeCount: 12,
		chapterCount: 50,
		volumeCount: 8,
	})
	expect(
		await prisma.releaseOccurrence.findMany({
			where: { mediaId: 'merge-target' },
			orderBy: { sourceKey: 'asc' },
			select: {
				id: true,
				source: true,
				sourceKey: true,
				releaseAt: true,
				episode: true,
			},
		}),
	).toEqual([
		{
			id: 'merge-source-release-occurrence',
			source: 'tmdb',
			sourceKey: 'episode:season-1:episode-2',
			releaseAt: new Date('2026-08-06T18:00:00.000Z'),
			episode: 2,
		},
		{
			id: expect.any(String),
			source: 'tmdb',
			sourceKey: 'next',
			releaseAt: new Date('2026-07-30T18:00:00.000Z'),
			episode: 3,
		},
	])
	expect(
		await prisma.releaseOccurrence.findUnique({
			where: { id: 'merge-source-next-occurrence' },
		}),
	).toBeNull()
	expect(
		await prisma.mediaExternalId.findUniqueOrThrow({
			where: { id: 'merge-source-external' },
			select: { mediaId: true },
		}),
	).toEqual({ mediaId: 'merge-target' })
	expect(
		await Promise.all([
			prisma.mediaSeason.findUniqueOrThrow({
				where: { id: 'merge-season' },
				select: { mediaId: true },
			}),
			prisma.mediaInstallment.findUniqueOrThrow({
				where: { id: 'merge-installment' },
				select: { mediaId: true, seasonId: true },
			}),
			prisma.consumptionEvent.findUniqueOrThrow({
				where: { id: 'merge-consumption' },
				select: { mediaId: true, installmentId: true },
			}),
			prisma.catalogMetricSnapshot.findUniqueOrThrow({
				where: { id: 'merge-metric-snapshot' },
				select: { mediaId: true },
			}),
			prisma.recommendationFeedback.findUniqueOrThrow({
				where: { id: 'merge-recommendation-feedback' },
				select: { mediaId: true },
			}),
			prisma.libraryImportItem.findUniqueOrThrow({
				where: { id: 'merge-import-item' },
				select: { mediaId: true },
			}),
		]),
	).toEqual([
		{ mediaId: 'merge-target' },
		{ mediaId: 'merge-target', seasonId: 'merge-season' },
		{
			mediaId: 'merge-target',
			installmentId: 'merge-installment',
		},
		{ mediaId: 'merge-target' },
		{ mediaId: 'merge-target' },
		{ mediaId: 'merge-target' },
	])
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
	expect(
		await prisma.activityEvent.findUniqueOrThrow({
			where: { id: 'merge-activity' },
			select: { mediaId: true, publicEligible: true },
		}),
	).toEqual({ mediaId: 'merge-target', publicEligible: true })

	const reverted = await revertCatalogMediaMerge(prisma, {
		mergeId: prepared.merge.id,
		actorId: admin.id,
		confirmation: expectedCatalogMergeReversal(prepared.merge.id),
		now: new Date(now.getTime() + 2_000),
	})
	expect(reverted.status).toBe('reverted')
	expect(
		await prisma.activityEvent.findUniqueOrThrow({
			where: { id: 'merge-activity' },
			select: { mediaId: true, publicEligible: true },
		}),
	).toEqual({ mediaId: 'merge-source', publicEligible: true })
	expect(
		await prisma.media.findUniqueOrThrow({
			where: { id: 'merge-source' },
			select: {
				description: true,
				nextRelease: true,
				nextReleaseAt: true,
				runtimeMinutes: true,
				episodeCount: true,
				chapterCount: true,
				volumeCount: true,
			},
		}),
	).toEqual({
		description: 'Source description',
		nextRelease: sourceNextRelease,
		nextReleaseAt: new Date('2026-07-30T18:00:00.000Z'),
		runtimeMinutes: 96,
		episodeCount: 12,
		chapterCount: 50,
		volumeCount: 8,
	})
	expect(
		await prisma.media.findUniqueOrThrow({
			where: { id: 'merge-target' },
			select: {
				description: true,
				nextRelease: true,
				nextReleaseAt: true,
				runtimeMinutes: true,
				episodeCount: true,
				chapterCount: true,
				volumeCount: true,
			},
		}),
	).toEqual({
		description: null,
		nextRelease: null,
		nextReleaseAt: null,
		runtimeMinutes: null,
		episodeCount: null,
		chapterCount: null,
		volumeCount: null,
	})
	expect(
		await prisma.releaseOccurrence.findMany({
			orderBy: [{ mediaId: 'asc' }, { sourceKey: 'asc' }],
			select: {
				mediaId: true,
				source: true,
				sourceKey: true,
				releaseAt: true,
			},
		}),
	).toEqual([
		{
			mediaId: 'merge-source',
			source: 'tmdb',
			sourceKey: 'episode:season-1:episode-2',
			releaseAt: new Date('2026-08-06T18:00:00.000Z'),
		},
		{
			mediaId: 'merge-source',
			source: 'tmdb',
			sourceKey: 'next',
			releaseAt: new Date('2026-07-30T18:00:00.000Z'),
		},
	])
	expect(
		await prisma.mediaExternalId.findUniqueOrThrow({
			where: { id: 'merge-source-external' },
			select: { mediaId: true },
		}),
	).toEqual({ mediaId: 'merge-source' })
	expect(
		await Promise.all([
			prisma.mediaSeason.findUniqueOrThrow({
				where: { id: 'merge-season' },
				select: { mediaId: true },
			}),
			prisma.mediaInstallment.findUniqueOrThrow({
				where: { id: 'merge-installment' },
				select: { mediaId: true, seasonId: true },
			}),
			prisma.consumptionEvent.findUniqueOrThrow({
				where: { id: 'merge-consumption' },
				select: { mediaId: true, installmentId: true },
			}),
			prisma.releaseOccurrence.findUniqueOrThrow({
				where: { id: 'merge-source-release-occurrence' },
				select: { mediaId: true },
			}),
			prisma.catalogMetricSnapshot.findUniqueOrThrow({
				where: { id: 'merge-metric-snapshot' },
				select: { mediaId: true },
			}),
			prisma.recommendationFeedback.findUniqueOrThrow({
				where: { id: 'merge-recommendation-feedback' },
				select: { mediaId: true },
			}),
			prisma.libraryImportItem.findUniqueOrThrow({
				where: { id: 'merge-import-item' },
				select: { mediaId: true },
			}),
		]),
	).toEqual([
		{ mediaId: 'merge-source' },
		{ mediaId: 'merge-source', seasonId: 'merge-season' },
		{
			mediaId: 'merge-source',
			installmentId: 'merge-installment',
		},
		{ mediaId: 'merge-source' },
		{ mediaId: 'merge-source' },
		{ mediaId: 'merge-source' },
		{ mediaId: 'merge-source' },
	])
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
		prisma.recommendationFeedback.createMany({
			data: [
				{
					id: 'collision-source-feedback',
					feedbackType: 'not-interested',
					ownerId: base.owner.id,
					mediaId: 'merge-source',
				},
				{
					id: 'collision-target-feedback',
					feedbackType: 'not-interested',
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
			'recommendation-feedback-collision',
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

test('preflight blocks colliding structural catalog rows without deleting either side', async () => {
	const base = await seedBase()
	await prisma.mediaSeason.createMany({
		data: [
			{
				id: 'collision-source-season',
				number: 1,
				mediaId: 'merge-source',
			},
			{
				id: 'collision-target-season',
				number: 1,
				mediaId: 'merge-target',
			},
		],
	})
	await Promise.all([
		prisma.mediaInstallment.createMany({
			data: [
				{
					id: 'collision-source-installment',
					kind: 'episode',
					seasonNumber: 1,
					number: 1,
					mediaId: 'merge-source',
					seasonId: 'collision-source-season',
				},
				{
					id: 'collision-target-installment',
					kind: 'episode',
					seasonNumber: 1,
					number: 1,
					mediaId: 'merge-target',
					seasonId: 'collision-target-season',
				},
			],
		}),
		prisma.releaseOccurrence.createMany({
			data: [
				{
					id: 'collision-source-occurrence',
					source: 'tmdb',
					sourceKey: 'episode:1:1',
					eventType: 'episode',
					releaseAt: new Date('2026-08-01T18:00:00.000Z'),
					observedAt: now,
					expiresAt: new Date('2026-08-15T18:00:00.000Z'),
					mediaId: 'merge-source',
				},
				{
					id: 'collision-target-occurrence',
					source: 'tmdb',
					sourceKey: 'episode:1:1',
					eventType: 'episode',
					releaseAt: new Date('2026-08-01T19:00:00.000Z'),
					observedAt: now,
					expiresAt: new Date('2026-08-15T19:00:00.000Z'),
					mediaId: 'merge-target',
				},
			],
		}),
		prisma.catalogMetricSnapshot.createMany({
			data: [
				{
					id: 'collision-source-metric',
					provider: 'tmdb',
					kind: 'movie',
					observedAt: now,
					audience: 100,
					mediaId: 'merge-source',
				},
				{
					id: 'collision-target-metric',
					provider: 'tmdb',
					kind: 'movie',
					observedAt: now,
					audience: 200,
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
			'media-season-collision',
			'media-installment-collision',
			'release-occurrence-collision',
			'catalog-metric-snapshot-collision',
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
		await Promise.all([
			prisma.mediaSeason.count(),
			prisma.mediaInstallment.count(),
			prisma.releaseOccurrence.count(),
			prisma.catalogMetricSnapshot.count(),
		]),
	).toEqual([2, 2, 2, 2])
	expect(await prisma.media.count()).toBe(3)
})

test('derived next-release collisions follow each media snapshot across apply and revert', async () => {
	const base = await seedBase()
	const targetNextRelease = JSON.stringify({
		source: 'tmdb',
		observedAt: now.toISOString(),
		releaseDate: '2026-08-10T18:00:00.000Z',
		episode: 7,
	})
	await prisma.media.update({
		where: { id: 'merge-target' },
		data: { nextRelease: targetNextRelease },
	})
	await prisma.releaseOccurrence.createMany({
		data: [
			{
				id: 'derived-source-next',
				source: 'tmdb',
				sourceKey: 'next',
				eventType: 'episode',
				releaseAt: new Date('2026-07-30T18:00:00.000Z'),
				episode: 3,
				observedAt: now,
				expiresAt: new Date('2026-08-06T18:00:00.000Z'),
				mediaId: 'merge-source',
			},
			{
				id: 'derived-target-next',
				source: 'tmdb',
				sourceKey: 'next',
				eventType: 'episode',
				releaseAt: new Date('2026-08-09T18:00:00.000Z'),
				episode: 6,
				observedAt: now,
				expiresAt: new Date('2026-08-23T18:00:00.000Z'),
				mediaId: 'merge-target',
			},
		],
	})

	const prepared = await prepareCatalogMediaMerge(prisma, {
		issueId: base.issue.id,
		targetMediaId: 'merge-target',
		actorId: base.admin.id,
		now,
	})
	expect(prepared.preflight.safe).toBe(true)
	expect(prepared.preflight.moves.releaseOccurrences).toBe(0)
	await applyCatalogMediaMerge(prisma, {
		mergeId: prepared.merge.id,
		actorId: base.admin.id,
		confirmation: expectedCatalogMergeConfirmation(
			'merge-source',
			'merge-target',
		),
		now: new Date(now.getTime() + 1_000),
	})
	expect(
		await prisma.releaseOccurrence.findMany({
			select: {
				id: true,
				mediaId: true,
				sourceKey: true,
				releaseAt: true,
				episode: true,
			},
		}),
	).toEqual([
		{
			id: 'derived-target-next',
			mediaId: 'merge-target',
			sourceKey: 'next',
			releaseAt: new Date('2026-08-10T18:00:00.000Z'),
			episode: 7,
		},
	])

	await revertCatalogMediaMerge(prisma, {
		mergeId: prepared.merge.id,
		actorId: base.admin.id,
		confirmation: expectedCatalogMergeReversal(prepared.merge.id),
		now: new Date(now.getTime() + 2_000),
	})
	expect(
		await prisma.releaseOccurrence.findMany({
			orderBy: { mediaId: 'asc' },
			select: {
				id: true,
				mediaId: true,
				sourceKey: true,
				releaseAt: true,
				episode: true,
			},
		}),
	).toEqual([
		{
			id: expect.any(String),
			mediaId: 'merge-source',
			sourceKey: 'next',
			releaseAt: new Date('2026-07-30T18:00:00.000Z'),
			episode: 3,
		},
		{
			id: 'derived-target-next',
			mediaId: 'merge-target',
			sourceKey: 'next',
			releaseAt: new Date('2026-08-10T18:00:00.000Z'),
			episode: 7,
		},
	])
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

test('reversal blocks legacy journals until omitted relations receive a manual integrity audit', async () => {
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
	const stored = await prisma.catalogMediaMerge.findUniqueOrThrow({
		where: { id: prepared.merge.id },
		select: { journal: true },
	})
	const legacyJournal = JSON.parse(stored.journal!) as Record<string, unknown>
	delete legacyJournal.inventoryVersion
	await prisma.catalogMediaMerge.update({
		where: { id: prepared.merge.id },
		data: { journal: JSON.stringify(legacyJournal) },
	})

	await expect(
		revertCatalogMediaMerge(prisma, {
			mergeId: prepared.merge.id,
			actorId: base.admin.id,
			confirmation: expectedCatalogMergeReversal(prepared.merge.id),
			now: new Date(now.getTime() + 2_000),
		}),
	).rejects.toThrow('manual relation-integrity audit')
	expect(
		await prisma.catalogMediaMerge.findUniqueOrThrow({
			where: { id: prepared.merge.id },
			select: { status: true },
		}),
	).toEqual({ status: 'applied' })
	expect(
		await prisma.media.findUnique({ where: { id: 'merge-source' } }),
	).toBeNull()
})
