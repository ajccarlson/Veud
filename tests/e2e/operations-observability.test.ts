import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

const incidentTitle = 'Browser operations fixture'

test('operators can publish and resolve a public incident', async ({
	page,
	login,
}) => {
	test.setTimeout(60_000)
	await prisma.serviceIncident.deleteMany({ where: { title: incidentTitle } })
	const operator = await login()
	await prisma.user.update({
		where: { id: operator.id },
		data: { roles: { connect: { name: 'site-operator' } } },
	})

	try {
		const health = await page.request.get('/resources/healthcheck')
		expect(health.ok()).toBe(true)
		expect(health.headers()['x-request-id']).toMatch(
			/^[0-9a-f]{8}-[0-9a-f-]{27}$/,
		)
		expect(health.headers()['x-veud-release']).toBeTruthy()

		await page.goto('/admin/operations')
		await expect(
			page.getByRole('heading', { name: 'Site operations', exact: true }),
		).toBeVisible()
		await expect(page.getByText('Overall readiness')).toBeVisible()
		await expect(page.getByText('Database', { exact: true })).toBeVisible()

		await page.getByLabel('Title', { exact: true }).fill(incidentTitle)
		await page
			.getByLabel('Public summary')
			.fill('Search results are temporarily delayed during a queue repair.')
		await page.getByLabel('Severity').selectOption('minor')
		await page.getByLabel('search', { exact: true }).check()
		await page.getByRole('button', { name: 'Publish incident' }).click()
		await expect(page.getByText(incidentTitle)).toBeVisible()

		await page.goto('/status')
		await expect(
			page.getByRole('heading', { name: 'Service status', exact: true }),
		).toBeVisible()
		await expect(page.getByText('Degraded performance')).toBeVisible()
		await expect(page.getByText(incidentTitle)).toBeVisible()
		await expect(page.getByText('Affected', { exact: true })).toHaveCount(1)

		await page.goto('/admin/operations')
		const incident = page.locator('li').filter({ hasText: incidentTitle })
		await incident.locator('select[name="status"]').selectOption('resolved')
		await incident
			.getByPlaceholder('Public update')
			.fill('The indexing queue is healthy and caught up.')
		await incident.getByRole('button', { name: 'Publish update' }).click()
		await expect
			.poll(async () => {
				const current = await prisma.serviceIncident.findFirst({
					where: { title: incidentTitle },
					select: { status: true },
				})
				return current?.status
			})
			.toBe('resolved')

		await page.goto('/status')
		await expect(page.getByText('All systems operational')).toBeVisible()
		await expect(page.getByText(incidentTitle)).toBeVisible()
		await expect(page.getByText('The indexing queue is healthy')).toBeVisible()

		await page.setViewportSize({ width: 390, height: 844 })
		await page.reload()
		const width = await page.evaluate(() => ({
			viewport: window.innerWidth,
			document: document.documentElement.scrollWidth,
		}))
		expect(width.document).toBeLessThanOrEqual(width.viewport)
	} finally {
		await prisma.serviceIncident.deleteMany({ where: { title: incidentTitle } })
	}
})

test('site operations redirects anonymous visitors to login', async ({
	page,
}) => {
	await page.goto('/admin/operations')
	await expect(page).toHaveURL(/\/login/)
})
