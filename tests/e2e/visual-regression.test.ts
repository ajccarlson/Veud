import path from 'node:path'
import { expect, test } from '#tests/playwright-utils.ts'

const stableScreenshot = {
	animations: 'disabled',
	caret: 'hide',
	fullPage: true,
	maxDiffPixelRatio: 0.01,
	scale: 'css',
	stylePath: path.join(process.cwd(), 'tests/visual-regression.css'),
} as const

test.use({
	colorScheme: 'dark',
	contextOptions: {
		reducedMotion: 'reduce',
	},
	locale: 'en-US',
	timezoneId: 'UTC',
})

test('credits page retains its desktop visual hierarchy', async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 900 })
	await page.goto('/credits')
	await expect(
		page.getByRole('heading', { name: 'Data sources & credits' }),
	).toBeVisible()
	await page.evaluate(() => document.fonts.ready)
	await expect(page).toHaveScreenshot('credits-desktop.png', stableScreenshot)
})

test('credits page retains its compact mobile composition', async ({
	page,
}) => {
	await page.setViewportSize({ width: 390, height: 844 })
	await page.goto('/credits')
	await expect(
		page.getByRole('heading', { name: 'Data sources & credits' }),
	).toBeVisible()
	await page.evaluate(() => document.fonts.ready)
	await expect(page).toHaveScreenshot('credits-mobile.png', stableScreenshot)
})

test('login form retains its desktop shell and focus hierarchy', async ({
	page,
}) => {
	await page.setViewportSize({ width: 1280, height: 900 })
	await page.goto('/login')
	await expect(
		page.getByRole('heading', { name: 'Welcome back' }),
	).toBeVisible()
	await page.evaluate(() => document.fonts.ready)
	await expect(page).toHaveScreenshot('login-desktop.png', stableScreenshot)
})
