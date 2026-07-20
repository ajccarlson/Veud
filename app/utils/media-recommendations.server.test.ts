import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { prisma } from './db.server.ts'
import { getSimilarMediaRecommendations } from './media-recommendations.server.ts'

async function createUser(prefix: string) {
	const suffix = faker.string.alphanumeric({ length: 10 }).toLowerCase()
	return prisma.user.create({
		data: {
			email: `${prefix}_${suffix}@example.com`,
			username: `${prefix}_${suffix}`,
		},
	})
}

test('similar titles prioritize exact genre overlap and exclude tracked works', async () => {
	const [viewer, firstMember, secondMember, thirdMember] = await Promise.all([
		createUser('recommendation_viewer'),
		createUser('recommendation_first'),
		createUser('recommendation_second'),
		createUser('recommendation_third'),
	])
	const [source, focusedMatch, broadMatch, popularWeakMatch, wrongKind] =
		await Promise.all([
			prisma.media.create({
				data: {
					kind: 'anime',
					title: 'Recommendation Source',
					genres: 'Action, Fantasy',
				},
			}),
			prisma.media.create({
				data: {
					kind: 'anime',
					title: 'Focused Match',
					genres: 'action, Fantasy',
				},
			}),
			prisma.media.create({
				data: {
					kind: 'anime',
					title: 'Broad Match',
					genres: 'Action, Fantasy, Adventure',
				},
			}),
			prisma.media.create({
				data: {
					kind: 'anime',
					title: 'Popular Weak Match',
					genres: 'Action',
				},
			}),
			prisma.media.create({
				data: {
					kind: 'movie',
					title: 'Wrong Kind Match',
					genres: 'Action, Fantasy',
				},
			}),
		])
	await prisma.trackingState.createMany({
		data: [
			{
				ownerId: viewer.id,
				mediaId: focusedMatch.id,
				status: 'completed',
				score: 9,
			},
			{
				ownerId: firstMember.id,
				mediaId: popularWeakMatch.id,
				status: 'completed',
				score: 8,
			},
			{
				ownerId: secondMember.id,
				mediaId: popularWeakMatch.id,
				status: 'completed',
				score: 9,
			},
			{
				ownerId: thirdMember.id,
				mediaId: popularWeakMatch.id,
				status: 'completed',
				score: 10,
			},
		],
	})
	const animeType = await prisma.listType.upsert({
		where: { name: 'anime' },
		update: {},
		create: {
			name: 'anime',
			header: 'Anime',
			columns: '{}',
			mediaType: '[]',
			completionType: '{}',
		},
	})
	await prisma.userFavorite.create({
		data: {
			ownerId: viewer.id,
			mediaId: broadMatch.id,
			typeId: animeType.id,
			position: 1,
			title: broadMatch.title ?? 'Broad Match',
		},
	})

	const anonymous = await getSimilarMediaRecommendations(source, null)
	expect(anonymous.items.map(item => item.title)).toEqual([
		'Focused Match',
		'Broad Match',
		'Popular Weak Match',
	])
	expect(anonymous.items.map(item => item.id)).toEqual([
		focusedMatch.id,
		broadMatch.id,
		popularWeakMatch.id,
	])
	expect(anonymous.items[0]?.matchedGenres).toEqual(['Action', 'Fantasy'])
	expect(anonymous.items.some(item => item.id === source.id)).toBe(false)
	expect(anonymous.items.some(item => item.id === wrongKind.id)).toBe(false)

	const personalized = await getSimilarMediaRecommendations(source, viewer.id)
	expect(personalized.items.map(item => item.title)).toEqual([
		'Popular Weak Match',
	])
})

test('titles without genres fall back to same-kind community popularity', async () => {
	const member = await createUser('fallback_member')
	const [source, popular, quiet] = await Promise.all([
		prisma.media.create({
			data: { kind: 'movie', title: 'Genre-free Source' },
		}),
		prisma.media.create({
			data: { kind: 'movie', title: 'Popular Fallback' },
		}),
		prisma.media.create({
			data: { kind: 'movie', title: 'Quiet Fallback' },
		}),
	])
	await prisma.trackingState.create({
		data: {
			ownerId: member.id,
			mediaId: popular.id,
			status: 'completed',
			score: 8.5,
		},
	})

	const result = await getSimilarMediaRecommendations(source, null)
	expect(result.sourceGenres).toEqual([])
	expect(result.items.map(item => item.title)).toEqual([
		'Popular Fallback',
		'Quiet Fallback',
	])
	expect(result.items.map(item => item.id)).toEqual([popular.id, quiet.id])
})
