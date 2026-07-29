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
		startSeason: `Winter ${2020 + (index % 6)}`,
		genres: 'Action, Drama',
		length: `${(index % 24) + 1} / 24 eps`,
		personal: (index % 10) + 1,
		malScore: (index % 10) + 1,
		history: JSON.stringify({
			added: Date.UTC(2025, 0, 1) + index,
			finished: Date.UTC(2024 + (index % 2), 0, 1) + index,
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
		page.getByRole('heading', { name: 'Completion History', exact: true }),
	).toBeVisible()

	const navigationTimings: string[] = []
	page.on('response', async response => {
		if (!response.url().includes('.data?')) return
		const timing = await response.headerValue('server-timing')
		if (timing) navigationTimings.push(timing)
	})

	await page.getByRole('link', { name: 'Reviews', exact: true }).click()
	await expect(page.getByRole('heading', { name: 'Reviews' })).toBeVisible()
	await page.getByRole('link', { name: 'Journal', exact: true }).click()
	await expect(
		page.getByRole('heading', { name: 'Recent Activity' }),
	).toBeVisible()
	await page.getByRole('link', { name: 'Collections', exact: true }).click()
	await expect(page.getByRole('heading', { name: 'Collections' })).toBeVisible()
	await page.getByRole('link', { name: 'Stats', exact: true }).click()
	await expect(page.getByRole('heading', { name: 'Stats' })).toBeVisible()
	const mediaFilter = page.getByRole('group', {
		name: 'Filter statistics by media type',
	})
	await expect(
		mediaFilter.getByRole('button', { name: 'Anime', exact: true }),
	).toHaveAttribute('aria-pressed', 'true')
	const chartView = page.getByLabel('Chart view', { exact: true })
	for (const chart of [
		{
			value: 'watchlist',
			heading: 'Watchlist Overview',
			label: 'Watchlist status distribution',
		},
		{
			value: 'listTypeDistribution',
			heading: 'List Type Distribution',
			label: 'List type distribution',
		},
		{
			value: 'score',
			heading: 'Score Distribution',
			label: 'Score distribution',
		},
		{
			value: 'objectiveScores',
			heading: 'Personal vs Public Scores',
			label: 'Personal score distribution by MAL score',
		},
		{
			value: 'release',
			heading: 'Release Date Distribution',
			label: 'Release year distribution',
		},
		{
			value: 'watched',
			heading: 'Watch Date Distribution',
			label: 'Completion year distribution',
		},
		{
			value: 'genreChords',
			heading: 'Genre Overlap',
			label: 'Genre overlap',
		},
		{
			value: 'type',
			heading: 'Media Type Distribution',
			label: 'Media type distribution',
		},
	]) {
		await chartView.selectOption(chart.value)
		await expect(
			page.getByRole('heading', { name: chart.heading, exact: true }),
		).toBeVisible()
		await expect(
			page
				.locator('.user-landing-chart-stage')
				.getByRole('img', { name: chart.label, exact: true }),
		).toBeVisible()
	}
	await page.getByRole('link', { name: 'Social', exact: true }).click()
	await expect(page.getByRole('heading', { name: 'Guestbook' })).toBeVisible()

	const combinedTimings = navigationTimings.join(',')
	expect(combinedTimings).toContain('profile_reviews')
	expect(combinedTimings).toContain('profile_activity')
	expect(combinedTimings).toContain('profile_stats')
	expect(combinedTimings).not.toContain('profile_shell')
})
