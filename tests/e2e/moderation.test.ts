import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

test.setTimeout(30_000)

test('community administrators can triage reports and manage moderator access', async ({
	page,
	login,
}) => {
	const owner = await login()
	await prisma.user.update({
		where: { id: owner.id },
		data: {
			roles: {
				connect: [{ name: 'moderator' }, { name: 'community-admin' }],
			},
		},
	})
	const offender = await prisma.user.create({
		data: {
			email: `moderation_offender_${owner.id}@example.com`,
			username: `moderation_offender_${owner.id}`.slice(0, 40),
			name: 'Moderation browser member',
			roles: { connect: { name: 'user' } },
		},
	})
	const media = await prisma.media.create({
		data: { kind: 'movie', title: 'Browser moderation fixture' },
	})
	const review = await prisma.review.create({
		data: {
			authorId: offender.id,
			mediaId: media.id,
			body: 'A deterministic review used by the moderation browser gate.',
		},
	})

	try {
		await page.goto('/reviews')
		await page
			.getByText('Browser moderation fixture', { exact: true })
			.first()
			.scrollIntoViewIfNeeded()
		const reviewCard = page
			.getByRole('heading', { name: 'Browser moderation fixture' })
			.locator('..')
			.locator('..')
		await reviewCard.locator('summary').filter({ hasText: 'Report' }).click()
		const reportForm = page
			.locator('form[action="/resources/report-content"]')
			.first()
		await reportForm.getByLabel('Reason').selectOption('spam')
		await reportForm
			.getByLabel('Context (optional)')
			.fill('Browser verification of the private reporting workflow.')
		await reportForm.getByRole('button', { name: 'Send report' }).click()
		await expect(page.getByText('Report sent privately.')).toBeVisible()

		const report = await prisma.moderationReport.findFirstOrThrow({
			where: { targetId: review.id, reporterId: owner.id },
		})
		await page.goto('/moderation')
		await expect(
			page.getByRole('heading', { name: 'Moderation', exact: true }),
		).toBeVisible()
		const card = page.getByTestId(`moderation-report-${report.id}`)
		await expect(card).toContainText('Browser moderation fixture')
		const hideForm = card
			.getByRole('button', { name: 'Hide content' })
			.locator('..')
		await hideForm.getByLabel('Reason').fill('Confirmed browser gate action.')
		page.once('dialog', dialog => dialog.accept())
		await hideForm.getByRole('button', { name: 'Hide content' }).click()
		await expect(page.getByRole('status')).toContainText('Content hidden')
		await expect
			.poll(() =>
				prisma.review
					.findUnique({
						where: { id: review.id },
						select: { moderationStatus: true },
					})
					.then(result => result?.moderationStatus),
			)
			.toBe('hidden')

		await page.goto(
			`/moderation?view=team&q=${encodeURIComponent(offender.username)}`,
		)
		await expect(
			page.getByRole('heading', { name: offender.username }),
		).toBeVisible()
		const grantForm = page
			.getByRole('button', { name: 'Grant moderator' })
			.locator('xpath=ancestor::form')
		await grantForm.getByLabel('Reason').fill('Browser role assignment gate.')
		await grantForm.getByRole('button', { name: 'Grant moderator' }).click()
		await expect(page.getByRole('status')).toContainText(
			'Moderator access granted',
		)
		await expect
			.poll(() =>
				prisma.user
					.findUnique({
						where: { id: offender.id },
						select: { roles: { select: { name: true } } },
					})
					.then(user => user?.roles.map(role => role.name)),
			)
			.toContain('moderator')

		await page.setViewportSize({ width: 390, height: 844 })
		await page.goto('/moderation?view=audit')
		await expect(page.getByText('Immutable action log')).toBeVisible()
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= window.innerWidth + 1,
			),
		).toBe(true)
	} finally {
		await prisma.media.delete({ where: { id: media.id } }).catch(() => {})
		await prisma.user.delete({ where: { id: offender.id } }).catch(() => {})
	}
})
