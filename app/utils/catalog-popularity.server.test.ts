import { expect, test } from 'vitest'
import { prisma } from './db.server.ts'
import { getDiscoveryResults } from './discovery.server.ts'
import { providerFeedRankingScores } from './tmdb-catalog-hydration.server.ts'

test('audience size prevents a low-audience raw outlier from leading popularity', () => {
	const scores = providerFeedRankingScores(
		[
			{ rank: 1, audience: 3 },
			{ rank: 2, audience: 120_000 },
			{ rank: 20, audience: 80_000 },
		],
		'popular',
	)
	expect(scores[1]).toBeGreaterThan(scores[0]!)
	expect(scores.every(score => score >= 0 && score <= 1)).toBe(true)
})

test('single-digit audiences receive an absolute confidence penalty', () => {
	const scores = providerFeedRankingScores(
		[
			{ rank: 1, audience: 6 },
			{ rank: 8, audience: 1_000 },
			{ rank: 20, audience: 500 },
		],
		'popular',
	)

	expect(scores[1]).toBeGreaterThan(scores[0]!)
	expect(scores[2]).toBeGreaterThan(scores[0]!)
})

test('popular feeds require more audience evidence than trending feeds', () => {
	const signals = [
		{ rank: 1, audience: 257 },
		{ rank: 3, audience: 4_000 },
		{ rank: 20, audience: 11_000 },
	]
	const popular = providerFeedRankingScores(signals, 'popular')
	const trending = providerFeedRankingScores(signals, 'trending')

	expect(popular[1]).toBeGreaterThan(popular[0]!)
	expect(trending[0]).toBeGreaterThan(popular[0]!)
})

test('raw TV popularity outliers cannot outrank a normalized popular-feed leader', async () => {
	const [leader, tagesschau, roteRosen] = await Promise.all([
		prisma.media.create({
			data: {
				kind: 'tv',
				title: 'Normalized Feed Leader',
				catalogPopularity: 1,
			},
		}),
		prisma.media.create({
			data: {
				kind: 'tv',
				title: 'Tagesschau',
				catalogPopularity: 999_999,
			},
		}),
		prisma.media.create({
			data: {
				kind: 'tv',
				title: 'Rote Rosen',
				catalogPopularity: 888_888,
			},
		}),
	])
	await prisma.catalogFeedItem.create({
		data: {
			provider: 'tmdb',
			kind: 'tv',
			feed: 'popular',
			rank: 1,
			audience: 500_000,
			rankingScore: 1,
			rankingVersion: 3,
			observedAt: new Date(),
			mediaId: leader.id,
		},
	})

	const result = await getDiscoveryResults(
		{
			q: '',
			kind: 'tv',
			mode: 'standard',
			genre: '',
			year: null,
			status: '',
			provider: 'all',
			sort: 'popular',
			page: 1,
		},
		null,
	)

	expect(result.items[0]?.id).toBe(leader.id)
	expect(
		result.items.findIndex(item => item.id === tagesschau.id),
	).toBeGreaterThan(0)
	expect(
		result.items.findIndex(item => item.id === roteRosen.id),
	).toBeGreaterThan(0)
})
