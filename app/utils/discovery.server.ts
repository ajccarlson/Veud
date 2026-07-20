import { type Prisma } from '@prisma/client'
import { z } from 'zod'
import { normalizeCatalogTitle } from './catalog-sync.server.ts'
import { prisma } from './db.server.ts'

export const DISCOVERY_PAGE_SIZE = 24
const FOR_YOU_CANDIDATE_LIMIT = 500

export const discoveryKinds = ['all', 'movie', 'tv', 'anime', 'manga'] as const
export const discoveryProviders = ['all', 'tmdb', 'mal'] as const
export const discoveryModes = ['standard', 'memory'] as const
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
		},
	},
	trackingStates: {
		select: {
			ownerId: true,
			status: true,
			statusWatchlistId: true,
			statusWatchlist: { select: { isPublic: true } },
			score: true,
		},
	},
	_count: {
		select: {
			trackingStates: true,
			reviews: true,
			diaryEntries: true,
		},
	},
} satisfies Prisma.MediaSelect

type DiscoveryMedia = Prisma.MediaGetPayload<{
	select: typeof discoveryMediaSelect
}>

type RankedMedia = DiscoveryMedia & {
	communityScore: number | null
	ratingCount: number
	popularityScore: number
	affinityScore: number
	viewerTracking: DiscoveryResult['viewerTracking']
	publicTrackerCount: number
}

type Preference = { label: string; weight: number }

function boundedSearchValue(value: string | null, maximum: number) {
	return (value ?? '').trim().slice(0, maximum)
}

export function parseDiscoveryQuery(searchParams: URLSearchParams) {
	const mode = searchParams.get('mode') === 'memory' ? 'memory' : 'standard'
	return DiscoveryQuerySchema.parse({
		q: boundedSearchValue(searchParams.get('q'), mode === 'memory' ? 500 : 100),
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
		page: 1,
		sort: 'popular' as const,
	}
	const [media, preferences] = await Promise.all([
		prisma.media.findMany({
			where: {
				AND: [discoveryWhere(filters, viewerId), { id: { in: orderedIds } }],
			},
			select: discoveryMediaSelect,
		}),
		getGenrePreferences(viewerId),
	])
	const byId = new Map(
		rankableMedia(media, preferences, viewerId).map(item => [item.id, item]),
	)
	const items = orderedIds.flatMap(id => {
		const item = byId.get(id)
		return item ? [resultFromMedia(item, '')] : []
	})
	return {
		filters: { ...input, page: 1 },
		items,
		total: items.length,
		pageCount: 1,
		preferredGenres: preferences.map(preference => preference.label),
	}
}

export function splitGenres(value: string | null | undefined) {
	if (!value) return []
	return value
		.split(',')
		.map(genre => genre.trim())
		.filter(Boolean)
}

function titleForSort(media: DiscoveryMedia) {
	return (media.title ?? '').toLocaleLowerCase()
}

function publicTrackingStates(media: DiscoveryMedia) {
	return media.trackingStates.filter(
		state =>
			state.statusWatchlistId === null || state.statusWatchlist?.isPublic,
	)
}

function communityScore(media: DiscoveryMedia) {
	const scores = publicTrackingStates(media)
		.map(state => (state.score === null ? null : Number(state.score)))
		.filter(
			(score): score is number => score !== null && Number.isFinite(score),
		)
	if (!scores.length) return null
	return scores.reduce((total, score) => total + score, 0) / scores.length
}

export function catalogPopularityScore(counts: {
	trackingStates: number
	reviews: number
	diaryEntries: number
}) {
	return counts.trackingStates * 4 + counts.reviews * 3 + counts.diaryEntries
}

function compareTitle(left: DiscoveryMedia, right: DiscoveryMedia) {
	return (
		titleForSort(left).localeCompare(titleForSort(right)) ||
		left.id.localeCompare(right.id)
	)
}

function comparePopularity(left: RankedMedia, right: RankedMedia) {
	return (
		(right.catalogPopularity ?? 0) - (left.catalogPopularity ?? 0) ||
		right.popularityScore - left.popularityScore ||
		right.publicTrackerCount - left.publicTrackerCount ||
		right._count.reviews - left._count.reviews ||
		compareTitle(left, right)
	)
}

function rankForYou(media: RankedMedia[]) {
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

function providerScore(media: DiscoveryMedia) {
	const values = [
		media.catalogScore,
		media.tmdbScore === null ? null : Number(media.tmdbScore),
		media.malScore === null ? null : Number(media.malScore),
	].filter((value): value is number => value !== null && Number.isFinite(value))
	return values.length ? Math.max(...values) : null
}

function weightedRatingScore(media: RankedMedia) {
	if (media.communityScore !== null) {
		const priorScore = 7
		const priorRatings = 3
		return (
			(media.communityScore * media.ratingCount + priorScore * priorRatings) /
			(media.ratingCount + priorRatings)
		)
	}
	return providerScore(media) ?? Number.NEGATIVE_INFINITY
}

function rankTopRated(media: RankedMedia[]) {
	return media.sort(
		(left, right) =>
			weightedRatingScore(right) - weightedRatingScore(left) ||
			right.ratingCount - left.ratingCount ||
			comparePopularity(left, right),
	)
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

async function getGenrePreferences(viewerId: string | null) {
	if (!viewerId) return []
	const [states, favorites] = await Promise.all([
		prisma.trackingState.findMany({
			where: { ownerId: viewerId },
			select: {
				status: true,
				score: true,
				media: { select: { genres: true } },
			},
		}),
		prisma.userFavorite.findMany({
			where: { ownerId: viewerId, mediaId: { not: null } },
			select: { media: { select: { genres: true } } },
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
	return [...preferences.values()]
		.sort(
			(left, right) =>
				right.weight - left.weight || left.label.localeCompare(right.label),
		)
		.slice(0, 5)
}

function genreWhere(genre: string): Prisma.MediaWhereInput {
	return {
		OR: [
			{ genres: { equals: genre } },
			{ genres: { startsWith: `${genre},` } },
			{ genres: { contains: `, ${genre},` } },
			{ genres: { endsWith: `, ${genre}` } },
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
						OR: [
							{ statusWatchlistId: null },
							{ statusWatchlist: { isPublic: true } },
						],
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
					{ title: { contains: filters.q } },
					{ description: { contains: filters.q } },
					...(normalizedQuery
						? [
								{
									titles: {
										some: {
											normalized: { contains: normalizedQuery },
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
				? [
						{ trackingStates: { none: { ownerId: viewerId } } },
						{ favorites: { none: { ownerId: viewerId } } },
					]
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

function rankableMedia(
	media: DiscoveryMedia[],
	preferences: Preference[],
	viewerId: string | null,
) {
	const preferenceWeights = new Map(
		preferences.map(preference => [
			preference.label.toLocaleLowerCase(),
			preference.weight,
		]),
	)
	return media.map(item => {
		const publicStates = publicTrackingStates(item)
		const viewerState = viewerId
			? item.trackingStates.find(state => state.ownerId === viewerId)
			: null
		return {
			...item,
			viewerTracking: viewerState
				? {
						status: viewerState.status,
						statusWatchlistId: viewerState.statusWatchlistId,
					}
				: null,
			communityScore: communityScore(item),
			ratingCount: publicStates.filter(state => state.score !== null).length,
			publicTrackerCount: publicStates.length,
			popularityScore: catalogPopularityScore({
				...item._count,
				trackingStates: publicStates.length,
			}),
			affinityScore: splitGenres(item.genres).reduce(
				(total, genre) =>
					total + (preferenceWeights.get(genre.toLocaleLowerCase()) ?? 0),
				0,
			),
		}
	})
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

export async function getDiscoveryResults(
	input: DiscoveryQuery,
	viewerId: string | null,
): Promise<DiscoveryResults> {
	const filters = {
		...input,
		sort: input.sort === 'for-you' && !viewerId ? 'popular' : input.sort,
	} satisfies DiscoveryQuery
	const preferences = await getGenrePreferences(viewerId)
	const where = discoveryWhere(filters, viewerId)
	const normalizedQuery = normalizeCatalogTitle(filters.q)

	if (filters.sort === 'for-you' && preferences.length) {
		const preferenceWhere: Prisma.MediaWhereInput = {
			AND: [
				where,
				{
					OR: preferences.map(preference => ({
						genres: { contains: preference.label },
					})),
				},
			],
		}
		const [preferredCandidates, popularCandidates] = await Promise.all([
			prisma.media.findMany({
				where: preferenceWhere,
				select: discoveryMediaSelect,
				orderBy: discoveryOrderBy('popular'),
				take: FOR_YOU_CANDIDATE_LIMIT / 2,
			}),
			prisma.media.findMany({
				where,
				select: discoveryMediaSelect,
				orderBy: discoveryOrderBy('popular'),
				take: FOR_YOU_CANDIDATE_LIMIT / 2,
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
		const ranked = rankForYou(rankableMedia(candidates, preferences, viewerId))
		const { page, pageCount, skip } = pagination(ranked.length, filters.page)
		return {
			filters: { ...filters, page },
			items: ranked
				.slice(skip, skip + DISCOVERY_PAGE_SIZE)
				.map(item => resultFromMedia(item, normalizedQuery)),
			total: ranked.length,
			pageCount,
			preferredGenres: preferences.map(preference => preference.label),
		}
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
	const ranked = rankableMedia(media, preferences, viewerId)
	return {
		filters: { ...filters, page },
		items: (filters.sort === 'top-rated' ? rankTopRated(ranked) : ranked).map(
			item => resultFromMedia(item, normalizedQuery),
		),
		total,
		pageCount,
		preferredGenres: preferences.map(preference => preference.label),
	}
}

export async function getDiscoveryGenres() {
	const media = await prisma.media.findMany({
		where: { genres: { not: null } },
		select: { genres: true },
		distinct: ['genres'],
	})
	const genres = new Map<string, string>()
	for (const item of media) {
		for (const genre of splitGenres(item.genres)) {
			const key = genre.toLocaleLowerCase()
			if (!genres.has(key)) genres.set(key, genre)
		}
	}
	return [...genres.values()].sort((left, right) => left.localeCompare(right))
}

export async function getDiscoveryStatuses() {
	const media = await prisma.media.findMany({
		where: { releaseStatus: { not: null } },
		select: { releaseStatus: true },
		distinct: ['releaseStatus'],
		orderBy: { releaseStatus: 'asc' },
	})
	return media.flatMap(item => (item.releaseStatus ? [item.releaseStatus] : []))
}
