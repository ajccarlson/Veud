import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

test('moderators can reach older audit actions and return to newest', async ({
	page,
	login,
}) => {
	const moderator = await login()
	await prisma.user.update({
		where: { id: moderator.id },
		data: { roles: { connect: { name: 'moderator' } } },
	})
	const createdAt = new Date('2026-08-28T22:00:00.000Z')
	const actionIds = Array.from(
		{ length: 101 },
		(_, index) =>
			`browser-audit-${moderator.id}-${String(999 - index).padStart(3, '0')}`,
	)
	await prisma.moderationAction.createMany({
		data: actionIds.map((id, index) => ({
			id,
			action: 'account_warn',
			targetType: 'account',
			targetId: moderator.id,
			reason: `Browser audit action ${index}`,
			createdAt,
		})),
	})

	try {
		await page.goto('/moderation?view=audit')
		await expect(page.getByText('Browser audit action 0')).toBeVisible()
		await expect(page.getByText('Browser audit action 100')).toHaveCount(0)
		await page.getByRole('link', { name: 'Older actions' }).click()
		await expect(page).toHaveURL(/\/moderation\?view=audit&cursor=/)
		await expect(page.getByText('Browser audit action 100')).toBeVisible()
		await page.getByRole('link', { name: 'Newest' }).click()
		await expect(page).toHaveURL('/moderation?view=audit')
		await expect(page.getByText('Browser audit action 0')).toBeVisible()
	} finally {
		await prisma.moderationAction.deleteMany({
			where: { id: { in: actionIds } },
		})
	}
})
