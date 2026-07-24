import { expect, test, vi } from 'vitest'
import {
	catalogHydrationPriorities,
	recordCatalogFetchSuccess,
	requestCatalogHydration,
	upsertCatalogIdentity,
} from './catalog-sync.server.ts'
import { prisma } from './db.server.ts'
import {
	defaultMalInventoryDate,
	fetchMalInventoryPage,
	importMalInventory,
	malCatalogPopularity,
	malPopularFeedScore,
	malRankingUrl,
	parseMalInventoryPage,
	parseMalRetryAfter,
	requireMalInventoryDate,
} from './mal-catalog-inventory.server.ts'

function rankingResult(id: number, kind: 'anime' | 'manga' = 'anime') {
	return {
		node: {
			id,
			title: `${kind === 'anime' ? 'Anime' : 'Manga'} ${id}`,
			alternative_titles: {
				synonyms: [`Work ${id}`],
				en: `English ${id}`,
				ja: `日本語 ${id}`,
			},
			media_type: kind === 'anime' ? 'tv' : 'manga',
			nsfw: id % 2 ? 'white' : 'gray',
			popularity: id,
			num_list_users: id * 1_000,
			num_scoring_users: id * 100,
			updated_at: '2026-07-19T12:00:00+00:00',
		},
		ranking: { rank: id },
	}
}

function rankingPage(input: {
	kind?: 'anime' | 'manga'
	records: ReturnType<typeof rankingResult>[]
	nextOffset?: number
}) {
	const kind = input.kind ?? 'anime'
	return {
		data: input.records,
		paging:
			input.nextOffset === undefined
				? {}
				: {
						next: `https://api.myanimelist.net/v2/${kind}/ranking?ranking_type=all&offset=${input.nextOffset}&limit=500`,
					},
	}
}

function inventoryFetch(
	records: ReturnType<typeof rankingResult>[],
	kind: 'anime' | 'manga' = 'anime',
) {
	return vi.fn(async (input: string | URL | Request) => {
		const url = new URL(String(input))
		const offset = Number(url.searchParams.get('offset'))
		const limit = Number(url.searchParams.get('limit'))
		const page = records.slice(offset, offset + limit)
		const nextOffset = offset + page.length
		return Response.json(
			rankingPage({
				kind,
				records: page,
				...(nextOffset < records.length ? { nextOffset } : {}),
			}),
		)
	})
}

const committedOptions = {
	prisma,
	kind: 'anime' as const,
	inventoryDate: '2026-07-20',
	clientId: 'test-client-id',
	policyApprovalReference: 'test-policy-approval',
	commit: true,
	requestDelayMs: 0,
	minimumRecords: 1,
}

test('builds ranking URLs and parses identity, freshness, and alternate titles', () => {
	expect(defaultMalInventoryDate(new Date('2026-07-20T23:59:59.000Z'))).toBe(
		'2026-07-20',
	)
	expect(malRankingUrl('anime', 500, 250)).toBe(
		'https://api.myanimelist.net/v2/anime/ranking?ranking_type=all&offset=500&limit=250&fields=alternative_titles%2Cmedia_type%2Cnsfw%2Cpopularity%2Cnum_list_users%2Cnum_scoring_users%2Cupdated_at',
	)
	const zeroMetrics = rankingResult(2)
	zeroMetrics.node.num_list_users = 0
	zeroMetrics.node.num_scoring_users = 0
	const parsed = parseMalInventoryPage(
		rankingPage({ records: [zeroMetrics], nextOffset: 500 }),
		'anime',
		0,
	)
	expect(parsed).toEqual({
		records: [
			expect.objectContaining({
				id: 2,
				title: 'Anime 2',
				mediaType: 'tv',
				nsfw: 'gray',
				popularityRank: 2,
				audience: 0,
				ratingCount: 0,
				rankingRank: 2,
				sourceUpdatedAt: new Date('2026-07-19T12:00:00.000Z'),
				catalogPopularity: 0.5,
				titles: [
					expect.objectContaining({ value: 'Anime 2', isPrimary: true }),
					expect.objectContaining({ value: 'English 2', language: 'en' }),
					expect.objectContaining({ value: '日本語 2', language: 'ja' }),
					expect.objectContaining({ value: 'Work 2' }),
				],
			}),
		],
		nextOffset: 500,
	})
	expect(malCatalogPopularity(1)).toBe(1)
	expect(malCatalogPopularity(100)).toBe(0.01)
	expect(malPopularFeedScore(2, 120_000)).toBeGreaterThan(
		malPopularFeedScore(1, 3),
	)
	expect(() => requireMalInventoryDate('2026-02-30')).toThrow(
		'not a real calendar date',
	)
	expect(() => malRankingUrl('anime', 0, 501)).toThrow('cannot exceed 500')
	expect(() =>
		parseMalInventoryPage(
			{
				data: [rankingResult(1), rankingResult(1)],
				paging: {},
			},
			'anime',
			0,
		),
	).toThrow('duplicate ids')
})

test('sends client-id authentication and parses provider retry deadlines', async () => {
	const fetchImpl = vi.fn(async () =>
		Response.json(rankingPage({ records: [rankingResult(1)] })),
	)
	await expect(
		fetchMalInventoryPage({
			kind: 'anime',
			offset: 0,
			limit: 1,
			clientId: 'client-123',
			fetchImpl: fetchImpl as unknown as typeof fetch,
		}),
	).resolves.toEqual(expect.objectContaining({ nextOffset: null }))
	expect(fetchImpl).toHaveBeenCalledWith(
		expect.stringContaining('/v2/anime/ranking?'),
		{
			headers: {
				accept: 'application/json',
				'X-MAL-CLIENT-ID': 'client-123',
			},
		},
	)
	const now = new Date('2026-07-20T00:00:00.000Z')
	expect(parseMalRetryAfter('120', now)).toEqual(
		new Date('2026-07-20T00:02:00.000Z'),
	)
	expect(parseMalRetryAfter('not-a-date', now)).toBeNull()
})

test('dry-run scans a bounded page without writing catalog rows', async () => {
	const fetchImpl = inventoryFetch([
		rankingResult(1),
		rankingResult(2),
		rankingResult(3),
	])
	const summary = await importMalInventory({
		kind: 'anime',
		inventoryDate: '2026-07-20',
		clientId: 'test-client-id',
		limit: 2,
		pageSize: 2,
		requestDelayMs: 0,
		fetchImpl: fetchImpl as unknown as typeof fetch,
	})

	expect(summary).toEqual(
		expect.objectContaining({
			dryRun: true,
			complete: false,
			recordsSeen: 2,
			recordsHandled: 2,
			nextOffset: 2,
			requestsMade: 1,
		}),
	)
	expect(await prisma.media.count()).toBe(0)
	expect(await prisma.mediaExternalId.count()).toBe(0)
	expect(await prisma.catalogSyncRun.count()).toBe(0)
})

test('waits between ranking-page requests at the configured provider pace', async () => {
	const delay = vi.fn(async () => {})
	const summary = await importMalInventory({
		kind: 'anime',
		inventoryDate: '2026-07-20',
		clientId: 'test-client-id',
		limit: 2,
		pageSize: 1,
		requestDelayMs: 1_000,
		delay,
		fetchImpl: inventoryFetch([
			rankingResult(1),
			rankingResult(2),
			rankingResult(3),
		]) as unknown as typeof fetch,
	})

	expect(summary.requestsMade).toBe(2)
	expect(delay).toHaveBeenCalledOnce()
	expect(delay).toHaveBeenCalledWith(1_000)
})

test('commit mode requires an explicit MAL policy approval reference', async () => {
	await expect(
		importMalInventory({
			prisma,
			kind: 'anime',
			inventoryDate: '2026-07-20',
			clientId: 'test-client-id',
			commit: true,
			leaseOwner: 'policy-worker',
			fetchImpl: inventoryFetch([]) as unknown as typeof fetch,
		}),
	).rejects.toThrow('policy approval reference is required')
	expect(await prisma.catalogSyncRun.count()).toBe(0)
})

test('a bounded commit resumes by offset and a completed rerun is idempotent', async () => {
	const records = [
		rankingResult(1),
		rankingResult(2),
		rankingResult(3),
		rankingResult(4),
	]
	const firstFetch = inventoryFetch(records)
	const first = await importMalInventory({
		...committedOptions,
		limit: 2,
		pageSize: 2,
		leaseOwner: 'partial-worker',
		fetchImpl: firstFetch as unknown as typeof fetch,
		now: () => new Date('2026-07-20T00:00:00.000Z'),
	})
	expect(first).toEqual(
		expect.objectContaining({
			complete: false,
			resumedFromOffset: 0,
			nextOffset: 2,
			recordsCommittedForScan: 2,
		}),
	)
	expect(
		await prisma.catalogSyncRun.findUniqueOrThrow({
			where: { id: first.runId as string },
		}),
	).toEqual(
		expect.objectContaining({
			policyApprovalRef: 'test-policy-approval',
		}),
	)

	const secondFetch = inventoryFetch(records)
	const second = await importMalInventory({
		...committedOptions,
		pageSize: 2,
		leaseOwner: 'resume-worker',
		fetchImpl: secondFetch as unknown as typeof fetch,
		now: () => new Date('2026-07-20T01:00:00.000Z'),
	})
	expect(second).toEqual(
		expect.objectContaining({
			complete: true,
			resumedFromOffset: 2,
			nextOffset: 4,
			recordsHandled: 2,
			recordsCommittedForScan: 4,
		}),
	)
	expect(await prisma.media.count()).toBe(4)
	expect(await prisma.mediaExternalId.count()).toBe(4)
	expect(await prisma.mediaTitle.count()).toBe(16)
	expect(
		await prisma.mediaExternalId.findUniqueOrThrow({
			where: {
				provider_kind_externalId: {
					provider: 'mal',
					kind: 'anime',
					externalId: '2',
				},
			},
			include: { media: true },
		}),
	).toEqual(
		expect.objectContaining({
			sourceTitle: 'Anime 2',
			sourcePopularity: 0.5,
			sourceRank: 2,
			sourceAudience: 2_000,
			sourceRatingCount: 200,
			sourceIsAdult: true,
			sourceUpdatedAt: new Date('2026-07-19T12:00:00.000Z'),
			hydrationReason: 'mal-inventory',
			media: expect.objectContaining({
				title: 'Anime 2',
				type: 'tv',
				catalogPopularity: 0.5,
			}),
		}),
	)
	expect(
		await prisma.catalogFeedItem.findMany({
			where: { provider: 'mal', kind: 'anime', feed: 'popular' },
			orderBy: { rank: 'asc' },
			select: {
				rank: true,
				audience: true,
				rankingScore: true,
				rankingVersion: true,
			},
		}),
	).toEqual(
		[1, 2, 3, 4].map((rank, index) =>
			expect.objectContaining({
				rank,
				audience: rank * 1_000,
				rankingVersion: 2,
				rankingScore: expect.closeTo(
					(1 - index / 3) * 0.35 + ((index + 1) / 4) * 0.65,
					8,
				),
			}),
		),
	)

	const repeatFetch = inventoryFetch([rankingResult(999)])
	const third = await importMalInventory({
		...committedOptions,
		leaseOwner: 'repeat-worker',
		fetchImpl: repeatFetch as unknown as typeof fetch,
		now: () => new Date('2026-07-20T02:00:00.000Z'),
	})
	expect(third.alreadyComplete).toBe(true)
	expect(repeatFetch).not.toHaveBeenCalled()
	expect(await prisma.mediaExternalId.count()).toBe(4)
})

test('a newer logical scan starts at zero and prevents date rollback', async () => {
	await importMalInventory({
		...committedOptions,
		leaseOwner: 'first-date-worker',
		fetchImpl: inventoryFetch([rankingResult(1)]) as unknown as typeof fetch,
		now: () => new Date('2026-07-20T00:00:00.000Z'),
	})
	const nextDate = await importMalInventory({
		...committedOptions,
		inventoryDate: '2026-07-21',
		leaseOwner: 'next-date-worker',
		fetchImpl: inventoryFetch([
			rankingResult(1),
			rankingResult(2),
		]) as unknown as typeof fetch,
		now: () => new Date('2026-07-21T00:00:00.000Z'),
	})
	expect(nextDate).toEqual(
		expect.objectContaining({
			complete: true,
			resumedFromOffset: 0,
			recordsCommittedForScan: 2,
		}),
	)

	await expect(
		importMalInventory({
			...committedOptions,
			leaseOwner: 'rollback-worker',
			fetchImpl: inventoryFetch([]) as unknown as typeof fetch,
			now: () => new Date('2026-07-21T01:00:00.000Z'),
		}),
	).rejects.toThrow('cursor is already at newer inventory 2026-07-21')
	expect(
		await prisma.catalogSyncCursor.findUniqueOrThrow({
			where: {
				provider_kind_mode: {
					provider: 'mal',
					kind: 'anime',
					mode: 'inventory',
				},
			},
		}),
	).toEqual(expect.objectContaining({ leaseOwner: null, leaseExpiresAt: null }))
})

test('a 429 persists cooldown and the next worker does not retry early', async () => {
	const rateLimited = vi.fn(
		async () =>
			new Response(null, {
				status: 429,
				statusText: 'Too Many Requests',
				headers: { 'retry-after': '120' },
			}),
	)
	const first = await importMalInventory({
		...committedOptions,
		leaseOwner: 'rate-limited-worker',
		fetchImpl: rateLimited as unknown as typeof fetch,
		now: () => new Date('2026-07-20T00:00:00.000Z'),
	})
	expect(first).toEqual(
		expect.objectContaining({
			complete: false,
			requestsMade: 1,
			rateLimitEvents: 1,
			providerRetryAfter: new Date('2026-07-20T00:02:00.000Z'),
		}),
	)

	const tooEarly = inventoryFetch([rankingResult(1)])
	const second = await importMalInventory({
		...committedOptions,
		leaseOwner: 'cooldown-worker',
		fetchImpl: tooEarly as unknown as typeof fetch,
		now: () => new Date('2026-07-20T00:01:00.000Z'),
	})
	expect(second.requestsMade).toBe(0)
	expect(tooEarly).not.toHaveBeenCalled()

	const recoveredFetch = inventoryFetch([rankingResult(1)])
	const recovered = await importMalInventory({
		...committedOptions,
		leaseOwner: 'recovered-worker',
		fetchImpl: recoveredFetch as unknown as typeof fetch,
		now: () => new Date('2026-07-20T00:03:00.000Z'),
	})
	expect(recovered.complete).toBe(true)
	expect(recovered.recordsCommittedForScan).toBe(1)
	expect(recoveredFetch).toHaveBeenCalledOnce()
})

test('MAL reconciliation is opt-in and guarded against suspicious coverage', async () => {
	const oldSeenAt = new Date('2026-07-01T00:00:00.000Z')
	const old = await prisma.$transaction(tx =>
		upsertCatalogIdentity(tx, {
			provider: 'mal',
			kind: 'anime',
			externalId: '999',
			seenAt: oldSeenAt,
		}),
	)
	const records = Array.from({ length: 10 }, (_, index) =>
		rankingResult(index + 1),
	)
	const imported = await importMalInventory({
		...committedOptions,
		leaseOwner: 'no-reconcile-worker',
		fetchImpl: inventoryFetch(records) as unknown as typeof fetch,
		now: () => new Date('2026-07-20T00:00:00.000Z'),
	})
	expect(imported.reconciled).toBe(false)
	expect(
		await prisma.mediaExternalId.findUniqueOrThrow({ where: { id: old.id } }),
	).toEqual(expect.objectContaining({ tombstonedAt: null }))

	const reconciled = await importMalInventory({
		...committedOptions,
		reconcile: true,
		leaseOwner: 'reconcile-worker',
		fetchImpl: inventoryFetch([]) as unknown as typeof fetch,
		now: () => new Date('2026-07-20T01:00:00.000Z'),
	})
	expect(reconciled).toEqual(
		expect.objectContaining({
			alreadyComplete: true,
			reconciled: true,
			tombstoned: 1,
		}),
	)
	expect(
		await prisma.mediaExternalId.findUniqueOrThrow({ where: { id: old.id } }),
	).toEqual(expect.objectContaining({ fetchStatus: 'tombstoned' }))
})

test('a newer provider updated_at requeues an otherwise fresh identity', async () => {
	await prisma.$transaction(async tx => {
		await upsertCatalogIdentity(tx, {
			provider: 'mal',
			kind: 'anime',
			externalId: '1',
			sourceUpdatedAt: new Date('2026-07-01T00:00:00.000Z'),
			seenAt: new Date('2026-07-01T00:00:00.000Z'),
		})
		await recordCatalogFetchSuccess(tx, {
			provider: 'mal',
			kind: 'anime',
			externalId: '1',
			fetchedAt: new Date('2026-07-10T00:00:00.000Z'),
			refreshAfter: new Date('2027-01-10T00:00:00.000Z'),
		})
		await requestCatalogHydration(tx, {
			provider: 'mal',
			kind: 'anime',
			externalId: '1',
			priority: catalogHydrationPriorities.userDemand,
			reason: 'user-demand',
			requestedAt: new Date('2026-07-10T00:00:00.000Z'),
		})
	})

	await importMalInventory({
		...committedOptions,
		leaseOwner: 'changed-source-worker',
		fetchImpl: inventoryFetch([rankingResult(1)]) as unknown as typeof fetch,
		now: () => new Date('2026-07-20T00:00:00.000Z'),
	})
	expect(
		await prisma.mediaExternalId.findUniqueOrThrow({
			where: {
				provider_kind_externalId: {
					provider: 'mal',
					kind: 'anime',
					externalId: '1',
				},
			},
		}),
	).toEqual(
		expect.objectContaining({
			sourceUpdatedAt: new Date('2026-07-19T12:00:00.000Z'),
			fetchStatus: 'pending',
			refreshAfter: null,
			hydrationPriority: catalogHydrationPriorities.userDemand,
			hydrationReason: 'user-demand',
		}),
	)
})

test('malformed provider pages fail the run and release its lease', async () => {
	const invalidFetch = vi.fn(async () => Response.json({ data: 'bad' }))
	await expect(
		importMalInventory({
			...committedOptions,
			leaseOwner: 'invalid-page-worker',
			fetchImpl: invalidFetch as unknown as typeof fetch,
			now: () => new Date('2026-07-20T00:00:00.000Z'),
		}),
	).rejects.toThrow('has no data array')
	expect(
		await prisma.catalogSyncRun.findFirstOrThrow({
			where: { leaseOwner: 'invalid-page-worker' },
		}),
	).toEqual(expect.objectContaining({ status: 'failed', requestsMade: 1 }))
	expect(
		await prisma.catalogSyncCursor.findUniqueOrThrow({
			where: {
				provider_kind_mode: {
					provider: 'mal',
					kind: 'anime',
					mode: 'inventory',
				},
			},
		}),
	).toEqual(expect.objectContaining({ leaseOwner: null, leaseExpiresAt: null }))
})
