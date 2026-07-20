import { type Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from './db.server.ts'

export const DISCOVERY_PAGE_SIZE = 24

export const discoveryKinds = ['all', 'movie', 'tv', 'anime', 'manga'] as const
export const discoverySorts = [
	'popular',
	'top-rated',
	'newest',
	'title',
	'for-you',
] as const

const DiscoveryQuerySchema = z.object({
	q: z.string().trim().max(100).catch(''),
	kind: z.enum(discoveryKinds).catch('all'),
	genre: z.string().trim().max(80).catch(''),
	sort: z.enum(discoverySorts).catch('popular'),
	page: z.coerce.number().int().min(1).max(1_000).catch(1),
})

export type DiscoveryQuery = z.infer<typeof DiscoveryQuerySchema>

export type DiscoveryResult = {
	id: string
	kind: string
	title: string
	thumbnail: string | null
	type: string | null
	year: string | null
	genres: string[]
	description: string | null
	communityScore: number | null
	ratingCount: number
	trackerCount: number
	reviewCount: number
	diaryCount: number
	viewerTracking: {
		status: string
		statusWatchlistId: string | null
	} | null
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
	createdAt: true,
	trackingStates: {
		select: {
			ownerId: true,
			status: true,
			statusWatchlistId: true,
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
}

function boundedSearchValue(value: string | null, maximum: number) {
	return (value ?? '').trim().slice(0, maximum)
}

export function parseDiscoveryQuery(searchParams: URLSearchParams) {
	return DiscoveryQuerySchema.parse({
		q: boundedSearchValue(searchParams.get('q'), 100),
		kind: searchParams.get('kind') ?? 'all',
		genre: boundedSearchValue(searchParams.get('genre'), 80),
		sort: searchParams.get('sort') ?? 'popular',
		page: searchParams.get('page') ?? '1',
	})
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

function communityScore(media: DiscoveryMedia) {
	const scores = media.trackingStates
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
		right.popularityScore - left.popularityScore ||
		right._count.trackingStates - left._count.trackingStates ||
		right._count.reviews - left._count.reviews ||
		compareTitle(left, right)
	)
}

/**
 * Pull sparse community averages toward a neutral 7/10 until a title has a
 * few ratings. This keeps a single 10 from outranking an established 9.
 */
function weightedCommunityScore(media: RankedMedia) {
	if (media.communityScore === null) return Number.NEGATIVE_INFINITY
	const priorScore = 7
	const priorRatings = 3
	return (
		(media.communityScore * media.ratingCount + priorScore * priorRatings) /
		(media.ratingCount + priorRatings)
	)
}

function rankMedia(media: RankedMedia[], sort: DiscoveryQuery['sort']) {
	return media.sort((left, right) => {
		if (sort === 'title') return compareTitle(left, right)
		if (sort === 'newest') {
			return (
				right.createdAt.getTime() - left.createdAt.getTime() ||
				compareTitle(left, right)
			)
		}
		if (sort === 'top-rated') {
			return (
				weightedCommunityScore(right) - weightedCommunityScore(left) ||
				right.ratingCount - left.ratingCount ||
				comparePopularity(left, right)
			)
		}
		if (sort === 'for-you') {
			return (
				right.affinityScore - left.affinityScore ||
				comparePopularity(left, right)
			)
		}
		return comparePopularity(left, right)
	})
}

function yearFor(media: DiscoveryMedia) {
	if (media.releaseStart) return String(media.releaseStart.getUTCFullYear())
	return media.startYear || media.airYear || null
}

function resultFromMedia(media: RankedMedia): DiscoveryResult {
	return {
		id: media.id,
		kind: media.kind,
		title: media.title || 'Untitled',
		thumbnail: media.thumbnail,
		type: media.type,
		year: yearFor(media),
		genres: splitGenres(media.genres),
		description: media.description,
		communityScore: media.communityScore,
		ratingCount: media.ratingCount,
		trackerCount: media._count.trackingStates,
		reviewCount: media._count.reviews,
		diaryCount: media._count.diaryEntries,
		viewerTracking: media.viewerTracking,
	}
}

type Preference = { label: string; weight: number }

async function getGenrePreferences(viewerId: string | null) {
	if (!viewerId) return []
	const states = await prisma.trackingState.findMany({
		where: { ownerId: viewerId },
		select: {
			status: true,
			score: true,
			media: { select: { genres: true } },
		},
	})
	const preferences = new Map<string, Preference>()
	for (const state of states) {
		const score = state.score === null ? 5 : Number(state.score)
		const statusBoost =
			state.status === 'completed' || state.status === 'watching' ? 2 : 0
		const weight = Math.max(1, score + statusBoost)
		for (const genre of splitGenres(state.media.genres)) {
			const key = genre.toLocaleLowerCase()
			const current = preferences.get(key)
			preferences.set(key, {
				label: current?.label ?? genre,
				weight: (current?.weight ?? 0) + weight,
			})
		}
	}
	return [...preferences.values()]
		.sort(
			(left, right) =>
				right.weight - left.weight || left.label.localeCompare(right.label),
		)
		.slice(0, 5)
}

function discoveryWhere(
	filters: DiscoveryQuery,
	viewerId: string | null,
): Prisma.MediaWhereInput {
	const textSearch: Prisma.MediaWhereInput | undefined = filters.q
		? {
				OR: [
					{ title: { contains: filters.q } },
					{ description: { contains: filters.q } },
				],
			}
		: undefined
	return {
		AND: [
			...(textSearch ? [textSearch] : []),
			...(filters.kind === 'all' ? [] : [{ kind: filters.kind }]),
			...(filters.sort === 'top-rated'
				? [{ trackingStates: { some: { score: { not: null } } } }]
				: []),
			...(filters.sort === 'for-you' && viewerId
				? [{ trackingStates: { none: { ownerId: viewerId } } }]
				: []),
		],
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
	const [preferences, media] = await Promise.all([
		getGenrePreferences(viewerId),
		prisma.media.findMany({
			where: discoveryWhere(filters, viewerId),
			select: discoveryMediaSelect,
		}),
	])
	const preferenceWeights = new Map(
		preferences.map(preference => [
			preference.label.toLocaleLowerCase(),
			preference.weight,
		]),
	)
	const genreKey = filters.genre.toLocaleLowerCase()
	const filteredMedia = genreKey
		? media.filter(item =>
				splitGenres(item.genres).some(
					genre => genre.toLocaleLowerCase() === genreKey,
				),
			)
		: media
	const ranked = rankMedia(
		filteredMedia.map(item => {
			const score = communityScore(item)
			const viewerState = viewerId
				? item.trackingStates.find(state => state.ownerId === viewerId)
				: null
			const ratingCount = item.trackingStates.filter(
				state => state.score !== null,
			).length
			return {
				...item,
				viewerTracking: viewerState
					? {
							status: viewerState.status,
							statusWatchlistId: viewerState.statusWatchlistId,
						}
					: null,
				communityScore: score,
				ratingCount,
				popularityScore: catalogPopularityScore(item._count),
				affinityScore: splitGenres(item.genres).reduce(
					(total, genre) =>
						total + (preferenceWeights.get(genre.toLocaleLowerCase()) ?? 0),
					0,
				),
			}
		}),
		filters.sort,
	)
	const total = ranked.length
	const pageCount = Math.max(1, Math.ceil(total / DISCOVERY_PAGE_SIZE))
	const page = Math.min(filters.page, pageCount)
	const start = (page - 1) * DISCOVERY_PAGE_SIZE

	return {
		filters: { ...filters, page },
		items: ranked
			.slice(start, start + DISCOVERY_PAGE_SIZE)
			.map(resultFromMedia),
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
