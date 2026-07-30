import { type Prisma } from '@prisma/client'
import { prisma } from './db.server.ts'
import { publicTrackingStateWhere } from './lists/visibility.ts'

type ScoreGroup = {
	score: unknown
	_count: { _all: number }
}

type StatusGroup = {
	status: string
	_count: { _all: number }
}

export type PublicTrackingSummary = {
	trackerCount: number
	ratingCount: number
	communityScore: number | null
}

const PUBLIC_TRACKING_SUMMARY_CHUNK_SIZE = 400

const emptyPublicTrackingSummary = (): PublicTrackingSummary => ({
	trackerCount: 0,
	ratingCount: 0,
	communityScore: null,
})

function finiteScore(value: unknown) {
	if (value === null || value === undefined) return null
	const score = Number(value)
	return Number.isFinite(score) ? score : null
}

export async function getPublicTrackingSummariesByMediaId(
	mediaIds: readonly string[],
) {
	const uniqueMediaIds = [...new Set(mediaIds)]
	const summaries = new Map<string, PublicTrackingSummary>(
		uniqueMediaIds.map(mediaId => [mediaId, emptyPublicTrackingSummary()]),
	)

	for (
		let offset = 0;
		offset < uniqueMediaIds.length;
		offset += PUBLIC_TRACKING_SUMMARY_CHUNK_SIZE
	) {
		const chunk = uniqueMediaIds.slice(
			offset,
			offset + PUBLIC_TRACKING_SUMMARY_CHUNK_SIZE,
		)
		const groups = await prisma.trackingState.groupBy({
			by: ['mediaId'],
			where: {
				mediaId: { in: chunk },
				AND: [publicTrackingStateWhere],
			},
			_count: { _all: true, score: true },
			_avg: { score: true },
		})

		for (const group of groups) {
			summaries.set(group.mediaId, {
				trackerCount: group._count._all,
				ratingCount: group._count.score,
				communityScore: finiteScore(group._avg.score),
			})
		}
	}

	return summaries
}

function titleCase(value: string) {
	return value
		.replace(/([a-z])([A-Z])/g, '$1 $2')
		.replace(/[-_]+/g, ' ')
		.replace(/\b\w/g, character => character.toUpperCase())
}

export function buildScoreDistribution(groups: ScoreGroup[]) {
	const counts = Array.from({ length: 10 }, () => 0)
	for (const group of groups) {
		const value = Number(group.score)
		if (!Number.isFinite(value) || value <= 0 || value > 10) continue
		const bucket = Math.max(1, Math.min(10, Math.round(value)))
		counts[bucket - 1] += Math.max(0, group._count._all)
	}
	const total = counts.reduce((sum, count) => sum + count, 0)
	return counts.map((count, index) => ({
		score: index + 1,
		count,
		percentage: total ? (count / total) * 100 : 0,
	}))
}

export function buildStatusBreakdown(groups: StatusGroup[]) {
	const counts = new Map<string, number>()
	for (const group of groups) {
		const status = group.status.trim() || 'tracked'
		counts.set(
			status,
			(counts.get(status) ?? 0) + Math.max(0, group._count._all),
		)
	}
	const total = [...counts.values()].reduce((sum, count) => sum + count, 0)
	return [...counts]
		.map(([status, count]) => ({
			status,
			label: titleCase(status),
			count,
			percentage: total ? (count / total) * 100 : 0,
		}))
		.sort(
			(left, right) =>
				right.count - left.count || left.label.localeCompare(right.label),
		)
}

export async function getMediaCommunityStatistics(mediaId: string) {
	const [summaries, scoreGroups, statusGroups] = await Promise.all([
		getPublicTrackingSummariesByMediaId([mediaId]),
		prisma.trackingState.groupBy({
			by: ['score'],
			where: {
				mediaId,
				score: { not: null },
				AND: [publicTrackingStateWhere],
			},
			_count: { _all: true },
		}),
		prisma.trackingState.groupBy({
			by: ['status'],
			where: { mediaId, AND: [publicTrackingStateWhere] },
			_count: { _all: true },
		}),
	])
	const summary = summaries.get(mediaId) ?? emptyPublicTrackingSummary()

	return {
		trackers: summary.trackerCount,
		ratings: summary.ratingCount,
		meanScore: summary.communityScore,
		scoreDistribution: buildScoreDistribution(scoreGroups),
		statusBreakdown: buildStatusBreakdown(statusGroups),
	}
}

export async function getFollowedMediaTracking(
	mediaId: string,
	viewerId: string,
) {
	const where = {
		mediaId,
		owner: { followers: { some: { followerId: viewerId } } },
		AND: [publicTrackingStateWhere],
	} satisfies Prisma.TrackingStateWhereInput
	const [summary, rows] = await Promise.all([
		prisma.trackingState.aggregate({
			where,
			_count: { id: true, score: true },
			_avg: { score: true },
		}),
		prisma.trackingState.findMany({
			where,
			orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
			take: 12,
			select: {
				id: true,
				status: true,
				score: true,
				updatedAt: true,
				statusWatchlist: { select: { header: true } },
				owner: {
					select: {
						id: true,
						username: true,
						image: { select: { id: true } },
					},
				},
			},
		}),
	])

	return {
		total: summary._count.id,
		ratings: summary._count.score,
		meanScore: summary._avg.score === null ? null : Number(summary._avg.score),
		items: rows.map(row => ({
			id: row.id,
			status: row.status,
			statusLabel:
				row.statusWatchlist?.header.trim() ||
				titleCase(row.status || 'tracked'),
			score: row.score === null ? null : Number(row.score),
			updatedAt: row.updatedAt,
			member: row.owner,
		})),
	}
}
