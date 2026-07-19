import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

test('member can engage with a review and open an unread notification', async ({
	page,
	login,
	insertNewUser,
}) => {
	const viewer = await login()
	const author = await insertNewUser()
	const media = await prisma.media.create({
		data: { kind: 'movie', title: 'Review Engagement Browser Test' },
	})
	const [authorReview, viewerReview] = await Promise.all([
		prisma.review.create({
			data: {
				authorId: author.id,
				mediaId: media.id,
				body: 'A review from another member.',
			},
		}),
		prisma.review.create({
			data: {
				authorId: viewer.id,
				mediaId: media.id,
				body: 'The signed-in member review.',
			},
		}),
	])
	const incomingLike = await prisma.reviewLike.create({
		data: { userId: author.id, reviewId: viewerReview.id },
	})
	await prisma.notification.create({
		data: {
			type: 'review_like',
			recipientId: viewer.id,
			actorId: author.id,
			reviewId: viewerReview.id,
			reviewLikeId: incomingLike.id,
		},
	})

	try {
		await page.goto(`/media/${media.id}`)
		const review = page.locator(`#review-${authorReview.id}`)
		await review.getByRole('button', { name: 'Like · 0' }).click()
		await expect(
			review.getByRole('button', { name: 'Unlike · 1' }),
		).toBeVisible()
		await review.getByLabel('Comment').fill('A browser-level review comment.')
		await review.getByRole('button', { name: 'Post comment' }).click()
		await expect(
			review.getByText('A browser-level review comment.'),
		).toBeVisible()
		await expect(review.getByText('1 comment')).toBeVisible()
		await expect
			.poll(() =>
				prisma.notification.count({
					where: { recipientId: author.id, actorId: viewer.id },
				}),
			)
			.toBe(2)

		await expect(page.getByLabel('Notifications (1 unread)')).toBeVisible()
		await page.getByLabel('Notifications (1 unread)').click()
		await expect(
			page.getByRole('heading', { name: 'Notifications' }),
		).toBeVisible()
		await page
			.getByRole('button', {
				name: `${author.name ?? author.username} liked your review of Review Engagement Browser Test`,
			})
			.click()
		await expect(page).toHaveURL(
			new RegExp(`/media/${media.id}#review-${viewerReview.id}$`),
		)
	} finally {
		await prisma.media.delete({ where: { id: media.id } }).catch(() => {})
	}
})
