import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { getFollowingActivityFeed } from './activity-feed.server.ts'
import { prisma } from './db.server.ts'

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
	const [followed, unrelated] = await Promise.all([
		createUser('followed'),
		createUser('unrelated'),
	])
	const media = await prisma.media.create({
		data: { kind: 'anime', title: 'Feed Fixture' },
	})
	const [tracking, review, diary, collection] = await Promise.all([
		prisma.activityEvent.create({
			data: {
				type: 'progress',
				actorId: followed.id,
				mediaId: media.id,
				progressUnit: 'episode',
				progressPrevious: 2,
				progressCurrent: 4,
				progressTotal: 12,
				createdAt: new Date('2026-07-17T12:00:00.000Z'),
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

	const feed = await getFollowingActivityFeed([followed.id, followed.id])

	expect(feed.map(item => item.id)).toEqual([
		`collection:${collection.id}`,
		`review:${review.id}`,
		`diary:${diary.id}`,
		`tracking:${tracking.id}`,
	])
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
	expect(await getFollowingActivityFeed([followed.id], 2)).toHaveLength(2)
	expect(await getFollowingActivityFeed([])).toEqual([])
})
