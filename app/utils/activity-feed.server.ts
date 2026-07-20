import { activityEventLabel, diaryActivityLabel } from './activity.ts'
import { prisma } from './db.server.ts'

export type FollowingActivityFeedItem = {
	id: string
	kind: 'tracking' | 'review' | 'diary' | 'collection'
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
	} | null
	collection: {
		id: string
		title: string
		description: string | null
		itemCount: number
		items: Array<{
			media: { id: string; title: string | null; thumbnail: string | null }
		}>
	} | null
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

	const [trackingRows, reviewRows, diaryRows, collectionRows] =
		await Promise.all([
			prisma.activityEvent.findMany({
				where: { actorId: { in: uniqueActorIds }, isPublic: true },
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
			prisma.mediaCollection.findMany({
				where: { ownerId: { in: uniqueActorIds }, isPublic: true },
				orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
				take,
				select: {
					id: true,
					title: true,
					description: true,
					createdAt: true,
					owner: { select: actorSelect },
					_count: { select: { items: true } },
					items: {
						orderBy: [{ position: 'asc' }, { id: 'asc' }],
						take: 4,
						select: {
							media: { select: { id: true, title: true, thumbnail: true } },
						},
					},
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
			collection: null,
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
			collection: null,
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
			collection: null,
			review: null,
			diary: {
				loggedOn: row.loggedOn,
				isRepeat: row.isRepeat,
				rating: row.rating === null ? null : Number(row.rating),
			},
		})),
		...collectionRows.map(row => ({
			id: `collection:${row.id}`,
			kind: 'collection' as const,
			action: 'Published a collection',
			time: row.createdAt,
			actor: row.owner,
			media: null,
			collection: {
				id: row.id,
				title: row.title,
				description: row.description,
				itemCount: row._count.items,
				items: row.items,
			},
			review: null,
			diary: null,
		})),
	]
		.sort(
			(a, b) =>
				new Date(b.time).getTime() - new Date(a.time).getTime() ||
				b.id.localeCompare(a.id),
		)
		.slice(0, take)
}
