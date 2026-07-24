import { expect, test, vi } from 'vitest'
import { prisma } from './db.server.ts'
import {
	currentMalSeason,
	fetchMalTrendCandidates,
	malTrendingUrl,
	parseMalTrendPage,
	rankMalTrendCandidates,
	refreshMalTrending,
} from './mal-trending.server.ts'

const now = new Date('2026-07-24T18:00:00.000Z')

function candidate(input: {
	id: number
	rank: number
	audience: number
	title?: string
}) {
	return {
		node: {
			id: input.id,
			title: input.title ?? `Title ${input.id}`,
			media_type: 'manga',
			nsfw: 'white',
			popularity: input.rank,
			num_list_users: input.audience,
			num_scoring_users: Math.floor(input.audience / 2),
			updated_at: '2026-07-24T12:00:00Z',
			start_season: { year: 2026, season: 'summer' },
		},
		ranking: { rank: input.rank },
	}
}

test('selects the UTC MAL season and provider-supported charts', () => {
	expect(
		[
			'2026-01-01T00:00:00Z',
			'2026-04-01T00:00:00Z',
			'2026-07-01T00:00:00Z',
			'2026-10-01T00:00:00Z',
			'2027-01-01T00:00:00Z',
		].map(value => currentMalSeason(new Date(value))),
	).toEqual([
		{ year: 2026, season: 'winter' },
		{ year: 2026, season: 'spring' },
		{ year: 2026, season: 'summer' },
		{ year: 2026, season: 'fall' },
		{ year: 2027, season: 'winter' },
	])
	expect(malTrendingUrl('anime', now, 0, 100)).toContain(
		'/v2/anime/season/2026/summer?sort=anime_num_list_users',
	)
	expect(malTrendingUrl('manga', now, 500, 500)).toContain(
		'/v2/manga/ranking?ranking_type=bypopularity',
	)
})

test('parses chart results and filters adult candidates during fetch', async () => {
	const payload = {
		data: [
			candidate({ id: 1, rank: 1, audience: 10_000 }),
			{
				...candidate({ id: 2, rank: 2, audience: 9_000 }),
				node: {
					...candidate({ id: 2, rank: 2, audience: 9_000 }).node,
					nsfw: 'black',
				},
			},
		],
	}
	expect(parseMalTrendPage(payload, 'manga', 0)[0]).toEqual(
		expect.objectContaining({
			id: 1,
			chartRank: 1,
			audience: 10_000,
			sourceUpdatedAt: new Date('2026-07-24T12:00:00.000Z'),
		}),
	)
	const fetchImpl = vi.fn(async () => Response.json(payload))
	const fetched = await fetchMalTrendCandidates({
		kind: 'manga',
		clientId: 'client-id',
		now,
		limit: 2,
		requestDelayMs: 0,
		fetchImpl: fetchImpl as typeof fetch,
	})
	expect(fetched.records.map(item => item.id)).toEqual([1])
	expect(fetchImpl).toHaveBeenCalledTimes(1)
})

test('uses chart order until history exists, then rewards measured momentum', () => {
	const current = [
		{
			id: 1,
			mediaId: 'established',
			title: 'Established favorite',
			mediaType: 'manga',
			nsfw: 'white',
			popularityRank: 1,
			audience: 1_000_010,
			ratingCount: 500_000,
			chartRank: 1,
			sourceUpdatedAt: now,
			startSeason: null,
		},
		{
			id: 2,
			mediaId: 'rising',
			title: 'Fast riser',
			mediaType: 'manga',
			nsfw: 'white',
			popularityRank: 200,
			audience: 51_000,
			ratingCount: 20_000,
			chartRank: 2,
			sourceUpdatedAt: now,
			startSeason: null,
		},
	]
	expect(rankMalTrendCandidates('manga', current, [], now)[0]?.mediaId).toBe(
		'established',
	)
	const history = current.flatMap(item => [
		{
			mediaId: item.mediaId,
			observedAt: new Date(now.getTime() - 24 * 60 * 60 * 1_000),
			audience:
				item.mediaId === 'rising' ? item.audience - 1_000 : item.audience - 10,
			ratingCount: null,
			sourceRank: item.popularityRank,
			chartRank: item.chartRank,
		},
		{
			mediaId: item.mediaId,
			observedAt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1_000),
			audience:
				item.mediaId === 'rising' ? item.audience - 5_000 : item.audience - 100,
			ratingCount: null,
			sourceRank: item.popularityRank,
			chartRank: item.chartRank,
		},
	])
	const ranked = rankMalTrendCandidates('manga', current, history, now)
	expect(ranked[0]?.mediaId).toBe('rising')
	expect(ranked[0]?.audienceGrowth24h).toBe(1_000)
	expect(ranked[1]?.audienceGrowth24h).toBe(10)
})

test('anime candidates are limited to titles that began in the current season', async () => {
	const current = candidate({
		id: 81_001,
		rank: 2,
		audience: 100_000,
		title: 'Current season title',
	})
	const continuing = {
		...candidate({
			id: 81_002,
			rank: 1,
			audience: 2_000_000,
			title: 'Long-running title',
		}),
		node: {
			...candidate({
				id: 81_002,
				rank: 1,
				audience: 2_000_000,
				title: 'Long-running title',
			}).node,
			start_season: { year: 1999, season: 'fall' },
		},
	}
	const fetched = await fetchMalTrendCandidates({
		kind: 'anime',
		clientId: 'client-id',
		now,
		limit: 2,
		requestDelayMs: 0,
		fetchImpl: vi.fn(async () =>
			Response.json({ data: [continuing, current] }),
		) as typeof fetch,
	})
	expect(fetched.records.map(item => item.title)).toEqual([
		'Current season title',
	])
})

test('refreshes an idempotent snapshot and publishes measured MAL momentum', async () => {
	const firstPayload = {
		data: [
			candidate({
				id: 91_001,
				rank: 1,
				audience: 1_000_000,
				title: 'Established chart leader',
			}),
			candidate({
				id: 91_002,
				rank: 2,
				audience: 50_000,
				title: 'Rising title',
			}),
		],
	}
	const fetchFirst = vi.fn(async () => Response.json(firstPayload))
	await refreshMalTrending({
		prisma,
		kind: 'manga',
		clientId: 'client-id',
		policyApprovalReference: 'test-policy',
		now,
		limit: 2,
		requestDelayMs: 0,
		leaseOwner: 'trend-test-first',
		fetchImpl: fetchFirst as typeof fetch,
	})
	expect(
		await prisma.catalogFeedItem.count({
			where: { provider: 'mal', kind: 'manga', feed: 'trending' },
		}),
	).toBe(0)

	const nextDay = new Date(now.getTime() + 24 * 60 * 60 * 1_000)
	const fetchSecond = vi.fn(async () =>
		Response.json({
			data: [
				candidate({
					id: 91_001,
					rank: 1,
					audience: 1_000_010,
					title: 'Established chart leader',
				}),
				candidate({
					id: 91_002,
					rank: 2,
					audience: 51_000,
					title: 'Rising title',
				}),
			],
		}),
	)
	const summary = await refreshMalTrending({
		prisma,
		kind: 'manga',
		clientId: 'client-id',
		policyApprovalReference: 'test-policy',
		now: nextDay,
		limit: 2,
		requestDelayMs: 0,
		leaseOwner: 'trend-test-second',
		fetchImpl: fetchSecond as typeof fetch,
	})
	expect(summary.historyCoverage24h).toBe(1)
	expect(summary.published).toBe(true)
	expect(summary.top[0]?.title).toBe('Rising title')

	const feed = await prisma.catalogFeedItem.findMany({
		where: { provider: 'mal', kind: 'manga', feed: 'trending' },
		orderBy: { rank: 'asc' },
		select: {
			rank: true,
			rankingVersion: true,
			media: { select: { title: true } },
		},
	})
	expect(feed).toEqual([
		{
			rank: 1,
			rankingVersion: 3,
			media: { title: 'Rising title' },
		},
		{
			rank: 2,
			rankingVersion: 3,
			media: { title: 'Established chart leader' },
		},
	])
	expect(
		await prisma.catalogMetricSnapshot.count({
			where: {
				provider: 'mal',
				kind: 'manga',
				media: {
					is: { title: { in: ['Established chart leader', 'Rising title'] } },
				},
			},
		}),
	).toBe(4)
})
