import { expect, test, vi } from 'vitest'
import { createMemoryCache } from './cache.server.ts'
import { prisma } from './db.server.ts'
import {
	getHomeTrending,
	HOME_TRENDING_LIMIT,
	HOME_TRENDING_PLAN_TTL_MS,
	parseHomeTrendingPlan,
	type HomeTrendingPlan,
} from './home-trending.server.ts'
import { createPublicSurfaceCacheRuntimeForTest } from './public-surface-cache.server.ts'

const now = new Date('2026-07-20T12:00:00.000Z')

type TrendingKind = 'movie' | 'tv' | 'anime' | 'manga'

async function createFreshFeed(
	kind: TrendingKind,
	titles: string[],
	observedAt = now,
) {
	const media = await Promise.all(
		titles.map((title, index) =>
			prisma.media.create({
				data: {
					kind,
					title,
					catalogPopularity: titles.length - index,
				},
			}),
		),
	)
	await prisma.catalogFeedItem.createMany({
		data: media.map((item, index) => ({
			provider: kind === 'anime' || kind === 'manga' ? 'mal' : 'tmdb',
			kind,
			feed: 'trending',
			rank: index + 1,
			rankingScore: titles.length - index,
			rankingVersion: 3,
			observedAt,
			mediaId: item.id,
		})),
	})
	return media
}

async function createOneFreshItemPerRail() {
	const entries = await Promise.all(
		(['movie', 'tv', 'anime', 'manga'] as const).map(async kind => ({
			kind,
			media: (await createFreshFeed(kind, [`Fresh ${kind}`]))[0]!,
		})),
	)
	return Object.fromEntries(
		entries.map(entry => [entry.kind, entry.media]),
	) as Record<TrendingKind, (typeof entries)[number]['media']>
}

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
				audience: 100,
				rankingScore: 0.7,
				rankingVersion: 3,
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
				audience: 1_000,
				rankingScore: 0.9,
				rankingVersion: 3,
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
				audience: 10,
				rankingScore: 0.1,
				rankingVersion: 3,
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
		'Provider Rank Two',
		'Provider Rank One',
	])
	expect(rails[0]?.items.map(item => item.source)).toEqual([
		'provider-feed',
		'provider-feed',
	])
	expect(rails[0]?.signal).toBe('trending')
	expect(rails[0]?.items[1]).toEqual(
		expect.objectContaining({
			rank: 2,
			score: 8.2,
			viewerTracking: expect.objectContaining({ status: 'watching' }),
		}),
	)
	expect(rails[0]?.items[0]?.viewerTracking).toBeNull()
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
				rankingVersion: 3,
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

test('runs the four fresh rail queries together, short-circuits fallbacks, and bypasses cache by default in tests', async () => {
	await createOneFreshItemPerRail()
	const feedQueries = vi.spyOn(prisma.catalogFeedItem, 'findMany')
	const mediaQueries = vi.spyOn(prisma.media, 'findMany')

	const first = await getHomeTrending(null, { now })
	const second = await getHomeTrending(null, { now })

	expect(first.map(rail => rail.kind)).toEqual([
		'movie',
		'tv',
		'anime',
		'manga',
	])
	expect(second).toEqual(first)
	expect(feedQueries).toHaveBeenCalledTimes(8)
	expect(
		feedQueries.mock.calls.every(call => {
			const input = call[0] as { where?: { feed?: string } } | undefined
			return input?.where?.feed === 'trending'
		}),
	).toBe(true)
	expect(mediaQueries).toHaveBeenCalledTimes(2)
	expect(
		mediaQueries.mock.calls.every(call => {
			const input = call[0] as
				{ where?: { id?: { in?: string[] } } } | undefined
			return input?.where?.id?.in?.length === 4
		}),
	).toBe(true)
})

test('queries each fallback tier sequentially and stops on the first nonempty tier', async () => {
	const [movie] = await createFreshFeed('movie', ['Fresh movie'])
	const [popularTv, seasonalAnime, catalogManga] = await Promise.all([
		prisma.media.create({
			data: { kind: 'tv', title: 'Popular TV' },
		}),
		prisma.media.create({
			data: {
				kind: 'anime',
				title: 'Current seasonal anime',
				startSeason: 'Summer 2026',
			},
		}),
		prisma.media.create({
			data: {
				kind: 'manga',
				title: 'Catalog manga',
				catalogPopularity: 100,
			},
		}),
	])
	await prisma.catalogFeedItem.createMany({
		data: [
			{
				provider: 'tmdb',
				kind: 'tv',
				feed: 'popular',
				rank: 1,
				rankingScore: 1,
				rankingVersion: 3,
				observedAt: now,
				mediaId: popularTv.id,
			},
			{
				provider: 'mal',
				kind: 'anime',
				feed: 'popular',
				rank: 1,
				rankingScore: 1,
				rankingVersion: 1,
				observedAt: now,
				mediaId: seasonalAnime.id,
			},
		],
	})
	const feedQueries = vi.spyOn(prisma.catalogFeedItem, 'findMany')
	const mediaQueries = vi.spyOn(prisma.media, 'findMany')

	const rails = await getHomeTrending(null, { now })

	const callsByKind = new Map<TrendingKind, string[]>()
	for (const call of feedQueries.mock.calls) {
		const input = call[0] as
			{ where?: { kind?: TrendingKind; feed?: string } } | undefined
		const kind = input?.where?.kind
		const feed = input?.where?.feed
		if (!kind || !feed) continue
		const calls = callsByKind.get(kind) ?? []
		calls.push(feed)
		callsByKind.set(kind, calls)
	}
	expect(callsByKind).toEqual(
		new Map([
			['movie', ['trending']],
			['tv', ['trending', 'popular']],
			['anime', ['trending', 'popular']],
			['manga', ['trending', 'popular']],
		]),
	)
	expect(mediaQueries).toHaveBeenCalledTimes(2)
	expect(
		mediaQueries.mock.calls.filter(call => {
			const input = call[0] as
				{ where?: { kind?: string; catalogPopularity?: unknown } } | undefined
			return (
				input?.where?.kind === 'manga' &&
				input.where.catalogPopularity !== undefined
			)
		}),
	).toHaveLength(1)
	expect(
		rails.map(rail => [rail.kind, rail.signal, rail.items[0]?.id]),
	).toEqual([
		['movie', 'trending', movie!.id],
		['tv', 'popular', popularTv.id],
		['anime', 'trending', seasonalAnime.id],
		['manga', 'legacy', catalogManga.id],
	])
})

test('shares one public plan across concurrent callers through single-flight', async () => {
	await createOneFreshItemPerRail()
	const runtime = createPublicSurfaceCacheRuntimeForTest()
	const feedQueries = vi.spyOn(prisma.catalogFeedItem, 'findMany')

	const results = await Promise.all(
		Array.from({ length: 8 }, () => getHomeTrending(null, { now, runtime })),
	)

	expect(results.every(result => result.length === 4)).toBe(true)
	expect(feedQueries).toHaveBeenCalledTimes(4)
	expect(runtime.cache.snapshot().entries).toBe(1)
})

test('expires the public plan after exactly the declared two-minute TTL', async () => {
	await createOneFreshItemPerRail()
	let cacheNow = Date.now()
	const runtime = createPublicSurfaceCacheRuntimeForTest({
		cache: createMemoryCache({
			name: 'home-trending-ttl-test',
			now: () => cacheNow,
		}),
	})
	const feedQueries = vi.spyOn(prisma.catalogFeedItem, 'findMany')

	await getHomeTrending(null, { now, runtime })
	cacheNow += HOME_TRENDING_PLAN_TTL_MS - 1_000
	await getHomeTrending(null, { now, runtime })
	expect(feedQueries).toHaveBeenCalledTimes(4)

	cacheNow += 2_000
	await getHomeTrending(null, { now, runtime })
	expect(HOME_TRENDING_PLAN_TTL_MS).toBe(120_000)
	expect(feedQueries).toHaveBeenCalledTimes(8)
})

test('keeps cached plans fixed, exact, unique, canonical, and bounded', () => {
	const emptyRails = () => [
		{ kind: 'movie', items: [] },
		{ kind: 'tv', items: [] },
		{ kind: 'anime', items: [] },
		{ kind: 'manga', items: [] },
	]
	expect(parseHomeTrendingPlan({ rails: emptyRails() }).rails).toHaveLength(4)

	for (const invalid of [
		{
			rails: [
				{
					kind: 'movie',
					items: Array.from(
						{ length: HOME_TRENDING_LIMIT + 1 },
						(_, index) => ({
							id: `media-${index}`,
							source: 'provider-feed',
							observedAt: now.toISOString(),
						}),
					),
				},
				...emptyRails().slice(1),
			],
		},
		{
			rails: [
				{
					kind: 'movie',
					items: [
						{
							id: 'duplicate-id',
							source: 'provider-feed',
							observedAt: now.toISOString(),
						},
						{
							id: 'duplicate-id',
							source: 'provider-feed',
							observedAt: now.toISOString(),
						},
					],
				},
				...emptyRails().slice(1),
			],
		},
		{
			rails: [
				{ kind: 'tv', items: [] },
				{ kind: 'movie', items: [] },
				...emptyRails().slice(2),
			],
		},
		{
			rails: emptyRails().map((rail, index) =>
				index === 0 ? { ...rail, explanation: 'not cache data' } : rail,
			),
		},
		{
			rails: [
				{
					kind: 'movie',
					items: [
						{
							id: 'media-a',
							source: 'provider-feed',
							observedAt: null,
						},
					],
				},
				...emptyRails().slice(1),
			],
		},
		{
			rails: [
				{
					kind: 'movie',
					items: [
						{
							id: 'media-a',
							source: 'catalog-popularity',
							observedAt: now.toISOString(),
						},
					],
				},
				...emptyRails().slice(1),
			],
		},
	]) {
		expect(() => parseHomeTrendingPlan(invalid)).toThrow()
	}
})

test('shares the anonymous public plan while hydrating each viewer state fresh and owner-scoped', async () => {
	const [media, viewerA, viewerB] = await Promise.all([
		createFreshFeed('movie', ['Shared public candidate']).then(
			items => items[0]!,
		),
		prisma.user.create({
			data: {
				email: 'trending_cache_viewer_a@example.com',
				username: 'trending_cache_viewer_a',
			},
		}),
		prisma.user.create({
			data: {
				email: 'trending_cache_viewer_b@example.com',
				username: 'trending_cache_viewer_b',
			},
		}),
	])
	await prisma.trackingState.createMany({
		data: [
			{ ownerId: viewerA.id, mediaId: media.id, status: 'watching' },
			{ ownerId: viewerB.id, mediaId: media.id, status: 'completed' },
		],
	})
	const runtime = createPublicSurfaceCacheRuntimeForTest()
	const trackingQueries = vi.spyOn(prisma.trackingState, 'findMany')

	const anonymous = await getHomeTrending(null, { now, runtime })
	const forViewerA = await getHomeTrending(viewerA.id, { now, runtime })
	const forViewerB = await getHomeTrending(viewerB.id, { now, runtime })
	await prisma.trackingState.update({
		where: {
			ownerId_mediaId: { ownerId: viewerA.id, mediaId: media.id },
		},
		data: { status: 'completed' },
	})
	const refreshedViewerA = await getHomeTrending(viewerA.id, {
		now,
		runtime,
	})

	expect(anonymous[0]?.items[0]?.viewerTracking).toBeNull()
	expect(forViewerA[0]?.items[0]?.viewerTracking?.status).toBe('watching')
	expect(forViewerB[0]?.items[0]?.viewerTracking?.status).toBe('completed')
	expect(refreshedViewerA[0]?.items[0]?.viewerTracking?.status).toBe(
		'completed',
	)
	expect(runtime.cache.snapshot().entries).toBe(1)
	expect(trackingQueries).toHaveBeenCalledTimes(3)
	expect(
		trackingQueries.mock.calls.map(call => {
			const input = call[0] as { where?: { ownerId?: string } } | undefined
			return input?.where?.ownerId
		}),
	).toEqual([viewerA.id, viewerB.id, viewerA.id])
})

test('rehydrates media metadata and drops deleted, title-null, or kind-changed cached IDs', async () => {
	const media = await createFreshFeed('movie', [
		'Delete after plan',
		'Clear title after plan',
		'Change kind after plan',
		'Keep after plan',
	])
	const runtime = createPublicSurfaceCacheRuntimeForTest()
	const feedQueries = vi.spyOn(prisma.catalogFeedItem, 'findMany')

	const first = await getHomeTrending(null, { now, runtime })
	const planQueryCount = feedQueries.mock.calls.length
	expect(first[0]?.items.map(item => item.id)).toEqual(
		media.map(item => item.id),
	)
	await Promise.all([
		prisma.media.delete({ where: { id: media[0]!.id } }),
		prisma.media.update({
			where: { id: media[1]!.id },
			data: { title: null },
		}),
		prisma.media.update({
			where: { id: media[2]!.id },
			data: { kind: 'tv' },
		}),
		prisma.media.update({
			where: { id: media[3]!.id },
			data: {
				title: 'Freshly hydrated title',
				catalogScore: 9.7,
			},
		}),
	])

	const second = await getHomeTrending(null, { now, runtime })

	expect(feedQueries).toHaveBeenCalledTimes(planQueryCount)
	expect(second).toHaveLength(1)
	expect(second[0]?.items).toHaveLength(1)
	expect(second[0]?.items[0]).toEqual(
		expect.objectContaining({
			id: media[3]!.id,
			title: 'Freshly hydrated title',
			score: 9.7,
			rank: 1,
		}),
	)
	expect(second[0]?.observedAt).toBeInstanceOf(Date)
	expect(second[0]?.items[0]?.observedAt).toBeInstanceOf(Date)
})

test('keys plans by semantic MAL season while keeping caller limits out of the key', async () => {
	const [summer, fall] = await Promise.all([
		prisma.media.create({
			data: {
				kind: 'anime',
				title: 'Summer seasonal result',
				startSeason: 'Summer 2026',
			},
		}),
		prisma.media.create({
			data: {
				kind: 'anime',
				title: 'Fall seasonal result',
				startSeason: 'Fall 2026',
			},
		}),
	])
	await prisma.catalogFeedItem.createMany({
		data: [
			{
				provider: 'mal',
				kind: 'anime',
				feed: 'popular',
				rank: 1,
				rankingScore: 1,
				observedAt: now,
				mediaId: summer.id,
			},
			{
				provider: 'mal',
				kind: 'anime',
				feed: 'popular',
				rank: 1,
				rankingScore: 1,
				observedAt: now,
				mediaId: fall.id,
			},
		],
	})
	const runtime = createPublicSurfaceCacheRuntimeForTest()

	const earlySummer = await getHomeTrending(null, {
		now: new Date('2026-07-01T00:00:00.000Z'),
		limit: 1,
		runtime,
	})
	const lateSummer = await getHomeTrending(null, {
		now: new Date('2026-08-31T23:59:59.000Z'),
		limit: HOME_TRENDING_LIMIT,
		runtime,
	})
	expect(earlySummer.find(rail => rail.kind === 'anime')?.items[0]?.id).toBe(
		summer.id,
	)
	expect(lateSummer.find(rail => rail.kind === 'anime')?.items[0]?.id).toBe(
		summer.id,
	)
	expect(runtime.cache.snapshot().entries).toBe(1)

	const fallRails = await getHomeTrending(null, {
		now: new Date('2026-10-01T00:00:00.000Z'),
		runtime,
	})
	expect(fallRails.find(rail => rail.kind === 'anime')?.items[0]?.id).toBe(
		fall.id,
	)
	expect(runtime.cache.snapshot().entries).toBe(2)
})

test('stores eighteen ordered IDs regardless of the first caller limit and restores order after fresh hydration', async () => {
	const titles = Array.from(
		{ length: HOME_TRENDING_LIMIT + 2 },
		(_, index) => `Ranked movie ${String(index + 1).padStart(2, '0')}`,
	)
	const media = await createFreshFeed('movie', titles)
	const runtime = createPublicSurfaceCacheRuntimeForTest()
	const feedQueries = vi.spyOn(prisma.catalogFeedItem, 'findMany')

	const compact = await getHomeTrending(null, {
		now,
		limit: 3,
		runtime,
	})
	const planQueryCount = feedQueries.mock.calls.length
	const full = await getHomeTrending(null, {
		now,
		limit: HOME_TRENDING_LIMIT,
		runtime,
	})

	expect(feedQueries).toHaveBeenCalledTimes(planQueryCount)
	expect(compact[0]?.items.map(item => item.id)).toEqual(
		media.slice(0, 3).map(item => item.id),
	)
	expect(full[0]?.items.map(item => item.id)).toEqual(
		media.slice(0, HOME_TRENDING_LIMIT).map(item => item.id),
	)
	expect(full[0]?.items.map(item => item.rank)).toEqual(
		Array.from({ length: HOME_TRENDING_LIMIT }, (_, index) => index + 1),
	)
	expect(runtime.cache.snapshot().entries).toBe(1)
	const [key] = runtime.cache.keys()
	const cachedEntry = key ? await runtime.cache.get(key) : undefined
	expect(Object.isFrozen(cachedEntry?.value)).toBe(true)
	expect(
		Object.isFrozen(
			(cachedEntry?.value as { rails?: unknown[] } | undefined)?.rails,
		),
	).toBe(true)
	const cachedPlan: HomeTrendingPlan = parseHomeTrendingPlan(cachedEntry?.value)
	expect(cachedPlan.rails).toHaveLength(4)
	expect(cachedPlan.rails[0].items).toHaveLength(HOME_TRENDING_LIMIT)
	expect(cachedPlan.rails.flatMap(rail => rail.items)).toHaveLength(
		HOME_TRENDING_LIMIT,
	)
	expect(
		cachedPlan.rails[0].items.every(
			item =>
				typeof item.observedAt === 'string' && item.observedAt.endsWith('Z'),
		),
	).toBe(true)
})
