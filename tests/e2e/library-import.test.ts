import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

test('previews, applies, and safely rolls back a member library import', async ({
	page,
	login,
}) => {
	const user = await login()
	const externalId = crypto.randomUUID().replaceAll('-', '').slice(0, 12)
	const media = await prisma.media.create({
		data: {
			kind: 'anime',
			title: 'Library import browser fixture',
			externalIds: {
				create: { provider: 'mal', kind: 'anime', externalId },
			},
		},
	})
	await page.setViewportSize({ width: 390, height: 844 })
	await page.goto('/settings/profile/import')
	await expect(
		page.getByRole('heading', { name: 'Import another library' }),
	).toBeVisible()
	await page.getByLabel('Export file').setInputFiles({
		name: 'mal-export.xml',
		mimeType: 'application/xml',
		buffer: Buffer.from(`
			<myanimelist><anime>
				<series_animedb_id>${externalId}</series_animedb_id>
				<series_title>Source-side title</series_title>
				<my_status>Completed</my_status>
				<my_score>8</my_score>
				<my_watched_episodes>12</my_watched_episodes>
			</anime></myanimelist>
		`),
	})
	await page.getByRole('button', { name: 'Build conflict preview' }).click()
	await expect(page.getByRole('status')).toContainText(
		'Built a private preview for 1 entry',
	)
	await expect(
		page.getByRole('heading', { name: 'Source-side title' }),
	).toBeVisible()
	await expect(
		page.getByText(/Matched Library import browser fixture/),
	).toBeVisible()

	await page.getByRole('button', { name: 'Apply selected entries' }).click()
	await expect(page.getByRole('status')).toContainText(
		'Imported 1 entry atomically',
	)
	const applied = await prisma.trackingState.findUniqueOrThrow({
		where: { ownerId_mediaId: { ownerId: user.id, mediaId: media.id } },
		include: { progress: true, statusWatchlist: true },
	})
	expect(applied.status).toBe('completed')
	expect(Number(applied.score)).toBe(8)
	expect(applied.progress).toEqual([
		expect.objectContaining({ unit: 'episode', current: 12 }),
	])
	expect(applied.statusWatchlist?.isPublic).toBe(false)

	await page.getByRole('button', { name: 'Roll back import' }).click()
	await expect(page.getByRole('status')).toContainText(
		'Rolled back 1 entry',
	)
	expect(
		await prisma.trackingState.findUnique({
			where: { ownerId_mediaId: { ownerId: user.id, mediaId: media.id } },
		}),
	).toBeNull()
	const bounds = await page.evaluate(() => ({
		scroll: document.documentElement.scrollWidth,
		client: document.documentElement.clientWidth,
	}))
	expect(bounds.scroll).toBeLessThanOrEqual(bounds.client)
})
