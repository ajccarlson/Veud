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
				name: `${author.username} liked your review of Review Engagement Browser Test`,
			})
			.click()
		await expect(page).toHaveURL(
			new RegExp(`/media/${media.id}#review-${viewerReview.id}$`),
		)
	} finally {
		await prisma.media.delete({ where: { id: media.id } }).catch(() => {})
	}
})

test('member can discover spoiler-safe reviews from followed critics', async ({
	page,
	login,
	insertNewUser,
}) => {
	const viewer = await login()
	const author = await insertNewUser()
	const [safeMedia, spoilerMedia] = await Promise.all([
		prisma.media.create({
			data: { kind: 'movie', title: 'Review Hub Browser Safe' },
		}),
		prisma.media.create({
			data: { kind: 'anime', title: 'Review Hub Browser Spoiler' },
		}),
	])
	await Promise.all([
		prisma.follow.create({
			data: { followerId: viewer.id, followingId: author.id },
		}),
		prisma.review.create({
			data: {
				authorId: author.id,
				mediaId: safeMedia.id,
				body: 'A visible browser review excerpt.',
				rating: 8,
			},
		}),
		prisma.review.create({
			data: {
				authorId: author.id,
				mediaId: spoilerMedia.id,
				body: 'The browser-only secret ending.',
				containsSpoilers: true,
			},
		}),
	])

	try {
		await page.goto('/reviews?sort=following')
		await expect(
			page.getByRole('heading', { name: 'From people you follow reviews' }),
		).toBeVisible()
		await expect(
			page.getByText('A visible browser review excerpt.'),
		).toBeVisible()
		await expect(page.getByText('The browser-only secret ending.')).toHaveCount(
			0,
		)
		await expect(
			page.getByText(/Contains spoilers\. Open the title page/),
		).toBeVisible()
		const safeReview = page.getByRole('article').filter({
			has: page.getByRole('heading', { name: 'Review Hub Browser Safe' }),
		})
		await safeReview.getByRole('button', { name: 'Like · 0' }).click()
		await expect(
			safeReview.getByRole('button', { name: 'Unlike · 1' }),
		).toBeVisible()
		await expect
			.poll(() =>
				prisma.reviewLike.count({
					where: { userId: viewer.id, review: { mediaId: safeMedia.id } },
				}),
			)
			.toBe(1)
		await safeReview.getByText('Quick discussion · 0').click()
		await safeReview
			.getByLabel('Comment on Review Hub Browser Safe')
			.fill('A quick browser comment from review discovery.')
		await safeReview.getByRole('button', { name: 'Post comment' }).click()
		await expect(safeReview.getByText('Quick discussion · 1')).toBeVisible()
		const browserComment = safeReview.getByText(
			'A quick browser comment from review discovery.',
		)
		if (!(await browserComment.isVisible())) {
			await safeReview.getByText('Quick discussion · 1').click()
		}
		await expect(browserComment).toBeVisible()
		await expect
			.poll(() =>
				prisma.reviewComment.count({
					where: { authorId: viewer.id, review: { mediaId: safeMedia.id } },
				}),
			)
			.toBe(1)
		await expect
			.poll(() =>
				prisma.notification.count({
					where: {
						recipientId: author.id,
						actorId: viewer.id,
						review: { mediaId: safeMedia.id },
					},
				}),
			)
			.toBe(2)
		await page.getByLabel('Spoiler-free reviews only').check()
		await page.getByRole('button', { name: 'Browse' }).click()
		await expect(page).toHaveURL(/spoilers=exclude/)
		await expect(
			page.getByRole('heading', { name: 'Review Hub Browser Spoiler' }),
		).toHaveCount(0)
	} finally {
		await prisma.media
			.deleteMany({ where: { id: { in: [safeMedia.id, spoilerMedia.id] } } })
			.catch(() => {})
	}
})
