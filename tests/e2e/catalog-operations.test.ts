import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

async function cleanupCatalogOperationsFixtures() {
	await prisma.catalogSyncRun.deleteMany({
		where: { leaseOwner: 'browser-test-worker' },
	})
	await prisma.catalogSyncCursor.deleteMany({
		where: { leaseOwner: 'browser-test-worker' },
	})
	await prisma.media.deleteMany({
		where: { title: 'Catalog Operations Fixture' },
	})
}

test('admin catalog operations dashboard is private, responsive, and live', async ({
	page,
	login,
}) => {
	test.setTimeout(30_000)
	await cleanupCatalogOperationsFixtures()
	const admin = await login()
	await prisma.user.update({
		where: { id: admin.id },
		data: { roles: { connect: { name: 'admin' } } },
	})
	await prisma.media.create({
		data: {
			kind: 'anime',
			title: 'Catalog Operations Fixture',
			externalIds: {
				create: {
					provider: 'mal',
					kind: 'anime',
					externalId: 'catalog-operations-fixture',
					fetchStatus: 'pending',
					hydrationPriority: 10_000,
				},
			},
		},
	})
	await prisma.catalogSyncRun.create({
		data: {
			provider: 'mal',
			kind: 'anime',
			mode: 'hydrate',
			status: 'running',
			leaseOwner: 'browser-test-worker',
			recordsSeen: 1,
			recordsHandled: 0,
			heartbeatAt: new Date(),
		},
	})
	await prisma.catalogSyncCursor.create({
		data: {
			provider: 'mal',
			kind: 'anime',
			mode: 'hydrate',
			leaseOwner: 'browser-test-worker',
			leaseExpiresAt: new Date(Date.now() + 5 * 60 * 1_000),
		},
	})

	try {
		await page.goto('/admin/catalog')
		await expect(
			page.getByRole('heading', { name: 'Catalog operations' }),
		).toBeVisible()
		await expect(
			page.getByText('Catalog sync telemetry is within'),
		).toBeVisible()
		const anime = page.getByRole('region', { name: 'MAL anime' })
		await expect(anime).toContainText('0 / 1')
		await expect(anime).toContainText('Eligible')
		await expect(page.getByText('browser-test-worker')).toBeHidden()

		await page.setViewportSize({ width: 390, height: 844 })
		await page.reload()
		const width = await page.evaluate(() => ({
			viewport: window.innerWidth,
			document: document.documentElement.scrollWidth,
			body: document.body.scrollWidth,
		}))
		expect(width.document).toBeLessThanOrEqual(width.viewport)
		expect(width.body).toBeLessThanOrEqual(width.viewport)
		await expect(
			page.getByRole('link', { name: 'Refresh snapshot' }),
		).toBeVisible()
	} finally {
		await cleanupCatalogOperationsFixtures()
	}
})

test('catalog operations redirects anonymous visitors to login', async ({
	page,
}) => {
	await page.goto('/admin/catalog')
	await expect(page).toHaveURL(/\/login/)
})
