import { type Prisma } from '@prisma/client'
import { prisma } from './db.server.ts'
import { catalogPopularityScore, splitGenres } from './discovery.server.ts'
import {
	type RecommendationGraph,
	type RecommendationGraphItem,
	type RecommendationLane,
	type RecommendationLaneKey,
} from './recommendation-graph.ts'

export const RECOMMENDATION_LANE_LIMIT = 6
const CANDIDATE_LIMIT = 240
const SEED_LIMIT = 40

const recommendationMediaSelect = {
	id: true,
	kind: true,
	title: true,
	thumbnail: true,
	type: true,
	releaseStart: true,
	startYear: true,
	airYear: true,
	genres: true,
	catalogPopularity: true,
	catalogScore: true,
	tmdbScore: true,
	malScore: true,
	_count: {
		select: {
			trackingStates: {
				where: {
					OR: [
						{ statusWatchlistId: null },
						{ statusWatchlist: { isPublic: true } },
					],
				},
			},
			reviews: true,
			diaryEntries: true,
		},
	},
} satisfies Prisma.MediaSelect

type RecommendationMedia = Prisma.MediaGetPayload<{
	select: typeof recommendationMediaSelect
}>

type Seed = {
	id: string
	title: string
	genres: string[]
	weight: number
}

type CandidateSignals = {
	connected: number
	circle: number
	collections: number
	taste: number
	reasons: Record<RecommendationLaneKey, Set<string>>
	matchedGenres: Set<string>
}

function candidateSignals() {
	return {
		connected: 0,
		circle: 0,
		collections: 0,
		taste: 0,
		reasons: {
			connected: new Set<string>(),
			circle: new Set<string>(),
			collections: new Set<string>(),
			taste: new Set<string>(),
		},
		matchedGenres: new Set<string>(),
	} satisfies CandidateSignals
}

function yearFor(media: RecommendationMedia) {
	if (media.releaseStart) return String(media.releaseStart.getUTCFullYear())
	return media.startYear || media.airYear || null
}

function providerScore(media: RecommendationMedia) {
	const scores = [
		media.catalogScore,
		media.tmdbScore === null ? null : Number(media.tmdbScore),
		media.malScore === null ? null : Number(media.malScore),
	].filter((score): score is number => score !== null && Number.isFinite(score))
	return scores.length ? Math.max(...scores) : 0
}

function popularityFor(media: RecommendationMedia) {
	return (
		Math.log1p(
			media.catalogPopularity ??
				catalogPopularityScore({
					...media._count,
				}),
		) *
			2 +
		providerScore(media)
	)
}

function displayName(user: { name: string | null; username: string }) {
	return user.name?.trim() || user.username
}

function addGenres(
	weights: Map<string, { label: string; weight: number }>,
	genres: string | null | undefined,
	weight: number,
) {
	for (const genre of splitGenres(genres)) {
		const key = genre.toLocaleLowerCase()
		const current = weights.get(key)
		weights.set(key, {
			label: current?.label ?? genre,
			weight: (current?.weight ?? 0) + weight,
		})
	}
}

function addReason(
	signals: CandidateSignals,
	lane: RecommendationLaneKey,
	reason: string,
) {
	if (signals.reasons[lane].size < 4) signals.reasons[lane].add(reason)
}

function recommendationBaseWhere(
	viewerId: string,
	excludedMediaIds: string[],
): Prisma.MediaWhereInput {
	return {
		title: { not: null },
		id: excludedMediaIds.length ? { notIn: excludedMediaIds } : undefined,
		trackingStates: { none: { ownerId: viewerId } },
		favorites: { none: { ownerId: viewerId } },
		recommendationFeedback: { none: { ownerId: viewerId } },
	}
}

function topGenres(weights: Map<string, { label: string; weight: number }>) {
	return [...weights.values()]
		.filter(genre => genre.weight > 0)
		.sort(
			(left, right) =>
				right.weight - left.weight || left.label.localeCompare(right.label),
		)
		.slice(0, 8)
}

function strength(
	signals: CandidateSignals,
	media: RecommendationMedia,
	lane: RecommendationLaneKey,
) {
	const laneSignal = signals[lane]
	const total = laneSignal + popularityFor(media) * 0.1
	return total
}

function laneMetadata(key: RecommendationLaneKey) {
	switch (key) {
		case 'connected':
			return {
				title: 'Continue a world you love',
				description:
					'Canonical sequels, adaptations, and related works connected to titles you rated highly.',
			}
		case 'circle':
			return {
				title: 'From people you follow',
				description:
					'Public ratings and reviews from members whose taste you chose to follow.',
			}
		case 'collections':
			return {
				title: 'From collections you trust',
				description:
					'Unseen titles appearing in public collections you liked or from people you follow.',
			}
		case 'taste':
			return {
				title: 'Matches your taste',
				description:
					'Genre affinity from your ratings, repeats, favorites, reviews, and saved collections.',
			}
	}
}

function buildLane(
	key: RecommendationLaneKey,
	media: RecommendationMedia[],
	signalsByMediaId: Map<string, CandidateSignals>,
	usedMediaIds: Set<string>,
) {
	const ranked = media
		.flatMap(candidate => {
			const signals = signalsByMediaId.get(candidate.id)
			if (!signals || signals[key] <= 0 || usedMediaIds.has(candidate.id)) {
				return []
			}
			return [{ candidate, signals, score: strength(signals, candidate, key) }]
		})
		.sort(
			(left, right) =>
				right.score - left.score ||
				(right.candidate.catalogPopularity ?? 0) -
					(left.candidate.catalogPopularity ?? 0) ||
				(left.candidate.title ?? '').localeCompare(
					right.candidate.title ?? '',
				) ||
				left.candidate.id.localeCompare(right.candidate.id),
		)
		.slice(0, RECOMMENDATION_LANE_LIMIT)

	if (!ranked.length) return null
	const items = ranked.map(({ candidate, signals }) => {
		usedMediaIds.add(candidate.id)
		return {
			id: candidate.id,
			kind: candidate.kind,
			title: candidate.title?.trim() || `Untitled ${candidate.kind}`,
			thumbnail: candidate.thumbnail,
			type: candidate.type,
			year: yearFor(candidate),
			reasons: [...signals.reasons[key]].slice(0, 3),
			viewerTracking: null,
		} satisfies RecommendationGraphItem
	})
	return { key, ...laneMetadata(key), items } satisfies RecommendationLane
}

export async function getRecommendationGraph(
	viewerId: string,
): Promise<RecommendationGraph> {
	const [
		trackingStates,
		favorites,
		ownReviews,
		follows,
		feedback,
		feedbackCount,
		likedReviews,
	] = await Promise.all([
		prisma.trackingState.findMany({
			where: {
				ownerId: viewerId,
				OR: [
					{ score: { not: null } },
					{ repeatCount: { gt: 0 } },
					{ status: { in: ['completed', 'watching'] } },
				],
			},
			select: {
				status: true,
				score: true,
				repeatCount: true,
				media: {
					select: { id: true, title: true, genres: true },
				},
			},
			orderBy: { updatedAt: 'desc' },
			take: 1_000,
		}),
		prisma.userFavorite.findMany({
			where: { ownerId: viewerId, mediaId: { not: null } },
			select: {
				media: { select: { id: true, title: true, genres: true } },
			},
			orderBy: { position: 'asc' },
			take: 250,
		}),
		prisma.review.findMany({
			where: {
				authorId: viewerId,
				rating: { not: null },
				moderationStatus: 'visible',
			},
			select: {
				rating: true,
				media: { select: { id: true, title: true, genres: true } },
			},
			orderBy: { updatedAt: 'desc' },
			take: 500,
		}),
		prisma.follow.findMany({
			where: { followerId: viewerId },
			select: { followingId: true },
			orderBy: { createdAt: 'desc' },
			take: 500,
		}),
		prisma.recommendationFeedback.findMany({
			where: { ownerId: viewerId },
			select: {
				mediaId: true,
				feedbackType: true,
				media: { select: { title: true, genres: true } },
			},
			orderBy: { updatedAt: 'desc' },
			take: 500,
		}),
		prisma.recommendationFeedback.count({ where: { ownerId: viewerId } }),
		prisma.reviewLike.findMany({
			where: {
				userId: viewerId,
				review: { moderationStatus: 'visible' },
			},
			select: {
				review: {
					select: {
						media: { select: { id: true, title: true, genres: true } },
					},
				},
			},
			take: SEED_LIMIT,
			orderBy: { createdAt: 'desc' },
		}),
	])

	const seedByMediaId = new Map<string, Seed>()
	const genreWeights = new Map<string, { label: string; weight: number }>()
	function addSeed(
		media: { id: string; title: string | null; genres: string | null },
		weight: number,
	) {
		if (weight <= 0) return
		const current = seedByMediaId.get(media.id)
		seedByMediaId.set(media.id, {
			id: media.id,
			title: media.title?.trim() || 'a title you enjoyed',
			genres: splitGenres(media.genres),
			weight: (current?.weight ?? 0) + weight,
		})
		addGenres(genreWeights, media.genres, weight)
	}

	for (const state of trackingStates) {
		const score = state.score === null ? null : Number(state.score)
		const positive =
			(score !== null && score >= 7 ? score - 4 : 0) +
			Math.min(state.repeatCount, 5) * 2 +
			(state.status === 'completed' || state.status === 'watching' ? 1 : 0)
		addSeed(state.media, positive)
		if (score !== null && score <= 4) {
			addGenres(genreWeights, state.media.genres, -(5 - score) * 0.75)
		}
	}
	for (const favorite of favorites) {
		if (favorite.media) addSeed(favorite.media, 8)
	}
	for (const review of ownReviews) {
		const rating = Number(review.rating)
		if (rating >= 7) addSeed(review.media, rating - 3)
		if (rating <= 4) addGenres(genreWeights, review.media.genres, rating - 5)
	}
	for (const like of likedReviews) addSeed(like.review.media, 3)
	for (const item of feedback) {
		if (item.feedbackType === 'show_less') {
			addGenres(genreWeights, item.media.genres, -3)
		}
	}

	const seeds = [...seedByMediaId.values()]
		.sort((left, right) => right.weight - left.weight)
		.slice(0, SEED_LIMIT)
	const preferredGenres = topGenres(genreWeights)
	const followedIds = follows.map(follow => follow.followingId)
	const hiddenIds = feedback.map(item => item.mediaId)
	const excludedIds = [...new Set([...seedByMediaId.keys(), ...hiddenIds])]
	const baseWhere = recommendationBaseWhere(viewerId, excludedIds)

	const [relations, followedStates, followedReviews, collectionItems, taste] =
		await Promise.all([
			seeds.length
				? prisma.mediaRelation.findMany({
						where: {
							OR: [
								{ sourceMediaId: { in: seeds.map(seed => seed.id) } },
								{ targetMediaId: { in: seeds.map(seed => seed.id) } },
							],
						},
						select: {
							sourceMediaId: true,
							targetMediaId: true,
							relationType: true,
						},
						take: CANDIDATE_LIMIT,
					})
				: Promise.resolve([]),
			followedIds.length
				? prisma.trackingState.findMany({
						where: {
							ownerId: { in: followedIds },
							OR: [
								{ statusWatchlistId: null },
								{ statusWatchlist: { isPublic: true } },
							],
							AND: [
								{
									OR: [{ score: { gte: 8 } }, { repeatCount: { gt: 0 } }],
								},
								{ media: baseWhere },
							],
						},
						select: {
							score: true,
							repeatCount: true,
							mediaId: true,
							owner: { select: { name: true, username: true } },
						},
						orderBy: { updatedAt: 'desc' },
						take: CANDIDATE_LIMIT,
					})
				: Promise.resolve([]),
			followedIds.length
				? prisma.review.findMany({
						where: {
							authorId: { in: followedIds },
							rating: { gte: 8 },
							moderationStatus: 'visible',
							media: baseWhere,
						},
						select: {
							rating: true,
							mediaId: true,
							author: { select: { name: true, username: true } },
						},
						orderBy: { updatedAt: 'desc' },
						take: CANDIDATE_LIMIT,
					})
				: Promise.resolve([]),
			prisma.mediaCollectionItem.findMany({
				where: {
					media: baseWhere,
					collection: {
						isPublic: true,
						moderationStatus: 'visible',
						OR: [
							...(followedIds.length ? [{ ownerId: { in: followedIds } }] : []),
							{ likes: { some: { userId: viewerId } } },
						],
					},
				},
				select: {
					mediaId: true,
					collection: {
						select: {
							title: true,
							owner: { select: { name: true, username: true } },
							likes: {
								where: { userId: viewerId },
								select: { id: true },
							},
						},
					},
				},
				orderBy: { updatedAt: 'desc' },
				take: CANDIDATE_LIMIT,
			}),
			preferredGenres.length
				? prisma.media.findMany({
						where: {
							AND: [
								baseWhere,
								{
									OR: preferredGenres.map(genre => ({
										genres: { contains: genre.label },
									})),
								},
							],
						},
						select: recommendationMediaSelect,
						orderBy: [
							{ catalogPopularity: 'desc' },
							{ catalogScore: 'desc' },
							{ title: 'asc' },
						],
						take: CANDIDATE_LIMIT,
					})
				: Promise.resolve([]),
		])

	const signalsByMediaId = new Map<string, CandidateSignals>()
	function signalsFor(mediaId: string) {
		const current = signalsByMediaId.get(mediaId)
		if (current) return current
		const created = candidateSignals()
		signalsByMediaId.set(mediaId, created)
		return created
	}
	const seedMap = new Map(seeds.map(seed => [seed.id, seed]))
	for (const relation of relations) {
		const sourceSeed = seedMap.get(relation.sourceMediaId)
		const targetSeed = seedMap.get(relation.targetMediaId)
		const seed = sourceSeed ?? targetSeed
		const candidateId = sourceSeed
			? relation.targetMediaId
			: relation.sourceMediaId
		if (!seed || excludedIds.includes(candidateId)) continue
		const signals = signalsFor(candidateId)
		signals.connected += 25 + seed.weight
		addReason(
			signals,
			'connected',
			`${relation.relationType.replaceAll('_', ' ')} connection to ${seed.title}`,
		)
	}
	for (const state of followedStates) {
		const signals = signalsFor(state.mediaId)
		const score = state.score === null ? 0 : Number(state.score)
		signals.circle += score + Math.min(state.repeatCount, 5) * 2
		addReason(
			signals,
			'circle',
			`${displayName(state.owner)} rated it ${score || 'highly'}${state.repeatCount ? ` and revisited it ${state.repeatCount}×` : ''}`,
		)
	}
	for (const review of followedReviews) {
		const signals = signalsFor(review.mediaId)
		signals.circle += Number(review.rating) + 4
		addReason(
			signals,
			'circle',
			`${displayName(review.author)} published a ${Number(review.rating).toFixed(0)}/10 review`,
		)
	}
	for (const item of collectionItems) {
		const signals = signalsFor(item.mediaId)
		const liked = item.collection.likes.length > 0
		signals.collections += liked ? 18 : 12
		addReason(
			signals,
			'collections',
			liked
				? `Included in “${item.collection.title}”, a collection you liked`
				: `Included in “${item.collection.title}” by ${displayName(item.collection.owner)}`,
		)
	}
	const preferredGenreWeights = new Map(
		preferredGenres.map(genre => [genre.label.toLocaleLowerCase(), genre]),
	)
	for (const media of taste) {
		const signals = signalsFor(media.id)
		for (const genre of splitGenres(media.genres)) {
			const preference = preferredGenreWeights.get(genre.toLocaleLowerCase())
			if (!preference) continue
			signals.taste += preference.weight
			signals.matchedGenres.add(preference.label)
		}
		if (signals.matchedGenres.size) {
			addReason(
				signals,
				'taste',
				`Matches your interest in ${[...signals.matchedGenres].slice(0, 3).join(', ')}`,
			)
		}
	}

	const signaledIds = [...signalsByMediaId.keys()]
	const signaledMedia = signaledIds.length
		? await prisma.media.findMany({
				where: { AND: [baseWhere, { id: { in: signaledIds } }] },
				select: recommendationMediaSelect,
			})
		: []
	const mediaById = new Map(
		[...taste, ...signaledMedia].map(media => [media.id, media]),
	)
	const candidates = [...mediaById.values()]
	const used = new Set<string>()
	const lanes = (
		['connected', 'circle', 'collections', 'taste'] as const
	).flatMap(key => {
		const lane = buildLane(key, candidates, signalsByMediaId, used)
		return lane ? [lane] : []
	})

	return {
		lanes,
		hiddenItems: feedback.slice(0, 50).map(item => ({
			id: item.mediaId,
			title: item.media.title?.trim() || 'Untitled',
			feedbackType: item.feedbackType,
		})),
		summary: {
			positiveSeeds: seeds.length,
			preferredGenres: preferredGenres.slice(0, 5).map(genre => genre.label),
			followingCount: followedIds.length,
			hiddenCount: feedbackCount,
		},
	}
}
