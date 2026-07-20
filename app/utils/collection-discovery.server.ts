import { type Prisma } from '@prisma/client'
import { prisma } from './db.server.ts'

const DAY_MS = 24 * 60 * 60 * 1000
const TRENDING_WINDOW_DAYS = 30
const COLLECTION_CANDIDATE_LIMIT = 300
const ENGAGEMENT_CANDIDATE_LIMIT = 500

export type TrendingCollectionSignals = {
	id: string
	createdAt: Date | string
	updatedAt: Date | string
	likeCount: number
	commentCount: number
	recentLikes: Array<Date | string>
	recentComments: Array<Date | string>
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

export function collectionTrendingScore(
	collection: TrendingCollectionSignals,
	now = new Date(),
) {
	const publicationFreshness =
		4 * Math.exp(-ageInDays(collection.createdAt, now) / 21)
	const recentEngagement =
		decayedSignal(collection.recentLikes, now, 3) +
		decayedSignal(collection.recentComments, now, 5)
	const sustainedInterest =
		0.35 * Math.log1p(collection.likeCount) +
		0.5 * Math.log1p(collection.commentCount)
	return publicationFreshness + recentEngagement + sustainedInterest
}

export function rankTrendingCollections(
	collections: TrendingCollectionSignals[],
	now = new Date(),
) {
	return collections
		.map(collection => ({
			...collection,
			trendingScore: collectionTrendingScore(collection, now),
		}))
		.sort(
			(a, b) =>
				b.trendingScore - a.trendingScore ||
				new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime() ||
				b.id.localeCompare(a.id),
		)
}

export async function getTrendingCollectionIds(
	where: Prisma.MediaCollectionWhereInput,
	now = new Date(),
) {
	const windowStart = new Date(now.getTime() - TRENDING_WINDOW_DAYS * DAY_MS)
	const [recent, popular, discussed, recentLikes, recentComments] =
		await Promise.all([
			prisma.mediaCollection.findMany({
				where,
				orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
				take: COLLECTION_CANDIDATE_LIMIT,
				select: { id: true },
			}),
			prisma.mediaCollection.findMany({
				where,
				orderBy: [{ likes: { _count: 'desc' } }, { updatedAt: 'desc' }],
				take: COLLECTION_CANDIDATE_LIMIT,
				select: { id: true },
			}),
			prisma.mediaCollection.findMany({
				where,
				orderBy: [{ comments: { _count: 'desc' } }, { updatedAt: 'desc' }],
				take: COLLECTION_CANDIDATE_LIMIT,
				select: { id: true },
			}),
			prisma.collectionLike.findMany({
				where: {
					createdAt: { gte: windowStart },
					collection: { is: where },
				},
				orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
				take: ENGAGEMENT_CANDIDATE_LIMIT,
				select: { collectionId: true },
			}),
			prisma.collectionComment.findMany({
				where: {
					createdAt: { gte: windowStart },
					collection: { is: where },
				},
				orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
				take: ENGAGEMENT_CANDIDATE_LIMIT,
				select: { collectionId: true },
			}),
		])
	const candidateIds = [
		...new Set([
			...recent.map(row => row.id),
			...popular.map(row => row.id),
			...discussed.map(row => row.id),
			...recentLikes.map(row => row.collectionId),
			...recentComments.map(row => row.collectionId),
		]),
	]
	if (!candidateIds.length) return []

	const candidates = await prisma.mediaCollection.findMany({
		where: { AND: [where, { id: { in: candidateIds } }] },
		select: {
			id: true,
			createdAt: true,
			updatedAt: true,
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

	return rankTrendingCollections(
		candidates.map(collection => ({
			id: collection.id,
			createdAt: collection.createdAt,
			updatedAt: collection.updatedAt,
			likeCount: collection._count.likes,
			commentCount: collection._count.comments,
			recentLikes: collection.likes.map(like => like.createdAt),
			recentComments: collection.comments.map(comment => comment.createdAt),
		})),
		now,
	).map(collection => collection.id)
}
