import { type Prisma } from '@prisma/client'
import { prisma } from './db.server.ts'
import { catalogPopularityScore, splitGenres } from './discovery.server.ts'

export const MEDIA_RECOMMENDATION_LIMIT = 6
const MEDIA_RECOMMENDATION_CANDIDATE_LIMIT = 200

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
	trackingStates: {
		select: {
			score: true,
			statusWatchlistId: true,
			statusWatchlist: { select: { isPublic: true } },
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

type RecommendationMedia = Prisma.MediaGetPayload<{
	select: typeof recommendationMediaSelect
}>

export type MediaRecommendation = {
	id: string
	kind: string
	title: string
	thumbnail: string | null
	type: string | null
	year: string | null
	matchedGenres: string[]
	communityScore: number | null
	ratingCount: number
	trackerCount: number
}

type RankedRecommendation = {
	media: RecommendationMedia
	matchedGenres: string[]
	similarity: number
	popularity: number
	communityScore: number | null
	ratingCount: number
	trackerCount: number
}

function yearFor(media: RecommendationMedia) {
	if (media.releaseStart) return String(media.releaseStart.getUTCFullYear())
	return media.startYear || media.airYear || null
}

function scoreFor(media: RecommendationMedia) {
	const scores = publicTrackingStates(media)
		.map(state => (state.score === null ? null : Number(state.score)))
		.filter(
			(score): score is number => score !== null && Number.isFinite(score),
		)
	if (!scores.length) return null
	return scores.reduce((total, score) => total + score, 0) / scores.length
}

function publicTrackingStates(media: RecommendationMedia) {
	return media.trackingStates.filter(
		state => state.statusWatchlistId === null || state.statusWatchlist?.isPublic,
	)
}

function rankCandidate(
	media: RecommendationMedia,
	sourceGenres: string[],
): RankedRecommendation {
	const candidateGenreKeys = new Set(
		splitGenres(media.genres).map(genre => genre.toLocaleLowerCase()),
	)
	const matchedGenres = sourceGenres.filter(genre =>
		candidateGenreKeys.has(genre.toLocaleLowerCase()),
	)
	const unionSize = new Set([
		...sourceGenres.map(genre => genre.toLocaleLowerCase()),
		...candidateGenreKeys,
	]).size
	const publicStates = publicTrackingStates(media)
	const scores = publicStates.filter(state => state.score !== null)

	return {
		media,
		matchedGenres,
		similarity: unionSize ? matchedGenres.length / unionSize : 0,
		popularity: catalogPopularityScore({
			...media._count,
			trackingStates: publicStates.length,
		}),
		communityScore: scoreFor(media),
		ratingCount: scores.length,
		trackerCount: publicStates.length,
	}
}

function compareRecommendations(
	left: RankedRecommendation,
	right: RankedRecommendation,
) {
	return (
		right.matchedGenres.length - left.matchedGenres.length ||
		right.similarity - left.similarity ||
		right.popularity - left.popularity ||
		right.trackerCount - left.trackerCount ||
		(left.media.title ?? '').localeCompare(right.media.title ?? '') ||
		left.media.id.localeCompare(right.media.id)
	)
}

export async function getSimilarMediaRecommendations(
	source: { id: string; kind: string; genres: string | null | undefined },
	viewerId: string | null,
	limit = MEDIA_RECOMMENDATION_LIMIT,
) {
	const sourceGenres = splitGenres(source.genres)
	const boundedLimit = Math.max(1, Math.min(limit, 12))
	const candidates = await prisma.media.findMany({
		where: {
			AND: [
				{ id: { not: source.id } },
				{ kind: source.kind },
				{ incomingRelations: { none: { sourceMediaId: source.id } } },
				{ outgoingRelations: { none: { targetMediaId: source.id } } },
				...(viewerId
					? [
							{ trackingStates: { none: { ownerId: viewerId } } },
							{ favorites: { none: { ownerId: viewerId } } },
						]
					: []),
				...(sourceGenres.length
					? [
							{ genres: { not: null } },
							{
								OR: sourceGenres.map(genre => ({
									genres: { contains: genre },
								})),
							},
						]
					: []),
			],
		},
		select: recommendationMediaSelect,
		orderBy: [{ reviews: { _count: 'desc' } }, { title: 'asc' }],
		take: MEDIA_RECOMMENDATION_CANDIDATE_LIMIT,
	})
	const ranked = candidates
		.map(media => rankCandidate(media, sourceGenres))
		.filter(item => !sourceGenres.length || item.matchedGenres.length)
		.sort(compareRecommendations)
		.slice(0, boundedLimit)

	return {
		sourceGenres,
		items: ranked.map(
			({ media, matchedGenres, communityScore, ratingCount, trackerCount }) =>
				({
					id: media.id,
					kind: media.kind,
					title: media.title?.trim() || `Untitled ${media.kind}`,
					thumbnail: media.thumbnail,
					type: media.type,
					year: yearFor(media),
					matchedGenres,
					communityScore,
					ratingCount,
					trackerCount,
				}) satisfies MediaRecommendation,
		),
	}
}
