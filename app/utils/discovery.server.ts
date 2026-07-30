import { createHash } from 'node:crypto'
import { type Prisma } from '@prisma/client'
import { z } from 'zod'
import { normalizeCatalogTitle } from './catalog-sync.server.ts'
import { prisma } from './db.server.ts'
import { publicTrackingStateWhere } from './lists/visibility.ts'
import {
	getPublicTrackingSummariesByMediaId,
	type PublicTrackingSummary,
} from './media-community.server.ts'
import { type NaturalLanguageDiscoveryPlan } from './natural-language-discovery.ts'
import { prismaSearchFilter } from './prisma-search.server.ts'
import {
	getPublicSurfaceFragment,
	type PublicSurfaceCacheRuntime,
} from './public-surface-cache.server.ts'
import {
	createRankedDiscoveryViewerFingerprint,
	getRankedDiscoveryPlan,
	type RankedDiscoveryPlanRequest,
} from './ranked-discovery-cache.server.ts'
import { TMDB_FEED_RANKING_VERSION } from './tmdb-catalog-hydration.server.ts'

export const DISCOVERY_PAGE_SIZE = 24
const FOR_YOU_CANDIDATE_LIMIT = 500
const RANKED_DISCOVERY_PLAN_LIMIT = 1_000
const RANKING_QUERY_CHUNK_SIZE = 400
const POPULAR_FEED_FRESHNESS_MS = 8 * 24 * 60 * 60 * 1_000
export const DISCOVERY_FACETS_CACHE_TTL_MS = 5 * 60 * 1_000
export const DISCOVERY_GENRE_SOURCE_LIMIT = 4_096
export const DISCOVERY_STATUS_SOURCE_LIMIT = 256
export const DISCOVERY_GENRE_SOURCE_MAX_CODE_UNITS = 512
export const DISCOVERY_STATUS_SOURCE_MAX_CODE_UNITS = 60
export const DISCOVERY_GENRE_LIMIT = 128
export const DISCOVERY_STATUS_LIMIT = 64
export const DISCOVERY_GENRE_MAX_CODE_UNITS = 80
export const DISCOVERY_STATUS_MAX_CODE_UNITS = 60
export const DISCOVERY_GENRE_MAX_BYTES = 240
export const DISCOVERY_STATUS_MAX_BYTES = 180
export const DISCOVERY_FACETS_CACHE_MAX_BYTES = 48 * 1_024

const DISCOVERY_GENRE_SOURCE_QUERY_LIMIT = DISCOVERY_GENRE_SOURCE_LIMIT + 1
const DISCOVERY_STATUS_SOURCE_QUERY_LIMIT = DISCOVERY_STATUS_SOURCE_LIMIT + 1
const DISCOVERY_GENRE_SOURCE_MAX_BYTES =
	DISCOVERY_GENRE_SOURCE_MAX_CODE_UNITS * 4
const DISCOVERY_STATUS_SOURCE_MAX_BYTES =
	DISCOVERY_STATUS_SOURCE_MAX_CODE_UNITS * 4
const DISCOVERY_FACETS_CACHE_KEY_VERSION = 2
const facetBaseCollator = new Intl.Collator('en-US', {
	usage: 'sort',
	sensitivity: 'base',
})
const facetVariantCollator = new Intl.Collator('en-US', {
	usage: 'sort',
	sensitivity: 'variant',
})

export const discoveryKinds = ['all', 'movie', 'tv', 'anime', 'manga'] as const
export const discoveryProviders = ['all', 'tmdb', 'mal'] as const
export const discoveryModes = ['standard', 'memory', 'describe'] as const
export const discoverySorts = [
	'popular',
	'top-rated',
	'newest',
	'title',
	'for-you',
] as const

const DiscoveryQuerySchema = z.object({
	q: z.string().trim().max(500).catch(''),
	kind: z.enum(discoveryKinds).catch('all'),
	mode: z.enum(discoveryModes).catch('standard'),
	genre: z.string().trim().max(80).catch(''),
	year: z.preprocess(
		value =>
			value === '' || value === null || value === undefined ? null : value,
		z.coerce.number().int().min(1870).max(2200).nullable().catch(null),
	),
	status: z.string().trim().max(60).catch(''),
	provider: z.enum(discoveryProviders).catch('all'),
	sort: z.enum(discoverySorts).catch('popular'),
	page: z.coerce.number().int().min(1).max(1_000).catch(1),
})

export type DiscoveryQuery = z.infer<typeof DiscoveryQuerySchema>

export type DiscoveryResult = {
	id: string
	kind: string
	title: string
	matchedTitle: string | null
	thumbnail: string | null
	type: string | null
	year: string | null
	releaseStatus: string | null
	providers: string[]
	genres: string[]
	description: string | null
	providerScore: number | null
	communityScore: number | null
	ratingCount: number
	trackerCount: number
	reviewCount: number
	diaryCount: number
	viewerTracking: {
		status: string
		statusWatchlistId: string | null
	} | null
	memoryMatch?: {
		summary: string
		matchedClues: string[]
	}
}

export type DiscoveryResults = {
	filters: DiscoveryQuery
	items: DiscoveryResult[]
	total: number
	pageCount: number
	preferredGenres: string[]
}

const discoveryMediaSelect = {
	id: true,
	kind: true,
	title: true,
	thumbnail: true,
	type: true,
	releaseStart: true,
	startYear: true,
	airYear: true,
	genres: true,
	description: true,
	releaseStatus: true,
	catalogScore: true,
	catalogPopularity: true,
	tmdbScore: true,
	malScore: true,
	createdAt: true,
	titles: {
		select: {
			value: true,
			normalized: true,
			isPrimary: true,
		},
	},
	externalIds: {
		where: { tombstonedAt: null },
		select: {
			provider: true,
			externalId: true,
			lastFetchedAt: true,
			sourceAudience: true,
			sourceRatingCount: true,
		},
	},
	_count: {
		select: {
			reviews: true,
			diaryEntries: true,
		},
	},
} satisfies Prisma.MediaSelect

type DiscoveryMedia = Prisma.MediaGetPayload<{
	select: typeof discoveryMediaSelect
}>

const discoveryRankCandidateSelect = {
	id: true,
	title: true,
	genres: true,
	catalogScore: true,
	catalogPopularity: true,
	tmdbScore: true,
	malScore: true,
	_count: {
		select: {
			reviews: true,
			diaryEntries: true,
		},
	},
} satisfies Prisma.MediaSelect

type DiscoveryRankCandidate = Prisma.MediaGetPayload<{
	select: typeof discoveryRankCandidateSelect
}>

type RankedMedia = DiscoveryMedia & {
	communityScore: number | null
	ratingCount: number
	popularityScore: number
	affinityScore: number
	viewerTracking: DiscoveryResult['viewerTracking']
	publicTrackerCount: number
}

type RankedDiscoveryCandidate = DiscoveryRankCandidate & {
	communityScore: number | null
	ratingCount: number
	popularityScore: number
	affinityScore: number
	publicTrackerCount: number
	sourceAudience: number
	sourceRatingCount: number
}

type Preference = { label: string; weight: number }

type ViewerDiscoveryTaste = {
	preferences: Preference[]
	fingerprint: string
}

function boundedSearchValue(value: string | null, maximum: number) {
	return (value ?? '').trim().slice(0, maximum)
}

export function parseDiscoveryQuery(searchParams: URLSearchParams) {
	const requestedMode = searchParams.get('mode')
	const mode =
		requestedMode === 'memory' || requestedMode === 'describe'
			? requestedMode
			: 'standard'
	return DiscoveryQuerySchema.parse({
		q: boundedSearchValue(
			searchParams.get('q'),
			mode === 'memory' || mode === 'describe' ? 500 : 100,
		),
		kind: searchParams.get('kind') ?? 'all',
		mode,
		genre: boundedSearchValue(searchParams.get('genre'), 80),
		year: searchParams.get('year'),
		status: boundedSearchValue(searchParams.get('status'), 60),
		provider: searchParams.get('provider') ?? 'all',
		sort: searchParams.get('sort') ?? 'popular',
		page: searchParams.get('page') ?? '1',
	})
}

function naturalTermWhere(term: string): Prisma.MediaWhereInput {
	const normalized = normalizeCatalogTitle(term)
	return {
		OR: [
			{ title: prismaSearchFilter('contains', term) },
			{ description: prismaSearchFilter('contains', term) },
			{ genres: prismaSearchFilter('contains', term) },
			...(normalized
				? [
						{
							titles: {
								some: {
									normalized: prismaSearchFilter('contains', normalized),
								},
							},
						},
					]
				: []),
		],
	}
}

function naturalYearWhere(
	from: number | null,
	to: number | null,
): Prisma.MediaWhereInput | null {
	if (from === null && to === null) return null
	const start = from ?? 1870
	const end = to ?? 2200
	return {
		OR: [
			{
				releaseStart: {
					gte: new Date(`${start}-01-01T00:00:00.000Z`),
					lt: new Date(`${end + 1}-01-01T00:00:00.000Z`),
				},
			},
			{ startYear: { gte: String(start), lte: String(end) } },
			{ airYear: { gte: String(start), lte: String(end) } },
		],
	}
}

function naturalLengthWhere(
	plan: NaturalLanguageDiscoveryPlan,
): Prisma.MediaWhereInput | null {
	if (
		!plan.lengthUnit ||
		(plan.lengthFrom === null && plan.lengthTo === null)
	) {
		return null
	}
	const field = {
		minutes: 'runtimeMinutes',
		episodes: 'episodeCount',
		chapters: 'chapterCount',
		volumes: 'volumeCount',
	}[plan.lengthUnit] as
		'runtimeMinutes' | 'episodeCount' | 'chapterCount' | 'volumeCount'
	return {
		[field]: {
			...(plan.lengthFrom === null ? {} : { gte: plan.lengthFrom }),
			...(plan.lengthTo === null ? {} : { lte: plan.lengthTo }),
		},
	}
}

function naturalReleaseStatusWhere(
	status: NaturalLanguageDiscoveryPlan['releaseStatus'],
): Prisma.MediaWhereInput | null {
	if (!status) return null
	const values = {
		upcoming: ['Not yet aired', 'Planned', 'In Production', 'Upcoming'],
		ongoing: [
			'Currently Airing',
			'Returning Series',
			'Airing',
			'Publishing',
			'Ongoing',
		],
		completed: [
			'Finished Airing',
			'Finished',
			'Ended',
			'Released',
			'Completed',
		],
		hiatus: ['On Hiatus', 'Hiatus'],
		cancelled: ['Canceled', 'Cancelled'],
	}[status]
	return { releaseStatus: { in: values } }
}

export async function getDiscoveryResultsForPlan(
	plan: NaturalLanguageDiscoveryPlan,
	viewerId: string | null,
	input: { page: number; filters: DiscoveryQuery },
): Promise<DiscoveryResults> {
	const kinds = [...new Set(plan.kinds)]
	const year = naturalYearWhere(plan.yearFrom, plan.yearTo)
	const length = naturalLengthWhere(plan)
	const releaseStatus = naturalReleaseStatusWhere(plan.releaseStatus)
	const sort =
		plan.sort === 'for-you' && !viewerId ? ('popular' as const) : plan.sort
	const filters = {
		...input.filters,
		sort,
		page: input.page,
	} satisfies DiscoveryQuery
	const where = {
		AND: [
			{ kind: { in: kinds } },
			...plan.includeGenres.map(genre => genreWhere(genre)),
			...plan.excludeGenres.map(genre => ({ NOT: genreWhere(genre) })),
			...plan.includeTerms.map(naturalTermWhere),
			...plan.toneTerms.map(naturalTermWhere),
			...(plan.pace ? [naturalTermWhere(plan.pace)] : []),
			...plan.excludeTerms.map(term => ({ NOT: naturalTermWhere(term) })),
			...(year ? [year] : []),
			...(releaseStatus ? [releaseStatus] : []),
			...(plan.language
				? [
						{
							language: prismaSearchFilter('contains', plan.language),
						},
					]
				: []),
			...(length ? [length] : []),
			...(sort === 'top-rated' ? [publicRatingWhere()] : []),
			...(sort === 'for-you' && viewerId
				? viewerDiscoveryExclusions(viewerId)
				: []),
		],
	} satisfies Prisma.MediaWhereInput
	const taste =
		sort === 'for-you' && viewerId
			? await getViewerDiscoveryTaste(viewerId)
			: null
	if (isRankedDiscoverySort(sort)) {
		return rankedDiscoveryResults({
			request: naturalRankedRequest({ ...plan, kinds }, sort, taste),
			where,
			sort,
			malKind:
				kinds.length === 1 && (kinds[0] === 'anime' || kinds[0] === 'manga')
					? kinds[0]
					: null,
			filters,
			viewerId,
			taste,
			normalizedQuery: '',
		})
	}
	const total = await prisma.media.count({ where })
	const { page, pageCount, skip } = pagination(total, input.page)
	const media = await prisma.media.findMany({
		where,
		select: discoveryMediaSelect,
		orderBy: discoveryOrderBy(sort),
		skip,
		take: DISCOVERY_PAGE_SIZE,
	})
	const ranked = await rankableMediaWithViewer(media, [], viewerId)
	return {
		filters: { ...filters, page },
		items: ranked.map(item => resultFromMedia(item, '')),
		total,
		pageCount,
		preferredGenres: [],
	}
}

export async function getDiscoveryResultsForMediaIds(
	input: DiscoveryQuery,
	viewerId: string | null,
	mediaIds: string[],
): Promise<DiscoveryResults> {
	const orderedIds = [...new Set(mediaIds)].slice(0, 5)
	if (!orderedIds.length) {
		return {
			filters: { ...input, page: 1 },
			items: [],
			total: 0,
			pageCount: 1,
			preferredGenres: [],
		}
	}
	const filters = {
		...input,
		q: '',
		mode: 'standard' as const,
		genre: '',
		year: null,
		status: '',
		provider: 'all' as const,
		page: 1,
		sort: 'popular' as const,
	}
	const media = await prisma.media.findMany({
		where: {
			AND: [discoveryWhere(filters, viewerId), { id: { in: orderedIds } }],
		},
		select: discoveryMediaSelect,
	})
	const ranked = await rankableMediaWithViewer(media, [], viewerId)
	const byId = new Map(ranked.map(item => [item.id, item]))
	const items = orderedIds.flatMap(id => {
		const item = byId.get(id)
		return item ? [resultFromMedia(item, '')] : []
	})
	return {
		filters: { ...input, page: 1 },
		items,
		total: items.length,
		pageCount: 1,
		preferredGenres: [],
	}
}

export function splitGenres(value: string | null | undefined) {
	if (!value) return []
	return value
		.split(',')
		.map(genre => genre.trim())
		.filter(Boolean)
}

type TitledMedia = { id: string; title: string | null }

type PopularityRankable = TitledMedia & {
	catalogPopularity: number | null
	popularityScore: number
	publicTrackerCount: number
	_count: {
		reviews: number
		diaryEntries: number
	}
}

function titleForSort(media: TitledMedia) {
	return (media.title ?? '').toLocaleLowerCase()
}

export function catalogPopularityScore(counts: {
	trackingStates: number
	reviews: number
	diaryEntries: number
}) {
	return counts.trackingStates * 4 + counts.reviews * 3 + counts.diaryEntries
}

function compareTitle(left: TitledMedia, right: TitledMedia) {
	return (
		titleForSort(left).localeCompare(titleForSort(right)) ||
		left.id.localeCompare(right.id)
	)
}

function comparePopularity(
	left: PopularityRankable,
	right: PopularityRankable,
) {
	return (
		(right.catalogPopularity ?? 0) - (left.catalogPopularity ?? 0) ||
		right.popularityScore - left.popularityScore ||
		right.publicTrackerCount - left.publicTrackerCount ||
		right._count.reviews - left._count.reviews ||
		compareTitle(left, right)
	)
}

function rankForYou<T extends PopularityRankable & { affinityScore: number }>(
	media: T[],
) {
	return media.sort(
		(left, right) =>
			right.affinityScore - left.affinityScore ||
			comparePopularity(left, right),
	)
}

function yearFor(media: DiscoveryMedia) {
	if (media.releaseStart) return String(media.releaseStart.getUTCFullYear())
	return media.startYear || media.airYear || null
}

function providerScore(media: {
	catalogScore: number | null
	tmdbScore: { toString(): string } | number | null
	malScore: { toString(): string } | number | null
}) {
	const values = [
		media.catalogScore,
		media.tmdbScore === null ? null : Number(media.tmdbScore),
		media.malScore === null ? null : Number(media.malScore),
	].filter((value): value is number => value !== null && Number.isFinite(value))
	return values.length ? Math.max(...values) : null
}

function weightedRatingScore(media: RankedDiscoveryCandidate) {
	if (media.communityScore !== null) {
		const priorScore = 7
		const priorRatings = 20
		return (
			(media.communityScore * media.ratingCount + priorScore * priorRatings) /
			(media.ratingCount + priorRatings)
		)
	}
	const score = providerScore(media)
	if (score === null) return Number.NEGATIVE_INFINITY
	const ratingCount = Math.max(0, media.sourceRatingCount)
	const audience = Math.max(0, media.sourceAudience)
	const confidenceWeight = ratingCount
		? Math.sqrt(ratingCount)
		: Math.sqrt(audience) * 0.35
	const priorScore = 7
	const priorWeight = 50
	return (
		(score * confidenceWeight + priorScore * priorWeight) /
		(confidenceWeight + priorWeight)
	)
}

function rankTopRated(media: RankedDiscoveryCandidate[]) {
	return media.sort(
		(left, right) =>
			weightedRatingScore(right) - weightedRatingScore(left) ||
			right.ratingCount - left.ratingCount ||
			comparePopularity(left, right),
	)
}

type ProviderConfidence = {
	sourceAudience: number
	sourceRatingCount: number
}

async function getProviderConfidenceByMediaId(mediaIds: readonly string[]) {
	const uniqueIds = [...new Set(mediaIds)]
	const confidence = new Map<string, ProviderConfidence>()
	for (
		let offset = 0;
		offset < uniqueIds.length;
		offset += RANKING_QUERY_CHUNK_SIZE
	) {
		const rows = await prisma.mediaExternalId.groupBy({
			by: ['mediaId'],
			where: {
				mediaId: {
					in: uniqueIds.slice(offset, offset + RANKING_QUERY_CHUNK_SIZE),
				},
				tombstonedAt: null,
			},
			_max: {
				sourceAudience: true,
				sourceRatingCount: true,
			},
		})
		for (const row of rows) {
			confidence.set(row.mediaId, {
				sourceAudience: row._max.sourceAudience ?? 0,
				sourceRatingCount: row._max.sourceRatingCount ?? 0,
			})
		}
	}
	return confidence
}

async function rankDiscoveryCandidates(
	media: DiscoveryRankCandidate[],
	preferences: readonly Preference[],
	{ withProviderConfidence = false }: { withProviderConfidence?: boolean } = {},
): Promise<RankedDiscoveryCandidate[]> {
	const mediaIds = media.map(item => item.id)
	const [publicSummaries, providerConfidence] = await Promise.all([
		getPublicTrackingSummariesByMediaId(mediaIds),
		withProviderConfidence
			? getProviderConfidenceByMediaId(mediaIds)
			: Promise.resolve(new Map<string, ProviderConfidence>()),
	])
	const preferenceWeights = new Map(
		preferences.map(preference => [
			preference.label.toLocaleLowerCase(),
			preference.weight,
		]),
	)
	return media.map(item => {
		const summary = publicSummaries.get(item.id) ?? {
			trackerCount: 0,
			ratingCount: 0,
			communityScore: null,
		}
		const confidence = providerConfidence.get(item.id) ?? {
			sourceAudience: 0,
			sourceRatingCount: 0,
		}
		return {
			...item,
			communityScore: summary.communityScore,
			ratingCount: summary.ratingCount,
			publicTrackerCount: summary.trackerCount,
			popularityScore: catalogPopularityScore({
				...item._count,
				trackingStates: summary.trackerCount,
			}),
			affinityScore: splitGenres(item.genres).reduce(
				(total, genre) =>
					total + (preferenceWeights.get(genre.toLocaleLowerCase()) ?? 0),
				0,
			),
			...confidence,
		}
	})
}

function resultFromMedia(
	media: RankedMedia,
	normalizedQuery: string,
): DiscoveryResult {
	const canonicalNormalized = normalizeCatalogTitle(media.title ?? '')
	const matchedTitle = normalizedQuery
		? (media.titles.find(
				title =>
					!title.isPrimary &&
					title.normalized !== canonicalNormalized &&
					title.normalized.includes(normalizedQuery),
			)?.value ?? null)
		: null
	return {
		id: media.id,
		kind: media.kind,
		title: media.title || 'Untitled',
		matchedTitle,
		thumbnail: media.thumbnail,
		type: media.type,
		year: yearFor(media),
		releaseStatus: media.releaseStatus,
		providers: [...new Set(media.externalIds.map(source => source.provider))],
		genres: splitGenres(media.genres),
		description: media.description,
		providerScore: providerScore(media),
		communityScore: media.communityScore,
		ratingCount: media.ratingCount,
		trackerCount: media.publicTrackerCount,
		reviewCount: media._count.reviews,
		diaryCount: media._count.diaryEntries,
		viewerTracking: media.viewerTracking,
	}
}

function updateFingerprint(
	hash: ReturnType<typeof createHash>,
	values: readonly string[],
) {
	for (const value of values) {
		const bytes = Buffer.byteLength(value, 'utf8')
		hash.update(String(bytes)).update(':').update(value)
	}
}

async function getViewerDiscoveryTaste(
	viewerId: string,
): Promise<ViewerDiscoveryTaste> {
	const [states, favorites, feedback] = await Promise.all([
		prisma.trackingState.findMany({
			where: { ownerId: viewerId },
			select: {
				mediaId: true,
				status: true,
				score: true,
				media: { select: { genres: true } },
			},
			orderBy: [{ mediaId: 'asc' }],
		}),
		prisma.userFavorite.findMany({
			where: { ownerId: viewerId, mediaId: { not: null } },
			select: {
				id: true,
				mediaId: true,
				media: { select: { genres: true } },
			},
			orderBy: [{ mediaId: 'asc' }, { id: 'asc' }],
		}),
		prisma.recommendationFeedback.findMany({
			where: { ownerId: viewerId },
			select: {
				mediaId: true,
				feedbackType: true,
				media: { select: { genres: true } },
			},
			orderBy: [{ mediaId: 'asc' }],
		}),
	])
	const preferences = new Map<string, Preference>()
	function addGenres(genres: string | null | undefined, weight: number) {
		for (const genre of splitGenres(genres)) {
			const key = genre.toLocaleLowerCase()
			const current = preferences.get(key)
			preferences.set(key, {
				label: current?.label ?? genre,
				weight: (current?.weight ?? 0) + weight,
			})
		}
	}
	for (const state of states) {
		const score = state.score === null ? 5 : Number(state.score)
		const statusBoost =
			state.status === 'completed' || state.status === 'watching' ? 2 : 0
		addGenres(state.media.genres, Math.max(1, score + statusBoost))
	}
	for (const favorite of favorites) addGenres(favorite.media?.genres, 8)
	const rankedPreferences = [...preferences.values()]
		.sort(
			(left, right) =>
				right.weight - left.weight || left.label.localeCompare(right.label),
		)
		.slice(0, 5)
	const fingerprint = createHash('sha256')
	updateFingerprint(fingerprint, ['viewer-discovery-taste-v1'])
	for (const state of states) {
		updateFingerprint(fingerprint, [
			'tracking',
			state.mediaId,
			state.status,
			state.score?.toString() ?? '',
			state.media.genres ?? '',
		])
	}
	for (const favorite of favorites) {
		updateFingerprint(fingerprint, [
			'favorite',
			favorite.mediaId ?? '',
			favorite.media?.genres ?? '',
		])
	}
	for (const item of feedback) {
		updateFingerprint(fingerprint, [
			'feedback',
			item.mediaId,
			item.feedbackType,
			item.media.genres ?? '',
		])
	}
	return {
		preferences: rankedPreferences,
		fingerprint: fingerprint.digest('base64url'),
	}
}

function viewerDiscoveryExclusions(viewerId: string): Prisma.MediaWhereInput[] {
	return [
		{ trackingStates: { none: { ownerId: viewerId } } },
		{ favorites: { none: { ownerId: viewerId } } },
		{ recommendationFeedback: { none: { ownerId: viewerId } } },
	]
}

function genreWhere(genre: string): Prisma.MediaWhereInput {
	return {
		OR: [
			{
				AND: [
					{ genres: prismaSearchFilter('startsWith', genre) },
					{ genres: prismaSearchFilter('endsWith', genre) },
				],
			},
			{ genres: prismaSearchFilter('startsWith', `${genre},`) },
			{ genres: prismaSearchFilter('contains', `, ${genre},`) },
			{ genres: prismaSearchFilter('endsWith', `, ${genre}`) },
		],
	}
}

function yearWhere(year: number): Prisma.MediaWhereInput {
	return {
		OR: [
			{
				releaseStart: {
					gte: new Date(`${year}-01-01T00:00:00.000Z`),
					lt: new Date(`${year + 1}-01-01T00:00:00.000Z`),
				},
			},
			{ startYear: String(year) },
			{ airYear: String(year) },
		],
	}
}

function publicRatingWhere(): Prisma.MediaWhereInput {
	return {
		OR: [
			{ catalogScore: { not: null } },
			{ tmdbScore: { not: null } },
			{ malScore: { not: null } },
			{
				trackingStates: {
					some: {
						score: { not: null },
						AND: [publicTrackingStateWhere],
					},
				},
			},
		],
	}
}

function discoveryWhere(
	filters: DiscoveryQuery,
	viewerId: string | null,
): Prisma.MediaWhereInput {
	const normalizedQuery = normalizeCatalogTitle(filters.q)
	const textSearch: Prisma.MediaWhereInput | undefined = filters.q
		? {
				OR: [
					{ title: prismaSearchFilter('contains', filters.q) },
					{ description: prismaSearchFilter('contains', filters.q) },
					...(normalizedQuery
						? [
								{
									titles: {
										some: {
											normalized: prismaSearchFilter(
												'contains',
												normalizedQuery,
											),
										},
									},
								},
							]
						: []),
				],
			}
		: undefined
	return {
		AND: [
			...(textSearch ? [textSearch] : []),
			...(filters.kind === 'all' ? [] : [{ kind: filters.kind }]),
			...(filters.genre ? [genreWhere(filters.genre)] : []),
			...(filters.year === null ? [] : [yearWhere(filters.year)]),
			...(filters.status ? [{ releaseStatus: filters.status }] : []),
			...(filters.provider === 'all'
				? []
				: [
						{
							externalIds: {
								some: {
									provider: filters.provider,
									tombstonedAt: null,
								},
							},
						},
					]),
			...(filters.sort === 'top-rated' ? [publicRatingWhere()] : []),
			...(filters.sort === 'for-you' && viewerId
				? viewerDiscoveryExclusions(viewerId)
				: []),
		],
	}
}

function discoveryOrderBy(
	sort: DiscoveryQuery['sort'],
): Prisma.MediaOrderByWithRelationInput[] {
	if (sort === 'title') return [{ title: 'asc' }, { id: 'asc' }]
	if (sort === 'newest') {
		return [{ releaseStart: 'desc' }, { createdAt: 'desc' }, { title: 'asc' }]
	}
	if (sort === 'top-rated') {
		return [
			{ catalogScore: 'desc' },
			{ catalogPopularity: 'desc' },
			{ title: 'asc' },
		]
	}
	return [
		{ catalogPopularity: 'desc' },
		{ releaseStart: 'desc' },
		{ title: 'asc' },
	]
}

async function tmdbPopularIdPlan(where: Prisma.MediaWhereInput) {
	const freshAfter = new Date(Date.now() - POPULAR_FEED_FRESHNESS_MS)
	const feedSelect = {
		mediaId: true,
		rank: true,
		rankingScore: true,
	} satisfies Prisma.CatalogFeedItemSelect
	const feedWhere = {
		provider: 'tmdb',
		feed: 'popular',
		rankingVersion: { gte: TMDB_FEED_RANKING_VERSION },
		media: { is: where },
	} satisfies Prisma.CatalogFeedItemWhereInput
	const freshFeedRows = await prisma.catalogFeedItem.findMany({
		where: {
			...feedWhere,
			observedAt: { gte: freshAfter },
		},
		orderBy: [
			{ rankingScore: 'desc' },
			{ rank: 'asc' },
			{ kind: 'asc' },
			{ mediaId: 'asc' },
		],
		take: 200,
		select: feedSelect,
	})
	const feedRows = freshFeedRows.length
		? freshFeedRows
		: await prisma.catalogFeedItem.findMany({
				where: feedWhere,
				orderBy: [
					{ observedAt: 'desc' },
					{ rankingScore: 'desc' },
					{ rank: 'asc' },
					{ mediaId: 'asc' },
				],
				take: 200,
				select: feedSelect,
			})
	const publicSummaries = await getPublicTrackingSummariesByMediaId(
		feedRows.map(row => row.mediaId),
	)
	const rankedIds = [
		...new Map(feedRows.map(row => [row.mediaId, row])).values(),
	]
		.sort((left, right) => {
			const boundedCommunityBoost = (mediaId: string) =>
				Math.min(
					0.02,
					(publicSummaries.get(mediaId)?.trackerCount ?? 0) / 50_000,
				)
			return (
				(right.rankingScore ?? 0) +
					boundedCommunityBoost(right.mediaId) -
					((left.rankingScore ?? 0) + boundedCommunityBoost(left.mediaId)) ||
				left.rank - right.rank ||
				left.mediaId.localeCompare(right.mediaId)
			)
		})
		.map(row => row.mediaId)
	const remaining = RANKED_DISCOVERY_PLAN_LIMIT - rankedIds.length
	if (!remaining) return rankedIds
	const fallback = await prisma.media.findMany({
		where: {
			AND: [where, ...(rankedIds.length ? [{ id: { notIn: rankedIds } }] : [])],
		},
		select: { id: true },
		orderBy: [{ title: 'asc' }, { id: 'asc' }],
		take: remaining,
	})
	return [...rankedIds, ...fallback.map(item => item.id)]
}

async function malPopularIdPlan(input: {
	where: Prisma.MediaWhereInput
	kind: 'anime' | 'manga'
}) {
	const feedWhere = {
		provider: 'mal',
		kind: input.kind,
		feed: 'popular',
		media: { is: input.where },
	} satisfies Prisma.CatalogFeedItemWhereInput
	const ranked = await prisma.catalogFeedItem.findMany({
		where: feedWhere,
		orderBy: [{ rank: 'asc' }, { mediaId: 'asc' }],
		take: RANKED_DISCOVERY_PLAN_LIMIT,
		select: { mediaId: true },
	})
	const rankedIds = ranked.map(row => row.mediaId)
	const remaining = RANKED_DISCOVERY_PLAN_LIMIT - rankedIds.length
	if (!remaining) return rankedIds
	const fallback = await prisma.media.findMany({
		where: {
			AND: [
				input.where,
				{
					catalogFeedItems: {
						none: {
							provider: 'mal',
							kind: input.kind,
							feed: 'popular',
						},
					},
				},
			],
		},
		select: { id: true },
		orderBy: [{ title: 'asc' }, { id: 'asc' }],
		take: remaining,
	})
	return [...rankedIds, ...fallback.map(item => item.id)]
}

async function popularIdPlan(input: {
	where: Prisma.MediaWhereInput
	malKind: 'anime' | 'manga' | null
}) {
	return input.malKind
		? malPopularIdPlan({ where: input.where, kind: input.malKind })
		: tmdbPopularIdPlan(input.where)
}

async function topRatedIdPlan(input: {
	where: Prisma.MediaWhereInput
	preferences: Preference[]
}) {
	const candidates = await prisma.media.findMany({
		where: input.where,
		select: discoveryRankCandidateSelect,
		orderBy: [
			{ catalogScore: 'desc' },
			{ tmdbScore: 'desc' },
			{ malScore: 'desc' },
			{ title: 'asc' },
			{ id: 'asc' },
		],
		take: RANKED_DISCOVERY_PLAN_LIMIT,
	})
	return rankTopRated(
		await rankDiscoveryCandidates(candidates, input.preferences, {
			withProviderConfidence: true,
		}),
	).map(item => item.id)
}

async function forYouIdPlan(input: {
	where: Prisma.MediaWhereInput
	preferences: Preference[]
}) {
	const preferredWhere: Prisma.MediaWhereInput | null = input.preferences.length
		? {
				AND: [
					input.where,
					{
						OR: input.preferences.map(preference => ({
							genres: prismaSearchFilter('contains', preference.label),
						})),
					},
				],
			}
		: null
	const [preferredCandidates, popularCandidates] = await Promise.all([
		preferredWhere
			? prisma.media.findMany({
					where: preferredWhere,
					select: discoveryRankCandidateSelect,
					orderBy: discoveryOrderBy('popular'),
					take: FOR_YOU_CANDIDATE_LIMIT / 2,
				})
			: Promise.resolve([]),
		prisma.media.findMany({
			where: input.where,
			select: discoveryRankCandidateSelect,
			orderBy: discoveryOrderBy('popular'),
			take: preferredWhere
				? FOR_YOU_CANDIDATE_LIMIT / 2
				: FOR_YOU_CANDIDATE_LIMIT,
		}),
	])
	const candidates = [
		...new Map(
			[...preferredCandidates, ...popularCandidates].map(item => [
				item.id,
				item,
			]),
		).values(),
	]
	return rankForYou(
		await rankDiscoveryCandidates(candidates, input.preferences),
	).map(item => item.id)
}

async function rankableMedia(
	media: DiscoveryMedia[],
	preferences: Preference[],
	knownPublicSummaries: Map<string, PublicTrackingSummary> = new Map(),
): Promise<RankedMedia[]> {
	const publicSummaries = new Map(knownPublicSummaries)
	const missingIds = media
		.map(item => item.id)
		.filter(mediaId => !publicSummaries.has(mediaId))
	if (missingIds.length) {
		const missingSummaries =
			await getPublicTrackingSummariesByMediaId(missingIds)
		for (const [mediaId, summary] of missingSummaries) {
			publicSummaries.set(mediaId, summary)
		}
	}
	const preferenceWeights = new Map(
		preferences.map(preference => [
			preference.label.toLocaleLowerCase(),
			preference.weight,
		]),
	)
	return media.map(item => {
		const publicSummary = publicSummaries.get(item.id) ?? {
			trackerCount: 0,
			ratingCount: 0,
			communityScore: null,
		}
		return {
			...item,
			viewerTracking: null,
			communityScore: publicSummary.communityScore,
			ratingCount: publicSummary.ratingCount,
			publicTrackerCount: publicSummary.trackerCount,
			popularityScore: catalogPopularityScore({
				...item._count,
				trackingStates: publicSummary.trackerCount,
			}),
			affinityScore: splitGenres(item.genres).reduce(
				(total, genre) =>
					total + (preferenceWeights.get(genre.toLocaleLowerCase()) ?? 0),
				0,
			),
		}
	})
}

async function withViewerTracking(
	media: RankedMedia[],
	viewerId: string | null,
) {
	if (!viewerId || !media.length) return media
	const viewerStates = await prisma.trackingState.findMany({
		where: {
			ownerId: viewerId,
			mediaId: { in: media.map(item => item.id) },
		},
		select: {
			mediaId: true,
			status: true,
			statusWatchlistId: true,
		},
	})
	const stateByMediaId = new Map(
		viewerStates.map(state => [state.mediaId, state]),
	)
	return media.map(item => {
		const viewerState = stateByMediaId.get(item.id)
		return {
			...item,
			viewerTracking: viewerState
				? {
						status: viewerState.status,
						statusWatchlistId: viewerState.statusWatchlistId,
					}
				: null,
		}
	})
}

async function rankableMediaWithViewer(
	media: DiscoveryMedia[],
	preferences: Preference[],
	viewerId: string | null,
	publicSummaries?: Map<string, PublicTrackingSummary>,
) {
	return withViewerTracking(
		await rankableMedia(media, preferences, publicSummaries),
		viewerId,
	)
}

function pagination(total: number, requestedPage: number) {
	const pageCount = Math.max(1, Math.ceil(total / DISCOVERY_PAGE_SIZE))
	const page = Math.min(requestedPage, pageCount)
	return {
		page,
		pageCount,
		skip: (page - 1) * DISCOVERY_PAGE_SIZE,
	}
}

type RankedDiscoverySort = 'popular' | 'top-rated' | 'for-you'

function isRankedDiscoverySort(
	sort: DiscoveryQuery['sort'],
): sort is RankedDiscoverySort {
	return sort === 'popular' || sort === 'top-rated' || sort === 'for-you'
}

function standardRankedRequest(
	filters: DiscoveryQuery,
	taste: ViewerDiscoveryTaste | null,
): RankedDiscoveryPlanRequest {
	const request = {
		source: 'standard' as const,
		q: filters.q,
		kind: filters.kind,
		genre: filters.genre,
		year: filters.year,
		status: filters.status,
		provider: filters.provider,
	}
	if (filters.sort === 'for-you') {
		if (!taste) {
			throw new TypeError('For-you discovery requires viewer taste.')
		}
		return {
			...request,
			sort: 'for-you',
			viewerFingerprint: createRankedDiscoveryViewerFingerprint({
				stateDigest: taste.fingerprint,
			}),
		}
	}
	if (filters.sort !== 'popular' && filters.sort !== 'top-rated') {
		throw new TypeError('The discovery sort is not cacheable.')
	}
	return { ...request, sort: filters.sort }
}

function naturalRankedRequest(
	plan: NaturalLanguageDiscoveryPlan,
	sort: RankedDiscoverySort,
	taste: ViewerDiscoveryTaste | null,
): RankedDiscoveryPlanRequest {
	const request = {
		source: 'natural' as const,
		kinds: plan.kinds,
		includeGenres: plan.includeGenres,
		excludeGenres: plan.excludeGenres,
		includeTerms: plan.includeTerms,
		excludeTerms: plan.excludeTerms,
		yearFrom: plan.yearFrom,
		yearTo: plan.yearTo,
		releaseStatus: plan.releaseStatus,
		language: plan.language,
		toneTerms: plan.toneTerms,
		pace: plan.pace,
		lengthUnit: plan.lengthUnit,
		lengthFrom: plan.lengthFrom,
		lengthTo: plan.lengthTo,
	}
	if (sort === 'for-you') {
		if (!taste) {
			throw new TypeError('For-you discovery requires viewer taste.')
		}
		return {
			...request,
			sort,
			viewerFingerprint: createRankedDiscoveryViewerFingerprint({
				stateDigest: taste.fingerprint,
			}),
		}
	}
	return { ...request, sort }
}

async function buildRankedDiscoveryIds({
	sort,
	where,
	malKind,
	preferences,
}: {
	sort: RankedDiscoverySort
	where: Prisma.MediaWhereInput
	malKind: 'anime' | 'manga' | null
	preferences: Preference[]
}) {
	if (sort === 'popular') return popularIdPlan({ where, malKind })
	if (sort === 'top-rated') return topRatedIdPlan({ where, preferences: [] })
	return forYouIdPlan({ where, preferences })
}

async function filterEligibleRankedDiscoveryIds(
	ids: readonly string[],
	where: Prisma.MediaWhereInput,
) {
	const eligibleIds = new Set<string>()
	for (
		let offset = 0;
		offset < ids.length;
		offset += RANKING_QUERY_CHUNK_SIZE
	) {
		const rows = await prisma.media.findMany({
			where: {
				AND: [
					where,
					{
						id: {
							in: ids.slice(offset, offset + RANKING_QUERY_CHUNK_SIZE),
						},
					},
				],
			},
			select: { id: true },
		})
		for (const row of rows) eligibleIds.add(row.id)
	}
	return ids.filter(id => eligibleIds.has(id))
}

async function hydrateRankedDiscoveryPage({
	ids,
	where,
	viewerId,
	preferences,
}: {
	ids: readonly string[]
	where: Prisma.MediaWhereInput
	viewerId: string | null
	preferences: Preference[]
}) {
	if (!ids.length) return []
	const media = await prisma.media.findMany({
		where: { AND: [where, { id: { in: [...ids] } }] },
		select: discoveryMediaSelect,
		take: DISCOVERY_PAGE_SIZE,
	})
	const ranked = await rankableMediaWithViewer(media, preferences, viewerId)
	const byId = new Map(ranked.map(item => [item.id, item]))
	return ids.flatMap(id => {
		const item = byId.get(id)
		return item ? [item] : []
	})
}

async function rankedDiscoveryResults({
	request,
	where,
	sort,
	malKind,
	filters,
	viewerId,
	taste,
	normalizedQuery,
}: {
	request: RankedDiscoveryPlanRequest
	where: Prisma.MediaWhereInput
	sort: RankedDiscoverySort
	malKind: 'anime' | 'manga' | null
	filters: DiscoveryQuery
	viewerId: string | null
	taste: ViewerDiscoveryTaste | null
	normalizedQuery: string
}): Promise<DiscoveryResults> {
	const preferences = taste?.preferences ?? []
	const scope =
		sort === 'for-you'
			? ({ kind: 'viewer', viewerId: viewerId! } as const)
			: ({ kind: 'public' } as const)
	const plan = await getRankedDiscoveryPlan({
		request,
		scope,
		getFreshValue: async () => ({
			ids: await buildRankedDiscoveryIds({
				sort,
				where,
				malKind,
				preferences,
			}),
		}),
	})
	const eligibleIds = await filterEligibleRankedDiscoveryIds(plan.ids, where)
	const { page, pageCount, skip } = pagination(eligibleIds.length, filters.page)
	const pageIds = eligibleIds.slice(skip, skip + DISCOVERY_PAGE_SIZE)
	const ranked = await hydrateRankedDiscoveryPage({
		ids: pageIds,
		where,
		viewerId,
		preferences,
	})
	return {
		filters: { ...filters, page },
		items: ranked.map(item => resultFromMedia(item, normalizedQuery)),
		total: eligibleIds.length,
		pageCount,
		preferredGenres:
			sort === 'for-you' ? preferences.map(preference => preference.label) : [],
	}
}

export async function getDiscoveryResults(
	input: DiscoveryQuery,
	viewerId: string | null,
): Promise<DiscoveryResults> {
	const filters = {
		...input,
		sort: input.sort === 'for-you' && !viewerId ? 'popular' : input.sort,
	} satisfies DiscoveryQuery
	const normalizedQuery = normalizeCatalogTitle(filters.q)
	const taste =
		filters.sort === 'for-you' && viewerId
			? await getViewerDiscoveryTaste(viewerId)
			: null
	const where = discoveryWhere(
		filters,
		filters.sort === 'for-you' ? viewerId : null,
	)
	if (isRankedDiscoverySort(filters.sort)) {
		return rankedDiscoveryResults({
			request: standardRankedRequest(filters, taste),
			where,
			sort: filters.sort,
			malKind:
				filters.kind === 'anime' || filters.kind === 'manga'
					? filters.kind
					: null,
			filters,
			viewerId,
			taste,
			normalizedQuery,
		})
	}
	const total = await prisma.media.count({ where })
	const { page, pageCount, skip } = pagination(total, filters.page)
	const media = await prisma.media.findMany({
		where,
		select: discoveryMediaSelect,
		orderBy: discoveryOrderBy(filters.sort),
		skip,
		take: DISCOVERY_PAGE_SIZE,
	})
	const ranked = await rankableMediaWithViewer(media, [], viewerId)
	return {
		filters: { ...filters, page },
		items: ranked.map(item => resultFromMedia(item, normalizedQuery)),
		total,
		pageCount,
		preferredGenres: [],
	}
}

type DiscoveryFacetSourceRow = {
	value?: unknown
}

export type DiscoveryFacets = Readonly<{
	genres: readonly string[]
	statuses: readonly string[]
	truncated: Readonly<{
		genres: boolean
		statuses: boolean
	}>
}>

type FacetEntry = {
	key: string
	value: string
}

type FacetAccumulator = {
	entries: FacetEntry[]
	entriesByKey: Map<string, FacetEntry>
	limit: number
	truncated: boolean
}

const discoveryFacetSourceRowSchema = z.object({ value: z.unknown() }).strict()

function boundedFacetValueSchema(
	maximumCodeUnits: number,
	maximumBytes: number,
) {
	return z
		.string()
		.min(1)
		.max(maximumCodeUnits)
		.refine(value => value === value.trim(), {
			message: 'facet values must not have surrounding whitespace',
		})
		.refine(value => !hasFacetControlCharacter(value), {
			message: 'facet values must not contain control characters',
		})
		.refine(value => Buffer.byteLength(value, 'utf8') <= maximumBytes, {
			message: 'facet value exceeds its UTF-8 byte limit',
		})
}

const discoveryFacetsSchema = z
	.object({
		genres: z
			.array(
				boundedFacetValueSchema(
					DISCOVERY_GENRE_MAX_CODE_UNITS,
					DISCOVERY_GENRE_MAX_BYTES,
				),
			)
			.max(DISCOVERY_GENRE_LIMIT),
		statuses: z
			.array(
				boundedFacetValueSchema(
					DISCOVERY_STATUS_MAX_CODE_UNITS,
					DISCOVERY_STATUS_MAX_BYTES,
				),
			)
			.max(DISCOVERY_STATUS_LIMIT),
		truncated: z
			.object({
				genres: z.boolean(),
				statuses: z.boolean(),
			})
			.strict(),
	})
	.strict()
	.superRefine((facets, context) => {
		for (const [field, values] of [
			['genres', facets.genres],
			['statuses', facets.statuses],
		] as const) {
			const keys = new Set<string>()
			for (const [index, value] of values.entries()) {
				const key = facetKey(value)
				if (keys.has(key)) {
					context.addIssue({
						code: 'custom',
						path: [field, index],
						message: 'facet values must be case-insensitively unique',
					})
				}
				keys.add(key)
				if (index > 0 && compareFacetValues(values[index - 1]!, value) >= 0) {
					context.addIssue({
						code: 'custom',
						path: [field, index],
						message: 'facet values must use deterministic en-US ordering',
					})
				}
			}
		}
		if (
			Buffer.byteLength(JSON.stringify(facets), 'utf8') >
			DISCOVERY_FACETS_CACHE_MAX_BYTES
		) {
			context.addIssue({
				code: 'custom',
				message: 'discovery facet cache payload exceeds its byte limit',
			})
		}
	})

function facetKey(value: string) {
	return value.normalize('NFKC').toLocaleLowerCase('en-US')
}

function hasFacetControlCharacter(value: string) {
	for (let index = 0; index < value.length; index++) {
		const codeUnit = value.charCodeAt(index)
		if (codeUnit <= 0x1f || codeUnit === 0x7f) return true
	}
	return false
}

function compareFacetValues(left: string, right: string) {
	return (
		facetBaseCollator.compare(left, right) ||
		facetVariantCollator.compare(left, right) ||
		(left < right ? -1 : left > right ? 1 : 0)
	)
}

function facetCaseRank(value: string) {
	const lower = value.toLocaleLowerCase('en-US')
	const upper = value.toLocaleUpperCase('en-US')
	if (lower === upper) return 0
	if (value === lower) return 1
	if (value === upper) return 2
	return 0
}

function compareFacetRepresentatives(left: string, right: string) {
	return (
		facetCaseRank(left) - facetCaseRank(right) ||
		compareFacetValues(left, right)
	)
}

function insertFacetEntry(entries: FacetEntry[], entry: FacetEntry) {
	let start = 0
	let end = entries.length
	while (start < end) {
		const middle = Math.floor((start + end) / 2)
		if (compareFacetValues(entries[middle]!.value, entry.value) < 0) {
			start = middle + 1
		} else {
			end = middle
		}
	}
	entries.splice(start, 0, entry)
}

function addFacetValue(accumulator: FacetAccumulator, value: string) {
	const key = facetKey(value)
	const existing = accumulator.entriesByKey.get(key)
	if (existing) {
		if (compareFacetRepresentatives(value, existing.value) >= 0) return
		const index = accumulator.entries.indexOf(existing)
		if (index >= 0) accumulator.entries.splice(index, 1)
		existing.value = value
		insertFacetEntry(accumulator.entries, existing)
		return
	}

	if (accumulator.entries.length >= accumulator.limit) {
		accumulator.truncated = true
		const last = accumulator.entries.at(-1)!
		if (compareFacetValues(value, last.value) >= 0) return
		accumulator.entries.pop()
		accumulator.entriesByKey.delete(last.key)
	}

	const entry = { key, value }
	accumulator.entriesByKey.set(key, entry)
	insertFacetEntry(accumulator.entries, entry)
}

function normalizeFacetValue(
	rawValue: unknown,
	{
		sourceMaxCodeUnits,
		sourceMaxBytes,
		valueMaxCodeUnits,
		valueMaxBytes,
	}: {
		sourceMaxCodeUnits: number
		sourceMaxBytes: number
		valueMaxCodeUnits: number
		valueMaxBytes: number
	},
) {
	if (
		typeof rawValue !== 'string' ||
		rawValue.length === 0 ||
		rawValue.length > sourceMaxCodeUnits ||
		Buffer.byteLength(rawValue, 'utf8') > sourceMaxBytes
	) {
		return null
	}
	const value = rawValue.trim()
	if (
		!value ||
		value.length > valueMaxCodeUnits ||
		Buffer.byteLength(value, 'utf8') > valueMaxBytes ||
		hasFacetControlCharacter(value)
	) {
		return null
	}
	return value
}

function parseFacetSourceRows(
	value: unknown,
	maximumRows: number,
): DiscoveryFacetSourceRow[] {
	return z.array(discoveryFacetSourceRowSchema).max(maximumRows).parse(value)
}

export function normalizeDiscoveryFacetSources({
	genreRows: rawGenreRows,
	statusRows: rawStatusRows,
}: {
	genreRows: unknown
	statusRows: unknown
}): DiscoveryFacets {
	const genreRows = parseFacetSourceRows(
		rawGenreRows,
		DISCOVERY_GENRE_SOURCE_QUERY_LIMIT,
	)
	const statusRows = parseFacetSourceRows(
		rawStatusRows,
		DISCOVERY_STATUS_SOURCE_QUERY_LIMIT,
	)
	const genreAccumulator: FacetAccumulator = {
		entries: [],
		entriesByKey: new Map(),
		limit: DISCOVERY_GENRE_LIMIT,
		truncated: genreRows.length > DISCOVERY_GENRE_SOURCE_LIMIT,
	}
	const statusAccumulator: FacetAccumulator = {
		entries: [],
		entriesByKey: new Map(),
		limit: DISCOVERY_STATUS_LIMIT,
		truncated: statusRows.length > DISCOVERY_STATUS_SOURCE_LIMIT,
	}

	for (const row of genreRows.slice(0, DISCOVERY_GENRE_SOURCE_LIMIT)) {
		if (
			typeof row.value !== 'string' ||
			row.value.length > DISCOVERY_GENRE_SOURCE_MAX_CODE_UNITS ||
			Buffer.byteLength(row.value, 'utf8') > DISCOVERY_GENRE_SOURCE_MAX_BYTES
		) {
			continue
		}
		for (const rawGenre of row.value.split(',')) {
			const genre = normalizeFacetValue(rawGenre, {
				sourceMaxCodeUnits: DISCOVERY_GENRE_SOURCE_MAX_CODE_UNITS,
				sourceMaxBytes: DISCOVERY_GENRE_SOURCE_MAX_BYTES,
				valueMaxCodeUnits: DISCOVERY_GENRE_MAX_CODE_UNITS,
				valueMaxBytes: DISCOVERY_GENRE_MAX_BYTES,
			})
			if (genre) addFacetValue(genreAccumulator, genre)
		}
	}

	for (const row of statusRows.slice(0, DISCOVERY_STATUS_SOURCE_LIMIT)) {
		const status = normalizeFacetValue(row.value, {
			sourceMaxCodeUnits: DISCOVERY_STATUS_SOURCE_MAX_CODE_UNITS,
			sourceMaxBytes: DISCOVERY_STATUS_SOURCE_MAX_BYTES,
			valueMaxCodeUnits: DISCOVERY_STATUS_MAX_CODE_UNITS,
			valueMaxBytes: DISCOVERY_STATUS_MAX_BYTES,
		})
		if (status) addFacetValue(statusAccumulator, status)
	}

	return parseDiscoveryFacets({
		genres: genreAccumulator.entries.map(entry => entry.value),
		statuses: statusAccumulator.entries.map(entry => entry.value),
		truncated: {
			genres: genreAccumulator.truncated,
			statuses: statusAccumulator.truncated,
		},
	})
}

export function parseDiscoveryFacets(value: unknown): DiscoveryFacets {
	return discoveryFacetsSchema.parse(value)
}

async function loadDiscoveryFacets() {
	const [genreRows, statusRows] = await Promise.all([
		prisma.$queryRaw<DiscoveryFacetSourceRow[]>`
			SELECT DISTINCT "genres" AS "value"
			FROM "Media"
			WHERE "genres" IS NOT NULL
				AND length("genres") BETWEEN 1 AND ${DISCOVERY_GENRE_SOURCE_MAX_CODE_UNITS}
				AND length(trim("genres")) >= 1
			ORDER BY "value" ASC
			LIMIT ${DISCOVERY_GENRE_SOURCE_QUERY_LIMIT}
		`,
		prisma.$queryRaw<DiscoveryFacetSourceRow[]>`
			SELECT DISTINCT "releaseStatus" AS "value"
			FROM "Media"
			WHERE "releaseStatus" IS NOT NULL
				AND length("releaseStatus") BETWEEN 1 AND ${DISCOVERY_STATUS_SOURCE_MAX_CODE_UNITS}
				AND length(trim("releaseStatus")) >= 1
			ORDER BY "value" ASC
			LIMIT ${DISCOVERY_STATUS_SOURCE_QUERY_LIMIT}
		`,
	])
	return normalizeDiscoveryFacetSources({ genreRows, statusRows })
}

export async function getDiscoveryFacets(
	options: { runtime?: PublicSurfaceCacheRuntime } = {},
): Promise<DiscoveryFacets> {
	return getPublicSurfaceFragment({
		namespace: 'discovery-facets',
		keyVersion: DISCOVERY_FACETS_CACHE_KEY_VERSION,
		keyPayload: { projection: 'bounded-facets-v1' },
		ttl: DISCOVERY_FACETS_CACHE_TTL_MS,
		parse: parseDiscoveryFacets,
		getFreshValue: loadDiscoveryFacets,
		runtime: options.runtime,
	})
}

export async function getDiscoveryGenres() {
	return [...(await getDiscoveryFacets()).genres]
}

export async function getDiscoveryStatuses() {
	return [...(await getDiscoveryFacets()).statuses]
}
