import { expect, test } from 'vitest'
import { prisma } from './db.server.ts'
import { getHomeTrending } from './home-trending.server.ts'

const now = new Date('2026-07-20T12:00:00.000Z')

test('fresh trending rails stay pure instead of silently mixing fallback signals', async () => {
	const viewer = await prisma.user.create({
		data: {
			email: 'home_trending_viewer@example.com',
			username: 'home_trending_viewer',
		},
	})
	const other = await prisma.user.create({
		data: {
			email: 'home_trending_other@example.com',
			username: 'home_trending_other',
		},
	})
	const [rankedFirst, rankedSecond, , staleFeed] = await Promise.all([
		prisma.media.create({
			data: {
				kind: 'movie',
				title: 'Provider Rank One',
				catalogPopularity: 10,
				catalogScore: 8.2,
			},
		}),
		prisma.media.create({
			data: {
				kind: 'movie',
				title: 'Provider Rank Two',
				catalogPopularity: 20,
			},
		}),
		prisma.media.create({
			data: {
				kind: 'movie',
				title: 'Popularity Fallback',
				catalogPopularity: 500,
			},
		}),
		prisma.media.create({
			data: {
				kind: 'movie',
				title: 'Stale Provider Rank',
				catalogPopularity: 1,
			},
		}),
	])
	await Promise.all([
		prisma.catalogFeedItem.create({
			data: {
				provider: 'tmdb',
				kind: 'movie',
				feed: 'trending',
				rank: 1,
				observedAt: now,
				mediaId: rankedFirst.id,
			},
		}),
		prisma.catalogFeedItem.create({
			data: {
				provider: 'tmdb',
				kind: 'movie',
				feed: 'trending',
				rank: 2,
				observedAt: now,
				mediaId: rankedSecond.id,
			},
		}),
		prisma.catalogFeedItem.create({
			data: {
				provider: 'tmdb',
				kind: 'movie',
				feed: 'trending',
				rank: 1,
				observedAt: new Date('2026-07-01T00:00:00.000Z'),
				mediaId: staleFeed.id,
			},
		}),
		prisma.trackingState.create({
			data: {
				ownerId: viewer.id,
				mediaId: rankedFirst.id,
				status: 'watching',
			},
		}),
		prisma.trackingState.create({
			data: {
				ownerId: other.id,
				mediaId: rankedSecond.id,
				status: 'completed',
			},
		}),
	])

	const rails = await getHomeTrending(viewer.id, { now, limit: 4 })

	expect(rails).toHaveLength(1)
	expect(rails[0]?.items.map(item => item.title)).toEqual([
		'Provider Rank One',
		'Provider Rank Two',
	])
	expect(rails[0]?.items.map(item => item.source)).toEqual([
		'provider-feed',
		'provider-feed',
	])
	expect(rails[0]?.signal).toBe('trending')
	expect(rails[0]?.items[0]).toEqual(
		expect.objectContaining({
			rank: 1,
			score: 8.2,
			viewerTracking: expect.objectContaining({ status: 'watching' }),
		}),
	)
	expect(rails[0]?.items[1]?.viewerTracking).toBeNull()
})

test('a stale trending chart falls back to normalized all-time popularity', async () => {
	const [staleTrending, normalizedPopular, rawOutlier] = await Promise.all([
		prisma.media.create({
			data: { kind: 'tv', title: 'Stale trending title' },
		}),
		prisma.media.create({
			data: { kind: 'tv', title: 'Normalized popular title' },
		}),
		prisma.media.create({
			data: {
				kind: 'tv',
				title: 'Raw popularity outlier',
				catalogPopularity: 999_999,
			},
		}),
	])
	await Promise.all([
		prisma.catalogFeedItem.create({
			data: {
				provider: 'tmdb',
				kind: 'tv',
				feed: 'trending',
				rank: 1,
				observedAt: new Date('2026-06-01T00:00:00.000Z'),
				mediaId: staleTrending.id,
			},
		}),
		prisma.catalogFeedItem.create({
			data: {
				provider: 'tmdb',
				kind: 'tv',
				feed: 'popular',
				rank: 1,
				rankingScore: 1,
				observedAt: new Date('2026-06-01T00:00:00.000Z'),
				mediaId: normalizedPopular.id,
			},
		}),
	])

	const rails = await getHomeTrending(null, { now, limit: 4 })
	const tv = rails.find(rail => rail.kind === 'tv')
	expect(tv?.signal).toBe('popular')
	expect(tv?.items.map(item => item.title)).toEqual([
		'Normalized popular title',
	])
	expect(tv?.items[0]?.source).toBe('popular-fallback')
	expect(tv?.items.some(item => item.id === rawOutlier.id)).toBe(false)
})

test('anime falls back to current-season MAL popularity instead of all-time titles', async () => {
	const [seasonRankTwo, seasonRankOne, allTimeRankOne] = await Promise.all([
		prisma.media.create({
			data: {
				kind: 'anime',
				title: 'Summer Rank Two',
				startSeason: 'Summer 2026',
			},
		}),
		prisma.media.create({
			data: {
				kind: 'anime',
				title: 'Summer Rank One',
				startSeason: 'Summer 2026',
			},
		}),
		prisma.media.create({
			data: {
				kind: 'anime',
				title: 'All-Time Rank One',
				startSeason: 'Fall 1999',
			},
		}),
	])
	await prisma.catalogFeedItem.createMany({
		data: [
			{
				provider: 'mal',
				kind: 'anime',
				feed: 'popular',
				rank: 2,
				rankingScore: 0.8,
				observedAt: now,
				mediaId: seasonRankTwo.id,
			},
			{
				provider: 'mal',
				kind: 'anime',
				feed: 'popular',
				rank: 1,
				rankingScore: 0.7,
				observedAt: now,
				mediaId: seasonRankOne.id,
			},
			{
				provider: 'mal',
				kind: 'anime',
				feed: 'popular',
				rank: 1,
				rankingScore: 1,
				observedAt: now,
				mediaId: allTimeRankOne.id,
			},
		],
	})

	const anime = (await getHomeTrending(null, { now, limit: 10 })).find(
		rail => rail.kind === 'anime',
	)
	expect(anime?.title).toBe('Trending anime')
	expect(anime?.signal).toBe('trending')
	expect(anime?.items.map(item => item.title)).toEqual([
		'Summer Rank One',
		'Summer Rank Two',
	])
})

test('popularity fallbacks exclude unranked anime and manga inventory', async () => {
	const [rankedAnime, unrankedAnime, nullScoreFeedAnime, unrankedManga] =
		await Promise.all([
			prisma.media.create({
				data: {
					kind: 'anime',
					title: 'Recognized Popular Anime',
					catalogPopularity: 1,
				},
			}),
			prisma.media.create({
				data: { kind: 'anime', title: 'Unranked Anime Inventory' },
			}),
			prisma.media.create({
				data: { kind: 'anime', title: 'Unscored Popular Feed Anime' },
			}),
			prisma.media.create({
				data: { kind: 'manga', title: 'Unranked Manga Inventory' },
			}),
		])
	await prisma.catalogFeedItem.create({
		data: {
			provider: 'mal',
			kind: 'anime',
			feed: 'popular',
			rank: 1,
			rankingScore: null,
			observedAt: now,
			mediaId: nullScoreFeedAnime.id,
		},
	})

	const rails = await getHomeTrending(null, { now, limit: 10 })
	const anime = rails.find(rail => rail.kind === 'anime')
	const manga = rails.find(rail => rail.kind === 'manga')

	expect(anime?.signal).toBe('legacy')
	expect(anime?.items.map(item => item.id)).toEqual([rankedAnime.id])
	expect(anime?.items.some(item => item.id === unrankedAnime.id)).toBe(false)
	expect(anime?.items.some(item => item.id === nullScoreFeedAnime.id)).toBe(
		false,
	)
	expect(manga).toBeUndefined()
	expect(unrankedManga.catalogPopularity).toBeNull()
})
