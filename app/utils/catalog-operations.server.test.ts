import { expect, test } from 'vitest'
import {
	assessCatalogHealth,
	getCatalogOperationsSnapshot,
	type CatalogCoverage,
} from './catalog-operations.server.ts'
import { prisma } from './db.server.ts'

const now = new Date('2026-07-23T08:00:00.000Z')

function coverage(input: Partial<CatalogCoverage> = {}): CatalogCoverage {
	return {
		provider: 'mal',
		kind: 'anime',
		label: 'MAL anime',
		total: 100,
		active: 100,
		tombstoned: 0,
		hydrated: 50,
		fresh: 50,
		overdue: 0,
		queueDepth: 50,
		failedDeferred: 0,
		highPriority: 50,
		coveragePercent: 50,
		freshnessPercent: 50,
		requestsMade: 50,
		rateLimitEvents: 0,
		...input,
	}
}

function run(
	input: Partial<
		Parameters<typeof assessCatalogHealth>[0]['runs'][number]
	> = {},
): Parameters<typeof assessCatalogHealth>[0]['runs'][number] {
	return {
		id: 'run-1',
		provider: 'mal',
		kind: 'anime',
		mode: 'hydrate',
		status: 'running',
		leaseOwner: 'worker',
		recordsSeen: 10,
		recordsHandled: 10,
		recordsFailed: 0,
		requestsMade: 10,
		rateLimitEvents: 0,
		providerRetryAfter: null,
		lastError: null,
		startedAt: new Date('2026-07-23T07:30:00.000Z'),
		heartbeatAt: new Date('2026-07-23T07:59:30.000Z'),
		completedAt: null,
		...input,
	}
}

function cursor(
	input: Partial<
		Parameters<typeof assessCatalogHealth>[0]['cursors'][number]
	> = {},
): Parameters<typeof assessCatalogHealth>[0]['cursors'][number] {
	return {
		id: 'cursor-1',
		provider: 'mal',
		kind: 'anime',
		mode: 'hydrate',
		leaseOwner: 'worker',
		leaseExpiresAt: new Date('2026-07-23T08:05:00.000Z'),
		lastSuccessfulAt: new Date('2026-07-23T07:59:30.000Z'),
		updatedAt: new Date('2026-07-23T07:59:30.000Z'),
		...input,
	}
}

test('classifies an empty database as uninitialized', async () => {
	const snapshot = await getCatalogOperationsSnapshot(prisma, { now })
	expect(snapshot.health).toEqual({
		status: 'uninitialized',
		issues: [],
		summary: 'No catalog sync runs or durable cursors exist in this database.',
	})
	expect(snapshot.coverage).toHaveLength(4)
	expect(snapshot.coverage.every(item => item.active === 0)).toBe(true)
})

test('aggregates active, hydrated, queued, deferred, and tombstoned identities', async () => {
	await prisma.media.createMany({
		data: [
			{ id: 'media-pending', kind: 'anime' },
			{ id: 'media-fresh', kind: 'anime' },
			{ id: 'media-deferred', kind: 'anime' },
			{ id: 'media-tombstoned', kind: 'anime' },
		],
	})
	await prisma.mediaExternalId.createMany({
		data: [
			{
				id: 'source-pending',
				mediaId: 'media-pending',
				provider: 'mal',
				kind: 'anime',
				externalId: '1',
				fetchStatus: 'pending',
				hydrationPriority: 10,
				firstSeenAt: now,
				lastSeenAt: now,
			},
			{
				id: 'source-fresh',
				mediaId: 'media-fresh',
				provider: 'mal',
				kind: 'anime',
				externalId: '2',
				fetchStatus: 'fresh',
				lastFetchedAt: new Date('2026-07-22T08:00:00.000Z'),
				refreshAfter: new Date('2027-01-20T08:00:00.000Z'),
				firstSeenAt: now,
				lastSeenAt: now,
			},
			{
				id: 'source-deferred',
				mediaId: 'media-deferred',
				provider: 'mal',
				kind: 'anime',
				externalId: '3',
				fetchStatus: 'failed',
				refreshAfter: new Date('2026-08-23T08:00:00.000Z'),
				firstSeenAt: now,
				lastSeenAt: now,
			},
			{
				id: 'source-tombstoned',
				mediaId: 'media-tombstoned',
				provider: 'mal',
				kind: 'anime',
				externalId: '4',
				fetchStatus: 'pending',
				tombstonedAt: now,
				firstSeenAt: now,
				lastSeenAt: now,
			},
		],
	})
	await prisma.catalogSyncRun.create({
		data: {
			id: 'completed-run',
			provider: 'mal',
			kind: 'anime',
			mode: 'hydrate',
			status: 'completed',
			leaseOwner: 'test-worker',
			recordsSeen: 2,
			recordsHandled: 1,
			recordsFailed: 1,
			requestsMade: 2,
			rateLimitEvents: 0,
			startedAt: new Date('2026-07-23T07:00:00.000Z'),
			heartbeatAt: new Date('2026-07-23T07:02:00.000Z'),
			completedAt: new Date('2026-07-23T07:02:00.000Z'),
		},
	})
	await prisma.catalogSyncCursor.create({
		data: {
			id: 'hydration-cursor',
			provider: 'mal',
			kind: 'anime',
			mode: 'hydrate',
			lastSuccessfulAt: new Date('2026-07-23T07:02:00.000Z'),
		},
	})

	const snapshot = await getCatalogOperationsSnapshot(prisma, { now })
	const anime = snapshot.coverage.find(
		item => item.provider === 'mal' && item.kind === 'anime',
	)
	expect(anime).toEqual(
		expect.objectContaining({
			total: 4,
			active: 3,
			tombstoned: 1,
			hydrated: 1,
			fresh: 1,
			queueDepth: 1,
			failedDeferred: 1,
			highPriority: 1,
			requestsMade: 2,
			rateLimitEvents: 0,
			coveragePercent: 33.33,
		}),
	)
	expect(snapshot.health.status).toBe('healthy')
})

test('marks stale running heartbeats critical', () => {
	const health = assessCatalogHealth({
		now,
		coverage: [coverage()],
		runs: [
			run({
				heartbeatAt: new Date('2026-07-23T07:40:00.000Z'),
			}),
		],
		cursors: [cursor()],
	})
	expect(health.status).toBe('critical')
	expect(health.issues).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				id: 'stale-run:run-1',
				severity: 'critical',
			}),
		]),
	)
})

test('surfaces recent failures, cooldowns, overdue inventory, leases, and deferred failures', () => {
	const health = assessCatalogHealth({
		now,
		coverage: [
			coverage({
				active: 1_000,
				failedDeferred: 25,
			}),
		],
		runs: [
			run({
				status: 'failed',
				lastError: 'Provider unavailable',
				providerRetryAfter: new Date('2026-07-23T09:00:00.000Z'),
			}),
		],
		cursors: [
			cursor({
				mode: 'inventory',
				leaseExpiresAt: new Date('2026-07-23T07:00:00.000Z'),
				lastSuccessfulAt: new Date('2026-07-21T08:00:00.000Z'),
			}),
		],
	})
	expect(health.status).toBe('degraded')
	expect(health.issues.map(item => item.id)).toEqual(
		expect.arrayContaining([
			'cooldown:run-1',
			'failed-run:run-1',
			'expired-lease:cursor-1',
			'stale-inventory:cursor-1',
			'deferred-failures:mal:anime',
		]),
	)
})
