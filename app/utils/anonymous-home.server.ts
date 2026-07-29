import { z } from 'zod'
import { activityEventLabel } from './activity.ts'
import { prisma } from './db.server.ts'
import { publicActivityEventWhere } from './lists/visibility.ts'
import {
	getPublicSurfaceFragment,
	type PublicSurfaceCacheRuntime,
} from './public-surface-cache.server.ts'

export const ANONYMOUS_HOME_SUMMARY_TTL_MS = 5 * 60 * 1_000
const ANONYMOUS_HOME_SUMMARY_KEY_VERSION = 1
const anonymousHomeKinds = ['anime', 'manga', 'movie', 'tv'] as const

const safeCountSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const anonymousHomeSummarySchema = z
	.object({
		catalogTotal: safeCountSchema,
		reviewTotal: safeCountSchema,
		publicCollectionTotal: safeCountSchema,
		kinds: z
			.array(
				z
					.object({
						kind: z.enum(anonymousHomeKinds),
						count: safeCountSchema,
					})
					.strict(),
			)
			.max(anonymousHomeKinds.length),
	})
	.strict()
	.superRefine((summary, context) => {
		const kinds = summary.kinds.map(item => item.kind)
		const expected = [...new Set(kinds)].sort((left, right) =>
			left.localeCompare(right, 'en-US'),
		)
		if (
			expected.length !== kinds.length ||
			expected.some((kind, index) => kind !== kinds[index])
		) {
			context.addIssue({
				code: 'custom',
				message: 'Anonymous home kinds must be unique and sorted.',
			})
		}
	})

export type AnonymousHomeSummary = z.infer<typeof anonymousHomeSummarySchema>

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

export type AnonymousHomeProof = AnonymousHomeSummary & {
	activity: AnonymousHomeActivity[]
}

function parseAnonymousHomeSummary(value: unknown) {
	return anonymousHomeSummarySchema.parse(value)
}

async function loadAnonymousHomeSummary(): Promise<AnonymousHomeSummary> {
	const [catalogTotal, reviewTotal, publicCollectionTotal, kinds] =
		await Promise.all([
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
				where: { kind: { in: [...anonymousHomeKinds] } },
				_count: { _all: true },
				orderBy: { kind: 'asc' },
			}),
		])

	return parseAnonymousHomeSummary({
		catalogTotal,
		reviewTotal,
		publicCollectionTotal,
		kinds: kinds.map(row => ({
			kind: row.kind,
			count: row._count._all,
		})),
	})
}

export function getAnonymousHomeSummary({
	runtime,
}: {
	runtime?: PublicSurfaceCacheRuntime
} = {}) {
	return getPublicSurfaceFragment({
		namespace: 'anonymous-home-summary',
		keyVersion: ANONYMOUS_HOME_SUMMARY_KEY_VERSION,
		keyPayload: { fragment: 'aggregate-summary' },
		ttl: ANONYMOUS_HOME_SUMMARY_TTL_MS,
		parse: parseAnonymousHomeSummary,
		getFreshValue: loadAnonymousHomeSummary,
		runtime,
	})
}

export async function getAnonymousHomeProof({
	cacheRuntime,
}: {
	cacheRuntime?: PublicSurfaceCacheRuntime
} = {}): Promise<AnonymousHomeProof> {
	const [summary, trackingRows, reviewRows, collectionRows] = await Promise.all(
		[
			getAnonymousHomeSummary({ runtime: cacheRuntime }),
			prisma.activityEvent.findMany({
				where: {
					actor: { is: { accountStatus: 'active' } },
					AND: [publicActivityEventWhere],
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
		],
	)

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
		...summary,
		activity,
	}
}
