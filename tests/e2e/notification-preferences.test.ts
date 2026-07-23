import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

test('notification preferences persist and filter the inbox on mobile', async ({
	page,
	login,
}) => {
	const owner = await login()
	const actor = await prisma.user.create({
		data: {
			email: `notification_actor_${owner.id}@example.com`,
			username: `notification_actor_${owner.id}`,
		},
	})
	const [reviewMedia, releaseMedia] = await Promise.all([
		prisma.media.create({
			data: { kind: 'movie', title: 'Hidden Social Notification Fixture' },
		}),
		prisma.media.create({
			data: {
				kind: 'anime',
				title: 'Visible Release Notification Fixture',
				releaseStart: new Date(Date.now() + 30 * 60 * 1_000),
			},
		}),
	])
	const review = await prisma.review.create({
		data: { authorId: owner.id, mediaId: reviewMedia.id, body: 'Inbox review' },
	})
	const reminder = await prisma.releaseReminder.create({
		data: {
			ownerId: owner.id,
			mediaId: releaseMedia.id,
			leadMinutes: 60,
		},
	})
	await Promise.all([
		prisma.notification.create({
			data: {
				type: 'review_like',
				recipientId: owner.id,
				actorId: actor.id,
				reviewId: review.id,
			},
		}),
		prisma.notification.create({
			data: {
				type: 'release_reminder',
				recipientId: owner.id,
				releaseReminderId: reminder.id,
				releaseAt: releaseMedia.releaseStart,
				availableAt: new Date(Date.now() - 30 * 60 * 1_000),
			},
		}),
	])

	await page.setViewportSize({ width: 390, height: 844 })
	await page.goto('/settings/profile/notifications')
	await expect(
		page.getByRole('heading', { name: 'Notification preferences' }),
	).toBeVisible()
	await page
		.getByRole('checkbox', { name: 'Social activity', exact: true })
		.uncheck()
	await page
		.getByRole('checkbox', { name: 'Include social activity' })
		.check()
	await page.getByLabel('Frequency').selectOption('daily')
	await page.getByLabel('Delivery time').selectOption('9')
	await page.getByRole('button', { name: 'Save notification preferences' }).click()
	await expect(page.getByRole('status')).toHaveText(
		'Notification preferences saved.',
	)
	await expect
		.poll(() =>
			prisma.notificationPreference.findUnique({
				where: { ownerId: owner.id },
				select: {
					inAppSocial: true,
					inAppReleases: true,
					emailSocial: true,
					digestFrequency: true,
					nextDigestAt: true,
				},
			}),
		)
		.toMatchObject({
			inAppSocial: false,
			inAppReleases: true,
			emailSocial: true,
			digestFrequency: 'daily',
			nextDigestAt: expect.any(Date),
		})

	await page.reload()
	await expect(
		page.getByRole('checkbox', { name: 'Social activity', exact: true }),
	).not.toBeChecked()
	await page.goto('/notifications')
	await expect(page.getByText('Visible Release Notification Fixture')).toBeVisible()
	await expect(
		page.getByText('Hidden Social Notification Fixture'),
	).toHaveCount(0)
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth + 1,
		),
	).toBe(true)
})
