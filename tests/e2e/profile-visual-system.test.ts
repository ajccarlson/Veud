import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

test('profile presentation stays deliberate across mobile and desktop tabs', async ({
	page,
	login,
}) => {
	test.setTimeout(30_000)
	const user = await login()
	await prisma.user.update({
		where: { id: user.id },
		data: {
			bio: 'I track stories across film, television, anime, and manga.',
		},
	})
	const listType = await prisma.listType.findFirstOrThrow()
	const watchlist = await prisma.watchlist.create({
		data: {
			ownerId: user.id,
			typeId: listType.id,
			name: 'watching',
			header: 'Watching',
			position: 1,
		},
	})
	await prisma.entry.createMany({
		data: [6, 7, 8].map((personal, index) => ({
			watchlistId: watchlist.id,
			position: index + 1,
			title: `Responsive profile fixture ${index + 1}`,
			personal,
			history: JSON.stringify({ added: Date.UTC(2026, 0, index + 1) }),
		})),
	})

	const pageErrors: string[] = []
	page.on('pageerror', error => pageErrors.push(error.message))
	await page.setViewportSize({ width: 390, height: 844 })
	await page.goto(`/users/${user.username}`)
	await expect(
		page.getByRole('heading', { name: user.name ?? user.username }),
	).toBeVisible()
	await expect(
		page.getByRole('heading', { name: 'No completion history yet' }),
	).toBeVisible()
	await prisma.entry.updateMany({
		where: {
			watchlistId: watchlist.id,
			title: 'Responsive profile fixture 1',
		},
		data: {
			history: JSON.stringify({
				finished: Date.UTC(2026, 0, 3),
				progress: {
					1: { finishDate: [Date.UTC(2026, 0, 2)] },
				},
			}),
		},
	})
	await page.reload()
	await expect(
		page.getByRole('heading', { name: 'No completion history yet' }),
	).toHaveCount(0)
	await expect(
		page.locator('.user-landing-completion-history-chart svg'),
	).toBeVisible()

	const mobileMetrics = await page.evaluate(() => {
		const tabs = document.querySelector('.user-landing-tabs')
		const hero = document.querySelector('.user-landing-hero')
		const profile = document.querySelector('.user-landing')
		const tabRows = new Set(
			[...document.querySelectorAll('.user-landing-tab')].map(element =>
				Math.round(element.getBoundingClientRect().top),
			),
		)
		return {
			profileScrollWidth: profile?.scrollWidth ?? 0,
			profileClientWidth: profile?.clientWidth ?? 0,
			tabsScrollWidth: tabs?.scrollWidth ?? 0,
			tabsClientWidth: tabs?.clientWidth ?? 0,
			tabRows: tabRows.size,
			heroHeight: Math.round(hero?.getBoundingClientRect().height ?? 0),
		}
	})

	expect(mobileMetrics.profileScrollWidth).toBeLessThanOrEqual(
		mobileMetrics.profileClientWidth,
	)
	expect(mobileMetrics.tabRows).toBe(1)
	expect(mobileMetrics.tabsScrollWidth).toBeGreaterThan(
		mobileMetrics.tabsClientWidth,
	)
	expect(mobileMetrics.heroHeight).toBeLessThan(500)

	const destinations = [
		['Reviews', 'Reviews'],
		['Diary', 'Diary'],
		['Collections', 'Collections'],
		['Stats', 'Stats'],
		['Favorites', 'Favorites'],
		['Activity', 'Recent Activity'],
		['Social', 'Guestbook'],
	] as const

	for (const [linkName, headingName] of destinations) {
		await page.getByRole('link', { name: linkName, exact: true }).click()
		await expect(
			page.getByRole('heading', { name: headingName, exact: true }),
		).toBeVisible()
		if (linkName === 'Stats') {
			await expect(
				page.locator('.user-landing-stats-waffle-chart-text-right'),
			).toContainText('Mean Score: 7.00')
		}
	}

	await page.setViewportSize({ width: 1440, height: 1000 })
	await page.getByRole('link', { name: 'Overview', exact: true }).click()
	await expect(
		page.getByRole('heading', { name: 'Completion History', exact: true }),
	).toBeVisible()
	const desktopCardRows = await page
		.locator('.user-landing-stats-overview-card')
		.evaluateAll(
			cards =>
				new Set(
					cards
						.slice(0, 3)
						.map(card => Math.round(card.getBoundingClientRect().top)),
				).size,
		)
	expect(desktopCardRows).toBe(1)
	expect(
		pageErrors.filter(error => error !== 'WebSocket closed without opened.'),
	).toEqual([])
})
