import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { prisma } from '#app/utils/db.server.ts'
import {
	REMOVED_COMMENT_BODY,
	REVIEW_COMMENT_PREVIEW,
	REVIEW_COMMENT_REMAINDER_LIMIT,
} from '#app/utils/review-excerpt.ts'
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

/** A review whose comments carry the given statuses, oldest first. */
async function reviewWithStatuses(statuses: string[]) {
	const tag = faker.string.alphanumeric({ length: 8 }).toLowerCase()
	const author = await prisma.user.create({
		data: { email: `mod_${tag}@example.com`, username: `mod_${tag}` },
	})
	const media = await prisma.media.create({
		data: { kind: 'anime', title: `Moderated fixture ${tag}` },
	})
	return prisma.review.create({
		data: {
			mediaId: media.id,
			authorId: author.id,
			body: 'body',
			moderationStatus: 'visible',
			comments: {
				// Explicit timestamps: these tests assert which comment comes back
				// first, and `now()` across one batch does not reliably differ.
				create: statuses.map((moderationStatus, index) => ({
					body: `comment ${index}`,
					authorId: author.id,
					moderationStatus,
					createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)),
				})),
			},
		},
	})
}

test('a moderated comment is served as a tombstone, never as its body', async () => {
	const review = await reviewWithStatuses([
		...Array.from({ length: REVIEW_COMMENT_PREVIEW }, () => 'visible'),
		'visible',
		'removed',
	])
	const response = (await fetchDetail(review.id)) as any
	const comments = response.data.review.comments
	const bodies = comments.map((c: any) => c.body)
	expect(bodies).toContain(`comment ${REVIEW_COMMENT_PREVIEW}`)
	// The body a moderator took down does not travel; its place does.
	expect(bodies).not.toContain(`comment ${REVIEW_COMMENT_PREVIEW + 1}`)
	expect(bodies).toContain(REMOVED_COMMENT_BODY)
	expect(comments.at(-1).isRemoved).toBe(true)
})

test('the remainder resumes where the page stopped, tombstones included', async () => {
	// The page spends a slot on each tombstone it renders. Skipping past only the
	// visible ones would step over one comment for every one that was removed,
	// and those comments would appear nowhere at all.
	const removedUpFront = 2
	const review = await reviewWithStatuses([
		...Array.from({ length: removedUpFront }, () => 'removed'),
		...Array.from({ length: 8 }, () => 'visible'),
	])
	const response = (await fetchDetail(review.id)) as any
	const bodies = response.data.review.comments.map((c: any) => c.body)

	// The page showed comments 0..2 — two tombstones and one body. The remainder
	// must therefore begin at comment 3 and skip nothing.
	expect(bodies[0]).toBe('comment 3')
	expect(bodies).toHaveLength(10 - REVIEW_COMMENT_PREVIEW)
	// Nothing the page already showed comes back a second time.
	expect(bodies).not.toContain(`comment ${removedUpFront}`)
})

test('the remainder is bounded, however many comments a review collects', async () => {
	// A review with ten thousand comments is not a reason to send ten thousand
	// comments.
	const review = await reviewWithComments(REVIEW_COMMENT_REMAINDER_LIMIT + 10)
	const response = (await fetchDetail(review.id)) as any
	expect(response.data.review.comments).toHaveLength(
		REVIEW_COMMENT_REMAINDER_LIMIT,
	)
})
