import { activityEventLabel } from './activity.ts'
import { prisma } from './db.server.ts'

export type AnonymousHomeActivity = {
	id: string
	kind: 'tracking' | 'review' | 'collection'
	action: string
	createdAt: Date | string
	username: string
	target: {
		id: string
		title: string
		thumbnail: string | null
		type: 'media' | 'collection'
	}
}

export type AnonymousHomeProof = {
	catalogTotal: number
	reviewTotal: number
	publicCollectionTotal: number
	kinds: Array<{ kind: string; count: number }>
	activity: AnonymousHomeActivity[]
}

export async function getAnonymousHomeProof(): Promise<AnonymousHomeProof> {
	const [
		catalogTotal,
		reviewTotal,
		publicCollectionTotal,
		kinds,
		trackingRows,
		reviewRows,
		collectionRows,
	] = await Promise.all([
		prisma.media.count(),
		prisma.review.count({
			where: {
				moderationStatus: 'visible',
				author: { is: { accountStatus: 'active' } },
			},
		}),
		prisma.mediaCollection.count({
			where: {
				isPublic: true,
				moderationStatus: 'visible',
				owner: { is: { accountStatus: 'active' } },
			},
		}),
		prisma.media.groupBy({
			by: ['kind'],
			_count: { _all: true },
			orderBy: { kind: 'asc' },
		}),
		prisma.activityEvent.findMany({
			where: {
				isPublic: true,
				actor: { is: { accountStatus: 'active' } },
			},
			orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
			take: 8,
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
				actor: { select: { username: true } },
				media: {
					select: { id: true, kind: true, title: true, thumbnail: true },
				},
			},
		}),
		prisma.review.findMany({
			where: {
				moderationStatus: 'visible',
				author: { is: { accountStatus: 'active' } },
			},
			orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
			take: 8,
			select: {
				id: true,
				createdAt: true,
				author: { select: { username: true } },
				media: { select: { id: true, title: true, thumbnail: true } },
			},
		}),
		prisma.mediaCollection.findMany({
			where: {
				isPublic: true,
				moderationStatus: 'visible',
				owner: { is: { accountStatus: 'active' } },
			},
			orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
			take: 8,
			select: {
				id: true,
				title: true,
				createdAt: true,
				owner: { select: { username: true } },
				items: {
					orderBy: [{ position: 'asc' }, { id: 'asc' }],
					take: 1,
					select: { media: { select: { thumbnail: true } } },
				},
			},
		}),
	])

	const activity: AnonymousHomeActivity[] = [
		...trackingRows.map(row => ({
			id: `tracking:${row.id}`,
			kind: 'tracking' as const,
			action: activityEventLabel(row),
			createdAt: row.createdAt,
			username: row.actor.username,
			target: {
				id: row.media.id,
				title: row.media.title?.trim() || `Untitled ${row.media.kind}`,
				thumbnail: row.media.thumbnail,
				type: 'media' as const,
			},
		})),
		...reviewRows.map(row => ({
			id: `review:${row.id}`,
			kind: 'review' as const,
			action: 'Published a review',
			createdAt: row.createdAt,
			username: row.author.username,
			target: {
				id: row.media.id,
				title: row.media.title?.trim() || 'Untitled media',
				thumbnail: row.media.thumbnail,
				type: 'media' as const,
			},
		})),
		...collectionRows.map(row => ({
			id: `collection:${row.id}`,
			kind: 'collection' as const,
			action: 'Published a collection',
			createdAt: row.createdAt,
			username: row.owner.username,
			target: {
				id: row.id,
				title: row.title,
				thumbnail: row.items[0]?.media.thumbnail ?? null,
				type: 'collection' as const,
			},
		})),
	]
		.sort(
			(first, second) =>
				new Date(second.createdAt).getTime() -
					new Date(first.createdAt).getTime() ||
				second.id.localeCompare(first.id),
		)
		.slice(0, 5)

	return {
		catalogTotal,
		reviewTotal,
		publicCollectionTotal,
		kinds: kinds.map(row => ({
			kind: row.kind,
			count: row._count._all,
		})),
		activity,
	}
}
