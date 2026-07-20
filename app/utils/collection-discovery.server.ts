import { type Prisma } from '@prisma/client'
import { prisma } from './db.server.ts'

const DAY_MS = 24 * 60 * 60 * 1000
const TRENDING_WINDOW_DAYS = 30
const COLLECTION_CANDIDATE_LIMIT = 300
const ENGAGEMENT_CANDIDATE_LIMIT = 500
const PERSONALIZATION_HISTORY_LIMIT = 500

export type PersonalizedCollectionTaste = {
	followedOwnerIds: ReadonlySet<string>
	mediaWeights: ReadonlyMap<string, number>
	tagWeights: ReadonlyMap<string, number>
}

export type PersonalizedCollectionSignals = {
	id: string
	ownerId: string
	updatedAt: Date | string
	likeCount: number
	commentCount: number
	itemIds: string[]
	tags: Array<{ name: string; slug: string }>
}

export type PersonalizedCollectionRecommendation = {
	id: string
	score: number
	reason: string
}

export type PersonalizedCollectionRanking = {
	items: PersonalizedCollectionRecommendation[]
	signals: {
		followedPeople: number
		tasteTitles: number
		likedTags: number
	}
}

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

export function personalizedCollectionScore(
	collection: PersonalizedCollectionSignals,
	taste: PersonalizedCollectionTaste,
	now = new Date(),
) {
	const followsCurator = taste.followedOwnerIds.has(collection.ownerId)
	const matchingItems = collection.itemIds.filter(mediaId =>
		taste.mediaWeights.has(mediaId),
	)
	const matchingTags = collection.tags.filter(tag =>
		taste.tagWeights.has(tag.slug),
	)
	const titleAffinity = Math.min(
		24,
		matchingItems.reduce(
			(total, mediaId) => total + (taste.mediaWeights.get(mediaId) ?? 0),
			0,
		),
	)
	const tagAffinity = Math.min(
		16,
		matchingTags.reduce(
			(total, tag) => total + (taste.tagWeights.get(tag.slug) ?? 0),
			0,
		),
	)
	const communityInterest =
		0.5 * Math.log1p(collection.likeCount) +
		0.75 * Math.log1p(collection.commentCount)
	const freshness = 1.5 * Math.exp(-ageInDays(collection.updatedAt, now) / 45)
	const score =
		(followsCurator ? 18 : 0) +
		titleAffinity +
		tagAffinity +
		communityInterest +
		freshness

	let reason: string
	if (followsCurator) {
		reason = 'From someone you follow'
	} else if (matchingItems.length) {
		reason =
			matchingItems.length === 1
				? 'Includes a title you enjoyed'
				: `Includes ${matchingItems.length} titles you enjoyed`
	} else if (matchingTags.length) {
		const labels = matchingTags
			.slice(0, 2)
			.map(tag => `#${tag.name}`)
			.join(' and ')
		reason = `Matches ${labels} from collections you liked`
	} else if (collection.likeCount || collection.commentCount) {
		reason = 'Popular with the community'
	} else {
		reason = 'A fresh community collection'
	}

	return { id: collection.id, score, reason }
}

export function rankPersonalizedCollections(
	collections: PersonalizedCollectionSignals[],
	taste: PersonalizedCollectionTaste,
	now = new Date(),
) {
	const updatedAt = new Map(
		collections.map(collection => [
			collection.id,
			new Date(collection.updatedAt).getTime(),
		]),
	)
	return collections
		.map(collection => personalizedCollectionScore(collection, taste, now))
		.sort(
			(left, right) =>
				right.score - left.score ||
				(updatedAt.get(right.id) ?? 0) - (updatedAt.get(left.id) ?? 0) ||
				right.id.localeCompare(left.id),
		)
}

function addWeight(weights: Map<string, number>, key: string, weight: number) {
	weights.set(key, (weights.get(key) ?? 0) + weight)
}

function trackingWeight(status: string, score: Prisma.Decimal | null) {
	const numericScore = score === null ? null : Number(score)
	if (
		numericScore !== null &&
		Number.isFinite(numericScore) &&
		numericScore >= 7
	) {
		return Math.min(6, numericScore - 4)
	}
	const normalizedStatus = status.toLocaleLowerCase().replace(/[^a-z]/g, '')
	return [
		'completed',
		'watching',
		'currentlywatching',
		'reading',
		'currentlyreading',
	].includes(normalizedStatus)
		? 2
		: 0
}

export async function getPersonalizedCollectionRanking(
	viewerId: string,
	where: Prisma.MediaCollectionWhereInput,
): Promise<PersonalizedCollectionRanking> {
	const [following, favorites, trackingStates, likedCollections] =
		await Promise.all([
			prisma.follow.findMany({
				where: { followerId: viewerId },
				orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
				take: PERSONALIZATION_HISTORY_LIMIT,
				select: { followingId: true },
			}),
			prisma.userFavorite.findMany({
				where: { ownerId: viewerId, mediaId: { not: null } },
				orderBy: [{ position: 'asc' }, { id: 'asc' }],
				take: PERSONALIZATION_HISTORY_LIMIT,
				select: { mediaId: true },
			}),
			prisma.trackingState.findMany({
				where: { ownerId: viewerId },
				orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
				take: PERSONALIZATION_HISTORY_LIMIT,
				select: { mediaId: true, status: true, score: true },
			}),
			prisma.collectionLike.findMany({
				where: {
					userId: viewerId,
					collection: { is: { isPublic: true } },
				},
				orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
				take: PERSONALIZATION_HISTORY_LIMIT,
				select: {
					collectionId: true,
					collection: {
						select: {
							items: { select: { mediaId: true } },
							tags: {
								select: { tag: { select: { slug: true } } },
							},
						},
					},
				},
			}),
		])
	const followedOwnerIds = new Set(following.map(row => row.followingId))
	const mediaWeights = new Map<string, number>()
	const tagWeights = new Map<string, number>()
	for (const favorite of favorites) {
		if (favorite.mediaId) addWeight(mediaWeights, favorite.mediaId, 6)
	}
	for (const state of trackingStates) {
		const weight = trackingWeight(state.status, state.score)
		if (weight) addWeight(mediaWeights, state.mediaId, weight)
	}
	for (const like of likedCollections) {
		for (const item of like.collection.items) {
			addWeight(mediaWeights, item.mediaId, 3)
		}
		for (const { tag } of like.collection.tags) {
			addWeight(tagWeights, tag.slug, 4)
		}
	}

	const taste: PersonalizedCollectionTaste = {
		followedOwnerIds,
		mediaWeights,
		tagWeights,
	}
	const personalizedWhere: Prisma.MediaCollectionWhereInput = {
		AND: [
			where,
			{ isPublic: true },
			{ ownerId: { not: viewerId } },
			{ likes: { none: { userId: viewerId } } },
		],
	}
	const topMediaIds = [...mediaWeights.entries()]
		.sort((left, right) => right[1] - left[1])
		.slice(0, 200)
		.map(([mediaId]) => mediaId)
	const topTagSlugs = [...tagWeights.entries()]
		.sort((left, right) => right[1] - left[1])
		.slice(0, 100)
		.map(([slug]) => slug)
	const [recent, popular, followed, mediaMatches, tagMatches] =
		await Promise.all([
			prisma.mediaCollection.findMany({
				where: personalizedWhere,
				orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
				take: COLLECTION_CANDIDATE_LIMIT,
				select: { id: true },
			}),
			prisma.mediaCollection.findMany({
				where: personalizedWhere,
				orderBy: [{ likes: { _count: 'desc' } }, { updatedAt: 'desc' }],
				take: COLLECTION_CANDIDATE_LIMIT,
				select: { id: true },
			}),
			followedOwnerIds.size
				? prisma.mediaCollection.findMany({
						where: {
							AND: [
								personalizedWhere,
								{ ownerId: { in: [...followedOwnerIds] } },
							],
						},
						orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
						take: COLLECTION_CANDIDATE_LIMIT,
						select: { id: true },
					})
				: Promise.resolve([]),
			topMediaIds.length
				? prisma.mediaCollection.findMany({
						where: {
							AND: [
								personalizedWhere,
								{ items: { some: { mediaId: { in: topMediaIds } } } },
							],
						},
						orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
						take: COLLECTION_CANDIDATE_LIMIT,
						select: { id: true },
					})
				: Promise.resolve([]),
			topTagSlugs.length
				? prisma.mediaCollection.findMany({
						where: {
							AND: [
								personalizedWhere,
								{
									tags: { some: { tag: { slug: { in: topTagSlugs } } } },
								},
							],
						},
						orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
						take: COLLECTION_CANDIDATE_LIMIT,
						select: { id: true },
					})
				: Promise.resolve([]),
		])
	const candidateIds = [
		...new Set(
			[recent, popular, followed, mediaMatches, tagMatches].flatMap(rows =>
				rows.map(row => row.id),
			),
		),
	]
	if (!candidateIds.length) {
		return {
			items: [],
			signals: {
				followedPeople: followedOwnerIds.size,
				tasteTitles: mediaWeights.size,
				likedTags: tagWeights.size,
			},
		}
	}
	const candidates = await prisma.mediaCollection.findMany({
		where: { AND: [personalizedWhere, { id: { in: candidateIds } }] },
		select: {
			id: true,
			ownerId: true,
			updatedAt: true,
			_count: { select: { likes: true, comments: true } },
			items: { select: { mediaId: true } },
			tags: { select: { tag: { select: { name: true, slug: true } } } },
		},
	})

	return {
		items: rankPersonalizedCollections(
			candidates.map(collection => ({
				id: collection.id,
				ownerId: collection.ownerId,
				updatedAt: collection.updatedAt,
				likeCount: collection._count.likes,
				commentCount: collection._count.comments,
				itemIds: collection.items.map(item => item.mediaId),
				tags: collection.tags.map(({ tag }) => tag),
			})),
			taste,
		),
		signals: {
			followedPeople: followedOwnerIds.size,
			tasteTitles: mediaWeights.size,
			likedTags: tagWeights.size,
		},
	}
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
