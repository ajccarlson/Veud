import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { loader } from './reviews.tsx'

async function createUser(prefix: string) {
	const suffix = faker.string.alphanumeric({ length: 10 }).toLowerCase()
	return prisma.user.create({
		data: {
			email: `${prefix}_${suffix}@example.com`,
			username: `${prefix}_${suffix}`,
		},
	})
}

async function cookieFor(userId: string) {
	const session = await prisma.session.create({
		data: { userId, expirationDate: getSessionExpirationDate() },
	})
	return getSessionCookieHeader(session)
}

test('review hub searches media and reviewers while honoring kind and spoiler filters', async () => {
	const [movieAuthor, animeAuthor] = await Promise.all([
		createUser('movie_critic'),
		createUser('anime_critic'),
	])
	const [movie, anime] = await Promise.all([
		prisma.media.create({
			data: { kind: 'movie', title: 'Review Hub Cinema' },
		}),
		prisma.media.create({
			data: { kind: 'anime', title: 'Review Hub Animation' },
		}),
	])
	await Promise.all([
		prisma.review.create({
			data: {
				authorId: movieAuthor.id,
				mediaId: movie.id,
				body: 'A spoiler-free close reading.',
				rating: 8,
			},
		}),
		prisma.review.create({
			data: {
				authorId: animeAuthor.id,
				mediaId: anime.id,
				body: 'The hidden ending changes everything.',
				containsSpoilers: true,
				rating: 9,
			},
		}),
	])

	const movieResult = await loader({
		request: new Request(
			`${BASE_URL}/reviews?q=Hub&kind=movie&spoilers=exclude&sort=recent`,
		),
		params: {},
	} as any)
	expect(movieResult.data.filters).toEqual({
		q: 'Hub',
		kind: 'movie',
		sort: 'recent',
		spoilers: 'exclude',
		page: 1,
	})
	expect(movieResult.data.items).toEqual([
		expect.objectContaining({
			body: 'A spoiler-free close reading.',
			rating: 8,
			media: expect.objectContaining({ title: 'Review Hub Cinema' }),
		}),
	])

	const authorResult = await loader({
		request: new Request(
			`${BASE_URL}/reviews?q=${animeAuthor.username}&sort=recent`,
		),
		params: {},
	} as any)
	expect(authorResult.data.items).toEqual([
		expect.objectContaining({
			containsSpoilers: true,
			author: expect.objectContaining({ id: animeAuthor.id }),
		}),
	])
})

test('following view is signed-in only and popular reviews rank by engagement', async () => {
	const [viewer, followed, other, firstLiker, secondLiker] = await Promise.all([
		createUser('review_viewer'),
		createUser('followed_critic'),
		createUser('other_critic'),
		createUser('review_liker_one'),
		createUser('review_liker_two'),
	])
	const [followedMedia, popularMedia] = await Promise.all([
		prisma.media.create({ data: { kind: 'movie', title: 'Followed Review' } }),
		prisma.media.create({ data: { kind: 'movie', title: 'Popular Review' } }),
	])
	const [followedReview, popularReview] = await Promise.all([
		prisma.review.create({
			data: {
				authorId: followed.id,
				mediaId: followedMedia.id,
				body: 'From a followed reviewer.',
			},
		}),
		prisma.review.create({
			data: {
				authorId: other.id,
				mediaId: popularMedia.id,
				body: 'Popular with everyone else.',
			},
		}),
	])
	await Promise.all([
		prisma.follow.create({
			data: { followerId: viewer.id, followingId: followed.id },
		}),
		prisma.reviewLike.create({
			data: { userId: firstLiker.id, reviewId: popularReview.id },
		}),
		prisma.reviewLike.create({
			data: { userId: secondLiker.id, reviewId: popularReview.id },
		}),
		prisma.reviewLike.create({
			data: { userId: firstLiker.id, reviewId: followedReview.id },
		}),
	])
	const cookie = await cookieFor(viewer.id)

	const following = await loader({
		request: new Request(`${BASE_URL}/reviews?sort=following`, {
			headers: { cookie },
		}),
		params: {},
	} as any)
	expect(following.data.filters.sort).toBe('following')
	expect(following.data.items.map(review => review.id)).toEqual([
		followedReview.id,
	])

	const popular = await loader({
		request: new Request(`${BASE_URL}/reviews?sort=popular`),
		params: {},
	} as any)
	expect(popular.data.items.map(review => review.id)).toEqual([
		popularReview.id,
		followedReview.id,
	])
	const anonymousFollowing = await loader({
		request: new Request(`${BASE_URL}/reviews?sort=following`),
		params: {},
	} as any)
	expect(anonymousFollowing.data.filters.sort).toBe('trending')
})
