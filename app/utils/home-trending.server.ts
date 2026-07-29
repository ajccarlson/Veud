import { type Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from './db.server.ts'
import { currentMalSeason } from './mal-trending.server.ts'
import {
	getPublicSurfaceFragment,
	type PublicSurfaceCacheRuntime,
} from './public-surface-cache.server.ts'
import { TMDB_FEED_RANKING_VERSION } from './tmdb-catalog-hydration.server.ts'

export const HOME_TRENDING_LIMIT = 18
export const HOME_TRENDING_PLAN_TTL_MS = 2 * 60 * 1_000
export const HOME_TRENDING_ALGORITHM_VERSION = 1

const HOME_TRENDING_PLAN_KEY_VERSION = 1
const FEED_FRESHNESS_MS = 8 * 24 * 60 * 60 * 1_000
const MEDIA_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

const railDefinitions = [
	{ kind: 'movie', title: 'Trending movies' },
	{ kind: 'tv', title: 'Trending TV' },
	{ kind: 'anime', title: 'Trending anime' },
	{ kind: 'manga', title: 'Trending manga' },
] as const

const homeTrendingSourceSchema = z.enum([
	'provider-feed',
	'popular-fallback',
	'catalog-popularity',
])
type HomeTrendingSource = z.infer<typeof homeTrendingSourceSchema>

const canonicalIsoDateSchema = z
	.string()
	.datetime()
	.refine(value => new Date(value).toISOString() === value, {
		message: 'observedAt must be a canonical ISO timestamp',
	})

const homeTrendingPlanItemSchema = z
	.object({
		id: z.string().regex(MEDIA_ID_PATTERN),
		source: homeTrendingSourceSchema,
		observedAt: canonicalIsoDateSchema.nullable(),
	})
	.strict()
	.superRefine((item, context) => {
		if ((item.source === 'catalog-popularity') !== (item.observedAt === null)) {
			context.addIssue({
				code: 'custom',
				path: ['observedAt'],
				message:
					'catalog fallbacks require a null observation and feed rows require an observation',
			})
		}
	})

function planRailSchema<Kind extends HomeTrendingRail['kind']>(kind: Kind) {
	return z
		.object({
			kind: z.literal(kind),
			items: z.array(homeTrendingPlanItemSchema).max(HOME_TRENDING_LIMIT),
		})
		.strict()
		.superRefine((rail, context) => {
			const ids = new Set<string>()
			const sources = new Set<HomeTrendingSource>()
			for (const [index, item] of rail.items.entries()) {
				if (ids.has(item.id)) {
					context.addIssue({
						code: 'custom',
						path: ['items', index, 'id'],
						message: 'trending plan IDs must be unique within a rail',
					})
				}
				ids.add(item.id)
				sources.add(item.source)
			}
			if (sources.size > 1) {
				context.addIssue({
					code: 'custom',
					path: ['items'],
					message: 'a trending rail cannot mix ranking signals',
				})
			}
		})
}

const homeTrendingPlanSchema = z
	.object({
		rails: z.tuple([
			planRailSchema('movie'),
			planRailSchema('tv'),
			planRailSchema('anime'),
			planRailSchema('manga'),
		]),
	})
	.strict()

export type HomeTrendingPlan = z.infer<typeof homeTrendingPlanSchema>

/**
 * The cache boundary calls this parser on fresh, cached, bypassed, and returned
 * values. It is exported so load gates can assert the exact public fragment
 * contract without exposing a producer or cache override to application code.
 */
export function parseHomeTrendingPlan(value: unknown): HomeTrendingPlan {
	return homeTrendingPlanSchema.parse(value)
}

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
	source: HomeTrendingSource
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

type PlannedCandidate = HomeTrendingPlan['rails'][number]['items'][number]

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

function uniqueFeedPlanItems(
	items: Array<{ mediaId: string; observedAt: Date }>,
	source: Extract<HomeTrendingSource, 'provider-feed' | 'popular-fallback'>,
) {
	return [...new Map(items.map(item => [item.mediaId, item] as const)).values()]
		.slice(0, HOME_TRENDING_LIMIT)
		.map((item): PlannedCandidate => ({
			id: item.mediaId,
			source,
			observedAt: item.observedAt.toISOString(),
		}))
}

async function candidatesForRail(input: {
	kind: HomeTrendingRail['kind']
	freshAfter: Date
	currentSeasonLabel: string
}) {
	const provider =
		input.kind === 'anime' || input.kind === 'manga' ? 'mal' : 'tmdb'
	const feedItems = await prisma.catalogFeedItem.findMany({
		where: {
			provider,
			kind: input.kind,
			feed: 'trending',
			rankingScore: { not: null },
			rankingVersion: {
				gte: provider === 'mal' ? 3 : TMDB_FEED_RANKING_VERSION,
			},
			observedAt: { gte: input.freshAfter },
			media: { is: { title: { not: null } } },
		},
		orderBy: [
			{ observedAt: 'desc' },
			{ rankingScore: 'desc' },
			{ rank: 'asc' },
		],
		take: HOME_TRENDING_LIMIT,
		select: {
			mediaId: true,
			observedAt: true,
		},
	})
	const freshPlan = uniqueFeedPlanItems(feedItems, 'provider-feed')
	if (freshPlan.length) return freshPlan

	if (input.kind === 'anime') {
		const seasonalAnimeItems = await prisma.catalogFeedItem.findMany({
			where: {
				provider: 'mal',
				kind: 'anime',
				feed: 'popular',
				rankingScore: { not: null },
				media: {
					is: {
						title: { not: null },
						startSeason: input.currentSeasonLabel,
					},
				},
			},
			orderBy: [{ rank: 'asc' }, { mediaId: 'asc' }],
			take: HOME_TRENDING_LIMIT,
			select: {
				mediaId: true,
				observedAt: true,
			},
		})
		const seasonalPlan = uniqueFeedPlanItems(
			seasonalAnimeItems,
			'provider-feed',
		)
		if (seasonalPlan.length) return seasonalPlan
	}

	const popularFeedItems = await prisma.catalogFeedItem.findMany({
		where: {
			provider,
			kind: input.kind,
			feed: 'popular',
			rankingScore: { not: null },
			rankingVersion: {
				gte: provider === 'mal' ? 1 : TMDB_FEED_RANKING_VERSION,
			},
			media: { is: { title: { not: null } } },
		},
		orderBy: [{ rankingScore: 'desc' }, { rank: 'asc' }, { mediaId: 'asc' }],
		take: HOME_TRENDING_LIMIT,
		select: {
			mediaId: true,
			observedAt: true,
		},
	})
	const popularPlan = uniqueFeedPlanItems(popularFeedItems, 'popular-fallback')
	if (popularPlan.length) return popularPlan

	const popular = await prisma.media.findMany({
		where: {
			kind: input.kind,
			title: { not: null },
			catalogPopularity: { not: null },
		},
		orderBy: [
			{ catalogPopularity: 'desc' },
			{ releaseStart: 'desc' },
			{ title: 'asc' },
		],
		take: HOME_TRENDING_LIMIT,
		select: { id: true },
	})
	return popular.map((media): PlannedCandidate => ({
		id: media.id,
		source: 'catalog-popularity',
		observedAt: null,
	}))
}

async function createHomeTrendingPlan(now: Date) {
	const currentSeason = currentMalSeason(now)
	const currentSeasonLabel = `${currentSeason.season[0]!.toUpperCase()}${currentSeason.season.slice(1)} ${currentSeason.year}`
	const freshAfter = new Date(now.getTime() - FEED_FRESHNESS_MS)
	const rails = await Promise.all(
		railDefinitions.map(async rail => ({
			kind: rail.kind,
			items: await candidatesForRail({
				kind: rail.kind,
				freshAfter,
				currentSeasonLabel,
			}),
		})),
	)
	return parseHomeTrendingPlan({ rails })
}

function signalForSource(
	source: HomeTrendingSource,
): HomeTrendingRail['signal'] {
	if (source === 'provider-feed') return 'trending'
	if (source === 'popular-fallback') return 'popular'
	return 'legacy'
}

function titleForRail(
	rail: (typeof railDefinitions)[number],
	source: HomeTrendingSource,
) {
	if (rail.kind === 'anime' || rail.kind === 'manga') return rail.title
	if (source === 'provider-feed') return rail.title
	if (source === 'popular-fallback') {
		return `Popular ${rail.kind === 'tv' ? 'TV' : rail.kind}`
	}
	return `Catalog ${rail.kind === 'tv' ? 'TV' : rail.kind}`
}

export async function getHomeTrending(
	viewerId: string | null,
	options: {
		now?: Date
		limit?: number
		runtime?: PublicSurfaceCacheRuntime
	} = {},
) {
	const now = options.now ?? new Date()
	const limit = Math.max(
		1,
		Math.min(options.limit ?? HOME_TRENDING_LIMIT, HOME_TRENDING_LIMIT),
	)
	const currentSeason = currentMalSeason(now)
	const plan = await getPublicSurfaceFragment({
		namespace: 'home-trending-plan',
		keyVersion: HOME_TRENDING_PLAN_KEY_VERSION,
		keyPayload: {
			algorithmVersion: HOME_TRENDING_ALGORITHM_VERSION,
			malSeason: {
				year: currentSeason.year,
				season: currentSeason.season,
			},
		},
		ttl: HOME_TRENDING_PLAN_TTL_MS,
		parse: parseHomeTrendingPlan,
		getFreshValue: () => createHomeTrendingPlan(now),
		runtime: options.runtime,
	})

	const plannedIds = [
		...new Set(plan.rails.flatMap(rail => rail.items.map(item => item.id))),
	]
	const media = plannedIds.length
		? await prisma.media.findMany({
				where: { id: { in: plannedIds } },
				select: homeTrendingMediaSelect,
			})
		: []
	const mediaById = new Map(media.map(item => [item.id, item]))
	const hydratedRails = plan.rails.map((rail, railIndex) => {
		const definition = railDefinitions[railIndex]!
		const items = rail.items
			.flatMap(item => {
				const current = mediaById.get(item.id)
				if (
					!current ||
					current.kind !== definition.kind ||
					current.title === null
				) {
					return []
				}
				return [
					{
						media: current,
						source: item.source,
						observedAt:
							item.observedAt === null ? null : new Date(item.observedAt),
					},
				]
			})
			.slice(0, limit)
		return { definition, items }
	})
	const mediaIds = hydratedRails.flatMap(rail =>
		rail.items.map(item => item.media.id),
	)
	const viewerStates =
		viewerId && mediaIds.length
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

	return hydratedRails.flatMap(({ definition, items }) => {
		const first = items[0]
		if (!first) return []
		return [
			{
				kind: definition.kind,
				title: titleForRail(definition, first.source),
				signal: signalForSource(first.source),
				observedAt: first.observedAt,
				items: items.map(({ media: item, source, observedAt }, index) => {
					const viewerState = viewerStateByMediaId.get(item.id)
					return {
						id: item.id,
						kind: item.kind,
						title: item.title?.trim() || `Untitled ${item.kind}`,
						thumbnail: item.thumbnail,
						type: item.type,
						year: yearFor(item),
						score: providerScore(item),
						rank: index + 1,
						source,
						observedAt,
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
