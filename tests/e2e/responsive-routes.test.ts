import { type Page } from '@playwright/test'
import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

const MOBILE_VIEWPORT = { width: 390, height: 844 }

async function expectResponsiveDocument(page: Page) {
	await expect(page.locator('body')).toBeVisible()

	const metrics = await page.evaluate(() => {
		const content = document.querySelector('.root-content')
		const footer = document.querySelector('.site-footer')
		return {
			viewportWidth: window.innerWidth,
			documentWidth: document.documentElement.scrollWidth,
			bodyWidth: document.body.scrollWidth,
			bodyFontSize: Number.parseFloat(getComputedStyle(document.body).fontSize),
			contentFooterOverlap:
				content && footer
					? Math.max(
							0,
							content.getBoundingClientRect().bottom -
								footer.getBoundingClientRect().top,
						)
					: 0,
			undersizedControls: Array.from(
				document.querySelectorAll<HTMLElement>(
					'button, [role="button"], select, textarea, input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])',
				),
			)
				.filter(element => {
					const bounds = element.getBoundingClientRect()
					const style = getComputedStyle(element)
					return (
						style.visibility !== 'hidden' &&
						style.display !== 'none' &&
						bounds.width > 0 &&
						bounds.height > 0 &&
						bounds.height < 43
					)
				})
				.map(element => element.getAttribute('aria-label') ?? element.tagName),
		}
	})

	expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth)
	expect(metrics.bodyWidth).toBeLessThanOrEqual(metrics.viewportWidth)
	expect(metrics.bodyFontSize).toBeGreaterThanOrEqual(14)
	expect(metrics.contentFooterOverlap).toBeLessThanOrEqual(1)
	expect(metrics.undersizedControls).toEqual([])
}

test.describe('mobile route audit', () => {
	test.use({
		viewport: MOBILE_VIEWPORT,
		hasTouch: true,
		isMobile: true,
	})

	const publicRoutes = [
		['home', '/', /Veud|Trending/i],
		['discover', '/discover', /Discover/i],
		['calendar', '/calendar', /Release calendar/i],
		['reviews', '/reviews', /Reviews/i],
		['collections', '/collections', /Collections/i],
		['credits', '/credits', /Data sources & credits/i],
		['login', '/login', /Welcome back/i],
		['signup', '/signup', /start your journey/i],
		['password recovery', '/forgot-password', /Forgot Password/i],
	] as const

	for (const [name, path, heading] of publicRoutes) {
		test(`${name} stays inside the mobile viewport`, async ({ page }) => {
			await page.goto(path)
			await expect(
				page.getByRole('heading', { name: heading }).first(),
			).toBeVisible()
			await expectResponsiveDocument(page)
		})
	}

	test('member routes stay inside the mobile viewport', async ({
		page,
		login,
	}) => {
		test.setTimeout(45_000)
		const user = await login()
		const routes = [
			['/notifications', /Notifications/i],
			['/settings/profile', /Edit profile/i],
			['/settings/profile/notifications', /Edit profile/i],
			['/settings/profile/photo', /Edit profile/i],
			['/settings/profile/banner', /Edit profile/i],
			['/settings/profile/change-email', /Edit profile/i],
			['/settings/profile/password', /Edit profile/i],
			['/settings/profile/two-factor', /Edit profile/i],
			['/collections/new', /New collection/i],
			[`/users/${user.username}`, new RegExp(user.username, 'i')],
		] as const

		for (const [path, heading] of routes) {
			await page.goto(path)
			await expect(
				page.getByRole('heading', { name: heading }).first(),
			).toBeVisible()
			await expectResponsiveDocument(page)
		}
	})

	test('media and collection detail routes remain usable on mobile', async ({
		page,
		login,
	}) => {
		const user = await login()
		const mediaTitle =
			'Responsive detail fixture with a deliberately long title'
		const media = await prisma.media.create({
			data: {
				kind: 'movie',
				title: mediaTitle,
				description:
					'A detailed mobile fixture that exercises metadata and collection cards.',
			},
		})
		const collection = await prisma.mediaCollection.create({
			data: {
				ownerId: user.id,
				title: 'Responsive collection detail fixture',
				description: 'A collection used by the route-wide responsive audit.',
				isPublic: true,
				items: { create: { mediaId: media.id, position: 1 } },
			},
		})

		try {
			const routes = [
				[`/media/${media.id}`, mediaTitle],
				[`/collections/${collection.id}`, collection.title],
				[`/collections/${collection.id}/edit`, 'Edit collection'],
			] as const

			for (const [path, heading] of routes) {
				await page.goto(path)
				await expect(
					page.getByRole('heading', { name: heading, exact: true }).first(),
				).toBeVisible()
				await expectResponsiveDocument(page)
			}
		} finally {
			await prisma.mediaCollection
				.delete({ where: { id: collection.id } })
				.catch(() => {})
			await prisma.media.delete({ where: { id: media.id } }).catch(() => {})
		}
	})
})
