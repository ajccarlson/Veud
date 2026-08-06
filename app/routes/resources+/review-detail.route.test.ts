import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { prisma } from '#app/utils/db.server.ts'
import { REVIEW_COMMENT_PREVIEW } from '#app/utils/review-excerpt.ts'
import { BASE_URL } from '#tests/utils.ts'
import { loader } from './review-detail.ts'

async function reviewWithComments(count: number, status = 'visible') {
	const tag = faker.string.alphanumeric({ length: 8 }).toLowerCase()
	const author = await prisma.user.create({
		data: { email: `rev_${tag}@example.com`, username: `rev_${tag}` },
	})
	const media = await prisma.media.create({
		data: { kind: 'anime', title: `Review fixture ${tag}` },
	})
	return prisma.review.create({
		data: {
			mediaId: media.id,
			authorId: author.id,
			body: 'b'.repeat(3_000),
			moderationStatus: status,
			comments: {
				create: Array.from({ length: count }, (_, index) => ({
					body: `comment ${index}`,
					authorId: author.id,
					moderationStatus: 'visible',
				})),
			},
		},
	})
}

async function fetchDetail(reviewId: string | null) {
	const url = new URL(`${BASE_URL}/resources/review-detail`)
	if (reviewId !== null) url.searchParams.set('reviewId', reviewId)
	return loader({ request: new Request(url), params: {} } as any)
}

test('the full body and the comments the page held back are served', async () => {
	const review = await reviewWithComments(10)
	const response = (await fetchDetail(review.id)) as any
	expect(response.data.review.body).toHaveLength(3_000)
	// The page already showed the first few; this is the remainder.
	expect(response.data.review.comments).toHaveLength(
		10 - REVIEW_COMMENT_PREVIEW,
	)
})

test('a moderated review is not served to anyone who guesses its id', async () => {
	// An endpoint that returned moderated-away content would undo the
	// moderation the page applies.
	const hidden = await reviewWithComments(4, 'removed')
	const response = (await fetchDetail(hidden.id)) as any
	expect(response.init?.status).toBe(404)
})

test('a missing or unusable id is refused', async () => {
	expect(((await fetchDetail(null)) as any).init?.status).toBe(400)
	expect(((await fetchDetail('   ')) as any).init?.status).toBe(400)
	expect(((await fetchDetail('x'.repeat(101))) as any).init?.status).toBe(400)
	expect(((await fetchDetail('does-not-exist')) as any).init?.status).toBe(404)
})

test('the response can be cached briefly but not for long', async () => {
	// Reviews are edited and moderated; a long cache would keep a withdrawn one
	// reachable.
	const review = await reviewWithComments(1)
	const response = (await fetchDetail(review.id)) as any
	expect(response.init.headers['Cache-Control']).toBe('public, max-age=30')
})

test('a moderated comment is not served with the rest', async () => {
	const tag = faker.string.alphanumeric({ length: 8 }).toLowerCase()
	const author = await prisma.user.create({
		data: { email: `mod_${tag}@example.com`, username: `mod_${tag}` },
	})
	const media = await prisma.media.create({
		data: { kind: 'anime', title: `Moderated fixture ${tag}` },
	})
	const review = await prisma.review.create({
		data: {
			mediaId: media.id,
			authorId: author.id,
			body: 'body',
			moderationStatus: 'visible',
			comments: {
				create: [
					...Array.from({ length: REVIEW_COMMENT_PREVIEW }, (_, index) => ({
						body: `shown ${index}`,
						authorId: author.id,
						moderationStatus: 'visible',
					})),
					{
						body: 'visible remainder',
						authorId: author.id,
						moderationStatus: 'visible',
					},
					{
						body: 'removed by a moderator',
						authorId: author.id,
						moderationStatus: 'removed',
					},
				],
			},
		},
	})
	const response = (await fetchDetail(review.id)) as any
	const bodies = response.data.review.comments.map((c: any) => c.body)
	expect(bodies).toContain('visible remainder')
	expect(bodies).not.toContain('removed by a moderator')
})

test('the remainder is bounded, however many comments a review collects', async () => {
	// A review with ten thousand comments is not a reason to send ten thousand
	// comments.
	const review = await reviewWithComments(210)
	const response = (await fetchDetail(review.id)) as any
	expect(response.data.review.comments).toHaveLength(200)
})
