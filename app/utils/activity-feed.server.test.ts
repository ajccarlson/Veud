import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import {
	FOLLOWING_COLLECTION_EXCERPT_LENGTH,
	getFollowingActivityFeed,
} from './activity-feed.server.ts'
import { prisma } from './db.server.ts'
import { REVIEW_EXCERPT_LENGTH } from './review-excerpt.ts'

async function createUser(prefix: string) {
	const suffix = faker.string.alphanumeric({ length: 10 }).toLowerCase()
	return prisma.user.create({
		data: {
			email: `${prefix}_${suffix}@example.com`,
			username: `${prefix}_${suffix}`,
			name: `${prefix} member`,
		},
	})
}

test('following activity merges supported events in time order and scopes actors', async () => {
	const [viewer, followed, unrelated] = await Promise.all([
		createUser('viewer'),
		createUser('followed'),
		createUser('unrelated'),
	])
	await prisma.follow.create({
		data: { followerId: viewer.id, followingId: followed.id },
	})
	const media = await prisma.media.create({
		data: { kind: 'anime', title: 'Feed Fixture' },
	})
	const [
		tracking,
		privateTracking,
		unresolvedTracking,
		review,
		diary,
		collection,
	] = await Promise.all([
		prisma.activityEvent.create({
			data: {
				type: 'progress',
				actorId: followed.id,
				mediaId: media.id,
				progressUnit: 'episode',
				progressPrevious: 2,
				progressCurrent: 4,
				progressTotal: 12,
				publicEligible: true,
				createdAt: new Date('2026-07-17T12:00:00.000Z'),
			},
		}),
		prisma.activityEvent.create({
			data: {
				type: 'status',
				actorId: followed.id,
				mediaId: media.id,
				status: 'watching',
				statusLabel: 'Private queue',
				isPublic: false,
				createdAt: new Date('2026-07-20T18:00:00.000Z'),
			},
		}),
		prisma.activityEvent.create({
			data: {
				type: 'score',
				actorId: followed.id,
				mediaId: media.id,
				statusLabel: 'Unresolved private queue',
				score: 10,
				isPublic: true,
				createdAt: new Date('2026-07-20T19:00:00.000Z'),
			},
		}),
		prisma.review.create({
			data: {
				authorId: followed.id,
				mediaId: media.id,
				body: 'A spoiler-aware feed review.',
				containsSpoilers: true,
				rating: 9.2,
				createdAt: new Date('2026-07-19T12:00:00.000Z'),
			},
		}),
		prisma.diaryEntry.create({
			data: {
				ownerId: followed.id,
				mediaId: media.id,
				loggedOn: new Date('2026-07-18T00:00:00.000Z'),
				isRepeat: true,
				rating: 8.5,
				createdAt: new Date('2026-07-18T12:00:00.000Z'),
			},
		}),
		prisma.mediaCollection.create({
			data: {
				ownerId: followed.id,
				title: 'Feed Collection',
				description: 'A collection shared with followers.',
				isPublic: true,
				createdAt: new Date('2026-07-20T12:00:00.000Z'),
				items: { create: { mediaId: media.id, position: 1 } },
			},
		}),
	])
	await prisma.mediaCollection.create({
		data: {
			ownerId: followed.id,
			title: 'Private Feed Collection',
			isPublic: false,
			createdAt: new Date('2026-07-21T12:00:00.000Z'),
		},
	})
	await prisma.review.create({
		data: {
			authorId: unrelated.id,
			mediaId: media.id,
			body: 'This should never enter the feed.',
			createdAt: new Date('2026-07-20T12:00:00.000Z'),
		},
	})

	const feed = await getFollowingActivityFeed(viewer.id)

	expect(feed.map(item => item.id)).toEqual([
		`collection:${collection.id}`,
		`review:${review.id}`,
		`diary:${diary.id}`,
		`tracking:${tracking.id}`,
	])
	expect(feed.map(item => item.id)).not.toContain(
		`tracking:${privateTracking.id}`,
	)
	expect(feed.map(item => item.id)).not.toContain(
		`tracking:${unresolvedTracking.id}`,
	)
	expect(feed.every(item => item.actor.id === followed.id)).toBe(true)
	expect(feed).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				kind: 'tracking',
				action: 'Watched episodes 3–4',
			}),
			expect.objectContaining({
				kind: 'review',
				action: 'Published a review',
				review: {
					body: 'A spoiler-aware feed review.',
					containsSpoilers: true,
					rating: 9.2,
				},
			}),
			expect.objectContaining({
				kind: 'diary',
				action: 'Logged a rewatch',
				diary: expect.objectContaining({ isRepeat: true, rating: 8.5 }),
			}),
			expect.objectContaining({
				kind: 'collection',
				action: 'Published a collection',
				media: null,
				collection: expect.objectContaining({
					id: collection.id,
					title: 'Feed Collection',
					itemCount: 1,
				}),
			}),
		]),
	)
	expect(await getFollowingActivityFeed(viewer.id, 2)).toHaveLength(2)
	expect(await getFollowingActivityFeed('')).toEqual([])
})

test('following activity enforces safety relations and bounds authored text', async () => {
	const [viewer, visible, muted, blocker] = await Promise.all([
		createUser('bounded_viewer'),
		createUser('bounded_visible'),
		createUser('bounded_muted'),
		createUser('bounded_blocker'),
	])
	const media = await prisma.media.create({
		data: { kind: 'movie', title: 'Bounded social payload' },
	})
	await prisma.follow.createMany({
		data: [visible, muted, blocker].map(member => ({
			followerId: viewer.id,
			followingId: member.id,
		})),
	})
	await prisma.userSafetyControl.createMany({
		data: [
			{ ownerId: viewer.id, targetId: muted.id, kind: 'mute' },
			{ ownerId: blocker.id, targetId: viewer.id, kind: 'block' },
		],
	})
	const longReview = 'A deliberately long followed review. '.repeat(40)
	const longDescription = 'A deliberately long collection description. '.repeat(
		30,
	)
	const [
		visibleReview,
		visibleCollection,
		nullDescriptionCollection,
		mutedReview,
		blockerReview,
	] = await Promise.all([
		prisma.review.create({
			data: { authorId: visible.id, mediaId: media.id, body: longReview },
		}),
		prisma.mediaCollection.create({
			data: {
				ownerId: visible.id,
				title: 'Bounded collection',
				description: longDescription,
				isPublic: true,
			},
		}),
		prisma.mediaCollection.create({
			data: {
				ownerId: visible.id,
				title: 'Collection without a description',
				isPublic: true,
			},
		}),
		prisma.review.create({
			data: {
				authorId: muted.id,
				mediaId: media.id,
				body: 'Muted review',
			},
		}),
		prisma.review.create({
			data: {
				authorId: blocker.id,
				mediaId: media.id,
				body: 'Blocking review',
			},
		}),
	])

	const feed = await getFollowingActivityFeed(viewer.id)
	const ids = feed.map(item => item.id)
	expect(ids).toContain(`review:${visibleReview.id}`)
	expect(ids).toContain(`collection:${visibleCollection.id}`)
	expect(ids).not.toContain(`review:${mutedReview.id}`)
	expect(ids).not.toContain(`review:${blockerReview.id}`)

	const reviewItem = feed.find(item => item.id === `review:${visibleReview.id}`)
	expect(reviewItem?.review?.body.length).toBeLessThanOrEqual(
		REVIEW_EXCERPT_LENGTH + 1,
	)
	expect(reviewItem?.review?.body.endsWith('…')).toBe(true)
	expect(reviewItem?.actor).not.toHaveProperty('name')

	const collectionItem = feed.find(
		item => item.id === `collection:${visibleCollection.id}`,
	)
	expect(collectionItem?.collection?.description?.length).toBeLessThanOrEqual(
		FOLLOWING_COLLECTION_EXCERPT_LENGTH + 1,
	)
	expect(collectionItem?.collection?.description?.endsWith('…')).toBe(true)

	const nullDescriptionItem = feed.find(
		item => item.id === `collection:${nullDescriptionCollection.id}`,
	)
	expect(nullDescriptionItem?.collection?.description).toBeNull()
})
