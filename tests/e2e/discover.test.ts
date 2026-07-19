import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

test('member can filter the catalog and discover an unseen personalized title', async ({
	page,
	login,
}) => {
	const viewer = await login()
	const [tracked, fantasyMatch, romanceMovie] = await Promise.all([
		prisma.media.create({
			data: {
				kind: 'anime',
				title: 'Browser Discovery Seed',
				genres: 'Fantasy, Adventure',
			},
		}),
		prisma.media.create({
			data: {
				kind: 'anime',
				title: 'Browser Fantasy Match',
				genres: 'Fantasy',
				description: 'An unseen fantasy recommendation.',
			},
		}),
		prisma.media.create({
			data: {
				kind: 'movie',
				title: 'Browser Romance Film',
				genres: 'Romance',
				description: 'A catalog search fixture.',
			},
		}),
	])
	await prisma.trackingState.create({
		data: {
			ownerId: viewer.id,
			mediaId: tracked.id,
			status: 'completed',
			score: 9,
		},
	})

	try {
		await page.goto('/discover')
		await expect(
			page.getByRole('heading', { name: 'Discover', exact: true }),
		).toBeVisible()
		await expect(page.getByText('Browser Fantasy Match')).toBeVisible()

		await page.getByLabel('Title or keyword').fill('Browser Romance')
		await page.getByLabel('Media type').selectOption('movie')
		await page.getByRole('button', { name: 'Discover' }).click()
		await expect(page).toHaveURL(/q=Browser\+Romance/)
		await expect(page.getByText('Browser Romance Film')).toBeVisible()
		await expect(page.getByText('Browser Fantasy Match')).not.toBeVisible()

		await page.getByLabel('Title or keyword').fill('')
		await page.getByLabel('Media type').selectOption('all')
		await page.getByLabel('Rank by').selectOption('for-you')
		await page.getByRole('button', { name: 'Discover' }).click()
		await expect(page).toHaveURL(/sort=for-you/)
		await expect(page.getByText('Browser Fantasy Match')).toBeVisible()
		await expect(page.getByText('Browser Discovery Seed')).not.toBeVisible()
		await expect(page.getByText(/Built from your interest in/)).toContainText(
			'Fantasy',
		)
	} finally {
		await prisma.media
			.deleteMany({
				where: { id: { in: [tracked.id, fantasyMatch.id, romanceMovie.id] } },
			})
			.catch(() => {})
	}
})
