import { type Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from './db.server.ts'

const DAY_MS = 24 * 60 * 60 * 1000
const TRENDING_WINDOW_DAYS = 30
const REVIEW_CANDIDATE_LIMIT = 400
const ENGAGEMENT_CANDIDATE_LIMIT = 600

export const REVIEW_DISCOVERY_PAGE_SIZE = 24
export const reviewDiscoveryKinds = [
	'all',
	'movie',
	'tv',
	'anime',
	'manga',
] as const
export const reviewDiscoverySorts = [
	'trending',
	'popular',
	'recent',
	'following',
] as const

const ReviewDiscoveryQuerySchema = z.object({
	q: z.string().trim().max(100).catch(''),
	kind: z.enum(reviewDiscoveryKinds).catch('all'),
	sort: z.enum(reviewDiscoverySorts).catch('trending'),
	spoilers: z.enum(['include', 'exclude']).catch('include'),
	page: z.coerce.number().int().min(1).max(1_000).catch(1),
})

export type ReviewDiscoveryQuery = z.infer<typeof ReviewDiscoveryQuerySchema>

export type ReviewDiscoveryResult = {
	id: string
	body: string
	containsSpoilers: boolean
	rating: number | null
	createdAt: Date | string
	updatedAt: Date | string
	author: {
		id: string
		username: string
		name: string | null
		image: { id: string } | null
	}
	media: {
		id: string
		kind: string
		title: string
		thumbnail: string | null
		type: string | null
		year: string | null
	}
	likeCount: number
	commentCount: number
	viewerLiked: boolean
	recentComments: Array<{
		id: string
		body: string
		createdAt: Date | string
		author: {
			id: string
			username: string
			name: string | null
		}
	}>
}

export type ReviewDiscoveryResults = {
	filters: ReviewDiscoveryQuery
	items: ReviewDiscoveryResult[]
	total: number
	pageCount: number
}

export type TrendingReviewSignals = {
	id: string
	createdAt: Date | string
	likeCount: number
	commentCount: number
	recentLikes: Array<Date | string>
	recentComments: Array<Date | string>
}

const reviewDiscoverySelect = {
	id: true,
	body: true,
	containsSpoilers: true,
	rating: true,
	createdAt: true,
	updatedAt: true,
	author: {
		select: {
			id: true,
			username: true,
			name: true,
			image: { select: { id: true } },
		},
	},
	media: {
		select: {
			id: true,
			kind: true,
			title: true,
			thumbnail: true,
			type: true,
			releaseStart: true,
			startYear: true,
			airYear: true,
		},
	},
	_count: { select: { likes: true, comments: true } },
	comments: {
		where: { parentId: null },
		orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
		take: 3,
		select: {
			id: true,
			body: true,
			createdAt: true,
			author: {
				select: { id: true, username: true, name: true },
			},
		},
	},
} satisfies Prisma.ReviewSelect

type ReviewDiscoveryRow = Prisma.ReviewGetPayload<{
	select: typeof reviewDiscoverySelect
}>

function boundedSearchValue(value: string | null) {
	return (value ?? '').trim().slice(0, 100)
}

export function parseReviewDiscoveryQuery(searchParams: URLSearchParams) {
	return ReviewDiscoveryQuerySchema.parse({
		q: boundedSearchValue(searchParams.get('q')),
		kind: searchParams.get('kind') ?? 'all',
		sort: searchParams.get('sort') ?? 'trending',
		spoilers: searchParams.get('spoilers') ?? 'include',
		page: searchParams.get('page') ?? '1',
	})
}

function ageInDays(value: Date | string, now: Date) {
	return Math.max(0, (now.getTime() - new Date(value).getTime()) / DAY_MS)
}

function decayedSignal(
	values: Array<Date | string>,
	now: Date,
	weight: number,
) {
	return values.reduce(
		(total, value) => total + weight * Math.exp(-ageInDays(value, now) / 10),
		0,
	)
}

export function reviewTrendingScore(
	review: TrendingReviewSignals,
	now = new Date(),
) {
	const publicationFreshness =
		3.5 * Math.exp(-ageInDays(review.createdAt, now) / 21)
	const recentEngagement =
		decayedSignal(review.recentLikes, now, 2.5) +
		decayedSignal(review.recentComments, now, 4)
	const sustainedDiscussion =
		0.3 * Math.log1p(review.likeCount) + 0.45 * Math.log1p(review.commentCount)
	return publicationFreshness + recentEngagement + sustainedDiscussion
}

export function rankTrendingReviews(
	reviews: TrendingReviewSignals[],
	now = new Date(),
) {
	return reviews
		.map(review => ({
			...review,
			trendingScore: reviewTrendingScore(review, now),
		}))
		.sort(
			(left, right) =>
				right.trendingScore - left.trendingScore ||
				new Date(right.createdAt).getTime() -
					new Date(left.createdAt).getTime() ||
				right.id.localeCompare(left.id),
		)
}

async function getTrendingReviewIds(
	where: Prisma.ReviewWhereInput,
	now = new Date(),
) {
	const windowStart = new Date(now.getTime() - TRENDING_WINDOW_DAYS * DAY_MS)
	const [recent, liked, discussed, recentLikes, recentComments] =
		await Promise.all([
			prisma.review.findMany({
				where,
				orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
				take: REVIEW_CANDIDATE_LIMIT,
				select: { id: true },
			}),
			prisma.review.findMany({
				where,
				orderBy: [{ likes: { _count: 'desc' } }, { createdAt: 'desc' }],
				take: REVIEW_CANDIDATE_LIMIT,
				select: { id: true },
			}),
			prisma.review.findMany({
				where,
				orderBy: [{ comments: { _count: 'desc' } }, { createdAt: 'desc' }],
				take: REVIEW_CANDIDATE_LIMIT,
				select: { id: true },
			}),
			prisma.reviewLike.findMany({
				where: {
					createdAt: { gte: windowStart },
					review: { is: where },
				},
				orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
				take: ENGAGEMENT_CANDIDATE_LIMIT,
				select: { reviewId: true },
			}),
			prisma.reviewComment.findMany({
				where: {
					createdAt: { gte: windowStart },
					review: { is: where },
				},
				orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
				take: ENGAGEMENT_CANDIDATE_LIMIT,
				select: { reviewId: true },
			}),
		])
	const candidateIds = [
		...new Set([
			...recent.map(row => row.id),
			...liked.map(row => row.id),
			...discussed.map(row => row.id),
			...recentLikes.map(row => row.reviewId),
			...recentComments.map(row => row.reviewId),
		]),
	]
	if (!candidateIds.length) return []
	const candidates = await prisma.review.findMany({
		where: { AND: [where, { id: { in: candidateIds } }] },
		select: {
			id: true,
			createdAt: true,
			_count: { select: { likes: true, comments: true } },
			likes: {
				where: { createdAt: { gte: windowStart } },
				select: { createdAt: true },
			},
			comments: {
				where: { createdAt: { gte: windowStart } },
				select: { createdAt: true },
			},
		},
	})
	return rankTrendingReviews(
		candidates.map(review => ({
			id: review.id,
			createdAt: review.createdAt,
			likeCount: review._count.likes,
			commentCount: review._count.comments,
			recentLikes: review.likes.map(like => like.createdAt),
			recentComments: review.comments.map(comment => comment.createdAt),
		})),
		now,
	).map(review => review.id)
}

function yearForReview(review: ReviewDiscoveryRow) {
	if (review.media.releaseStart) {
		return String(review.media.releaseStart.getUTCFullYear())
	}
	return review.media.startYear || review.media.airYear || null
}

function resultFromReview(
	review: ReviewDiscoveryRow,
	viewerLiked: boolean,
): ReviewDiscoveryResult {
	return {
		id: review.id,
		body: review.body,
		containsSpoilers: review.containsSpoilers,
		rating: review.rating === null ? null : Number(review.rating),
		createdAt: review.createdAt,
		updatedAt: review.updatedAt,
		author: review.author,
		media: {
			id: review.media.id,
			kind: review.media.kind,
			title: review.media.title?.trim() || `Untitled ${review.media.kind}`,
			thumbnail: review.media.thumbnail,
			type: review.media.type,
			year: yearForReview(review),
		},
		likeCount: review._count.likes,
		commentCount: review._count.comments,
		viewerLiked,
		recentComments: review.comments,
	}
}

export async function getReviewDiscoveryResults(
	input: ReviewDiscoveryQuery,
	viewerId: string | null,
): Promise<ReviewDiscoveryResults> {
	const filters = {
		...input,
		sort: input.sort === 'following' && !viewerId ? 'trending' : input.sort,
	} satisfies ReviewDiscoveryQuery
	const followedIds =
		filters.sort === 'following' && viewerId
			? await prisma.follow
					.findMany({
						where: { followerId: viewerId },
						select: { followingId: true },
					})
					.then(rows => rows.map(row => row.followingId))
			: []
	const where: Prisma.ReviewWhereInput = {
		AND: [
			...(filters.q
				? [
						{
							OR: [
								{ body: { contains: filters.q } },
								{ media: { title: { contains: filters.q } } },
								{ author: { username: { contains: filters.q } } },
								{ author: { name: { contains: filters.q } } },
							],
						},
					]
				: []),
			...(filters.kind === 'all' ? [] : [{ media: { kind: filters.kind } }]),
			...(filters.spoilers === 'exclude' ? [{ containsSpoilers: false }] : []),
			...(filters.sort === 'following'
				? [{ authorId: { in: followedIds } }]
				: []),
		],
	}
	const rankingIds =
		filters.sort === 'trending' ? await getTrendingReviewIds(where) : null
	const total = rankingIds?.length ?? (await prisma.review.count({ where }))
	const pageCount = Math.max(1, Math.ceil(total / REVIEW_DISCOVERY_PAGE_SIZE))
	const page = Math.min(filters.page, pageCount)
	const pageIds = rankingIds?.slice(
		(page - 1) * REVIEW_DISCOVERY_PAGE_SIZE,
		page * REVIEW_DISCOVERY_PAGE_SIZE,
	)
	let rows = await prisma.review.findMany({
		where: pageIds ? { id: { in: pageIds } } : where,
		orderBy: pageIds
			? undefined
			: filters.sort === 'popular'
				? [
						{ likes: { _count: 'desc' } },
						{ comments: { _count: 'desc' } },
						{ createdAt: 'desc' },
						{ id: 'desc' },
					]
				: [{ createdAt: 'desc' }, { id: 'desc' }],
		skip: pageIds ? undefined : (page - 1) * REVIEW_DISCOVERY_PAGE_SIZE,
		take: pageIds ? undefined : REVIEW_DISCOVERY_PAGE_SIZE,
		select: reviewDiscoverySelect,
	})
	if (pageIds) {
		const positions = new Map(pageIds.map((id, index) => [id, index]))
		rows = rows.sort(
			(left, right) =>
				(positions.get(left.id) ?? 0) - (positions.get(right.id) ?? 0),
		)
	}
	const viewerLikes =
		viewerId && rows.length
			? await prisma.reviewLike.findMany({
					where: {
						userId: viewerId,
						reviewId: { in: rows.map(review => review.id) },
					},
					select: { reviewId: true },
				})
			: []
	const viewerLikedIds = new Set(viewerLikes.map(like => like.reviewId))

	return {
		filters: { ...filters, page },
		items: rows.map(review =>
			resultFromReview(review, viewerLikedIds.has(review.id)),
		),
		total,
		pageCount,
	}
}
