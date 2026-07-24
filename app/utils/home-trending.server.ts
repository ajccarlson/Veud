import { type Prisma } from '@prisma/client'
import { prisma } from './db.server.ts'

export const HOME_TRENDING_LIMIT = 18
const FEED_FRESHNESS_MS = 8 * 24 * 60 * 60 * 1_000

const railDefinitions = [
	{ kind: 'movie', title: 'Trending movies' },
	{ kind: 'tv', title: 'Trending TV' },
	{ kind: 'anime', title: 'Trending anime' },
	{ kind: 'manga', title: 'Trending manga' },
] as const

const homeTrendingMediaSelect = {
	id: true,
	kind: true,
	title: true,
	thumbnail: true,
	type: true,
	releaseStart: true,
	startYear: true,
	airYear: true,
	catalogScore: true,
	catalogPopularity: true,
	tmdbScore: true,
	malScore: true,
} satisfies Prisma.MediaSelect

type HomeTrendingMedia = Prisma.MediaGetPayload<{
	select: typeof homeTrendingMediaSelect
}>

export type HomeTrendingItem = {
	id: string
	kind: string
	title: string
	thumbnail: string | null
	type: string | null
	year: string | null
	score: number | null
	rank: number
	source: 'provider-feed' | 'popular-fallback' | 'catalog-popularity'
	observedAt: Date | null
	viewerTracking: {
		status: string
		statusWatchlistId: string | null
	} | null
}

export type HomeTrendingRail = {
	kind: (typeof railDefinitions)[number]['kind']
	title: string
	items: HomeTrendingItem[]
	signal: 'trending' | 'popular' | 'legacy'
	observedAt: Date | null
}

function yearFor(media: HomeTrendingMedia) {
	if (media.releaseStart) return String(media.releaseStart.getUTCFullYear())
	return media.startYear || media.airYear || null
}

function providerScore(media: HomeTrendingMedia) {
	const values = [
		media.catalogScore,
		media.tmdbScore === null ? null : Number(media.tmdbScore),
		media.malScore === null ? null : Number(media.malScore),
	].filter((value): value is number => value !== null && Number.isFinite(value))
	return values.length ? Math.max(...values) : null
}

async function candidatesForRail(input: {
	kind: HomeTrendingRail['kind']
	limit: number
	freshAfter: Date
}) {
	const [feedItems, popularFeedItems, popular] = await Promise.all([
		prisma.catalogFeedItem.findMany({
			where: {
				kind: input.kind,
				feed: 'trending',
				observedAt: { gte: input.freshAfter },
				media: { is: { title: { not: null } } },
			},
			orderBy: [{ observedAt: 'desc' }, { rank: 'asc' }],
			take: input.limit,
			select: {
				observedAt: true,
				media: { select: homeTrendingMediaSelect },
			},
		}),
		prisma.catalogFeedItem.findMany({
			where: {
				kind: input.kind,
				feed: 'popular',
				media: { is: { title: { not: null } } },
			},
			orderBy: [{ rankingScore: 'desc' }, { rank: 'asc' }, { mediaId: 'asc' }],
			take: input.limit,
			select: {
				observedAt: true,
				media: { select: homeTrendingMediaSelect },
			},
		}),
		prisma.media.findMany({
			where: { kind: input.kind, title: { not: null } },
			orderBy: [
				{ catalogPopularity: 'desc' },
				{ releaseStart: 'desc' },
				{ title: 'asc' },
			],
			take: input.limit,
			select: homeTrendingMediaSelect,
		}),
	])
	const uniqueFeedItems = [
		...new Map(feedItems.map(item => [item.media.id, item])).values(),
	]
	const uniquePopularFeedItems = [
		...new Map(popularFeedItems.map(item => [item.media.id, item])).values(),
	]
	if (uniqueFeedItems.length) {
		return uniqueFeedItems.slice(0, input.limit).map(item => ({
			media: item.media,
			source: 'provider-feed' as const,
			observedAt: item.observedAt,
		}))
	}
	if (uniquePopularFeedItems.length) {
		return uniquePopularFeedItems.slice(0, input.limit).map(item => ({
			media: item.media,
			source: 'popular-fallback' as const,
			observedAt: item.observedAt,
		}))
	}
	return popular.map(media => ({
		media,
		source: 'catalog-popularity' as const,
		observedAt: null,
	}))
}

export async function getHomeTrending(
	viewerId: string | null,
	options: { now?: Date; limit?: number } = {},
) {
	const now = options.now ?? new Date()
	const limit = Math.max(
		1,
		Math.min(options.limit ?? HOME_TRENDING_LIMIT, HOME_TRENDING_LIMIT),
	)
	const freshAfter = new Date(now.getTime() - FEED_FRESHNESS_MS)
	const candidates = await Promise.all(
		railDefinitions.map(async rail => ({
			...rail,
			items: await candidatesForRail({ kind: rail.kind, limit, freshAfter }),
		})),
	)
	const mediaIds = candidates.flatMap(rail =>
		rail.items.map(item => item.media.id),
	)
	const viewerStates = viewerId
		? await prisma.trackingState.findMany({
				where: { ownerId: viewerId, mediaId: { in: mediaIds } },
				select: {
					mediaId: true,
					status: true,
					statusWatchlistId: true,
				},
			})
		: []
	const viewerStateByMediaId = new Map(
		viewerStates.map(state => [state.mediaId, state]),
	)

	return candidates.flatMap(rail => {
		if (!rail.items.length) return []
		return [
			{
				kind: rail.kind,
				title:
					rail.items[0]?.source === 'provider-feed'
						? rail.title
						: rail.items[0]?.source === 'popular-fallback'
							? `Popular ${rail.kind === 'tv' ? 'TV' : rail.kind}`
							: `Catalog ${rail.kind === 'tv' ? 'TV' : rail.kind}`,
				signal:
					rail.items[0]?.source === 'provider-feed'
						? ('trending' as const)
						: rail.items[0]?.source === 'popular-fallback'
							? ('popular' as const)
							: ('legacy' as const),
				observedAt: rail.items[0]?.observedAt ?? null,
				items: rail.items.map(({ media, source }, index) => {
					const viewerState = viewerStateByMediaId.get(media.id)
					return {
						id: media.id,
						kind: media.kind,
						title: media.title?.trim() || `Untitled ${media.kind}`,
						thumbnail: media.thumbnail,
						type: media.type,
						year: yearFor(media),
						score: providerScore(media),
						rank: index + 1,
						source,
						observedAt: rail.items[index]?.observedAt ?? null,
						viewerTracking: viewerState
							? {
									status: viewerState.status,
									statusWatchlistId: viewerState.statusWatchlistId,
								}
							: null,
					} satisfies HomeTrendingItem
				}),
			} satisfies HomeTrendingRail,
		]
	})
}
