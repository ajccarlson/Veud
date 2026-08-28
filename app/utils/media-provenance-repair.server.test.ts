import { PrismaClient } from '@prisma/client'
import { expect, test, vi } from 'vitest'
import { prisma } from './db.server.ts'
import {
	assertCatalogProvenanceBoundaryReady,
	CATALOG_PROVENANCE_REPAIR_COMPLETE_CURSOR,
	CATALOG_PROVENANCE_REPAIR_CONFIRMATION,
	CATALOG_PROVENANCE_REPAIR_CURSOR_KEY,
	repairMediaCatalogProvenance,
} from './media-provenance-repair.server.ts'

test('requires and durably records the completed provenance boundary', async () => {
	await expect(assertCatalogProvenanceBoundaryReady(prisma)).rejects.toThrow(
		'completion marker is missing or invalid',
	)
	await expect(repairMediaCatalogProvenance(prisma)).resolves.toMatchObject({
		dryRun: true,
		completed: false,
		alreadyCompleted: false,
	})
	expect(
		await prisma.catalogSyncCursor.findUnique({
			where: { provider_kind_mode: CATALOG_PROVENANCE_REPAIR_CURSOR_KEY },
		}),
	).toBeNull()

	await expect(
		repairMediaCatalogProvenance(prisma, {
			commit: true,
			confirmation: CATALOG_PROVENANCE_REPAIR_CONFIRMATION,
		}),
	).resolves.toMatchObject({
		dryRun: false,
		completed: true,
		alreadyCompleted: false,
		processedMedia: 0,
	})
	await expect(assertCatalogProvenanceBoundaryReady(prisma)).resolves.toEqual({
		completed: true,
		hasUntrustedMedia: false,
		hasUntrustedRelations: false,
	})
	expect(
		await prisma.catalogSyncCursor.findUniqueOrThrow({
			where: { provider_kind_mode: CATALOG_PROVENANCE_REPAIR_CURSOR_KEY },
			select: {
				cursor: true,
				lastSuccessfulAt: true,
				leaseOwner: true,
				leaseExpiresAt: true,
			},
		}),
	).toEqual({
		cursor: CATALOG_PROVENANCE_REPAIR_COMPLETE_CURSOR,
		lastSuccessfulAt: expect.any(Date),
		leaseOwner: null,
		leaseExpiresAt: null,
	})

	const [source, target] = await Promise.all([
		prisma.media.create({
			data: {
				kind: 'movie',
				title: 'Trusted source',
				catalogProvenanceVersion: 1,
			},
		}),
		prisma.media.create({
			data: {
				kind: 'movie',
				title: 'Trusted target',
				catalogProvenanceVersion: 1,
			},
		}),
	])
	const untrustedRelation = await prisma.mediaRelation.create({
		data: {
			sourceMediaId: source.id,
			targetMediaId: target.id,
			relationType: 'sequel',
		},
	})
	await expect(assertCatalogProvenanceBoundaryReady(prisma)).rejects.toThrow(
		'changed after the completed repair boundary',
	)
	await prisma.mediaRelation.delete({ where: { id: untrustedRelation.id } })
	await expect(
		assertCatalogProvenanceBoundaryReady(prisma),
	).resolves.toMatchObject({ completed: true })

	await prisma.catalogSyncCursor.update({
		where: { provider_kind_mode: CATALOG_PROVENANCE_REPAIR_CURSOR_KEY },
		data: { cursor: '{"phase":"complete"}' },
	})
	await expect(assertCatalogProvenanceBoundaryReady(prisma)).rejects.toThrow(
		'completion marker is missing or invalid',
	)
	await prisma.catalogSyncCursor.update({
		where: { provider_kind_mode: CATALOG_PROVENANCE_REPAIR_CURSOR_KEY },
		data: {
			cursor: JSON.stringify({
				phase: 'complete',
				catalogProvenanceVersion: 1,
				repairVersion: 1,
			}),
		},
	})
	await expect(
		repairMediaCatalogProvenance(prisma, {
			commit: true,
			confirmation: CATALOG_PROVENANCE_REPAIR_CONFIRMATION,
		}),
	).resolves.toMatchObject({
		alreadyCompleted: false,
		completed: true,
	})
	expect(
		await prisma.catalogSyncCursor.findUniqueOrThrow({
			where: { provider_kind_mode: CATALOG_PROVENANCE_REPAIR_CURSOR_KEY },
			select: { cursor: true },
		}),
	).toEqual({ cursor: CATALOG_PROVENANCE_REPAIR_COMPLETE_CURSOR })
	await prisma.catalogSyncCursor.update({
		where: { provider_kind_mode: CATALOG_PROVENANCE_REPAIR_CURSOR_KEY },
		data: {
			cursor: CATALOG_PROVENANCE_REPAIR_COMPLETE_CURSOR,
			lastSuccessfulAt: null,
		},
	})
	await expect(assertCatalogProvenanceBoundaryReady(prisma)).rejects.toThrow(
		'completion marker is missing or invalid',
	)
	await expect(
		repairMediaCatalogProvenance(prisma, {
			commit: true,
			confirmation: CATALOG_PROVENANCE_REPAIR_CONFIRMATION,
		}),
	).rejects.toThrow('completion marker is missing or invalid')
})

test('rechecks the completion marker after acquiring a delayed repair lease', async () => {
	let markTransactionEntered = () => {}
	const transactionEntered = new Promise<void>(resolve => {
		markTransactionEntered = resolve
	})
	let releaseTransaction = () => {}
	const transactionRelease = new Promise<void>(resolve => {
		releaseTransaction = resolve
	})
	const originalTransaction = prisma.$transaction.bind(prisma)
	const transactionSpy = vi
		.spyOn(prisma, '$transaction')
		.mockImplementationOnce(((...args: unknown[]) => {
			markTransactionEntered()
			return transactionRelease.then(() =>
				(originalTransaction as (...input: unknown[]) => unknown)(...args),
			)
		}) as typeof prisma.$transaction)
	const delayedRepair = repairMediaCatalogProvenance(prisma, {
		commit: true,
		confirmation: CATALOG_PROVENANCE_REPAIR_CONFIRMATION,
	})
	const competingClient = new PrismaClient()
	let delayedSettled = false
	try {
		await transactionEntered
		await expect(
			repairMediaCatalogProvenance(competingClient, {
				commit: true,
				confirmation: CATALOG_PROVENANCE_REPAIR_CONFIRMATION,
			}),
		).resolves.toMatchObject({
			completed: true,
			alreadyCompleted: false,
		})
		const media = await competingClient.media.create({
			data: {
				kind: 'movie',
				title: 'Post-boundary provider record',
				catalogProvenanceVersion: 1,
			},
		})
		const issue = await competingClient.catalogQualityIssue.create({
			data: {
				fingerprint: 'post-boundary-race-finding',
				issueType: 'provider_refresh',
				summary: 'Fresh provider finding survives delayed invocation',
				evidence: JSON.stringify({ source: 'tmdb' }),
				primaryMediaId: media.id,
			},
		})

		releaseTransaction()
		await expect(delayedRepair).resolves.toMatchObject({
			completed: true,
			alreadyCompleted: true,
			processedMedia: 0,
		})
		delayedSettled = true
		await expect(
			competingClient.catalogQualityIssue.findUniqueOrThrow({
				where: { id: issue.id },
				select: { summary: true, evidence: true, status: true },
			}),
		).resolves.toEqual({
			summary: 'Fresh provider finding survives delayed invocation',
			evidence: JSON.stringify({ source: 'tmdb' }),
			status: 'open',
		})
	} finally {
		releaseTransaction()
		if (!delayedSettled) await delayedRepair.catch(() => {})
		transactionSpy.mockRestore()
		await competingClient.$disconnect()
	}
})

test('dry-runs, then resumably quarantines every historical provider snapshot', async () => {
	const now = new Date('2026-07-29T12:00:00.000Z')
	const privateSentinel = 'PRIVATE MEMBER CATALOG SNAPSHOT'
	const owner = await prisma.user.create({
		data: {
			email: 'catalog-provenance-owner@example.com',
			username: 'catalog_provenance_owner',
		},
	})
	const listType = await prisma.listType.create({
		data: {
			name: 'catalog-provenance-list',
			header: 'Catalog provenance list',
			columns: '{}',
			mediaType: '["movie"]',
			completionType: '{}',
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
	const [source, target] = await Promise.all([
		prisma.media.create({
			data: {
				kind: 'movie',
				title: `${privateSentinel} title`,
				thumbnail: `${privateSentinel} thumbnail`,
				type: `${privateSentinel} type`,
				releaseStart: new Date('2099-01-01T00:00:00.000Z'),
				releaseEnd: new Date('2099-12-31T00:00:00.000Z'),
				nextRelease: JSON.stringify({
					source: 'tmdb',
					observedAt: now.toISOString(),
					releaseDate: '2099-02-01',
				}),
				nextReleaseAt: new Date('2099-02-01T00:00:00.000Z'),
				genres: privateSentinel,
				description: privateSentinel.padEnd(1024 * 1024, 'x'),
				originalTitle: privateSentinel,
				airYear: '2099',
				startSeason: privateSentinel,
				startYear: '2099',
				length: privateSentinel,
				chapters: privateSentinel,
				volumes: privateSentinel,
				runtimeMinutes: 999,
				episodeCount: 999,
				chapterCount: 999,
				volumeCount: 999,
				rating: privateSentinel,
				language: privateSentinel,
				studios: privateSentinel,
				networks: privateSentinel,
				keywords: privateSentinel,
				budget: '999999999',
				revenue: '9999999999',
				videos: privateSentinel,
				serialization: privateSentinel,
				authors: privateSentinel,
				tmdbScore: 1,
				malScore: 1,
				catalogScore: 1,
				catalogPopularity: 1,
				releaseStatus: privateSentinel,
				externalIds: {
					create: [
						{
							provider: 'tmdb',
							kind: 'movie',
							externalId: 'provenance-source',
							sourceTitle: 'Trusted provider title',
							sourcePopularity: 9_876,
							fetchStatus: 'fresh',
							lastFetchedAt: new Date('2026-01-01T00:00:00.000Z'),
							refreshAfter: new Date('2027-01-01T00:00:00.000Z'),
							failureCount: 3,
							lastError: 'old provider failure',
						},
						{
							provider: 'mal',
							kind: 'anime',
							externalId: 'provenance-tombstone',
							sourceTitle: 'Tombstoned fallback title',
							fetchStatus: 'tombstoned',
							tombstonedAt: new Date('2026-01-01T00:00:00.000Z'),
						},
					],
				},
			},
		}),
		prisma.media.create({
			data: {
				kind: 'movie',
				title: `${privateSentinel} target`,
				description: privateSentinel,
				externalIds: {
					create: {
						provider: 'tmdb',
						kind: 'movie',
						externalId: 'provenance-target',
						sourceTitle: 'Trusted target title',
					},
				},
			},
		}),
	])
	const [entry, favorite] = await Promise.all([
		prisma.entry.create({
			data: {
				watchlistId: watchlist.id,
				mediaId: source.id,
				position: 1,
				title: `${privateSentinel} entry`,
				thumbnail: privateSentinel,
				type: privateSentinel,
				description: privateSentinel,
				genres: privateSentinel,
				personal: 8.5,
				history: '{"lastUpdated":123}',
				length: '45 / 120 min',
				notes: 'Member note remains',
			},
		}),
		prisma.userFavorite.create({
			data: {
				ownerId: owner.id,
				typeId: listType.id,
				mediaId: source.id,
				position: 1,
				title: `${privateSentinel} favorite`,
				thumbnail: privateSentinel,
				mediaType: privateSentinel,
				startYear: '2099',
			},
		}),
	])
	const extraEntries = await prisma.entry.createMany({
		data: Array.from({ length: 4 }, (_, index) => ({
			watchlistId: watchlist.id,
			mediaId: source.id,
			position: index + 2,
			title: `${privateSentinel} extra ${index}`,
			description: privateSentinel,
			personal: 7 + index / 10,
			history: JSON.stringify({ episode: index + 1 }),
			notes: `Member note ${index}`,
		})),
	})
	expect(extraEntries.count).toBe(4)
	const reminder = await prisma.releaseReminder.create({
		data: { ownerId: owner.id, mediaId: source.id },
	})
	await Promise.all([
		prisma.mediaRelation.create({
			data: {
				sourceMediaId: source.id,
				targetMediaId: target.id,
				relationType: 'sequel',
				provider: 'mal',
			},
		}),
		prisma.releaseOccurrence.createMany({
			data: [
				{
					mediaId: source.id,
					source: 'tmdb',
					sourceKey: 'next',
					eventType: 'episode',
					releaseAt: new Date('2099-02-01T00:00:00.000Z'),
					observedAt: now,
					expiresAt: new Date('2099-02-02T00:00:00.000Z'),
				},
				{
					mediaId: source.id,
					source: 'tmdb',
					sourceKey: 'episode-2',
					eventType: 'episode',
					releaseAt: new Date('2099-02-08T00:00:00.000Z'),
					observedAt: now,
					expiresAt: new Date('2099-02-09T00:00:00.000Z'),
				},
			],
		}),
		prisma.catalogQualityIssue.create({
			data: {
				fingerprint: 'catalog-provenance-quality',
				issueType: 'suspicious_metadata',
				summary: privateSentinel,
				evidence: privateSentinel,
				primaryMediaId: source.id,
			},
		}),
		prisma.libraryImportBatch.create({
			data: {
				ownerId: owner.id,
				provider: 'mal',
				fileName: 'provenance.xml',
				itemCount: 1,
				matchedCount: 0,
				ambiguousCount: 1,
				unmatchedCount: 0,
				conflictCount: 0,
				items: {
					create: {
						sourceKey: 'ambiguous-item',
						payload: '{"member":"payload remains"}',
						matchState: 'ambiguous',
						candidates: JSON.stringify([
							{
								mediaId: source.id,
								title: privateSentinel,
								thumbnail: privateSentinel,
							},
						]),
					},
				},
			},
		}),
		prisma.trackingCommandPreview.create({
			data: {
				ownerId: owner.id,
				requestText: 'track a movie',
				operations: JSON.stringify({ mediaTitle: privateSentinel }),
				snapshotHash: 'catalog-provenance-preview',
				expiresAt: new Date('2026-07-29T12:20:00.000Z'),
			},
		}),
		prisma.notification.create({
			data: {
				recipientId: owner.id,
				releaseReminderId: reminder.id,
				type: 'release',
				message: privateSentinel,
				releaseAt: new Date('2099-02-01T00:00:00.000Z'),
			},
		}),
	])

	const dryRun = await repairMediaCatalogProvenance(prisma, {
		batchSize: 1,
		now,
	})
	expect(dryRun).toMatchObject({
		dryRun: true,
		blocked: false,
		processedMedia: 0,
		before: {
			mediaToQuarantine: 2,
			untrustedRelations: 1,
			catalogQualitySnapshots: 1,
			catalogMergeSnapshots: 0,
			importCandidates: 1,
			trackingCommandPreviews: 1,
			activeIdentitiesToRequeue: 2,
		},
	})
	expect(
		(await prisma.media.findUniqueOrThrow({ where: { id: source.id } }))
			.description?.length,
	).toBe(1024 * 1024)
	expect(
		await prisma.catalogSyncCursor.findUnique({
			where: { provider_kind_mode: CATALOG_PROVENANCE_REPAIR_CURSOR_KEY },
		}),
	).toBeNull()

	const result = await repairMediaCatalogProvenance(prisma, {
		batchSize: 1,
		commit: true,
		confirmation: CATALOG_PROVENANCE_REPAIR_CONFIRMATION,
		now,
	})
	expect(result).toMatchObject({
		dryRun: false,
		blocked: false,
		processedMedia: 2,
		after: {
			mediaToQuarantine: 0,
			untrustedRelations: 0,
			catalogQualitySnapshots: 0,
			catalogMergeSnapshots: 0,
			importCandidates: 0,
			trackingCommandPreviews: 0,
			activeIdentitiesToRequeue: 0,
		},
	})
	const repaired = await prisma.media.findUniqueOrThrow({
		where: { id: source.id },
	})
	expect(repaired).toMatchObject({
		kind: 'movie',
		catalogProvenanceVersion: 1,
		title: 'Trusted provider title',
		thumbnail: null,
		type: null,
		releaseStart: null,
		releaseEnd: null,
		nextRelease: null,
		nextReleaseAt: null,
		genres: null,
		description: null,
		airYear: null,
		startSeason: null,
		startYear: null,
		length: null,
		chapters: null,
		volumes: null,
		runtimeMinutes: null,
		episodeCount: null,
		chapterCount: null,
		volumeCount: null,
		rating: null,
		language: null,
		studios: null,
		networks: null,
		keywords: null,
		budget: null,
		revenue: null,
		videos: null,
		originalTitle: null,
		serialization: null,
		authors: null,
		tmdbScore: null,
		malScore: null,
		catalogScore: null,
		catalogPopularity: 9_876,
		releaseStatus: null,
	})
	const repairedEntry = await prisma.entry.findUniqueOrThrow({
		where: { id: entry.id },
	})
	expect(repairedEntry).toMatchObject({
		title: 'Trusted provider title',
		thumbnail: null,
		type: null,
		description: null,
		genres: null,
		history: '{"lastUpdated":123}',
		length: '45 / 120 min',
		notes: 'Member note remains',
	})
	expect(Number(repairedEntry.personal)).toBe(8.5)
	const repairedExtraEntries = await prisma.entry.findMany({
		where: { watchlistId: watchlist.id, id: { not: entry.id } },
		orderBy: { position: 'asc' },
		select: {
			title: true,
			description: true,
			personal: true,
			history: true,
			notes: true,
		},
	})
	expect(repairedExtraEntries).toHaveLength(4)
	for (const [index, repairedExtraEntry] of repairedExtraEntries.entries()) {
		expect(repairedExtraEntry).toMatchObject({
			title: 'Trusted provider title',
			description: null,
			history: JSON.stringify({ episode: index + 1 }),
			notes: `Member note ${index}`,
		})
		expect(Number(repairedExtraEntry.personal)).toBe(7 + index / 10)
	}
	expect(
		await prisma.userFavorite.findUniqueOrThrow({
			where: { id: favorite.id },
		}),
	).toMatchObject({
		title: 'Trusted provider title',
		thumbnail: null,
		mediaType: null,
		startYear: null,
	})
	expect(
		await prisma.releaseOccurrence.findMany({
			where: { mediaId: source.id },
			select: { sourceKey: true },
		}),
	).toEqual([{ sourceKey: 'episode-2' }])
	expect(await prisma.mediaRelation.count()).toBe(0)
	expect(
		await prisma.catalogQualityIssue.findFirstOrThrow({
			select: { summary: true, evidence: true },
		}),
	).toEqual({
		summary:
			'Catalog finding requires a fresh provider scan after the provenance reset.',
		evidence: null,
	})
	expect(await prisma.trackingCommandPreview.count()).toBe(0)
	expect(await prisma.releaseReminder.count()).toBe(1)
	expect(await prisma.notification.count()).toBe(0)
	expect(
		await prisma.libraryImportItem.findFirstOrThrow({
			select: { candidates: true, payload: true },
		}),
	).toEqual({
		candidates: '[]',
		payload: '{"member":"payload remains"}',
	})
	expect(
		await prisma.mediaExternalId.findUniqueOrThrow({
			where: {
				provider_kind_externalId: {
					provider: 'tmdb',
					kind: 'movie',
					externalId: 'provenance-source',
				},
			},
		}),
	).toMatchObject({
		fetchStatus: 'pending',
		lastFetchedAt: null,
		refreshAfter: now,
		hydrationPriority: 50_000,
		hydrationReason: 'catalog-provenance-repair',
		hydrationRequestedAt: now,
		failureCount: 0,
		lastError: null,
	})
	expect(
		await prisma.mediaExternalId.findUniqueOrThrow({
			where: {
				provider_kind_externalId: {
					provider: 'mal',
					kind: 'anime',
					externalId: 'provenance-tombstone',
				},
			},
		}),
	).toMatchObject({
		fetchStatus: 'tombstoned',
		tombstonedAt: new Date('2026-01-01T00:00:00.000Z'),
	})

	const importItem = await prisma.libraryImportItem.findFirstOrThrow()
	await prisma.libraryImportItem.update({
		where: { id: importItem.id },
		data: {
			candidates: JSON.stringify([
				{ mediaId: source.id, title: 'Fresh trusted candidate' },
			]),
		},
	})
	const postCutoverPreview = await prisma.trackingCommandPreview.create({
		data: {
			ownerId: owner.id,
			requestText: 'track the fresh provider title',
			operations: JSON.stringify({ mediaId: source.id }),
			snapshotHash: 'post-cutover-preview',
			expiresAt: new Date('2026-07-29T12:30:00.000Z'),
		},
	})
	const postCutoverIssue = await prisma.catalogQualityIssue.create({
		data: {
			fingerprint: 'post-cutover-quality',
			issueType: 'provider_refresh',
			summary: 'Fresh trusted provider finding',
			evidence: '{"source":"tmdb"}',
			primaryMediaId: source.id,
		},
	})
	await expect(
		repairMediaCatalogProvenance(prisma, {
			batchSize: 1,
			commit: true,
			confirmation: CATALOG_PROVENANCE_REPAIR_CONFIRMATION,
			now,
		}),
	).resolves.toMatchObject({
		processedMedia: 0,
		completed: true,
		alreadyCompleted: true,
	})
	expect(
		await prisma.libraryImportItem.findUniqueOrThrow({
			where: { id: importItem.id },
			select: { candidates: true },
		}),
	).toEqual({
		candidates: JSON.stringify([
			{ mediaId: source.id, title: 'Fresh trusted candidate' },
		]),
	})
	expect(
		await prisma.trackingCommandPreview.findUnique({
			where: { id: postCutoverPreview.id },
		}),
	).not.toBeNull()
	expect(
		await prisma.catalogQualityIssue.findUnique({
			where: { id: postCutoverIssue.id },
		}),
	).toMatchObject({
		summary: 'Fresh trusted provider finding',
		evidence: '{"source":"tmdb"}',
	})

	await prisma.media.create({
		data: {
			kind: 'movie',
			title: 'Post-boundary corruption',
			catalogProvenanceVersion: 0,
		},
	})
	await expect(
		repairMediaCatalogProvenance(prisma, {
			commit: true,
			confirmation: CATALOG_PROVENANCE_REPAIR_CONFIRMATION,
		}),
	).rejects.toThrow('changed after the completed repair boundary')
	await expect(assertCatalogProvenanceBoundaryReady(prisma)).rejects.toThrow(
		'changed after the completed repair boundary',
	)
	expect(
		await prisma.trackingCommandPreview.findUnique({
			where: { id: postCutoverPreview.id },
		}),
	).not.toBeNull()
})

test('invalidates historical merge snapshots without discarding review history', async () => {
	const [source, target] = await Promise.all([
		prisma.media.create({
			data: {
				kind: 'movie',
				title: 'Potentially unsafe source',
				externalIds: {
					create: {
						provider: 'tmdb',
						kind: 'movie',
						externalId: 'blocked-provenance-source',
					},
				},
			},
		}),
		prisma.media.create({
			data: { kind: 'movie', title: 'Potentially unsafe target' },
		}),
	])
	const issue = await prisma.catalogQualityIssue.create({
		data: {
			fingerprint: 'blocked-catalog-provenance-quality',
			issueType: 'possible_duplicate',
			status: 'confirmed',
			summary: 'Historical finding',
			evidence: JSON.stringify({ source: 'historical-provider-scan' }),
			primaryMediaId: source.id,
			secondaryMediaId: target.id,
		},
	})
	await prisma.catalogMediaMerge.create({
		data: {
			issueId: issue.id,
			status: 'applied',
			sourceMediaId: source.id,
			targetMediaId: target.id,
			preflight: '{}',
			preflightFingerprint: 'historical-preflight',
			journal: JSON.stringify({ historical: 'catalog snapshot' }),
		},
	})

	await expect(
		repairMediaCatalogProvenance(prisma, {
			commit: true,
			confirmation: CATALOG_PROVENANCE_REPAIR_CONFIRMATION,
		}),
	).resolves.toMatchObject({
		processedMedia: 2,
		after: {
			mediaToQuarantine: 0,
			catalogQualitySnapshots: 0,
			catalogMergeSnapshots: 0,
		},
	})
	expect(
		await prisma.media.findUniqueOrThrow({
			where: { id: source.id },
			select: { title: true, catalogProvenanceVersion: true },
		}),
	).toEqual({
		title: null,
		catalogProvenanceVersion: 1,
	})
	expect(await prisma.catalogQualityIssue.count()).toBe(1)
	expect(
		await prisma.catalogQualityIssue.findUniqueOrThrow({
			where: { id: issue.id },
			select: { summary: true, evidence: true, status: true },
		}),
	).toEqual({
		summary:
			'Catalog finding requires a fresh provider scan after the provenance reset.',
		evidence: null,
		status: 'open',
	})
	expect(
		await prisma.catalogMediaMerge.findUniqueOrThrow({
			where: { issueId: issue.id },
			select: {
				preflight: true,
				preflightFingerprint: true,
				journal: true,
				catalogProvenanceVersion: true,
				status: true,
			},
		}),
	).toEqual({
		preflight: '{}',
		preflightFingerprint: 'catalog-provenance-reset-required',
		journal: null,
		catalogProvenanceVersion: 0,
		status: 'invalidated',
	})
	expect(
		await prisma.catalogQualityEvent.findMany({
			where: { issueId: issue.id },
			select: {
				action: true,
				previousStatus: true,
				nextStatus: true,
				actorId: true,
			},
		}),
	).toEqual([
		{
			action: 'provenance-reset',
			previousStatus: 'confirmed',
			nextStatus: 'open',
			actorId: null,
		},
	])
	expect(
		await prisma.catalogMediaMergeEvent.findMany({
			where: { merge: { issueId: issue.id } },
			select: {
				action: true,
				previousStatus: true,
				nextStatus: true,
				actorId: true,
			},
		}),
	).toEqual([
		{
			action: 'provenance-reset',
			previousStatus: 'applied',
			nextStatus: 'invalidated',
			actorId: null,
		},
	])
})
