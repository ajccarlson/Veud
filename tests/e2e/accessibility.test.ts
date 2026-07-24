import AxeBuilder from '@axe-core/playwright'
import { type Page } from '@playwright/test'
import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

const wcagTags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

async function expectNoAccessibilityViolations(page: Page) {
	const results = await new AxeBuilder({ page }).withTags(wcagTags).analyze()
	expect(
		results.violations.map(violation => ({
			id: violation.id,
			impact: violation.impact,
			description: violation.description,
			targets: violation.nodes.map(node => node.target.join(' ')),
		})),
	).toEqual([])
}

for (const [name, path] of [
	['home', '/'],
	['discover', '/discover'],
	['calendar', '/calendar'],
	['reviews', '/reviews'],
	['collections', '/collections'],
	['credits', '/credits'],
	['login', '/login'],
	['signup', '/signup'],
] as const) {
	test(`${name} meets automated WCAG A and AA checks`, async ({ page }) => {
		await page.goto(path)
		await expect(page.locator('h1').first()).toBeVisible()
		await expectNoAccessibilityViolations(page)
	})
}

test('signed-in settings and profile meet automated WCAG checks', async ({
	page,
	login,
}) => {
	const user = await login()
	for (const path of [
		'/settings/profile',
		'/settings/profile/notifications',
		'/assistant',
		'/discover?mode=memory',
		`/users/${user.username}`,
	]) {
		await page.goto(path)
		await expect(page.locator('h1').first()).toBeVisible()
		await expectNoAccessibilityViolations(page)
	}
})

test('configurable member home dashboard meets automated WCAG checks', async ({
	page,
	login,
}) => {
	await login()
	await page.goto('/')
	await expect(
		page.getByRole('region', { name: 'Personal home dashboard' }),
	).toBeVisible()
	await page.getByText('Customize home', { exact: true }).click()
	await expectNoAccessibilityViolations(page)
})

test('explainable recommendation lanes meet automated WCAG checks', async ({
	page,
	login,
}) => {
	const user = await login()
	const [seed, candidate] = await Promise.all([
		prisma.media.create({
			data: {
				kind: 'movie',
				title: 'Accessibility recommendation seed',
				genres: 'Accessible Adventure',
			},
		}),
		prisma.media.create({
			data: {
				kind: 'movie',
				title: 'Accessibility recommendation candidate',
				genres: 'Accessible Adventure',
			},
		}),
	])
	await prisma.trackingState.create({
		data: {
			ownerId: user.id,
			mediaId: seed.id,
			status: 'completed',
			score: 9,
		},
	})

	try {
		await page.goto('/discover?sort=for-you')
		await expect(
			page.getByRole('heading', { name: 'Recommendations for you' }),
		).toBeVisible()
		await expect(page.getByText(candidate.title!)).toBeVisible()
		await expectNoAccessibilityViolations(page)
	} finally {
		await prisma.media
			.deleteMany({ where: { id: { in: [seed.id, candidate.id] } } })
			.catch(() => {})
	}
})

test('mobile navigation meets automated WCAG checks while expanded', async ({
	page,
}) => {
	await page.setViewportSize({ width: 390, height: 844 })
	await page.goto('/credits')
	await page.getByLabel('Open site navigation').click()
	await expect(
		page.getByLabel('Site navigation', { exact: true }),
	).toBeVisible()
	await expectNoAccessibilityViolations(page)
})

test('media detail and list tracking surfaces meet automated WCAG checks', async ({
	page,
	login,
}) => {
	const user = await login()
	const listType = await prisma.listType.findFirstOrThrow({
		where: { name: 'liveaction' },
	})
	const media = await prisma.media.create({
		data: {
			kind: 'movie',
			title: 'Accessibility gate fixture',
			description:
				'A deterministic title used to verify tracking interface semantics.',
		},
	})
	const watchlist = await prisma.watchlist.create({
		data: {
			ownerId: user.id,
			typeId: listType.id,
			name: 'watching',
			header: 'Watching',
			position: 1,
			displayedColumns: 'position, title, type',
			entries: {
				create: {
					mediaId: media.id,
					title: media.title ?? 'Accessibility gate fixture',
					position: 1,
				},
			},
		},
	})

	try {
		for (const path of [
			`/media/${media.id}`,
			`/lists/${user.username}/${listType.name}/${watchlist.name}`,
		]) {
			await page.goto(path)
			await expect(page.locator('h1').first()).toBeVisible()
			await expectNoAccessibilityViolations(page)
		}
	} finally {
		await prisma.media.delete({ where: { id: media.id } }).catch(() => {})
	}
})

test('keyboard users can skip repeated navigation and operate site menus', async ({
	page,
}) => {
	await page.goto('/credits')
	await page.keyboard.press('Tab')
	const skipLink = page.getByRole('link', { name: 'Skip to main content' })
	await expect(skipLink).toBeFocused()
	await expect(skipLink).toBeVisible()
	await page.keyboard.press('Enter')
	await expect(page.locator('#main-content')).toBeFocused()

	await page.goto('/')
	const community = page.getByRole('button', { name: 'Community' })
	await community.focus()
	await expect(community).toBeFocused()
	await page.keyboard.press('Enter')
	const menu = page.getByRole('menu')
	await expect(menu).toBeVisible()
	await page.keyboard.press('ArrowDown')
	await page.keyboard.press('Enter')
	await expect(page).toHaveURL(/\/discover$/)
})

test('reduced-motion preference minimizes global animation and transitions', async ({
	page,
}) => {
	await page.emulateMedia({ reducedMotion: 'reduce' })
	await page.goto('/credits')
	const metrics = await page.evaluate(() => {
		const probe = document.createElement('div')
		probe.style.animation = 'accessibility-probe 10s linear infinite'
		probe.style.transition = 'transform 5s ease'
		document.body.append(probe)
		const style = getComputedStyle(probe)
		return {
			reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
			animationDuration: style.animationDuration,
			animationIterationCount: style.animationIterationCount,
			transitionDuration: style.transitionDuration,
		}
	})
	expect(metrics.reduced).toBe(true)
	expect(metrics.animationIterationCount).toBe('1')
	expect(Number.parseFloat(metrics.animationDuration)).toBeLessThanOrEqual(
		0.001,
	)
	expect(Number.parseFloat(metrics.transitionDuration)).toBeLessThanOrEqual(
		0.001,
	)
})

test('projector beam scales, pauses, and has a static reduced-motion state', async ({
	page,
}) => {
	await page.setViewportSize({ width: 1440, height: 900 })
	await page.emulateMedia({
		colorScheme: 'dark',
		reducedMotion: 'no-preference',
	})
	await page.goto('/credits')
	const beam = page.locator('.root-logo-projector-beam')
	await expect(beam).toBeVisible()
	const wide = await beam.evaluate(element => {
		const style = getComputedStyle(element)
		const highlight = getComputedStyle(element, '::before')
		return {
			width: Number.parseFloat(style.width),
			animation: style.animationName,
			highlightAnimation: highlight.animationName,
		}
	})
	expect(wide.width).toBeGreaterThan(60)
	expect(wide.animation).toContain('veud-projector-breathe')
	expect(wide.highlightAnimation).toContain('veud-projector-sweep')

	await page.setViewportSize({ width: 760, height: 900 })
	const narrowWidth = await beam.evaluate(element =>
		Number.parseFloat(getComputedStyle(element).width),
	)
	expect(narrowWidth).toBeLessThan(wide.width)
	expect(narrowWidth).toBeGreaterThanOrEqual(60)

	await page.evaluate(() =>
		document.documentElement.classList.add('veud-document-hidden'),
	)
	expect(
		await beam.evaluate(
			element => getComputedStyle(element).animationPlayState,
		),
	).toBe('paused')

	await page.emulateMedia({ reducedMotion: 'reduce' })
	expect(
		await beam.evaluate(element => getComputedStyle(element).animationName),
	).toBe('none')
	expect(
		await beam.evaluate(
			element => getComputedStyle(element, '::before').display,
		),
	).toBe('none')

	await page.setViewportSize({ width: 390, height: 844 })
	await expect(beam).toBeHidden()
})
