import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

test('member can curate, reorder, and publish a media collection', async ({
	page,
	login,
}) => {
	const user = await login()
	const [first, second] = await Promise.all([
		prisma.media.create({
			data: {
				kind: 'movie',
				title: 'Collection Browser Arrival',
				description: 'The first browser collection fixture.',
			},
		}),
		prisma.media.create({
			data: {
				kind: 'movie',
				title: 'Collection Browser Moon',
				description: 'The second browser collection fixture.',
			},
		}),
	])

	try {
		await page.goto('/collections/new')
		await page.getByLabel('Title').fill('Browser Science Fiction Picks')
		await page
			.getByLabel('Description')
			.fill('A browser-tested collection of thoughtful science fiction.')
		await page.getByRole('button', { name: 'Create collection' }).click()
		await expect(page).not.toHaveURL(/\/collections\/new$/)
		await expect(page).toHaveURL(/\/collections\/[a-z0-9]+$/)
		const collectionId = page.url().split('/').pop()
		if (!collectionId)
			throw new Error('Collection redirect did not include an ID')

		await expect(
			page.getByRole('heading', { name: 'Add a title' }),
		).toBeVisible()
		await page
			.getByPlaceholder('Search media')
			.fill('Collection Browser Arrival')
		await page.getByRole('button', { name: 'Search' }).click()
		const arrivalResult = page
			.getByRole('article')
			.filter({ hasText: 'Collection Browser Arrival' })
		await arrivalResult.getByRole('button', { name: 'Add' }).click()
		await expect(page.getByRole('heading', { name: 'The list' })).toBeVisible()
		await expect(
			page.getByRole('heading', { name: 'Collection Browser Arrival' }),
		).toBeVisible()

		await page.goto(`/media/${second.id}`)
		await page
			.getByLabel('Collection')
			.selectOption({ label: 'Browser Science Fiction Picks' })
		await page.getByRole('button', { name: 'Add to collection' }).click()
		await expect(page.getByLabel('Collection')).toContainText(
			'✓ Browser Science Fiction Picks',
		)

		await page.goto(`/collections/${collectionId}`)
		await expect(
			page.getByRole('heading', { name: 'Collection Browser Arrival' }),
		).toBeVisible()
		await expect(
			page.getByRole('heading', { name: 'Collection Browser Moon' }),
		).toBeVisible()
		await page.getByLabel('Move Collection Browser Moon up').click()
		await expect
			.poll(() =>
				prisma.mediaCollectionItem
					.findMany({
						where: { collectionId },
						orderBy: { position: 'asc' },
						select: { mediaId: true },
					})
					.then(items => items.map(item => item.mediaId)),
			)
			.toEqual([second.id, first.id])

		await page.goto(`/users/${user.username}/collections`)
		await expect(
			page.getByRole('heading', { name: 'Browser Science Fiction Picks' }),
		).toBeVisible()
		await page.goto('/collections?q=Browser+Science+Fiction')
		await expect(
			page.getByRole('heading', { name: 'Browser Science Fiction Picks' }),
		).toBeVisible()
	} finally {
		await prisma.media
			.deleteMany({ where: { id: { in: [first.id, second.id] } } })
			.catch(() => {})
	}
})
