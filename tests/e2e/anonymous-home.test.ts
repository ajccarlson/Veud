import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

test('anonymous home explains the product and runs its catalog memory demo', async ({
	page,
}) => {
	const media = await Promise.all(
		Array.from({ length: 5 }, (_, index) =>
			prisma.media.create({
				data: {
					kind: 'movie',
					title: `Glass Station Memory ${index + 1}`,
					description:
						'A traveler follows a red light through an abandoned glass station.',
					catalogPopularity: 100 - index,
				},
			}),
		),
	)

	try {
		await page.goto('/')
		await expect(
			page.getByRole('heading', {
				name: 'Remember it. Track it. Find what’s next.',
			}),
		).toBeVisible()
		await expect(
			page.getByRole('link', { name: 'Create your library' }).first(),
		).toHaveAttribute('href', '/signup')
		await expect(
			page.getByRole('heading', { name: 'Your library, at a glance' }),
		).toBeVisible()
		await expect(
			page.getByText('A sample watchlist', { exact: true }),
		).toBeVisible()
		await expect(
			page.locator('.home-anon-product-columns').getByText('Personal'),
		).toBeAttached()
		const sampleScoreColors = await page
			.locator('.home-anon-product-score')
			.evaluateAll(scores =>
				scores.map(score => getComputedStyle(score).backgroundColor),
			)
		expect(new Set(sampleScoreColors).size).toBeGreaterThan(2)
		await expect(page.getByText('MyAnimeList', { exact: true })).toBeVisible()
		await expect(page.getByText('Letterboxd', { exact: true })).toBeVisible()

		const memoryForm = page.locator('form.home-anon-memory-form')
		await expect(memoryForm).toHaveAttribute(
			'action',
			'/resources/image-tip-of-tongue',
		)
		await expect(memoryForm).toHaveAttribute('enctype', 'multipart/form-data')
		const imageInput = page.getByLabel('Add a screenshot or cover')
		await expect(imageInput).toBeVisible()
		await page
			.getByLabel('Describe the movie, show, anime, or manga you remember')
			.fill('a red light inside an abandoned glass station')
		await page.getByLabel('Memory search media type').selectOption('movie')
		await page.getByRole('button', { name: 'Find matches' }).click()
		await expect(
			page
				.locator('.home-anon-memory-results')
				.getByRole('link', { name: /Glass Station Memory 1/ }),
		).toBeVisible()
		await expect(page.locator('.home-anon-memory-result')).toHaveCount(5)
		await expect(
			page.getByText('5 of 5 matches · AI match', { exact: true }),
		).toBeVisible()
		await expect(page.locator('.home-anon-memory-result em')).toHaveCount(5)
		await expect(
			page.getByText('Want AI and image clues?', { exact: false }),
		).toHaveCount(0)
		await expect(
			page.getByRole('link', { name: 'Open the full search' }),
		).toHaveAttribute('href', '/discover?mode=memory')

		await page.setViewportSize({ width: 320, height: 900 })
		await expect(page.locator('.home-anon-memory-result').nth(4)).toBeVisible()
	} finally {
		await prisma.media
			.deleteMany({ where: { id: { in: media.map(item => item.id) } } })
			.catch(() => {})
	}
})

test('anonymous home remains bounded across responsive breakpoints', async ({
	page,
}) => {
	const media = await Promise.all(
		['movie', 'tv', 'anime', 'manga'].flatMap(kind =>
			Array.from({ length: 4 }, (_, index) =>
				prisma.media.create({
					data: {
						kind,
						title: `${kind} responsive catalog title with deliberately long text ${index + 1}`,
						catalogPopularity: 100 - index,
					},
				}),
			),
		),
	)

	try {
		for (const width of [320, 390, 640, 833, 1024, 1440]) {
			await page.setViewportSize({ width, height: 900 })
			await page.goto('/')
			await expect(
				page.getByRole('heading', {
					name: 'Remember it. Track it. Find what’s next.',
				}),
			).toBeVisible()
			await expect(page.getByText('Bring your history with you.')).toBeVisible()

			if (width === 320) {
				const tvPreviewRow = page
					.locator('.home-anon-product-row')
					.filter({ hasText: 'tv responsive catalog title' })
					.first()
				await expect(tvPreviewRow).toContainText('7 / 12')
				await expect(tvPreviewRow).not.toContainText('ch.')
				const sectionOrder = await page.evaluate(() => {
					const precedes = (first: Element | null, second: Element | null) =>
						Boolean(
							first &&
							second &&
							first.compareDocumentPosition(second) &
								Node.DOCUMENT_POSITION_FOLLOWING,
						)
					return {
						trendingBeforeProduct: precedes(
							document.querySelector('.home-anon-trending'),
							document.querySelector('.home-anon-product'),
						),
						capabilitiesBeforeImport: precedes(
							document.querySelector('.home-anon-capabilities'),
							document.querySelector('.home-anon-import'),
						),
					}
				})
				expect(sectionOrder).toEqual({
					trendingBeforeProduct: true,
					capabilitiesBeforeImport: true,
				})
			}

			const dimensions = await page.evaluate(() => {
				const viewport = window.innerWidth
				const sections = [
					'.home-anon-hero',
					'.home-anon-import',
					'.home-anon-product',
					'.home-anon-capabilities',
					'.home-anon-trending',
					'.home-anon-proof',
					'.home-anon-final',
				]
				const offenders = sections
					.flatMap(selector => [
						...document.querySelectorAll<HTMLElement>(selector),
					])
					.map(element => {
						const rect = element.getBoundingClientRect()
						return {
							element: `${element.tagName.toLowerCase()}.${element.className}`,
							left: Math.round(rect.left),
							right: Math.round(rect.right),
							width: Math.round(rect.width),
						}
					})
					.filter(item => item.left < -1 || item.right > viewport + 1)
				const clipped = [
					...document.querySelectorAll<HTMLElement>(
						'.home-anon-hero-copy, .home-anon-memory, .home-anon-product-table, .home-anon-product-sidebar',
					),
				]
					.filter(element => element.scrollWidth > element.clientWidth + 1)
					.map(element => ({
						element: `${element.tagName.toLowerCase()}.${element.className}`,
						clientWidth: element.clientWidth,
						scrollWidth: element.scrollWidth,
					}))
				return {
					viewport,
					document: document.documentElement.scrollWidth,
					offenders,
					clipped,
				}
			})
			expect(
				dimensions.document,
				`${width}px: ${JSON.stringify(dimensions.offenders, null, 2)}`,
			).toBeLessThanOrEqual(dimensions.viewport)
			expect(dimensions.offenders, `${width}px section boundaries`).toEqual([])
			expect(dimensions.clipped, `${width}px clipped content`).toEqual([])
		}
	} finally {
		await prisma.media
			.deleteMany({ where: { id: { in: media.map(item => item.id) } } })
			.catch(() => {})
	}
})
