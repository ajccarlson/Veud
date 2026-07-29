import { faker } from '@faker-js/faker'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
	ANONYMOUS_HOME_SUMMARY_TTL_MS,
	getAnonymousHomeProof,
	getAnonymousHomeSummary,
} from './anonymous-home.server.ts'
import { prisma } from './db.server.ts'
import { createPublicSurfaceCacheRuntimeForTest } from './public-surface-cache.server.ts'

afterEach(() => {
	vi.useRealTimers()
	vi.restoreAllMocks()
})

async function createUser(
	prefix: string,
	{ accountStatus = 'active' }: { accountStatus?: string } = {},
) {
	const suffix = faker.string.alphanumeric({ length: 10 }).toLowerCase()
	return prisma.user.create({
		data: {
			email: `${prefix}_${suffix}@example.com`,
			username: `${prefix}_${suffix}`,
			accountStatus,
		},
	})
}

describe('anonymous home summary cache', () => {
	test('uses a bounded public aggregate cache while activity remains fresh', async () => {
		const runtime = createPublicSurfaceCacheRuntimeForTest()
		const mediaCount = vi.spyOn(prisma.media, 'count')
		const mediaGroupBy = vi.spyOn(prisma.media, 'groupBy')
		const reviewCount = vi.spyOn(prisma.review, 'count')
		const collectionCount = vi.spyOn(prisma.mediaCollection, 'count')
		const activityFindMany = vi.spyOn(prisma.activityEvent, 'findMany')
		const reviewFindMany = vi.spyOn(prisma.review, 'findMany')
		const collectionFindMany = vi.spyOn(prisma.mediaCollection, 'findMany')

		const first = await getAnonymousHomeProof({ cacheRuntime: runtime })
		const author = await createUser('anonymous_cache')
		const media = await prisma.media.create({
			data: { kind: 'movie', title: 'Fresh anonymous activity' },
		})
		const review = await prisma.review.create({
			data: {
				authorId: author.id,
				mediaId: media.id,
				body: 'This review should appear without refreshing the summary.',
			},
		})
		const second = await getAnonymousHomeProof({ cacheRuntime: runtime })

		expect(first).toMatchObject({
			catalogTotal: 0,
			reviewTotal: 0,
			publicCollectionTotal: 0,
			kinds: [],
			activity: [],
		})
		expect(second).toMatchObject({
			catalogTotal: 0,
			reviewTotal: 0,
			publicCollectionTotal: 0,
			kinds: [],
		})
		expect(second.activity.map(item => item.id)).toContain(
			`review:${review.id}`,
		)

		expect(mediaCount).toHaveBeenCalledOnce()
		expect(mediaGroupBy).toHaveBeenCalledOnce()
		expect(reviewCount).toHaveBeenCalledOnce()
		expect(collectionCount).toHaveBeenCalledOnce()
		expect(activityFindMany).toHaveBeenCalledTimes(2)
		expect(reviewFindMany).toHaveBeenCalledTimes(2)
		expect(collectionFindMany).toHaveBeenCalledTimes(2)
	})

	test('expires aggregate values at the TTL and returns detached frozen data', async () => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2026-07-29T12:00:00.000Z'))
		const runtime = createPublicSurfaceCacheRuntimeForTest()

		const initial = await getAnonymousHomeSummary({ runtime })
		await prisma.media.create({
			data: { kind: 'anime', title: 'New catalog title' },
		})
		const warm = await getAnonymousHomeSummary({ runtime })

		expect(initial).toEqual({
			catalogTotal: 0,
			reviewTotal: 0,
			publicCollectionTotal: 0,
			kinds: [],
		})
		expect(warm).toEqual(initial)
		expect(warm).not.toBe(initial)
		expect(Object.isFrozen(warm)).toBe(true)
		expect(Object.isFrozen(warm.kinds)).toBe(true)

		vi.advanceTimersByTime(ANONYMOUS_HOME_SUMMARY_TTL_MS + 1)
		const refreshed = await getAnonymousHomeSummary({ runtime })
		expect(refreshed).toMatchObject({
			catalogTotal: 1,
			kinds: [{ kind: 'anime', count: 1 }],
		})
	})

	test('keeps identities out of the cached summary and applies moderation immediately', async () => {
		const [active, suspended] = await Promise.all([
			createUser('anonymous_visible'),
			createUser('anonymous_suspended', { accountStatus: 'suspended' }),
		])
		const [visibleMedia, unclassifiedMedia] = await Promise.all([
			prisma.media.create({
				data: { kind: 'manga', title: 'Visible proof title' },
			}),
			prisma.media.create({
				data: { kind: 'podcast', title: 'Unclassified catalog title' },
			}),
		])
		const [visibleReview] = await Promise.all([
			prisma.review.create({
				data: {
					authorId: active.id,
					mediaId: visibleMedia.id,
					body: 'A visible review.',
				},
			}),
			prisma.review.create({
				data: {
					authorId: suspended.id,
					mediaId: unclassifiedMedia.id,
					body: 'A review from a suspended member.',
				},
			}),
			prisma.mediaCollection.create({
				data: {
					ownerId: active.id,
					title: 'Visible collection',
				},
			}),
			prisma.mediaCollection.create({
				data: {
					ownerId: active.id,
					title: 'Private collection',
					isPublic: false,
				},
			}),
			prisma.mediaCollection.create({
				data: {
					ownerId: suspended.id,
					title: 'Suspended collection',
				},
			}),
		])
		const runtime = createPublicSurfaceCacheRuntimeForTest()

		const first = await getAnonymousHomeProof({ cacheRuntime: runtime })
		const serializedSummary = JSON.stringify({
			catalogTotal: first.catalogTotal,
			reviewTotal: first.reviewTotal,
			publicCollectionTotal: first.publicCollectionTotal,
			kinds: first.kinds,
		})
		expect(first).toMatchObject({
			catalogTotal: 2,
			reviewTotal: 1,
			publicCollectionTotal: 1,
			kinds: [{ kind: 'manga', count: 1 }],
		})
		expect(first.activity.map(item => item.id)).toContain(
			`review:${visibleReview.id}`,
		)
		expect(serializedSummary).not.toContain(active.username)
		expect(serializedSummary).not.toContain(visibleMedia.title)

		await prisma.user.update({
			where: { id: active.id },
			data: { accountStatus: 'suspended' },
		})
		const second = await getAnonymousHomeProof({ cacheRuntime: runtime })

		// Aggregate counts intentionally use the short TTL as their consistency
		// boundary, while identity-bearing activity is always re-evaluated.
		expect(second.reviewTotal).toBe(1)
		expect(second.publicCollectionTotal).toBe(1)
		expect(second.activity.map(item => item.id)).not.toContain(
			`review:${visibleReview.id}`,
		)
	})

	test('bypasses public caches by default in the unit-test runtime', async () => {
		const mediaCount = vi.spyOn(prisma.media, 'count')

		await getAnonymousHomeSummary()
		await getAnonymousHomeSummary()

		expect(mediaCount).toHaveBeenCalledTimes(2)
	})
})
