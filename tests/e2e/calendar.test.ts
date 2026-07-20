import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

test('member can browse a release week and focus on tracked titles', async ({
	page,
	login,
}) => {
	const viewer = await login()
	const listType = await prisma.listType.findUniqueOrThrow({
		where: { name: 'anime' },
	})
	const watching = await prisma.watchlist.create({
		data: {
			ownerId: viewer.id,
			typeId: listType.id,
			name: 'watching',
			header: 'Watching',
		},
	})
	const [trackedEpisode, publicPremiere, outside] = await Promise.all([
		prisma.media.create({
			data: {
				kind: 'anime',
				title: 'Browser Calendar Episode',
				type: 'TV Series',
				nextRelease: JSON.stringify({
					releaseDate: '2026-07-21T18:30:00.000Z',
					season: 2,
					episode: 4,
					name: 'Browser episode fixture',
				}),
			},
		}),
		prisma.media.create({
			data: {
				kind: 'movie',
				title: 'Browser Calendar Premiere',
				releaseStart: new Date('2026-07-22T00:00:00.000Z'),
			},
		}),
		prisma.media.create({
			data: {
				kind: 'anime',
				title: 'Browser Outside Calendar',
				releaseStart: new Date('2026-07-29T00:00:00.000Z'),
			},
		}),
	])
	await prisma.trackingState.create({
		data: {
			ownerId: viewer.id,
			mediaId: trackedEpisode.id,
			status: 'watching',
			statusWatchlistId: watching.id,
			score: 8,
		},
	})

	try {
		await page.goto('/calendar?start=2026-07-20')
		await expect(
			page.getByRole('heading', { name: 'Release calendar' }),
		).toBeVisible()
		await expect(page.getByText('July 20 – July 26, 2026')).toBeVisible()
		await expect(page.getByText('Browser Calendar Episode')).toBeVisible()
		await expect(page.getByText('Season 2 · Episode 4')).toBeVisible()
		await expect(page.getByText('6:30 PM UTC')).toBeVisible()
		await expect(page.getByText('Browser Calendar Premiere')).toBeVisible()
		await expect(page.getByText('Browser Outside Calendar')).not.toBeVisible()

		await page.getByLabel('Release scope').selectOption('mine')
		await page.getByRole('button', { name: 'Show schedule' }).click()
		await expect(page).toHaveURL(/scope=mine/)
		await expect(page.getByText('Browser Calendar Episode')).toBeVisible()
		await expect(page.getByText('Watching · 8/10')).toBeVisible()
		await expect(page.getByText('1 member tracking')).toBeVisible()
		await expect(page.getByText('Browser Calendar Premiere')).not.toBeVisible()
		await expect(
			page.getByRole('link', { name: 'Next week →' }),
		).toHaveAttribute('href', '/calendar?start=2026-07-27&kind=all&scope=mine')

		const exportLink = page.getByRole('link', {
			name: 'Export this week (.ics)',
		})
		await expect(exportLink).toHaveAttribute(
			'href',
			'/resources/calendar.ics?start=2026-07-20&kind=all&scope=mine',
		)
		const downloadPromise = page.waitForEvent('download')
		await exportLink.click()
		const download = await downloadPromise
		expect(download.suggestedFilename()).toBe('veud-releases-2026-07-20.ics')
		const stream = await download.createReadStream()
		let calendarBody = ''
		for await (const chunk of stream) calendarBody += chunk.toString()
		expect(calendarBody).toContain('BEGIN:VCALENDAR')
		expect(calendarBody).toContain('Browser Calendar Episode')
		expect(calendarBody).not.toContain('Browser Calendar Premiere')
	} finally {
		await prisma.media
			.deleteMany({
				where: {
					id: { in: [trackedEpisode.id, publicPremiere.id, outside.id] },
				},
			})
			.catch(() => {})
	}
})
