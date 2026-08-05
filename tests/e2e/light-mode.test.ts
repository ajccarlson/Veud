import { expect, test } from '#tests/playwright-utils.ts'

async function backgroundOf(page: any) {
	return page.evaluate(() => getComputedStyle(document.body).backgroundColor)
}

test('a visitor can switch to light mode and back, and it sticks', async ({
	page,
}) => {
	// Pinned, because the default browser scheme decides where the cycle starts
	// and this test is about the switch, not about the device.
	await page.emulateMedia({ colorScheme: 'dark' })
	await page.goto('/')
	const html = page.locator('html')
	await expect(html).toHaveClass(/dark/)

	// The switch cycles system → light → dark, so the label says where it goes.
	const toggle = page.getByRole('button', { name: /light|dark|system/i }).last()
	await expect(toggle).toBeVisible()

	const startingBackground = await backgroundOf(page)

	await toggle.click()
	await expect(html).toHaveClass(/light/)
	const lightBackground = await backgroundOf(page)
	// A real light mode, not a class that sets nothing — which is exactly what
	// the previous `.light` block was.
	expect(lightBackground).not.toBe(startingBackground)

	// Paper, not ink: the light background is bright.
	const [r, g, b] = lightBackground.match(/\d+/g)!.map(Number)
	expect((r + g + b) / 3).toBeGreaterThan(200)

	// It survives a reload, so the choice is stored rather than optimistic.
	await page.reload()
	await expect(html).toHaveClass(/light/)
	expect(await backgroundOf(page)).toBe(lightBackground)

	await page
		.getByRole('button', { name: /light|dark|system/i })
		.last()
		.click()
	await expect(html).toHaveClass(/dark/)
	const darkBackground = await backgroundOf(page)
	const [dr, dg, db] = darkBackground.match(/\d+/g)!.map(Number)
	expect((dr + dg + db) / 3).toBeLessThan(80)
})

test('text stays readable against the light palette', async ({ page }) => {
	await page.emulateMedia({ colorScheme: 'dark' })
	await page.goto('/')
	await page
		.getByRole('button', { name: /light|dark|system/i })
		.last()
		.click()
	await expect(page.locator('html')).toHaveClass(/light/)

	// A light background with light text is the classic way a half-finished
	// light mode ships.
	const contrast = await page.evaluate(() => {
		const luminance = (color: string) => {
			const [r, g, b] = color.match(/\d+/g)!.map(Number) as [
				number,
				number,
				number,
			]
			const channel = (value: number) => {
				const scaled = value / 255
				return scaled <= 0.03928
					? scaled / 12.92
					: Math.pow((scaled + 0.055) / 1.055, 2.4)
			}
			return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
		}
		const body = getComputedStyle(document.body)
		const background = luminance(body.backgroundColor)
		const foreground = luminance(body.color)
		const lighter = Math.max(background, foreground)
		const darker = Math.min(background, foreground)
		return (lighter + 0.05) / (darker + 0.05)
	})
	// WCAG AA for body text.
	expect(contrast).toBeGreaterThan(4.5)
})
