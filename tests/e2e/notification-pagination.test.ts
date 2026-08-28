import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

test('member can reach older notification pages and return to newest', async ({
	page,
	login,
}) => {
	const user = await login()
	const availableAt = new Date('2026-08-28T12:00:00.000Z')
	await prisma.notification.createMany({
		data: Array.from({ length: 51 }, (_, index) => ({
			id: `browser-page-${user.id}-${String(999 - index).padStart(3, '0')}`,
			type: 'moderation_notice',
			message: `Browser notification ${index}`,
			recipientId: user.id,
			availableAt,
			createdAt: availableAt,
		})),
	})

	await page.goto('/notifications')
	await expect(page.getByText('Browser notification 0')).toBeVisible()
	await expect(page.getByText('Browser notification 50')).toHaveCount(0)
	await page.getByRole('link', { name: 'Older notifications' }).click()
	await expect(page).toHaveURL(/\/notifications\?cursor=/)
	await expect(page.getByText('Browser notification 50')).toBeVisible()
	await page.getByRole('link', { name: 'Newest' }).click()
	await expect(page).toHaveURL('/notifications')
	await expect(page.getByText('Browser notification 0')).toBeVisible()
})
