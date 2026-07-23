import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { prisma } from './db.server.ts'
import { getRecommendationGraph } from './recommendation-graph.server.ts'

async function createUser(prefix: string) {
	const suffix = faker.string.alphanumeric({ length: 10 }).toLowerCase()
	return prisma.user.create({
		data: {
			email: `${prefix}_${suffix}@example.com`,
			username: `${prefix}_${suffix}`,
			name: prefix,
		},
	})
}

test('recommendation graph separates canonical, social, collection, and taste evidence', async () => {
	const suffix = faker.string.alphanumeric({ length: 10 }).toLowerCase()
	const genre = `GraphGenre${suffix}`
	const [viewer, followed, collectionOwner] = await Promise.all([
		createUser('Graph viewer'),
		createUser('Graph critic'),
		createUser('Graph curator'),
	])
	await prisma.follow.create({
		data: { followerId: viewer.id, followingId: followed.id },
	})
	const listType = await prisma.listType.create({
		data: {
			name: `graph-${suffix}`,
			header: 'Graph',
			columns: '{}',
			mediaType: '["movie"]',
			completionType: '{}',
		},
	})
	const privateList = await prisma.watchlist.create({
		data: {
			ownerId: followed.id,
			typeId: listType.id,
			name: 'private',
			header: 'Private',
			isPublic: false,
		},
	})
	const [
		seed,
		connected,
		circle,
		collectionMatch,
		taste,
		privateMatch,
		hidden,
	] = await Promise.all(
		[
			['Graph Seed', genre],
			['Graph Connected', null],
			['Graph Circle', null],
			['Graph Collection', null],
			['Graph Taste', genre],
			['Graph Private', null],
			['Graph Hidden', genre],
		].map(([title, genres]) =>
			prisma.media.create({
				data: {
					kind: 'movie',
					title: `${title} ${suffix}`,
					genres,
					catalogPopularity: title === 'Graph Taste' ? 50 : 10,
				},
			}),
		),
	)
	await Promise.all([
		prisma.trackingState.create({
			data: {
				ownerId: viewer.id,
				mediaId: seed.id,
				status: 'completed',
				score: 9,
				repeatCount: 2,
			},
		}),
		prisma.trackingState.create({
			data: {
				ownerId: followed.id,
				mediaId: circle.id,
				status: 'completed',
				score: 9,
			},
		}),
		prisma.trackingState.create({
			data: {
				ownerId: followed.id,
				mediaId: privateMatch.id,
				status: 'completed',
				statusWatchlistId: privateList.id,
				score: 10,
			},
		}),
		prisma.mediaRelation.create({
			data: {
				sourceMediaId: seed.id,
				targetMediaId: connected.id,
				relationType: 'sequel',
				provider: 'tmdb',
			},
		}),
		prisma.review.create({
			data: {
				authorId: followed.id,
				mediaId: circle.id,
				body: 'A public recommendation signal.',
				rating: 9,
			},
		}),
		prisma.recommendationFeedback.create({
			data: {
				ownerId: viewer.id,
				mediaId: hidden.id,
				feedbackType: 'not_interested',
				sourceLane: 'taste',
			},
		}),
	])
	const collection = await prisma.mediaCollection.create({
		data: {
			ownerId: collectionOwner.id,
			title: `Graph collection ${suffix}`,
			isPublic: true,
			items: { create: { mediaId: collectionMatch.id, position: 1 } },
		},
	})
	await prisma.collectionLike.create({
		data: { userId: viewer.id, collectionId: collection.id },
	})

	const graph = await getRecommendationGraph(viewer.id)
	const byKey = new Map(graph.lanes.map(lane => [lane.key, lane]))

	expect(byKey.get('connected')?.items.map(item => item.id)).toContain(
		connected.id,
	)
	expect(byKey.get('circle')?.items.map(item => item.id)).toContain(circle.id)
	expect(byKey.get('collections')?.items.map(item => item.id)).toContain(
		collectionMatch.id,
	)
	expect(byKey.get('taste')?.items.map(item => item.id)).toContain(taste.id)
	expect(
		graph.lanes.flatMap(lane => lane.items).map(item => item.id),
	).not.toContain(privateMatch.id)
	expect(
		graph.lanes.flatMap(lane => lane.items).map(item => item.id),
	).not.toContain(hidden.id)
	expect(
		byKey.get('connected')?.items.find(item => item.id === connected.id)
			?.reasons[0],
	).toContain('Graph Seed')
	expect(
		byKey.get('circle')?.items.find(item => item.id === circle.id)?.reasons,
	).toEqual(expect.arrayContaining([expect.stringContaining('Graph critic')]))
	expect(
		byKey.get('collections')?.items.find(item => item.id === collectionMatch.id)
			?.reasons[0],
	).toContain('collection you liked')
	expect(graph.summary).toEqual(
		expect.objectContaining({
			followingCount: 1,
			hiddenCount: 1,
			preferredGenres: [genre],
		}),
	)
	expect(graph.hiddenItems).toEqual([
		expect.objectContaining({ id: hidden.id, feedbackType: 'not_interested' }),
	])
})

test('show-less feedback subtracts genre affinity without affecting public data', async () => {
	const suffix = faker.string.alphanumeric({ length: 10 }).toLowerCase()
	const genre = `MutedGenre${suffix}`
	const viewer = await createUser('Muted viewer')
	const [seed, feedbackMedia, candidate] = await Promise.all([
		prisma.media.create({
			data: { kind: 'anime', title: `Muted Seed ${suffix}`, genres: genre },
		}),
		prisma.media.create({
			data: {
				kind: 'anime',
				title: `Muted Feedback ${suffix}`,
				genres: genre,
			},
		}),
		prisma.media.create({
			data: {
				kind: 'anime',
				title: `Muted Candidate ${suffix}`,
				genres: genre,
			},
		}),
	])
	await prisma.trackingState.create({
		data: {
			ownerId: viewer.id,
			mediaId: seed.id,
			status: 'planning',
			score: 7,
		},
	})
	const beforeFeedback = await getRecommendationGraph(viewer.id)
	expect(beforeFeedback.summary.preferredGenres).toEqual([genre])
	expect(
		beforeFeedback.lanes.flatMap(lane => lane.items).map(item => item.id),
	).toContain(candidate.id)

	await prisma.recommendationFeedback.create({
		data: {
			ownerId: viewer.id,
			mediaId: feedbackMedia.id,
			feedbackType: 'show_less',
			sourceLane: 'taste',
		},
	})

	const graph = await getRecommendationGraph(viewer.id)
	expect(graph.summary.preferredGenres).toEqual([])
	expect(
		graph.lanes.flatMap(lane => lane.items).map(item => item.id),
	).not.toContain(candidate.id)
	expect(
		await prisma.trackingState.count({ where: { mediaId: seed.id } }),
	).toBe(1)
})
