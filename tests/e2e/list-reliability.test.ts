import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

async function titlesInOrder(watchlistId: string) {
	return prisma.entry
		.findMany({
			where: { watchlistId },
			orderBy: { position: 'asc' },
			select: { title: true, position: true },
		})
		.then(entries => entries.map(entry => `${entry.position}:${entry.title}`))
}

test('desktop row selection and bulk controls remain clear and actionable', async ({
	page,
	login,
}) => {
	const user = await login()
	const listType = await prisma.listType.findUniqueOrThrow({
		where: { name: 'anime' },
	})
	const [source, destination] = await Promise.all([
		prisma.watchlist.create({
			data: {
				name: 'bulk-source',
				header: 'Bulk source',
				position: 1,
				displayedColumns: 'position, title, type',
				ownerId: user.id,
				typeId: listType.id,
			},
		}),
		prisma.watchlist.create({
			data: {
				name: 'bulk-destination',
				header: 'Bulk destination',
				position: 2,
				displayedColumns: 'position, title, type',
				ownerId: user.id,
				typeId: listType.id,
			},
		}),
	])
	const entries = await Promise.all(
		['Bulk move entry', 'Row move entry', 'Bulk delete entry'].map(
			(title, index) =>
				prisma.entry.create({
					data: {
						watchlistId: source.id,
						position: index + 1,
						title,
						type: 'TV Series',
					},
				}),
		),
	)

	await page.goto(`/lists/${user.username}/anime/${source.name}`)
	const grid = page.locator('.ag-theme-custom-react')
	const row = (title: string) =>
		grid.locator('.ag-row').filter({ hasText: title })

	const moveRow = row('Bulk move entry')
	await expect(moveRow).toBeVisible()
	const quickEdit = moveRow.getByRole('button', {
		name: 'Quick edit Bulk move entry',
	})
	const moreActions = moveRow.getByRole('button', {
		name: 'More actions for Bulk move entry',
	})
	await expect
		.poll(() =>
			Promise.all(
				[quickEdit, moreActions].map(action =>
					action.evaluate(element => ({
						opacity: getComputedStyle(element).opacity,
						pointerEvents: getComputedStyle(element).pointerEvents,
					})),
				),
			),
		)
		.toEqual([
			{ opacity: '0', pointerEvents: 'none' },
			{ opacity: '0', pointerEvents: 'none' },
		])
	await moveRow.hover()
	await expect
		.poll(() =>
			Promise.all(
				[quickEdit, moreActions].map(action =>
					action.evaluate(element => ({
						opacity: getComputedStyle(element).opacity,
						pointerEvents: getComputedStyle(element).pointerEvents,
					})),
				),
			),
		)
		.toEqual([
			{ opacity: '1', pointerEvents: 'auto' },
			{ opacity: '1', pointerEvents: 'auto' },
		])
	await moreActions.focus()
	await expect
		.poll(() =>
			moreActions.evaluate(element => ({
				opacity: getComputedStyle(element).opacity,
				pointerEvents: getComputedStyle(element).pointerEvents,
			})),
		)
		.toEqual({ opacity: '1', pointerEvents: 'auto' })

	const selection = moveRow.locator(
		'.ag-selection-checkbox input[type="checkbox"]',
	)
	await selection.click()
	await expect(selection).toBeChecked()
	const checkbox = moveRow.locator('.ag-checkbox-input-wrapper')
	await expect(checkbox).toHaveClass(/ag-checked/)
	await expect
		.poll(() =>
			checkbox.evaluate(element =>
				getComputedStyle(element, '::after').content.replaceAll('"', ''),
			),
		)
		.toBe('✓')
	await expect(moveRow).toHaveClass(/ag-row-selected/)

	const toolbar = page.getByRole('toolbar', {
		name: 'Selected list entries',
	})
	await expect(toolbar).toContainText('1 title selected')
	await expect(
		toolbar.getByRole('button', { name: 'Delete selected' }),
	).toBeEnabled()
	await expect(
		toolbar.getByRole('button', { name: 'Move selected' }),
	).toBeDisabled()
	await expect(toolbar.getByLabel('Bulk move destination')).toHaveValue('')
	await expect(
		toolbar.getByLabel('Bulk move destination').locator('option').first(),
	).toHaveText('Choose destination')
	await expect(
		toolbar.getByLabel('Bulk move destination').locator('option').first(),
	).toBeDisabled()

	await toolbar.getByRole('button', { name: 'Clear' }).click()
	await expect(selection).not.toBeChecked()
	await expect(toolbar).toBeHidden()
	await selection.click()
	await expect(selection).toBeChecked()

	await toolbar.getByLabel('Bulk move destination').selectOption(destination.id)
	await toolbar.getByRole('button', { name: 'Move selected' }).click()
	await expect
		.poll(() =>
			prisma.entry.findUniqueOrThrow({
				where: { id: entries[0].id },
				select: { watchlistId: true },
			}),
		)
		.toEqual({ watchlistId: destination.id })
	await expect(toolbar).toBeHidden()

	const menuRow = row('Row move entry')
	await menuRow.hover()
	await menuRow
		.getByRole('button', { name: 'More actions for Row move entry' })
		.click()
	const moveSubmenu = page.getByRole('menuitem', {
		name: 'Move to another list',
	})
	await moveSubmenu.hover()
	const destinationItem = page.getByRole('menuitem', {
		name: 'Bulk destination',
	})
	await expect(destinationItem).toBeVisible()
	await destinationItem.click()
	await expect
		.poll(() =>
			prisma.entry.findUniqueOrThrow({
				where: { id: entries[1].id },
				select: { watchlistId: true },
			}),
		)
		.toEqual({ watchlistId: destination.id })

	await page.goto(`/lists/${user.username}/anime/${source.name}`)
	const deleteRow = row('Bulk delete entry')
	await deleteRow
		.locator('.ag-selection-checkbox input[type="checkbox"]')
		.click()
	page.once('dialog', dialog => dialog.accept())
	await page
		.getByRole('toolbar', { name: 'Selected list entries' })
		.getByRole('button', { name: 'Delete selected' })
		.click()
	await expect
		.poll(() => prisma.entry.count({ where: { id: entries[2].id } }))
		.toBe(0)
	await expect(
		page.getByRole('toolbar', { name: 'Selected list entries' }),
	).toBeHidden()
})

test.describe('touch watchlist row actions', () => {
	test.use({
		viewport: { width: 1024, height: 768 },
		hasTouch: true,
		isMobile: true,
	})

	test('keeps quick edit and more row actions available without hover', async ({
		page,
		login,
	}) => {
		const user = await login()
		const listType = await prisma.listType.findUniqueOrThrow({
			where: { name: 'anime' },
		})
		const watchlist = await prisma.watchlist.create({
			data: {
				name: 'touch-row-actions',
				header: 'Touch row actions',
				position: 1,
				displayedColumns: 'position, title, type',
				ownerId: user.id,
				typeId: listType.id,
			},
		})
		await prisma.entry.create({
			data: {
				watchlistId: watchlist.id,
				position: 1,
				title: 'Touch action entry',
				type: 'TV Series',
			},
		})

		await page.goto(`/lists/${user.username}/anime/${watchlist.name}`)
		await expect
			.poll(() =>
				page.evaluate(() => ({
					hoverless: window.matchMedia('(any-hover: none)').matches,
					coarsePointer: window.matchMedia('(any-pointer: coarse)').matches,
				})),
			)
			.toEqual({ hoverless: true, coarsePointer: true })
		const row = page
			.locator('.ag-row')
			.filter({ hasText: 'Touch action entry' })
		const actions = [
			row.getByRole('button', { name: 'Quick edit Touch action entry' }),
			row.getByRole('button', {
				name: 'More actions for Touch action entry',
			}),
		]

		await expect(row).toBeVisible()
		await expect
			.poll(() =>
				Promise.all(
					actions.map(action =>
						action.evaluate(element => ({
							opacity: getComputedStyle(element).opacity,
							pointerEvents: getComputedStyle(element).pointerEvents,
						})),
					),
				),
			)
			.toEqual([
				{ opacity: '1', pointerEvents: 'auto' },
				{ opacity: '1', pointerEvents: 'auto' },
			])
	})
})

test('member can type a new position and see the persisted order', async ({
	page,
	login,
}) => {
	const user = await login()
	const listType = await prisma.listType.findUniqueOrThrow({
		where: { name: 'anime' },
	})
	const source = await prisma.watchlist.create({
		data: {
			name: 'watching',
			header: 'Watching',
			position: 1,
			displayedColumns: 'position, title, type',
			ownerId: user.id,
			typeId: listType.id,
		},
	})
	await Promise.all([
		prisma.entry.create({
			data: {
				watchlistId: source.id,
				position: 1,
				title: 'First reliability entry',
				type: 'TV Series',
			},
		}),
		prisma.entry.create({
			data: {
				watchlistId: source.id,
				position: 2,
				title: 'Moved reliability entry',
				type: 'TV Series',
			},
		}),
		prisma.entry.create({
			data: {
				watchlistId: source.id,
				position: 3,
				title: 'Third reliability entry',
				type: 'TV Series',
			},
		}),
	])

	const listResourcePaths: string[] = []
	page.on('request', request => {
		const path = new URL(request.url()).pathname
		if (
			path.startsWith('/resources/lists/') ||
			path.startsWith('/lists/fetch/')
		) {
			listResourcePaths.push(path)
		}
	})
	await page.goto(`/lists/${user.username}/anime/${source.name}`)
	const firstPosition = page
		.locator('.ag-theme-custom-react')
		.getByLabel('Move First reliability entry to position')
	await firstPosition.fill('3')
	await firstPosition.press('Enter')
	await expect
		.poll(() => titlesInOrder(source.id))
		.toEqual([
			'1:Moved reliability entry',
			'2:Third reliability entry',
			'3:First reliability entry',
		])
	const renderedRows = page.locator('.ag-row')
	await expect(renderedRows.nth(0)).toContainText('Moved reliability entry')
	await expect(renderedRows.nth(1)).toContainText('Third reliability entry')
	await expect(renderedRows.nth(2)).toContainText('First reliability entry')

	await page.setViewportSize({ width: 390, height: 844 })
	const mobileList = page.getByRole('region', { name: 'Mobile list' })
	const mobileCards = mobileList.getByRole('article')
	await expect(mobileCards.nth(0)).toContainText('Moved reliability entry')
	await expect(mobileCards.nth(2)).toContainText('First reliability entry')
	const mobilePosition = mobileList.getByLabel(
		'Move First reliability entry to position',
	)
	await mobilePosition.fill('1')
	await mobilePosition.press('Enter')
	await expect
		.poll(() => titlesInOrder(source.id))
		.toEqual([
			'1:First reliability entry',
			'2:Moved reliability entry',
			'3:Third reliability entry',
		])
	await expect(mobileCards.nth(0)).toContainText('First reliability entry')
	expect(listResourcePaths).toContain('/resources/lists/v1')
	expect(listResourcePaths).toContain('/resources/lists/v1/entries')
	expect(listResourcePaths.some(path => path.startsWith('/lists/fetch/'))).toBe(
		false,
	)
})

test('member can keep tracking global search results across lists in one session', async ({
	page,
	login,
}) => {
	test.setTimeout(30_000)
	const user = await login()
	const listType = await prisma.listType.findUniqueOrThrow({
		where: { name: 'anime' },
	})
	const [watching, completed] = await Promise.all([
		prisma.watchlist.create({
			data: {
				name: 'watching',
				header: 'Watching',
				position: 1,
				displayedColumns: 'position, title, type',
				ownerId: user.id,
				typeId: listType.id,
			},
		}),
		prisma.watchlist.create({
			data: {
				name: 'completed',
				header: 'Completed',
				position: 2,
				displayedColumns: 'position, title, type',
				ownerId: user.id,
				typeId: listType.id,
			},
		}),
	])
	const titles = [
		'Universal Anime Alpha',
		'Universal Anime Beta',
		'Universal Anime Gamma',
	]
	const media = await Promise.all(
		titles.map((title, index) =>
			prisma.media.create({
				data: {
					kind: 'anime',
					title,
					type: 'TV Series',
					startSeason: 'Winter 2024',
					thumbnail: `https://example.com/universal-${index}.jpg|https://myanimelist.net/anime/${99100 + index}`,
					catalogPopularity: 100 - index,
					externalIds: {
						create: {
							provider: 'mal',
							kind: 'anime',
							externalId: String(99100 + index),
						},
					},
				},
			}),
		),
	)

	async function trackCatalogResult(
		title: string,
		destination: { id: string; header: string },
	) {
		const siteSearch = page.locator('form.site-search')
		await siteSearch
			.getByLabel('Search movies, TV, anime, manga, and people')
			.fill(title)
		await siteSearch.getByLabel('Media type').selectOption('anime')
		await siteSearch
			.getByLabel('Search movies, TV, anime, manga, and people')
			.press('Enter')
		await expect(page).toHaveURL(/\/discover\?q=/)
		const card = page.getByRole('article').filter({ hasText: title })
		await expect(card).toBeVisible()
		await expect(card.getByText('mal', { exact: true })).toBeVisible()
		const status = card.getByLabel(`Tracking status for ${title}`)
		if (title === titles[0] && destination.id === watching.id) {
			await expect(status).toHaveValue(watching.id)
		}
		await status.selectOption(destination.id)
		const verb = (await prisma.trackingState.count({
			where: { ownerId: user.id, mediaId: media[titles.indexOf(title)].id },
		}))
			? 'Update'
			: 'Track'
		await card.getByRole('button', { name: `${verb} ${title}` }).click()
		await expect
			.poll(() =>
				prisma.entry.count({
					where: {
						watchlistId: destination.id,
						mediaId: media[titles.indexOf(title)].id,
					},
				}),
			)
			.toBe(1)
	}

	await page.goto(`/lists/${user.username}/anime/${watching.name}`)
	await expect(page.getByRole('button', { name: 'Add title' })).toHaveCount(0)
	await expect(
		page
			.locator('form.site-search')
			.getByLabel('Search movies, TV, anime, manga, and people'),
	).toBeVisible()
	await trackCatalogResult(titles[0], watching)
	await page.setViewportSize({ width: 390, height: 844 })
	const siteSearchBounds = await page
		.locator('form.site-search')
		.evaluate(form => {
			const bounds = form.getBoundingClientRect()
			return { left: bounds.left, right: bounds.right, width: bounds.width }
		})
	expect(siteSearchBounds.left).toBeGreaterThanOrEqual(-1)
	expect(siteSearchBounds.right).toBeLessThanOrEqual(391)
	expect(siteSearchBounds.width).toBeGreaterThan(250)
	await page.setViewportSize({ width: 1280, height: 720 })
	await trackCatalogResult(titles[0], completed)
	await expect
		.poll(() => prisma.entry.count({ where: { watchlistId: watching.id } }))
		.toBe(0)
	await trackCatalogResult(titles[1], completed)
	await trackCatalogResult(titles[2], completed)

	expect(
		await prisma.entry.findMany({
			where: { watchlistId: completed.id },
			orderBy: { position: 'asc' },
			select: { title: true, position: true },
		}),
	).toEqual([
		{ title: titles[0], position: 1 },
		{ title: titles[1], position: 2 },
		{ title: titles[2], position: 3 },
	])
})

test('list grid fits the viewport and leaves missing scores blank', async ({
	page,
	login,
}) => {
	const user = await login()
	const listType = await prisma.listType.findUniqueOrThrow({
		where: { name: 'liveaction' },
	})
	const watchlist = await prisma.watchlist.create({
		data: {
			name: 'responsive-list',
			header: 'Responsive list',
			position: 1,
			displayedColumns:
				'position, thumbnail, title, averaged, personal, differencePersonal, tmdbScore, differenceObjective',
			ownerId: user.id,
			typeId: listType.id,
		},
	})
	await prisma.entry.create({
		data: {
			watchlistId: watchlist.id,
			position: 1,
			title: 'Unscored reliability entry',
			type: 'Movie',
			story: 0,
			character: 0,
			presentation: 0,
			sound: 0,
			performance: 0,
			enjoyment: 0,
			personal: 0,
			tmdbScore: 0,
			thumbnail: '/favicons/favicon.png|https://example.com/unscored',
		},
	})

	await page.setViewportSize({ width: 1280, height: 720 })
	await page.goto(`/lists/${user.username}/liveaction/${watchlist.name}`)

	const row = page
		.locator('.ag-row')
		.filter({ hasText: 'Unscored reliability entry' })
	for (const column of [
		'averaged',
		'personal',
		'differencePersonal',
		'tmdbScore',
		'differenceObjective',
	]) {
		await expect(row.locator(`[col-id="${column}"]`)).toHaveText('')
	}
	await expect(page.getByText('NaN', { exact: true })).toHaveCount(0)
	const titleHeader = page.locator('.ag-header-cell[col-id="title"]')
	const filterIcon = titleHeader.locator('.veud-grid-filter-icon')
	const dragIcon = row.locator('.veud-grid-drag-icon')
	await expect(filterIcon).toBeHidden()
	await titleHeader.hover()
	await expect(filterIcon).toBeVisible()
	await expect(dragIcon).toBeHidden()
	await row.hover()
	await expect(dragIcon).toBeVisible()

	async function expectResponsiveGrid() {
		const metrics = await page.evaluate(() => {
			const main = document.querySelector('.user-watchlist')!
			const grid = document.querySelector('.ag-theme-custom-react')!
			const headerText = document.querySelector('.ag-header-cell-text')!
			const mainRect = main.getBoundingClientRect()
			const gridRect = grid.getBoundingClientRect()
			const headerRect = headerText
				.closest('.ag-header-cell')!
				.getBoundingClientRect()
			const headerStyle = window.getComputedStyle(headerText)
			const displayedHeaders = Array.from(
				document.querySelectorAll<HTMLElement>(
					'.ag-header-cell:not(.ag-header-cell-moving)',
				),
			)
			const lastHeaderRight = Math.max(
				...displayedHeaders.map(header => header.getBoundingClientRect().right),
			)
			return {
				viewportHeight: window.innerHeight,
				mainBottom: mainRect.bottom,
				gridHeight: gridRect.height,
				headerHeight: headerRect.height,
				headerWhiteSpace: headerStyle.whiteSpace,
				headerWordBreak: headerStyle.wordBreak,
				unusedGridWidth: Math.round(gridRect.right - lastHeaderRight),
			}
		})

		expect(metrics.mainBottom).toBeLessThanOrEqual(metrics.viewportHeight + 1)
		expect(metrics.gridHeight).toBeGreaterThan(200)
		expect(metrics.headerHeight).toBeLessThanOrEqual(44)
		expect(metrics.headerWhiteSpace).toBe('nowrap')
		expect(metrics.headerWordBreak).toBe('normal')
		expect(metrics.unusedGridWidth).toBeLessThanOrEqual(2)
		const renderedRow = page
			.locator('.ag-row')
			.filter({ hasText: 'Unscored reliability entry' })
		const rowBounds = await renderedRow.boundingBox()
		expect(rowBounds).not.toBeNull()
		expect(rowBounds!.height).toBeGreaterThanOrEqual(40)
		const thumbnailBounds = await renderedRow
			.locator('.ag-thumbnail-image')
			.boundingBox()
		expect(thumbnailBounds).not.toBeNull()
		expect(thumbnailBounds!.y + thumbnailBounds!.height).toBeLessThanOrEqual(
			rowBounds!.y + rowBounds!.height + 1,
		)
	}

	await expectResponsiveGrid()
	await page.setViewportSize({ width: 390, height: 844 })
	const mobileList = page.getByRole('region', { name: 'Mobile list' })
	await expect(mobileList).toBeVisible()
	await expect(page.locator('.ag-theme-custom-react')).toBeHidden()
	const mobileCard = mobileList.getByRole('article', {
		name: 'Unscored reliability entry',
	})
	await expect(mobileCard).toBeVisible()
	await expect(
		mobileCard.locator('.mobile-list-card-stats').getByText('Responsive list'),
	).toBeVisible()
	await expect(
		mobileCard.getByRole('button', {
			name: 'Quick edit Unscored reliability entry',
		}),
	).toBeVisible()
	const quickEditBounds = await mobileCard
		.getByRole('button', {
			name: 'Quick edit Unscored reliability entry',
		})
		.boundingBox()
	expect(quickEditBounds).not.toBeNull()
	expect(quickEditBounds!.width).toBeGreaterThanOrEqual(44)
	expect(quickEditBounds!.height).toBeGreaterThanOrEqual(44)
	await mobileCard
		.getByRole('button', {
			name: 'Quick edit Unscored reliability entry',
		})
		.click()
	const mobileEditor = mobileCard.getByRole('dialog')
	await expect(mobileEditor).toBeVisible()
	await expect(mobileEditor.getByLabel('Personal')).toBeVisible()
	await mobileEditor.getByRole('button', { name: 'Close quick edit' }).click()
	await expect(
		mobileCard.getByLabel('Move Unscored reliability entry to position'),
	).toBeVisible()
	const mobileMetrics = await page.evaluate(() => {
		const card = document.querySelector('.mobile-list-card')!
		const bounds = card.getBoundingClientRect()
		return {
			viewportWidth: window.innerWidth,
			documentWidth: document.documentElement.scrollWidth,
			cardLeft: bounds.left,
			cardRight: bounds.right,
			overflowing: Array.from(document.body.querySelectorAll<HTMLElement>('*'))
				.map(element => {
					const rect = element.getBoundingClientRect()
					return {
						tag: element.tagName,
						className: element.className,
						left: Math.round(rect.left),
						right: Math.round(rect.right),
						width: Math.round(rect.width),
					}
				})
				.filter(
					element =>
						element.width > 0 &&
						(element.left < -1 || element.right > window.innerWidth + 1),
				)
				.slice(0, 12),
		}
	})
	expect(mobileMetrics.overflowing).toEqual([])
	expect(mobileMetrics.documentWidth).toBeLessThanOrEqual(
		mobileMetrics.viewportWidth,
	)
	expect(mobileMetrics.cardLeft).toBeGreaterThanOrEqual(0)
	expect(mobileMetrics.cardRight).toBeLessThanOrEqual(
		mobileMetrics.viewportWidth,
	)
	await expect(mobileList.getByLabel('Filter this list')).toBeHidden()
	await mobileList.getByText('Filter & sort', { exact: true }).click()
	await expect(mobileList.getByLabel('Filter this list')).toBeVisible()
	await mobileList.getByLabel('Filter this list').fill('not present')
	await expect(mobileList.getByText('No matching titles')).toBeVisible()
	await mobileList.getByLabel('Filter this list').fill('reliability')
	await expect(mobileCard).toBeVisible()
	await page.setViewportSize({ width: 844, height: 390 })
	await expect(mobileList).toBeVisible()
	await expect(mobileCard).toBeVisible()
	expect(
		await page.evaluate(() => document.documentElement.scrollWidth),
	).toBeLessThanOrEqual(844)
})

test('watchlist metadata cells and header hints retain the dark theme contrast', async ({
	page,
	login,
}) => {
	const user = await login()
	const listType = await prisma.listType.findUniqueOrThrow({
		where: { name: 'liveaction' },
	})
	const watchlist = await prisma.watchlist.create({
		data: {
			name: 'metadata-contrast-list',
			header: 'Metadata contrast list',
			position: 1,
			displayedColumns:
				'position, title, airYear, startSeason, startYear, releaseStart, releaseEnd, startDate, finishedDate',
			ownerId: user.id,
			typeId: listType.id,
		},
	})
	await prisma.entry.create({
		data: {
			watchlistId: watchlist.id,
			position: 1,
			title: 'Metadata contrast entry',
			type: 'TV Series',
			airYear: '2024',
			startSeason: 'Fall',
			startYear: '2024',
			releaseStart: new Date('2024-10-01T00:00:00.000Z'),
			releaseEnd: new Date('2025-03-31T00:00:00.000Z'),
			history: JSON.stringify({
				started: '2024-10-02T00:00:00.000Z',
				finished: '2025-04-01T00:00:00.000Z',
			}),
		},
	})

	await page.goto(`/lists/${user.username}/liveaction/${watchlist.name}`)
	const row = page
		.locator('.ag-row')
		.filter({ hasText: 'Metadata contrast entry' })
	await expect(row).toBeVisible()

	for (const column of [
		'airYear',
		'startSeason',
		'startYear',
		'releaseStart',
		'releaseEnd',
		'started',
		'finished',
	]) {
		await expect(row.locator(`[col-id="${column}"]`)).toHaveCSS(
			'color',
			'rgb(231, 231, 231)',
		)
	}

	const airYearHeader = page.locator('.ag-header-cell[col-id="airYear"]')
	await airYearHeader.hover()
	const headerHint = page.locator('.ag-tooltip').filter({ hasText: 'Air Year' })
	await expect(headerHint).toBeVisible()
	await expect(headerHint).toHaveCSS('color', 'rgb(231, 231, 231)')
	await expect(headerHint).toHaveCSS('background-color', 'rgb(18, 18, 18)')
})

test('list landing keeps every list reachable inside the viewport', async ({
	page,
	login,
}) => {
	const user = await login()
	const listType = await prisma.listType.findUniqueOrThrow({
		where: { name: 'anime' },
	})
	await prisma.watchlist.createMany({
		data: Array.from({ length: 8 }, (_, index) => ({
			name: `landing-${index + 1}`,
			header: `Landing list ${index + 1}`,
			position: index + 1,
			displayedColumns: 'position, title, type',
			description:
				'A deliberately long description that verifies cards wrap and remain inside the list page background at every viewport size.',
			ownerId: user.id,
			typeId: listType.id,
		})),
	})

	async function expectBoundedLanding() {
		const metrics = await page.evaluate(() => {
			const landing = document.querySelector('.list-landing')!
			const content = document.querySelector('.list-landing-nav-main')!
			const mediaTypes = document.querySelector(
				'.list-landing-sidebar-container',
			)!
			const landingRect = landing.getBoundingClientRect()
			const contentRect = content.getBoundingClientRect()
			const mediaTypesRect = mediaTypes.getBoundingClientRect()
			return {
				viewportWidth: window.innerWidth,
				viewportHeight: window.innerHeight,
				landingLeft: landingRect.left,
				landingRight: landingRect.right,
				landingBottom: landingRect.bottom,
				contentBottom: contentRect.bottom,
				contentScrollHeight: content.scrollHeight,
				contentClientHeight: content.clientHeight,
				mediaTypesLeft: mediaTypesRect.left,
				mediaTypesRight: mediaTypesRect.right,
			}
		})

		expect(metrics.landingLeft).toBeGreaterThanOrEqual(-1)
		expect(metrics.landingRight).toBeLessThanOrEqual(metrics.viewportWidth + 1)
		expect(metrics.landingBottom).toBeLessThanOrEqual(
			metrics.viewportHeight + 1,
		)
		expect(metrics.contentBottom).toBeLessThanOrEqual(
			metrics.viewportHeight + 1,
		)
		expect(metrics.mediaTypesLeft).toBeGreaterThanOrEqual(-1)
		expect(metrics.mediaTypesRight).toBeLessThanOrEqual(
			metrics.viewportWidth + 1,
		)
		expect(metrics.contentScrollHeight).toBeGreaterThan(
			metrics.contentClientHeight,
		)
	}

	await page.setViewportSize({ width: 1100, height: 650 })
	await page.goto(`/lists/${user.username}/anime`)
	await expect(page.getByRole('article')).toHaveCount(8)
	await expectBoundedLanding()
	const lastList = page.getByRole('article', { name: 'Landing list 8' })
	await lastList.scrollIntoViewIfNeeded()
	await expect(
		lastList.getByRole('link', { name: 'Open Landing list 8 list' }),
	).toBeVisible()

	await page.setViewportSize({ width: 390, height: 844 })
	await expectBoundedLanding()
	await lastList.scrollIntoViewIfNeeded()
	await expect(
		lastList.getByRole('button', {
			name: 'Edit Landing list 8 list settings',
		}),
	).toBeVisible()
	await expect(
		page.getByRole('navigation', { name: 'Media list types' }),
	).toBeVisible()
})

test('list landing switches media types without a reload or stale cards', async ({
	page,
	login,
}) => {
	const user = await login()
	const listTypes = await prisma.listType.findMany({
		where: { name: { in: ['anime', 'manga'] } },
	})
	const animeType = listTypes.find(type => type.name === 'anime')!
	const mangaType = listTypes.find(type => type.name === 'manga')!
	await Promise.all([
		prisma.watchlist.create({
			data: {
				name: 'anime-switch-list',
				header: 'Anime switch list',
				position: 1,
				displayedColumns: 'position, title, type',
				description: 'Anime landing switch fixture.',
				ownerId: user.id,
				typeId: animeType.id,
			},
		}),
		prisma.watchlist.create({
			data: {
				name: 'manga-switch-list',
				header: 'Manga switch list',
				position: 1,
				displayedColumns: 'position, title, type',
				description: 'Manga landing switch fixture.',
				ownerId: user.id,
				typeId: mangaType.id,
			},
		}),
	])

	await page.goto(`/lists/${user.username}/anime`)
	await expect(
		page.getByRole('article', { name: 'Anime switch list' }),
	).toBeVisible()
	await expect(
		page.getByRole('article', { name: 'Manga switch list' }),
	).toHaveCount(0)
	await page.evaluate(() => {
		sessionStorage.removeItem('list-landing-document-unloaded')
		window.addEventListener('beforeunload', () => {
			sessionStorage.setItem('list-landing-document-unloaded', 'true')
		})
	})

	const mediaTypes = page.getByRole('navigation', {
		name: 'Media list types',
	})
	await mediaTypes.getByRole('link', { name: 'Manga' }).click()

	await expect(page).toHaveURL(`/lists/${user.username}/manga`)
	await expect(page.getByRole('heading', { name: 'Manga lists' })).toBeVisible()
	await expect(
		page.getByRole('article', { name: 'Manga switch list' }),
	).toBeVisible()
	await expect(
		page.getByRole('article', { name: 'Anime switch list' }),
	).toHaveCount(0)
	expect(
		await page.evaluate(() =>
			sessionStorage.getItem('list-landing-document-unloaded'),
		),
	).toBeNull()
})

test('quick-add results keep long-title actions reachable on mobile', async ({
	page,
	login,
}) => {
	const user = await login()
	const listType = await prisma.listType.findUniqueOrThrow({
		where: { name: 'anime' },
	})
	const watchlist = await prisma.watchlist.create({
		data: {
			name: 'quick-add-layout',
			header: 'Quick add layout',
			position: 1,
			displayedColumns: 'position, title, type',
			ownerId: user.id,
			typeId: listType.id,
		},
	})
	await prisma.entry.create({
		data: {
			watchlistId: watchlist.id,
			position: 1,
			title: ' ',
			type: 'TV Series',
		},
	})

	const titles = Array.from(
		{ length: 6 },
		(_, index) =>
			`An Exceptionally Long Catalog Result Title Number ${index + 1} That Still Has A Reachable Add Button`,
	)
	await page.route('**/media/fetch-data/**', async route => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify([
				{ observedAt: new Date().toISOString() },
				{
					data: titles.map((title, index) => ({
						node: {
							id: 88000 + index,
							title,
							media_type: 'tv',
							start_date: '2024-01-01',
							main_picture: {
								medium: `https://example.com/poster-${index}.jpg`,
							},
						},
					})),
				},
			]),
		})
	})

	await page.setViewportSize({ width: 390, height: 844 })
	await page.goto(`/lists/${user.username}/anime/${watchlist.name}`)
	await page.getByRole('button', { name: 'Add title' }).click()
	const dialog = page.getByRole('dialog', { name: 'Choose a title' })
	await expect(dialog).toBeVisible()
	const quickAddSearch = dialog.getByLabel('Search the catalog')
	await quickAddSearch.fill('long title')
	await expect(quickAddSearch).toHaveValue('long title')
	await dialog.getByRole('button', { name: 'Search', exact: true }).click()
	await expect(dialog.getByRole('article')).toHaveCount(titles.length)
	const lastResult = dialog.getByRole('article').last()
	await lastResult.scrollIntoViewIfNeeded()
	const addButton = lastResult.getByRole('button', {
		name: `Add to Quick add layout ${titles.at(-1)}`,
	})
	await expect(addButton).toBeVisible()
	const bounds = await addButton.boundingBox()
	expect(bounds).not.toBeNull()
	expect(bounds!.x).toBeGreaterThanOrEqual(0)
	expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390)
	expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844)
})

test('member can quick edit fields that are hidden from the grid', async ({
	page,
	login,
}) => {
	const user = await login()
	const listType = await prisma.listType.findUniqueOrThrow({
		where: { name: 'anime' },
	})
	const watchlist = await prisma.watchlist.create({
		data: {
			name: 'quick-edit-list',
			header: 'Quick edit list',
			position: 1,
			displayedColumns: 'position, title',
			ownerId: user.id,
			typeId: listType.id,
		},
	})
	const entry = await prisma.entry.create({
		data: {
			watchlistId: watchlist.id,
			position: 1,
			title: 'Hidden edit entry',
			type: 'TV Series',
			priority: 'Low',
			history: JSON.stringify({
				added: Date.now(),
				started: null,
				finished: null,
				progress: null,
			}),
		},
	})

	await page.goto(`/lists/${user.username}/anime/${watchlist.name}`)
	const entryRow = page
		.locator('.ag-row')
		.filter({ hasText: 'Hidden edit entry' })
	const quickEdit = entryRow.locator(
		'button[aria-label="Quick edit Hidden edit entry"]',
	)
	const moreActions = entryRow.locator(
		'button[aria-label="More actions for Hidden edit entry"]',
	)
	await expect(quickEdit).toBeHidden()
	await expect(moreActions).toBeHidden()
	await entryRow.hover()
	await expect(quickEdit).toBeVisible()
	await expect(moreActions).toBeVisible()
	await quickEdit.click()

	const dialog = page.getByRole('dialog')
	await expect(dialog).toBeVisible()
	await expect(dialog.getByRole('heading')).toHaveText('Hidden edit entry')
	await dialog.getByLabel('Story').fill('9')
	await dialog.getByLabel('Personal').fill('8.5')
	await dialog.getByLabel('Started').fill('2026-07-01')
	await dialog.getByLabel('Finished').fill('2026-07-18')
	await dialog.getByLabel('Repeat count').fill('2')
	await dialog.getByLabel('Priority').selectOption('High')
	await dialog.getByLabel('Notes').fill('Watch the director commentary.')
	await dialog.getByRole('button', { name: 'Save changes' }).click()
	await expect(dialog).not.toBeVisible()

	await expect
		.poll(async () => {
			const saved = await prisma.entry.findUniqueOrThrow({
				where: { id: entry.id },
			})
			const history = JSON.parse(saved.history ?? '{}') as Record<
				string,
				unknown
			>
			return {
				story: saved.story,
				personal: Number(saved.personal),
				priority: saved.priority,
				notes: saved.notes,
				started: history.started,
				finished: history.finished,
				repeatCount: history.repeatCount,
			}
		})
		.toEqual({
			story: 9,
			personal: 8.5,
			priority: 'High',
			notes: 'Watch the director commentary.',
			started: '2026-07-01T00:00:00.000Z',
			finished: '2026-07-18T00:00:00.000Z',
			repeatCount: 2,
		})

	await entryRow.getByLabel('Move Hidden edit entry to position').focus()
	await expect(moreActions).toBeVisible()
	await moreActions.click()
	await expect(page.getByText('Row actions', { exact: true })).toBeVisible()
	await expect(
		page.getByRole('menuitem', { name: 'Insert 1 row above' }),
	).toHaveCount(0)
	await expect(page.getByRole('menuitem', { name: 'Delete row' })).toBeVisible()
	await page.getByRole('menuitem', { name: 'Advanced edit' }).click()
	await expect(dialog).toBeVisible()
	await dialog.getByRole('button', { name: 'Close quick edit' }).click()
})

test('hovering a list tab opens it so a dragged entry can be positioned', async ({
	page,
	login,
}) => {
	const user = await login()
	const listType = await prisma.listType.findUniqueOrThrow({
		where: { name: 'anime' },
	})
	const [source, destination] = await Promise.all([
		prisma.watchlist.create({
			data: {
				name: 'drag-source',
				header: 'Drag source',
				position: 1,
				displayedColumns: 'position, title, type',
				ownerId: user.id,
				typeId: listType.id,
			},
		}),
		prisma.watchlist.create({
			data: {
				name: 'drag-destination',
				header: 'Drag destination',
				position: 2,
				displayedColumns: 'position, title, type',
				ownerId: user.id,
				typeId: listType.id,
			},
		}),
	])
	await prisma.entry.create({
		data: {
			watchlistId: source.id,
			position: 1,
			title: 'Cross-list dragged entry',
			type: 'TV Series',
		},
	})
	await prisma.entry.createMany({
		data: [
			{
				watchlistId: destination.id,
				position: 1,
				title: 'Destination first',
				type: 'TV Series',
			},
			{
				watchlistId: destination.id,
				position: 2,
				title: 'Destination second',
				type: 'TV Series',
			},
		],
	})

	await page.goto(`/lists/${user.username}/anime/${source.name}`)
	const draggedRow = page
		.locator('.ag-row')
		.filter({ hasText: 'Cross-list dragged entry' })
	const dragHandle = draggedRow.locator('.ag-row-drag')
	const destinationTab = page.getByRole('link', {
		name: 'Drag destination',
	})
	await expect(destinationTab).toHaveClass(/list-nav-drop-ready/)
	await draggedRow.hover()
	await expect(dragHandle).toBeVisible()
	await dragHandle.hover()
	await page.mouse.down()
	await draggedRow.hover({ position: { x: 80, y: 20 }, force: true })
	await expect(page.locator('.ag-dnd-ghost')).toBeVisible()
	await destinationTab.hover({ force: true })
	await expect(destinationTab).toHaveClass(/list-nav-drag-active/)
	await expect(page.getByRole('status')).toHaveCount(0)
	const firstDestinationRow = page
		.locator('.ag-row')
		.filter({ hasText: 'Destination first' })
	await expect(firstDestinationRow).toBeVisible()
	const firstDestinationBounds = await firstDestinationRow.boundingBox()
	expect(firstDestinationBounds).not.toBeNull()
	await page.mouse.move(
		firstDestinationBounds!.x + firstDestinationBounds!.width / 2,
		firstDestinationBounds!.y + 2,
		{ steps: 12 },
	)
	await page.mouse.up()

	await expect
		.poll(() => titlesInOrder(destination.id))
		.toEqual([
			'1:Cross-list dragged entry',
			'2:Destination first',
			'3:Destination second',
		])
	await expect(page).toHaveURL(
		new RegExp(`/lists/${user.username}/anime/${destination.name}$`),
	)
	await expect(page.getByRole('status')).toHaveCount(0)
})

test('dragging into a sorted list appends rather than inventing a position', async ({
	page,
	login,
}) => {
	// A list with a saved column sort never displays in stored order, so a drop
	// index cannot be translated into one. Appending is what dropping straight
	// onto the list's tab already does.
	const user = await login()
	const listType = await prisma.listType.findUniqueOrThrow({
		where: { name: 'anime' },
	})
	const [source, destination] = await Promise.all([
		prisma.watchlist.create({
			data: {
				name: 'plain-source',
				header: 'Plain source',
				position: 1,
				displayedColumns: 'position, title, type',
				ownerId: user.id,
				typeId: listType.id,
			},
		}),
		prisma.watchlist.create({
			data: {
				name: 'sorted-destination',
				header: 'Sorted destination',
				position: 2,
				displayedColumns: 'position, title, type',
				defaultSortColumn: 'title',
				defaultSortDirection: 'asc',
				ownerId: user.id,
				typeId: listType.id,
			},
		}),
	])
	await prisma.entry.create({
		data: {
			watchlistId: source.id,
			position: 1,
			title: 'Zebra arrives',
			type: 'TV Series',
		},
	})
	await prisma.entry.createMany({
		data: [
			{
				watchlistId: destination.id,
				position: 1,
				title: 'Zulu kept first',
				type: 'TV Series',
			},
			{
				watchlistId: destination.id,
				position: 2,
				title: 'Alpha kept second',
				type: 'TV Series',
			},
		],
	})

	await page.goto(`/lists/${user.username}/anime/${source.name}`)
	const draggedRow = page
		.locator('.ag-row')
		.filter({ hasText: 'Zebra arrives' })
	const dragHandle = draggedRow.locator('.ag-row-drag')
	await draggedRow.hover()
	await expect(dragHandle).toBeVisible()
	await dragHandle.hover()
	await page.mouse.down()
	await draggedRow.hover({ position: { x: 80, y: 20 }, force: true })
	await expect(page.locator('.ag-dnd-ghost')).toBeVisible()
	const destinationTab = page.getByRole('link', { name: 'Sorted destination' })
	await destinationTab.hover({ force: true })
	await expect(destinationTab).toHaveClass(/list-nav-drag-active/)
	// The preview renders the destination under ITS OWN sort. Stored order is
	// Zulu then Alpha; the destination sorts by title, so Alpha must appear
	// ABOVE Zulu. Before the fix the grid kept the source's
	// sort — none — and showed stored order instead.
	const firstRow = page
		.locator('.ag-row')
		.filter({ hasText: 'Zulu kept first' })
	const secondRow = page
		.locator('.ag-row')
		.filter({ hasText: 'Alpha kept second' })
	await expect(firstRow).toBeVisible()
	const bounds = await firstRow.boundingBox()
	const secondBounds = await secondRow.boundingBox()
	expect(bounds).not.toBeNull()
	expect(secondBounds).not.toBeNull()
	expect(secondBounds!.y).toBeLessThan(bounds!.y)
	// Dropped at the very top, which under a sort means nothing in particular.
	await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + 2, {
		steps: 12,
	})
	await page.mouse.up()

	// Stored order is untouched and the newcomer is last.
	await expect
		.poll(() => titlesInOrder(destination.id))
		.toEqual(['1:Zulu kept first', '2:Alpha kept second', '3:Zebra arrives'])
})

test('abandoning a drag puts the source list back the way it was', async ({
	page,
	login,
}) => {
	// Previewing a destination installs that list's sort in the shared grid. If
	// the drag is then abandoned, the source must go back to its own order — not
	// sit there wearing the sort of a list the viewer decided against.
	const user = await login()
	const listType = await prisma.listType.findUniqueOrThrow({
		where: { name: 'anime' },
	})
	const [source, destination] = await Promise.all([
		prisma.watchlist.create({
			data: {
				name: 'cancel-source',
				header: 'Cancel source',
				position: 1,
				displayedColumns: 'position, title, type',
				ownerId: user.id,
				typeId: listType.id,
			},
		}),
		prisma.watchlist.create({
			data: {
				name: 'cancel-destination',
				header: 'Cancel destination',
				position: 2,
				displayedColumns: 'position, title, type',
				defaultSortColumn: 'title',
				defaultSortDirection: 'asc',
				ownerId: user.id,
				typeId: listType.id,
			},
		}),
	])
	// Stored order is deliberately not alphabetical, so the source's own order is
	// distinguishable from the destination's title sort.
	await prisma.entry.createMany({
		data: [
			{
				watchlistId: source.id,
				position: 1,
				title: 'Zulu source row',
				type: 'TV Series',
			},
			{
				watchlistId: source.id,
				position: 2,
				title: 'Alpha source row',
				type: 'TV Series',
			},
		],
	})
	await prisma.entry.create({
		data: {
			watchlistId: destination.id,
			position: 1,
			title: 'Destination row',
			type: 'TV Series',
		},
	})

	await page.goto(`/lists/${user.username}/anime/${source.name}`)
	// The grid's own sort state, which is the precise observable here: row order
	// settles back on its own, the installed sort does not.
	const sortState = () =>
		page
			.locator('.ag-header-cell[aria-sort]')
			.evaluateAll(cells =>
				cells.map(
					cell =>
						`${cell.getAttribute('col-id')}=${cell.getAttribute('aria-sort')}`,
				),
			)
	await expect(
		page.locator('.ag-row').filter({ hasText: 'Zulu source row' }),
	).toBeVisible()
	expect(await sortState()).not.toContain('title=ascending')

	const draggedRow = page
		.locator('.ag-row')
		.filter({ hasText: 'Zulu source row' })
	const dragHandle = draggedRow.locator('.ag-row-drag')
	await draggedRow.hover()
	await expect(dragHandle).toBeVisible()
	await dragHandle.hover()
	await page.mouse.down()
	await draggedRow.hover({ position: { x: 80, y: 20 }, force: true })
	await expect(page.locator('.ag-dnd-ghost')).toBeVisible()
	await page
		.getByRole('link', { name: 'Cancel destination' })
		.hover({ force: true })
	await expect(
		page.locator('.ag-row').filter({ hasText: 'Destination row' }),
	).toBeVisible()
	// The preview installed the destination's sort — without this the restore
	// below would be proving nothing.
	await expect.poll(sortState).toContain('title=ascending')

	// Change your mind: drop it back on the list it came from.
	await page.getByRole('link', { name: 'Cancel source' }).hover({ force: true })
	await page.mouse.up()

	// The source is its own list again, not wearing the destination's sort.
	await expect(
		page.locator('.ag-row').filter({ hasText: 'Zulu source row' }),
	).toBeVisible()
	await expect.poll(sortState).not.toContain('title=ascending')
	// And nothing moved.
	await expect
		.poll(() => titlesInOrder(destination.id))
		.toEqual(['1:Destination row'])
})

test('dragging near a grid edge continuously scrolls the list', async ({
	page,
	login,
}) => {
	const user = await login()
	const listType = await prisma.listType.findUniqueOrThrow({
		where: { name: 'anime' },
	})
	const watchlist = await prisma.watchlist.create({
		data: {
			name: 'drag-scroll',
			header: 'Drag scroll',
			position: 1,
			displayedColumns: 'position, title, type',
			ownerId: user.id,
			typeId: listType.id,
		},
	})
	await prisma.entry.createMany({
		data: Array.from({ length: 40 }, (_, index) => ({
			watchlistId: watchlist.id,
			position: index + 1,
			title: `Scroll entry ${String(index + 1).padStart(2, '0')}`,
			type: 'TV Series',
		})),
	})

	await page.setViewportSize({ width: 1000, height: 600 })
	await page.goto(`/lists/${user.username}/anime/${watchlist.name}`)
	const firstRow = page
		.locator('.ag-row')
		.filter({ hasText: 'Scroll entry 01' })
	const dragHandle = firstRow.locator('.ag-row-drag')
	const viewport = page.locator('.ag-grid-viewport')
	await firstRow.hover()
	await expect(dragHandle).toBeVisible()
	const handleBounds = await dragHandle.boundingBox()
	const viewportBounds = await viewport.boundingBox()
	expect(handleBounds).not.toBeNull()
	expect(viewportBounds).not.toBeNull()

	await page.mouse.move(
		handleBounds!.x + handleBounds!.width / 2,
		handleBounds!.y + handleBounds!.height / 2,
	)
	await page.mouse.down()
	await page.mouse.move(
		viewportBounds!.x + viewportBounds!.width / 2,
		viewportBounds!.y + viewportBounds!.height - 50,
		{ steps: 12 },
	)
	await expect
		.poll(() => viewport.evaluate(element => element.scrollTop))
		.toBeGreaterThan(100)
	await page.mouse.up()

	await page.setViewportSize({ width: 390, height: 844 })
	const mobileList = page.getByRole('region', { name: 'Mobile list' })
	const mobileCards = mobileList.getByRole('article')
	await expect(mobileCards).toHaveCount(40)
	expect(await mobileCards.getByRole('heading').allTextContents()).toEqual(
		expect.arrayContaining(
			Array.from(
				{ length: 40 },
				(_, index) => `Scroll entry ${String(index + 1).padStart(2, '0')}`,
			),
		),
	)
	const firstMobileCardBounds = await mobileCards.first().boundingBox()
	expect(firstMobileCardBounds).not.toBeNull()
	expect(firstMobileCardBounds!.height).toBeGreaterThanOrEqual(140)
	const mobileStack = mobileList.locator('.mobile-list-card-stack')
	expect(
		await mobileStack.evaluate(element => element.scrollHeight),
	).toBeGreaterThan(await mobileStack.evaluate(element => element.clientHeight))
	await mobileCards.last().scrollIntoViewIfNeeded()
	await expect(mobileCards.last()).toBeVisible()
})

test('mobile list defers desktop grid, catalog search, and advanced editor assets', async ({
	page,
	login,
}) => {
	const user = await login()
	const listType = await prisma.listType.findUniqueOrThrow({
		where: { name: 'anime' },
	})
	const watchlist = await prisma.watchlist.create({
		data: {
			name: 'mobile-module-boundary',
			header: 'Mobile module boundary',
			position: 1,
			displayedColumns: 'position, title, type',
			ownerId: user.id,
			typeId: listType.id,
		},
	})
	await prisma.entry.create({
		data: {
			watchlistId: watchlist.id,
			position: 1,
			title: 'Deferred mobile entry',
			type: 'TV Series',
		},
	})

	await page.setViewportSize({ width: 390, height: 844 })
	const assetRequests: string[] = []
	page.on('request', request => {
		const pathname = new URL(request.url()).pathname
		if (pathname.startsWith('/assets/')) assetRequests.push(pathname)
	})

	await page.goto(`/lists/${user.username}/anime/${watchlist.name}`)
	await expect(page.getByRole('region', { name: 'Mobile list' })).toBeVisible()

	const requestedAsset = (prefix: string) =>
		assetRequests.some(pathname => pathname.includes(`/assets/${prefix}-`))
	expect(requestedAsset('mobile-watchlist-cards')).toBe(true)
	expect(requestedAsset('watchlist-grid')).toBe(false)
	expect(requestedAsset('advanced-entry-editor')).toBe(false)
	expect(requestedAsset('search-add-watchlist-entry')).toBe(false)
	expect(requestedAsset('tmdb')).toBe(false)
	expect(requestedAsset('mal')).toBe(false)

	await page.getByRole('button', { name: 'Add title' }).click()
	const quickAdd = page.getByRole('dialog', { name: 'Choose a title' })
	await expect(quickAdd).toBeVisible()
	expect(requestedAsset('search-add-watchlist-entry')).toBe(true)
	expect(requestedAsset('watchlist-grid')).toBe(false)
	await quickAdd.getByRole('button', { name: 'Close quick add' }).click()

	await page
		.getByRole('button', { name: 'Quick edit Deferred mobile entry' })
		.click()
	await expect(
		page.getByRole('dialog', { name: 'Deferred mobile entry' }),
	).toBeVisible()
	expect(requestedAsset('advanced-entry-editor')).toBe(true)
	expect(requestedAsset('watchlist-grid')).toBe(false)
})

test('desktop poster follows the user-resizable thumbnail column', async ({
	page,
	login,
}) => {
	const user = await login()
	const listType = await prisma.listType.findUniqueOrThrow({
		where: { name: 'anime' },
	})
	const watchlist = await prisma.watchlist.create({
		data: {
			name: 'desktop-poster-scale',
			header: 'Desktop poster scale',
			position: 1,
			displayedColumns: 'position, thumbnail, title, type',
			ownerId: user.id,
			typeId: listType.id,
		},
	})
	await prisma.entry.create({
		data: {
			watchlistId: watchlist.id,
			position: 1,
			thumbnail: '/favicons/favicon.png|/discover',
			title: 'Readable desktop poster',
			type: 'TV Series',
		},
	})

	await page.setViewportSize({ width: 1280, height: 900 })
	await page.goto(`/lists/${user.username}/anime/${watchlist.name}`)

	const grid = page.locator('.ag-theme-custom-react')
	const mobileCards = page.getByRole('region', { name: 'Mobile list' })
	const poster = grid.locator('.ag-thumbnail-image')
	await expect(grid).toBeVisible()
	await expect(mobileCards).toBeHidden()
	await expect(poster).toBeVisible()
	const thumbnailHeader = grid.locator('.ag-header-cell[col-id="thumbnail"]')
	const initialPosterBounds = await poster.boundingBox()
	const initialHeaderBounds = await thumbnailHeader.boundingBox()
	expect(initialPosterBounds).not.toBeNull()
	expect(initialHeaderBounds).not.toBeNull()
	expect(
		Math.abs(initialPosterBounds!.width - initialHeaderBounds!.width),
	).toBeLessThanOrEqual(2)

	const resizeHandle = thumbnailHeader.locator('.ag-header-cell-resize')
	const handleBounds = await resizeHandle.boundingBox()
	expect(handleBounds).not.toBeNull()
	await page.mouse.move(
		handleBounds!.x + handleBounds!.width / 2,
		handleBounds!.y + handleBounds!.height / 2,
	)
	await page.mouse.down()
	await page.mouse.move(handleBounds!.x + 82, handleBounds!.y, { steps: 8 })
	await page.mouse.up()

	await expect
		.poll(async () => (await poster.boundingBox())?.width ?? 0)
		.toBeGreaterThan(initialPosterBounds!.width + 60)
	await expect
		.poll(async () => {
			const [resizedPosterBounds, resizedHeaderBounds] = await Promise.all([
				poster.boundingBox(),
				thumbnailHeader.boundingBox(),
			])
			if (!resizedPosterBounds || !resizedHeaderBounds) {
				return Number.POSITIVE_INFINITY
			}
			return Math.abs(resizedPosterBounds.width - resizedHeaderBounds.width)
		})
		.toBeLessThanOrEqual(2)
})

test('member can save a default list sort without changing manual positions', async ({
	page,
	login,
}) => {
	const user = await login()
	const listType = await prisma.listType.findUniqueOrThrow({
		where: { name: 'anime' },
	})
	const watchlist = await prisma.watchlist.create({
		data: {
			name: 'defaultsortlist',
			header: 'Default sort list',
			position: 1,
			displayedColumns: 'position, title, type',
			description: 'A list used to verify saved presentation sorting.',
			ownerId: user.id,
			typeId: listType.id,
		},
	})
	await prisma.entry.createMany({
		data: [
			{
				watchlistId: watchlist.id,
				position: 1,
				title: 'Zebra default sort entry',
				type: 'TV Series',
			},
			{
				watchlistId: watchlist.id,
				position: 2,
				title: 'Alpha default sort entry',
				type: 'TV Series',
			},
			{
				watchlistId: watchlist.id,
				position: 3,
				title: 'Moon default sort entry',
				type: 'TV Series',
			},
		],
	})

	await page.goto(`/lists/${user.username}/anime`)
	await page
		.getByRole('button', { name: 'Edit Default sort list list settings' })
		.click()
	await page.getByLabel('Default sorting').selectOption('title')
	await page.getByLabel('Default sort direction').selectOption('asc')
	await page.getByRole('button', { name: 'Submit' }).click()
	await expect
		.poll(() =>
			prisma.watchlist
				.findUniqueOrThrow({ where: { id: watchlist.id } })
				.then(list => [list.defaultSortColumn, list.defaultSortDirection]),
		)
		.toEqual(['title', 'asc'])

	await page.goto(`/lists/${user.username}/anime/${watchlist.name}`)
	await expect(page.getByTestId('default-sort-status')).toHaveCount(0)
	const renderedRow = (index: number) =>
		page.locator(`.ag-row[row-index="${index}"]`)
	await expect(renderedRow(0)).toContainText('Alpha default sort entry')
	await expect(renderedRow(1)).toContainText('Moon default sort entry')
	await expect(renderedRow(2)).toContainText('Zebra default sort entry')
	expect(await titlesInOrder(watchlist.id)).toEqual([
		'1:Zebra default sort entry',
		'2:Alpha default sort entry',
		'3:Moon default sort entry',
	])

	const titleHeader = page.locator('.ag-header-cell[col-id="title"]')
	const titleFilter = titleHeader.locator(
		'.ag-header-cell-menu-button, .ag-header-cell-filter-button',
	)
	await expect(titleHeader).toHaveAttribute('aria-sort', 'ascending')
	await expect(titleFilter).toBeHidden()
	await titleHeader.hover()
	await expect(titleFilter).toBeVisible()
	await page.locator('.ag-grid-viewport').hover()
	await expect(titleFilter).toBeHidden()
	await titleHeader.evaluate(element =>
		element.classList.add('ag-header-cell-filtered'),
	)
	await expect(titleFilter).toBeVisible()
	await titleHeader.evaluate(element =>
		element.classList.remove('ag-header-cell-filtered'),
	)
	await titleHeader.locator('.ag-header-cell-text').click()
	await expect(titleHeader).toHaveAttribute('aria-sort', 'descending')
	await expect(renderedRow(0)).toContainText('Zebra default sort entry')
	await page.reload()
	await expect(renderedRow(0)).toContainText('Alpha default sort entry')
	await titleHeader.hover()
	await titleFilter.first().click()
	await expect(
		page.locator('.watchlist-grid-shell > .ag-theme-custom-react'),
	).toBeVisible()
	await expect(page.locator('.ag-filter-body input').first()).toBeVisible()
	await expect(renderedRow(0)).toContainText('Alpha default sort entry')
})

test('member can make a list private and visitors cannot open or discover it', async ({
	page,
	login,
}) => {
	const user = await login()
	const listType = await prisma.listType.findUniqueOrThrow({
		where: { name: 'anime' },
	})
	const watchlist = await prisma.watchlist.create({
		data: {
			name: 'privacysettingslist',
			header: 'Privacy settings list',
			position: 1,
			displayedColumns: 'position, title, type',
			description: 'A list used to verify private visibility.',
			ownerId: user.id,
			typeId: listType.id,
		},
	})
	const listLanding = `/lists/${user.username}/anime`
	const directList = `${listLanding}/${watchlist.name}`

	await page.goto(listLanding)
	await page.getByRole('button', { name: 'Settings' }).click()
	await page.getByLabel('Visibility', { exact: true }).selectOption('private')
	await page.getByRole('button', { name: 'Submit' }).click()

	await expect(
		page
			.getByLabel('Privacy settings list', { exact: true })
			.getByText('Private', { exact: true }),
	).toBeVisible()
	await expect
		.poll(() =>
			prisma.watchlist
				.findUniqueOrThrow({ where: { id: watchlist.id } })
				.then(list => list.isPublic),
		)
		.toBe(false)

	const ownerResponse = await page.goto(directList)
	expect(ownerResponse?.status()).toBe(200)

	await page.context().clearCookies()
	const visitorLandingResponse = await page.goto(listLanding)
	expect(visitorLandingResponse?.status()).toBe(200)
	await expect(page.getByText(watchlist.header, { exact: true })).toHaveCount(0)

	const visitorDirectResponse = await page.goto(directList)
	expect(visitorDirectResponse?.status()).toBe(404)
})

test('member can insert a title into the gap between two rows', async ({
	page,
	login,
}) => {
	const user = await login()
	const listType = await prisma.listType.findUniqueOrThrow({
		where: { name: 'anime' },
	})
	const watching = await prisma.watchlist.create({
		data: {
			name: 'watching',
			header: 'Watching',
			position: 1,
			displayedColumns: 'position, title, type',
			ownerId: user.id,
			typeId: listType.id,
		},
	})
	await Promise.all(
		['Boundary first', 'Boundary second', 'Boundary third'].map(
			(title, index) =>
				prisma.entry.create({
					data: {
						watchlistId: watching.id,
						position: index + 1,
						title,
						type: 'TV Series',
					},
				}),
		),
	)

	await page.goto(`/lists/${user.username}/anime/${watching.name}`)
	const grid = page.locator('.ag-theme-custom-react')
	await expect(grid.locator('.ag-row')).toHaveCount(3)

	// Every gap gets exactly one control, including the two at the ends: above
	// the first row and below the last. Those are where off-by-one errors live.
	for (const position of [1, 2, 3, 4]) {
		await expect(
			grid.getByLabel(`Insert a title at position ${position} in Watching`),
		).toHaveCount(1)
	}
	// Four gaps for three rows, and no more: a doubled control would mean one
	// gap is reachable twice and another not at all.
	await expect(grid.locator('.ag-insert-boundary')).toHaveCount(4)

	// Reachable without a pointer: hover is not an interaction everyone has.
	const secondGap = grid.getByLabel('Insert a title at position 2 in Watching')
	await secondGap.focus()
	await expect(secondGap).toBeFocused()

	await secondGap.click()
	const dialog = page.getByRole('dialog')
	await expect(dialog).toBeVisible()
	await page.keyboard.press('Escape')

	// The catalog providers are not reachable from a test, so the search the
	// dialog runs is answered here. Everything past this point — the position
	// travelling with the chosen title, and the rows below it moving down — is
	// the real code path.
	const malNode = {
		id: 55001,
		title: 'Boundary inserted title',
		main_picture: { medium: 'https://example.com/boundary.jpg' },
		media_type: 'tv',
		status: 'finished_airing',
		start_date: '2024-01-07',
		end_date: '2024-03-24',
		start_season: { year: 2024, season: 'winter' },
		num_episodes: 12,
		average_episode_duration: 1440,
		mean: 8.1,
		rating: 'pg_13',
		genres: [{ name: 'Adventure' }],
		studios: [{ name: 'Studio Boundary' }],
		synopsis: 'Inserted between two rows.',
	}
	await page.route('**/media/fetch-data/**', async route => {
		// The proxy encodes the provider URL twice: once into the query string,
		// once into the path segment.
		const target = decodeURIComponent(decodeURIComponent(route.request().url()))
		const body = target.includes('/v2/anime?q=')
			? [{ data: [{ node: malNode }] }]
			: [malNode]
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(body),
		})
	})

	await secondGap.click()
	const insertDialog = page.getByRole('dialog')
	await expect(insertDialog).toBeVisible()
	await insertDialog.getByLabel('Search the catalog').fill('Boundary inserted')
	await insertDialog.getByRole('button', { name: 'Search' }).click()
	await insertDialog
		.getByRole('button', { name: 'Add to Watching Boundary inserted title' })
		.click()

	// The gap the viewer clicked, not the end of the list.
	await expect
		.poll(() => titlesInOrder(watching.id))
		.toEqual([
			'1:Boundary first',
			'2:Boundary inserted title',
			'3:Boundary second',
			'4:Boundary third',
		])

	// Under any sort the rows on screen are not in stored order, so "between
	// these two" no longer names a position and the control is withdrawn.
	await grid.getByRole('columnheader', { name: 'Title' }).click()
	await expect(grid.locator('.ag-insert-boundary')).toHaveCount(0)
})
