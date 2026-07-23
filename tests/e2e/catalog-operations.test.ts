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
		where: {
			title: {
				in: [
					'Catalog Operations Fixture',
					'Catalog Merge Fixture Source',
					'Catalog Merge Fixture Target',
				],
			},
		},
	})
}

test('admin catalog operations dashboard is private, responsive, and live', async ({
	page,
	login,
}) => {
	test.setTimeout(60_000)
	await cleanupCatalogOperationsFixtures()
	const admin = await login()
	await prisma.user.update({
		where: { id: admin.id },
		data: { roles: { connect: { name: 'admin' } } },
	})
	const fixtureMedia = await prisma.media.create({
		data: {
			kind: 'anime',
			title: 'Catalog Operations Fixture',
			externalIds: {
				create: {
					provider: 'mal',
					kind: 'anime',
					externalId: 'catalog-operations-fixture',
					fetchStatus: 'fresh',
					hydrationPriority: 10_000,
					lastFetchedAt: new Date(),
				},
			},
		},
	})
	const fixtureIssue = await prisma.catalogQualityIssue.create({
		data: {
			fingerprint: `browser-quality-${fixtureMedia.id}`,
			issueType: 'missing_image',
			severity: 'info',
			confidence: 1,
			summary:
				'Catalog Operations Fixture is hydrated but has no poster image.',
			evidence: JSON.stringify({ source: 'browser-fixture' }),
			primaryMediaId: fixtureMedia.id,
		},
	})
	await prisma.media.createMany({
		data: [
			{
				id: 'browser-merge-source',
				kind: 'anime',
				title: 'Catalog Merge Fixture Source',
				description: 'Metadata preserved by the journal.',
			},
			{
				id: 'browser-merge-target',
				kind: 'anime',
				title: 'Catalog Merge Fixture Target',
			},
		],
	})
	await prisma.catalogQualityIssue.create({
		data: {
			id: 'browser-merge-issue',
			fingerprint: 'browser-merge-fingerprint',
			issueType: 'possible_duplicate',
			status: 'confirmed',
			severity: 'warning',
			confidence: 0.9,
			summary: 'Catalog Merge Fixture records are a reviewed duplicate.',
			primaryMediaId: 'browser-merge-source',
			secondaryMediaId: 'browser-merge-target',
			reviewedById: admin.id,
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
			page.getByRole('heading', { name: 'Catalog operations', exact: true }),
		).toBeVisible()
		await expect(
			page.getByText('Catalog sync telemetry is within'),
		).toBeVisible()
		const anime = page.getByRole('region', { name: 'MAL anime' })
		await expect(anime).toContainText('1 / 1')
		await expect(anime).toContainText('Eligible')
		await expect(page.getByText('browser-test-worker')).toBeHidden()
		await expect(
			page.getByRole('heading', { name: 'Catalog quality review' }),
		).toBeVisible()
		await expect(
			page.getByText(
				'Catalog Operations Fixture is hydrated but has no poster image.',
			),
		).toBeVisible()
		const qualityCard = page.getByTestId(`quality-issue-${fixtureIssue.id}`)
		await qualityCard
			.getByRole('button', { name: 'Queue provider repair' })
			.click()
		await expect(qualityCard.getByRole('status')).toContainText(
			'Saved as queued',
		)
		await qualityCard.getByRole('button', { name: 'Reopen review' }).click()
		await expect(qualityCard.getByRole('status')).toContainText('Saved as open')
		expect(
			await prisma.catalogQualityEvent.count({
				where: { issue: { primaryMediaId: fixtureMedia.id } },
			}),
		).toBe(2)

		const mergeCard = page.getByTestId('quality-issue-browser-merge-issue')
		await mergeCard
			.getByRole('button', { name: 'Keep Catalog Merge Fixture Target' })
			.click()
		await expect(mergeCard.getByText('Preflight safe')).toBeVisible()
		await mergeCard
			.locator('input[name="confirmation"]')
			.fill('MERGE browser-merge-source INTO browser-merge-target')
		await mergeCard
			.getByRole('button', { name: 'Apply journaled merge' })
			.click()
		await expect(mergeCard.getByRole('status')).toContainText(
			'Saved as applied',
		)
		expect(
			await prisma.media.findUnique({ where: { id: 'browser-merge-source' } }),
		).toBeNull()
		const merge = await prisma.catalogMediaMerge.findUniqueOrThrow({
			where: { issueId: 'browser-merge-issue' },
		})
		await mergeCard
			.locator('input[name="confirmation"]')
			.fill(`REVERT ${merge.id}`)
		await mergeCard
			.getByRole('button', { name: 'Reverse from journal' })
			.click()
		await expect(mergeCard.getByRole('status')).toContainText(
			'Saved as reverted',
		)
		expect(
			await prisma.media.findUnique({ where: { id: 'browser-merge-source' } }),
		).toEqual(
			expect.objectContaining({
				description: 'Metadata preserved by the journal.',
			}),
		)

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
