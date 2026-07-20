import { expect, test } from 'vitest'
import {
	acquireCatalogSyncLease,
	catalogSourceNeedsFetch,
	CatalogSyncLeaseError,
	checkpointCatalogSyncRun,
	completeCatalogSyncRun,
	failCatalogSyncRun,
	normalizeCatalogTitle,
	recordCatalogFetchFailure,
	recordCatalogFetchSuccess,
	replaceCatalogTitles,
	tombstoneCatalogSourcesNotSeenSince,
	upsertCatalogIdentity,
} from './catalog-sync.server.ts'
import { prisma } from './db.server.ts'

const identity = {
	provider: 'tmdb',
	kind: 'movie',
	externalId: 'catalog-sync-101',
}

test('normalizes catalog titles without losing non-Latin scripts', () => {
	expect(normalizeCatalogTitle('  Amélie: Le Fabuleux Destin! ')).toBe(
		'amelie le fabuleux destin',
	)
	expect(normalizeCatalogTitle('鋼の錬金術師 FULLMETAL ALCHEMIST')).toBe(
		'鋼の錬金術師 fullmetal alchemist',
	)
})

test('inventory upserts revive identities and replace provider titles idempotently', async () => {
	const firstSeenAt = new Date('2026-01-01T00:00:00.000Z')
	const sourceUpdatedAt = new Date('2025-12-20T00:00:00.000Z')
	const first = await prisma.$transaction(tx =>
		upsertCatalogIdentity(tx, {
			...identity,
			seenAt: firstSeenAt,
			sourceUpdatedAt,
		}),
	)
	await prisma.mediaExternalId.update({
		where: { id: first.id },
		data: { tombstonedAt: new Date('2026-02-01T00:00:00.000Z') },
	})
	const seenAgainAt = new Date('2026-03-01T00:00:00.000Z')
	const revived = await prisma.$transaction(tx =>
		upsertCatalogIdentity(tx, { ...identity, seenAt: seenAgainAt }),
	)

	expect(revived.id).toBe(first.id)
	expect(revived.mediaId).toBe(first.mediaId)
	expect(revived.firstSeenAt).toEqual(firstSeenAt)
	expect(revived.lastSeenAt).toEqual(seenAgainAt)
	expect(revived.sourceUpdatedAt).toEqual(sourceUpdatedAt)
	expect(revived.tombstonedAt).toBeNull()
	expect(await prisma.media.count()).toBe(1)
	expect(await prisma.mediaExternalId.count()).toBe(1)

	await prisma.$transaction(tx =>
		replaceCatalogTitles(tx, {
			mediaId: revived.mediaId,
			provider: identity.provider,
			titles: [
				{
					language: 'fr',
					titleType: 'primary',
					value: 'Amélie',
					isPrimary: true,
				},
				{ language: 'fr', titleType: 'primary', value: 'Amélie' },
				{ language: 'en', titleType: 'alternate', value: 'Amelie' },
			],
		}),
	)
	expect(
		await prisma.mediaTitle.findMany({
			where: { mediaId: revived.mediaId },
			orderBy: { language: 'asc' },
			select: {
				language: true,
				titleType: true,
				value: true,
				normalized: true,
				isPrimary: true,
			},
		}),
	).toEqual([
		{
			language: 'en',
			titleType: 'alternate',
			value: 'Amelie',
			normalized: 'amelie',
			isPrimary: false,
		},
		{
			language: 'fr',
			titleType: 'primary',
			value: 'Amélie',
			normalized: 'amelie',
			isPrimary: true,
		},
	])

	await prisma.$transaction(tx =>
		replaceCatalogTitles(tx, {
			mediaId: revived.mediaId,
			provider: identity.provider,
			titles: [
				{ language: 'fr', titleType: 'primary', value: 'Le Fabuleux Destin' },
			],
		}),
	)
	expect(
		await prisma.mediaTitle.findMany({
			where: { mediaId: revived.mediaId },
			select: { value: true, normalized: true },
		}),
	).toEqual([{ value: 'Le Fabuleux Destin', normalized: 'le fabuleux destin' }])
})

test('freshness records honor provider updates, retry delays, and tombstones', async () => {
	const sourceUpdatedAt = new Date('2026-01-01T00:00:00.000Z')
	const source = await prisma.$transaction(tx =>
		upsertCatalogIdentity(tx, { ...identity, sourceUpdatedAt }),
	)
	expect(catalogSourceNeedsFetch(source, sourceUpdatedAt)).toBe(true)

	const retryAfter = new Date('2026-01-02T00:00:00.000Z')
	const failed = await prisma.$transaction(tx =>
		recordCatalogFetchFailure(tx, {
			...identity,
			error: new Error('provider unavailable'),
			retryAfter,
		}),
	)
	expect(failed.failureCount).toBe(1)
	expect(failed.lastError).toBe('provider unavailable')
	expect(
		catalogSourceNeedsFetch(failed, new Date('2026-01-01T12:00:00.000Z')),
	).toBe(false)
	expect(catalogSourceNeedsFetch(failed, retryAfter)).toBe(true)

	const fetchedAt = new Date('2026-01-03T00:00:00.000Z')
	const refreshAfter = new Date('2026-06-01T00:00:00.000Z')
	const fresh = await prisma.$transaction(tx =>
		recordCatalogFetchSuccess(tx, {
			...identity,
			fetchedAt,
			refreshAfter,
		}),
	)
	expect(fresh.fetchStatus).toBe('fresh')
	expect(fresh.failureCount).toBe(0)
	expect(fresh.lastError).toBeNull()
	expect(catalogSourceNeedsFetch(fresh, new Date('2026-05-01'))).toBe(false)
	expect(catalogSourceNeedsFetch(fresh, refreshAfter)).toBe(true)

	const changed = await prisma.mediaExternalId.update({
		where: { id: source.id },
		data: { sourceUpdatedAt: new Date('2026-04-01T00:00:00.000Z') },
	})
	expect(catalogSourceNeedsFetch(changed, new Date('2026-04-02'))).toBe(true)

	const tombstoned = await prisma.mediaExternalId.update({
		where: { id: source.id },
		data: { tombstonedAt: new Date('2026-04-03T00:00:00.000Z') },
	})
	expect(catalogSourceNeedsFetch(tombstoned, refreshAfter)).toBe(false)
})

test('reconciliation tombstones missing sources without deleting canonical media', async () => {
	const old = await prisma.$transaction(tx =>
		upsertCatalogIdentity(tx, {
			...identity,
			externalId: 'old',
			seenAt: new Date('2026-01-01T00:00:00.000Z'),
		}),
	)
	const current = await prisma.$transaction(tx =>
		upsertCatalogIdentity(tx, {
			...identity,
			externalId: 'current',
			seenAt: new Date('2026-03-01T00:00:00.000Z'),
		}),
	)
	const now = new Date('2026-03-02T00:00:00.000Z')
	const result = await prisma.$transaction(tx =>
		tombstoneCatalogSourcesNotSeenSince(tx, {
			provider: identity.provider,
			kind: identity.kind,
			missingBefore: new Date('2026-02-01T00:00:00.000Z'),
			now,
		}),
	)

	expect(result.count).toBe(1)
	expect(
		await prisma.mediaExternalId.findUniqueOrThrow({ where: { id: old.id } }),
	).toEqual(expect.objectContaining({ tombstonedAt: now }))
	expect(
		await prisma.mediaExternalId.findUniqueOrThrow({
			where: { id: current.id },
		}),
	).toEqual(expect.objectContaining({ tombstonedAt: null }))
	expect(await prisma.media.count()).toBe(2)
})

test('sync cursors checkpoint, complete, and release cooperative leases', async () => {
	const startedAt = new Date('2026-01-01T00:00:00.000Z')
	const first = await prisma.$transaction(tx =>
		acquireCatalogSyncLease(tx, {
			provider: 'tmdb',
			kind: 'movie',
			mode: 'inventory',
			leaseOwner: 'worker-one',
			leaseDurationMs: 60_000,
			now: startedAt,
		}),
	)

	await expect(
		prisma.$transaction(tx =>
			acquireCatalogSyncLease(tx, {
				provider: 'tmdb',
				kind: 'movie',
				mode: 'inventory',
				leaseOwner: 'worker-two',
				leaseDurationMs: 60_000,
				now: new Date('2026-01-01T00:00:10.000Z'),
			}),
		),
	).rejects.toBeInstanceOf(CatalogSyncLeaseError)

	const progress = {
		cursor: 'page-25',
		recordsSeen: 12_500,
		recordsHandled: 12_450,
		recordsFailed: 50,
	}
	const checkpointed = await prisma.$transaction(tx =>
		checkpointCatalogSyncRun(tx, {
			runId: first.run.id,
			leaseOwner: 'worker-one',
			progress,
			leaseDurationMs: 60_000,
			now: new Date('2026-01-01T00:00:20.000Z'),
		}),
	)
	expect(checkpointed).toEqual(expect.objectContaining(progress))
	await expect(
		prisma.$transaction(tx =>
			checkpointCatalogSyncRun(tx, {
				runId: first.run.id,
				leaseOwner: 'worker-one',
				progress: {
					...progress,
					recordsSeen: progress.recordsSeen - 1,
					recordsHandled: progress.recordsHandled - 1,
				},
				leaseDurationMs: 60_000,
				now: new Date('2026-01-01T00:00:25.000Z'),
			}),
		),
	).rejects.toThrow('recordsSeen cannot move backward')
	await expect(
		prisma.$transaction(tx =>
			checkpointCatalogSyncRun(tx, {
				runId: first.run.id,
				leaseOwner: 'worker-one',
				progress: {
					...progress,
					recordsHandled: progress.recordsSeen,
				},
				leaseDurationMs: 60_000,
				now: new Date('2026-01-01T00:00:25.000Z'),
			}),
		),
	).rejects.toThrow('handled and failed records cannot exceed records seen')

	const completedAt = new Date('2026-01-01T00:00:30.000Z')
	const completed = await prisma.$transaction(tx =>
		completeCatalogSyncRun(tx, {
			runId: first.run.id,
			leaseOwner: 'worker-one',
			progress,
			now: completedAt,
		}),
	)
	expect(completed.status).toBe('completed')
	expect(completed.completedAt).toEqual(completedAt)
	expect(
		await prisma.catalogSyncCursor.findUniqueOrThrow({
			where: {
				provider_kind_mode: {
					provider: 'tmdb',
					kind: 'movie',
					mode: 'inventory',
				},
			},
		}),
	).toEqual(
		expect.objectContaining({
			cursor: progress.cursor,
			leaseOwner: null,
			leaseExpiresAt: null,
			lastSuccessfulAt: completedAt,
		}),
	)

	const second = await prisma.$transaction(tx =>
		acquireCatalogSyncLease(tx, {
			provider: 'tmdb',
			kind: 'movie',
			mode: 'inventory',
			leaseOwner: 'worker-two',
			leaseDurationMs: 60_000,
			now: new Date('2026-01-01T00:00:40.000Z'),
		}),
	)
	expect(second.run.cursor).toBe(progress.cursor)
	const failed = await prisma.$transaction(tx =>
		failCatalogSyncRun(tx, {
			runId: second.run.id,
			leaseOwner: 'worker-two',
			error: new Error('upstream 429'),
			now: new Date('2026-01-01T00:00:50.000Z'),
		}),
	)
	expect(failed).toEqual(
		expect.objectContaining({ status: 'failed', lastError: 'upstream 429' }),
	)
})

test('an expired lease is abandoned before another worker resumes its cursor', async () => {
	const first = await prisma.$transaction(tx =>
		acquireCatalogSyncLease(tx, {
			provider: 'mal',
			kind: 'anime',
			mode: 'hydrate',
			leaseOwner: 'expired-worker',
			leaseDurationMs: 1_000,
			now: new Date('2026-01-01T00:00:00.000Z'),
		}),
	)
	await expect(
		prisma.$transaction(tx =>
			checkpointCatalogSyncRun(tx, {
				runId: first.run.id,
				leaseOwner: 'expired-worker',
				progress: {
					cursor: 'late',
					recordsSeen: 1,
					recordsHandled: 1,
					recordsFailed: 0,
				},
				leaseDurationMs: 1_000,
				now: new Date('2026-01-01T00:00:01.001Z'),
			}),
		),
	).rejects.toThrow('Catalog sync lease expired')

	const resumed = await prisma.$transaction(tx =>
		acquireCatalogSyncLease(tx, {
			provider: 'mal',
			kind: 'anime',
			mode: 'hydrate',
			leaseOwner: 'replacement-worker',
			leaseDurationMs: 1_000,
			now: new Date('2026-01-01T00:00:02.000Z'),
		}),
	)
	expect(resumed.run.cursor).toBeNull()
	expect(
		await prisma.catalogSyncRun.findUniqueOrThrow({
			where: { id: first.run.id },
		}),
	).toEqual(
		expect.objectContaining({
			status: 'abandoned',
			lastError: 'Lease expired before the run completed',
		}),
	)
})
