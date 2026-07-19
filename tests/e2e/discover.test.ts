import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

test('member can filter the catalog and discover an unseen personalized title', async ({
	page,
	login,
}) => {
	const viewer = await login()
	const listType = await prisma.listType.upsert({
		where: { name: 'anime' },
		update: {},
		create: {
			name: 'anime',
			header: 'Anime',
			columns: '{}',
			mediaType: '["episode"]',
			completionType: '{}',
		},
	})
	const completed = await prisma.watchlist.create({
		data: {
			ownerId: viewer.id,
			typeId: listType.id,
			name: 'completed',
			header: 'Completed',
		},
	})
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
			statusWatchlistId: completed.id,
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
		await page
			.getByRole('button', { name: 'Discover', exact: true })
			.click()
		await expect(page).toHaveURL(/q=Browser\+Romance/)
		await expect(page.getByText('Browser Romance Film')).toBeVisible()
		await expect(page.getByText('Browser Fantasy Match')).not.toBeVisible()

		await page.getByLabel('Title or keyword').fill('')
		await page.getByLabel('Media type').selectOption('all')
		await page.getByLabel('Rank by').selectOption('for-you')
		await page
			.getByRole('button', { name: 'Discover', exact: true })
			.click()
		await expect(page).toHaveURL(/sort=for-you/)
		await expect(page.getByText('Browser Fantasy Match')).toBeVisible()
		await expect(page.getByText('Browser Discovery Seed')).not.toBeVisible()
		await expect(page.getByText(/Built from your interest in/)).toContainText(
			'Fantasy',
		)

		const recommendation = page
			.getByRole('article')
			.filter({ hasText: 'Browser Fantasy Match' })
		await expect(
			recommendation.getByLabel('Tracking status for Browser Fantasy Match'),
		).toHaveValue(completed.id)
		await recommendation
			.getByRole('button', { name: 'Track Browser Fantasy Match' })
			.click()
		await expect(recommendation).not.toBeVisible()
		await expect
			.poll(() =>
				prisma.trackingState.findUnique({
					where: {
						ownerId_mediaId: {
							ownerId: viewer.id,
							mediaId: fantasyMatch.id,
						},
					},
				}),
			)
			.toEqual(
				expect.objectContaining({
					status: 'completed',
					statusWatchlistId: completed.id,
				}),
			)
		expect(
			await prisma.entry.count({
				where: { mediaId: fantasyMatch.id, watchlistId: completed.id },
			}),
		).toBe(1)
	} finally {
		await prisma.media
			.deleteMany({
				where: { id: { in: [tracked.id, fantasyMatch.id, romanceMovie.id] } },
			})
			.catch(() => {})
	}
})
