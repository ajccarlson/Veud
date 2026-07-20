import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { prisma } from './db.server.ts'
import {
	buildScoreDistribution,
	buildStatusBreakdown,
	getFollowedMediaTracking,
	getMediaCommunityStatistics,
} from './media-community.server.ts'

test('score distribution rounds decimal ratings into bounded ten-point buckets', () => {
	const distribution = buildScoreDistribution([
		{ score: 8.4, _count: { _all: 1 } },
		{ score: 8.5, _count: { _all: 2 } },
		{ score: 10, _count: { _all: 1 } },
		{ score: null, _count: { _all: 5 } },
		{ score: 11, _count: { _all: 5 } },
	])

	expect(distribution).toHaveLength(10)
	expect(distribution.find(bucket => bucket.score === 8)).toEqual({
		score: 8,
		count: 1,
		percentage: 25,
	})
	expect(distribution.find(bucket => bucket.score === 9)).toEqual({
		score: 9,
		count: 2,
		percentage: 50,
	})
	expect(distribution.find(bucket => bucket.score === 10)).toEqual({
		score: 10,
		count: 1,
		percentage: 25,
	})
})

test('status breakdown stays data-driven and ranks the largest groups first', () => {
	const breakdown = buildStatusBreakdown([
		{ status: 'plan-to-watch', _count: { _all: 2 } },
		{ status: 'watching', _count: { _all: 3 } },
		{ status: 'on_hold', _count: { _all: 1 } },
	])
	expect(breakdown.map(({ percentage: _, ...status }) => status)).toEqual([
		{ status: 'watching', label: 'Watching', count: 3 },
		{ status: 'plan-to-watch', label: 'Plan To Watch', count: 2 },
		{ status: 'on_hold', label: 'On Hold', count: 1 },
	])
	expect(breakdown[0]?.percentage).toBe(50)
	expect(breakdown[1]?.percentage).toBeCloseTo(100 / 3)
	expect(breakdown[2]?.percentage).toBeCloseTo(100 / 6)
})

test('community and following statistics exclude private-list tracking', async () => {
	const suffix = faker.string.alphanumeric({ length: 10 }).toLowerCase()
	const [viewer, publicMember, privateMember] = await Promise.all([
		prisma.user.create({
			data: {
				email: `viewer_${suffix}@example.com`,
				username: `viewer_${suffix}`,
			},
		}),
		prisma.user.create({
			data: {
				email: `public_${suffix}@example.com`,
				username: `public_${suffix}`,
			},
		}),
		prisma.user.create({
			data: {
				email: `private_${suffix}@example.com`,
				username: `private_${suffix}`,
			},
		}),
	])
	const listType = await prisma.listType.create({
		data: {
			name: `community-${suffix}`,
			header: 'Community privacy',
			columns: '{}',
			mediaType: '[]',
			completionType: '{}',
		},
	})
	const [publicList, privateList, media] = await Promise.all([
		prisma.watchlist.create({
			data: {
				ownerId: publicMember.id,
				typeId: listType.id,
				name: 'public',
				header: 'Public',
				isPublic: true,
			},
		}),
		prisma.watchlist.create({
			data: {
				ownerId: privateMember.id,
				typeId: listType.id,
				name: 'private',
				header: 'Private',
				isPublic: false,
			},
		}),
		prisma.media.create({
			data: { kind: 'movie', title: 'Community privacy title' },
		}),
	])
	await Promise.all([
		prisma.trackingState.create({
			data: {
				ownerId: publicMember.id,
				mediaId: media.id,
				status: 'completed',
				statusWatchlistId: publicList.id,
				score: 8,
			},
		}),
		prisma.trackingState.create({
			data: {
				ownerId: privateMember.id,
				mediaId: media.id,
				status: 'completed',
				statusWatchlistId: privateList.id,
				score: 10,
			},
		}),
		prisma.follow.create({
			data: { followerId: viewer.id, followingId: publicMember.id },
		}),
		prisma.follow.create({
			data: { followerId: viewer.id, followingId: privateMember.id },
		}),
	])

	const community = await getMediaCommunityStatistics(media.id)
	expect(community.trackers).toBe(1)
	expect(community.ratings).toBe(1)
	expect(community.meanScore).toBe(8)
	expect(community.statusBreakdown).toEqual([
		expect.objectContaining({ status: 'completed', count: 1 }),
	])
	const followed = await getFollowedMediaTracking(media.id, viewer.id)
	expect(followed.total).toBe(1)
	expect(followed.items.map(item => item.member.id)).toEqual([publicMember.id])
})
