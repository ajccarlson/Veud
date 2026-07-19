import { activityEventLabel, diaryActivityLabel } from './activity.ts'
import { prisma } from './db.server.ts'

export type FollowingActivityFeedItem = {
	id: string
	kind: 'tracking' | 'review' | 'diary'
	action: string
	time: Date | string
	actor: {
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
	}
	review: {
		body: string
		containsSpoilers: boolean
		rating: number | null
	} | null
	diary: {
		loggedOn: Date | string
		isRepeat: boolean
		rating: number | null
	} | null
}

function mediaItem(media: {
	id: string
	kind: string
	title: string | null
	thumbnail: string | null
}) {
	return {
		...media,
		title: media.title?.trim() || `Untitled ${media.kind}`,
	}
}

export async function getFollowingActivityFeed(
	actorIds: string[],
	limit = 60,
): Promise<FollowingActivityFeedItem[]> {
	const uniqueActorIds = [...new Set(actorIds)]
	if (!uniqueActorIds.length) return []
	const take = Math.min(Math.max(Math.trunc(limit), 1), 100)
	const actorSelect = {
		id: true,
		username: true,
		name: true,
		image: { select: { id: true } },
	} as const
	const mediaSelect = {
		id: true,
		kind: true,
		title: true,
		thumbnail: true,
	} as const

	const [trackingRows, reviewRows, diaryRows] = await Promise.all([
		prisma.activityEvent.findMany({
			where: { actorId: { in: uniqueActorIds } },
			orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
			take,
			select: {
				id: true,
				type: true,
				status: true,
				statusLabel: true,
				previousStatus: true,
				previousStatusLabel: true,
				score: true,
				previousScore: true,
				progressUnit: true,
				progressCurrent: true,
				progressPrevious: true,
				progressTotal: true,
				createdAt: true,
				actor: { select: actorSelect },
				media: { select: mediaSelect },
			},
		}),
		prisma.review.findMany({
			where: { authorId: { in: uniqueActorIds } },
			orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
			take,
			select: {
				id: true,
				body: true,
				containsSpoilers: true,
				rating: true,
				createdAt: true,
				author: { select: actorSelect },
				media: { select: mediaSelect },
			},
		}),
		prisma.diaryEntry.findMany({
			where: { ownerId: { in: uniqueActorIds } },
			orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
			take,
			select: {
				id: true,
				loggedOn: true,
				isRepeat: true,
				rating: true,
				createdAt: true,
				owner: { select: actorSelect },
				media: { select: mediaSelect },
			},
		}),
	])

	return [
		...trackingRows.map(row => ({
			id: `tracking:${row.id}`,
			kind: 'tracking' as const,
			action: activityEventLabel(row),
			time: row.createdAt,
			actor: row.actor,
			media: mediaItem(row.media),
			review: null,
			diary: null,
		})),
		...reviewRows.map(row => ({
			id: `review:${row.id}`,
			kind: 'review' as const,
			action: 'Published a review',
			time: row.createdAt,
			actor: row.author,
			media: mediaItem(row.media),
			review: {
				body: row.body,
				containsSpoilers: row.containsSpoilers,
				rating: row.rating === null ? null : Number(row.rating),
			},
			diary: null,
		})),
		...diaryRows.map(row => ({
			id: `diary:${row.id}`,
			kind: 'diary' as const,
			action: diaryActivityLabel(row.media.kind, row.isRepeat),
			time: row.createdAt,
			actor: row.owner,
			media: mediaItem(row.media),
			review: null,
			diary: {
				loggedOn: row.loggedOn,
				isRepeat: row.isRepeat,
				rating: row.rating === null ? null : Number(row.rating),
			},
		})),
	]
		.sort(
			(a, b) =>
				new Date(b.time).getTime() - new Date(a.time).getTime() ||
				b.id.localeCompare(a.id),
		)
		.slice(0, take)
}
