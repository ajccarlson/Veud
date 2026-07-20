import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

test('member schedules a release reminder and receives it in the inbox', async ({
	page,
	login,
}) => {
	const user = await login()
	const releaseAt = new Date(Date.now() + 2 * 60 * 60 * 1000)
	const media = await prisma.media.create({
		data: {
			kind: 'anime',
			title: 'Release Reminder Browser Test',
			nextRelease: JSON.stringify({
				releaseDate: releaseAt.toISOString(),
				episode: 7,
			}),
		},
	})

	try {
		await page.goto(`/media/${media.id}`)
		await expect(
			page.getByRole('heading', { name: 'Release reminder', exact: true }),
		).toBeVisible()
		await expect(page.getByText(/Episode 7/)).toBeVisible()
		await page.getByLabel('Notify me').selectOption('60')
		await page.getByRole('button', { name: 'Set reminder' }).click()
		await expect(
			page.getByRole('button', { name: 'Update reminder' }),
		).toBeVisible()
		await expect
			.poll(() =>
				prisma.releaseReminder.findUnique({
					where: {
						ownerId_mediaId: { ownerId: user.id, mediaId: media.id },
					},
					include: { notifications: true },
				}),
			)
			.not.toBeNull()
		const savedReminder = await prisma.releaseReminder.findUniqueOrThrow({
			where: {
				ownerId_mediaId: { ownerId: user.id, mediaId: media.id },
			},
			include: { notifications: true },
		})
		expect(savedReminder.notifications).toHaveLength(1)
		await prisma.notification.update({
			where: { id: savedReminder.notifications[0]!.id },
			data: { availableAt: new Date(Date.now() - 60 * 1000) },
		})

		await page.goto('/notifications')
		await expect(
			page.getByText('Release Reminder Browser Test', { exact: true }),
		).toBeVisible()
		await page
			.getByRole('button', {
				name: /Release Reminder Browser Test is coming up/,
			})
			.click()
		await expect(page).toHaveURL(`/media/${media.id}`)
		await expect(
			page.getByRole('button', { name: 'Remove reminder' }),
		).toBeVisible()
		await page.getByRole('button', { name: 'Remove reminder' }).click()
		await expect(
			page.getByRole('button', { name: 'Set reminder' }),
		).toBeVisible()
		await expect
			.poll(() =>
				prisma.releaseReminder.count({
					where: { ownerId: user.id, mediaId: media.id },
				}),
			)
			.toBe(0)
	} finally {
		await prisma.media.delete({ where: { id: media.id } }).catch(() => {})
	}
})
