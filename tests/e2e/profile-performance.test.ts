import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

test('profile tabs load their own data without reloading the heavy shell', async ({
	page,
	login,
}) => {
	const user = await login()
	const listType = await prisma.listType.findUniqueOrThrow({
		where: { name: 'anime' },
	})
	const watchlist = await prisma.watchlist.create({
		data: {
			ownerId: user.id,
			typeId: listType.id,
			name: 'watching',
			header: 'Watching',
			position: 1,
		},
	})
	const entries = Array.from({ length: 500 }, (_, index) => ({
		watchlistId: watchlist.id,
		position: index + 1,
		title: `Profile browser history ${index + 1}`,
		type: 'TV',
		length: `${(index % 24) + 1} / 24 eps`,
		personal: (index % 10) + 1,
		history: JSON.stringify({
			added: Date.UTC(2025, 0, 1) + index,
			lastUpdated: Date.UTC(2025, 0, 1) + index,
		}),
		description: 'Large provider description. '.repeat(100),
		notes: 'A private note that analytics must not transfer. '.repeat(50),
	}))
	for (let index = 0; index < entries.length; index += 100) {
		await prisma.entry.createMany({ data: entries.slice(index, index + 100) })
	}

	await page.goto(`/users/${user.username}`)
	await expect(
		page.getByRole('heading', { name: 'Completion History' }),
	).toBeVisible()

	const navigationTimings: string[] = []
	page.on('response', async response => {
		if (!response.url().includes('.data?')) return
		const timing = await response.headerValue('server-timing')
		if (timing) navigationTimings.push(timing)
	})

	await page.getByRole('link', { name: 'Reviews', exact: true }).click()
	await expect(page.getByRole('heading', { name: 'Reviews' })).toBeVisible()
	await page.getByRole('link', { name: 'Diary', exact: true }).click()
	await expect(page.getByRole('heading', { name: 'Diary' })).toBeVisible()
	await page.getByRole('link', { name: 'Activity', exact: true }).click()
	await expect(
		page.getByRole('heading', { name: 'Recent Activity' }),
	).toBeVisible()
	await page.getByRole('link', { name: 'Favorites', exact: true }).click()
	await expect(page.getByRole('heading', { name: 'Favorites' })).toBeVisible()

	const combinedTimings = navigationTimings.join(',')
	expect(combinedTimings).toContain('profile_reviews')
	expect(combinedTimings).toContain('profile_diary')
	expect(combinedTimings).toContain('profile_activity')
	expect(combinedTimings).toContain('profile_favorites')
	expect(combinedTimings).not.toContain('profile_shell')
})
