import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { action, loader } from './reviews.tsx'

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

function postRequest(values: Record<string, string>, cookie: string) {
	return new Request(`${BASE_URL}/reviews`, {
		method: 'POST',
		headers: {
			cookie,
			'content-type': 'application/x-www-form-urlencoded',
		},
		body: new URLSearchParams(values),
	})
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

test('review hub engagement and source-linked notifications stay synchronized', async () => {
	const [viewer, author] = await Promise.all([
		createUser('hub_liker'),
		createUser('hub_review_author'),
	])
	const media = await prisma.media.create({
		data: { kind: 'movie', title: 'Inline Review Likes' },
	})
	const review = await prisma.review.create({
		data: {
			authorId: author.id,
			mediaId: media.id,
			body: 'A review that can be liked from discovery.',
		},
	})
	const cookie = await cookieFor(viewer.id)

	const liked = await action({
		request: postRequest(
			{ intent: 'review-like-toggle', reviewId: review.id },
			cookie,
		),
		params: {},
	} as any)
	expect(liked.data).toMatchObject({ ok: true, liked: true })
	const like = await prisma.reviewLike.findUniqueOrThrow({
		where: { userId_reviewId: { userId: viewer.id, reviewId: review.id } },
	})
	expect(
		await prisma.notification.findUnique({
			where: { reviewLikeId: like.id },
		}),
	).toMatchObject({
		type: 'review_like',
		recipientId: author.id,
		actorId: viewer.id,
		reviewId: review.id,
	})
	const commented = await action({
		request: postRequest(
			{
				intent: 'review-comment-create',
				reviewId: review.id,
				body: '  A quick comment from review discovery.  ',
			},
			cookie,
		),
		params: {},
	} as any)
	expect(commented.data).toMatchObject({ ok: true })
	const comment = await prisma.reviewComment.findFirstOrThrow({
		where: { reviewId: review.id, authorId: viewer.id },
	})
	expect(comment.body).toBe('A quick comment from review discovery.')
	expect(
		await prisma.notification.findUnique({
			where: { reviewCommentId: comment.id },
		}),
	).toMatchObject({
		type: 'review_comment',
		recipientId: author.id,
		actorId: viewer.id,
		reviewId: review.id,
	})

	const loaded = await loader({
		request: new Request(`${BASE_URL}/reviews?sort=recent`, {
			headers: { cookie },
		}),
		params: {},
	} as any)
	expect(loaded.data.items).toEqual([
		expect.objectContaining({
			id: review.id,
			likeCount: 1,
			viewerLiked: true,
			commentCount: 1,
			recentComments: [
				expect.objectContaining({
					id: comment.id,
					body: 'A quick comment from review discovery.',
					author: expect.objectContaining({ id: viewer.id }),
				}),
			],
		}),
	])

	const unliked = await action({
		request: postRequest(
			{ intent: 'review-like-toggle', reviewId: review.id },
			cookie,
		),
		params: {},
	} as any)
	expect(unliked.data).toMatchObject({ ok: true, liked: false })
	expect(
		await prisma.reviewLike.count({ where: { reviewId: review.id } }),
	).toBe(0)
	expect(
		await prisma.notification.count({
			where: { reviewId: review.id, type: 'review_like' },
		}),
	).toBe(0)
	expect(
		await prisma.notification.count({
			where: { reviewId: review.id, type: 'review_comment' },
		}),
	).toBe(1)
	await prisma.reviewComment.delete({ where: { id: comment.id } })
	expect(
		await prisma.notification.count({ where: { reviewId: review.id } }),
	).toBe(0)

	const invalidComment = await action({
		request: postRequest(
			{ intent: 'review-comment-create', reviewId: review.id, body: '   ' },
			cookie,
		),
		params: {},
	} as any).catch(error => error)
	expect(invalidComment).toBeInstanceOf(Response)
	expect((invalidComment as Response).status).toBe(400)

	const missing = await action({
		request: postRequest(
			{ intent: 'review-like-toggle', reviewId: 'missing-review' },
			cookie,
		),
		params: {},
	} as any).catch(error => error)
	expect(missing).toBeInstanceOf(Response)
	expect((missing as Response).status).toBe(404)
})
