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

	await page.goto(`/lists/${user.username}/anime/${source.name}`)
	const firstPosition = page.getByLabel(
		'Move First reliability entry to position',
	)
	await firstPosition.fill('3')
	await firstPosition.press('Enter')
	await expect
		.poll(() => titlesInOrder(source.id))
		.toEqual([
			'1:Moved reliability entry',
			'2:Third reliability entry',
			'3:First reliability entry',
		])
	const renderedRows = page.locator('.ag-center-cols-container .ag-row')
	await expect(renderedRows.nth(0)).toContainText('Moved reliability entry')
	await expect(renderedRows.nth(1)).toContainText('Third reliability entry')
	await expect(renderedRows.nth(2)).toContainText('First reliability entry')
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
			.getByLabel('Search movies, TV, anime, and manga')
			.fill(title)
		await siteSearch.getByLabel('Media type').selectOption('anime')
		await siteSearch
			.getByLabel('Search movies, TV, anime, and manga')
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
			.getByLabel('Search movies, TV, anime, and manga'),
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
				'position, title, averaged, personal, differencePersonal, tmdbScore, differenceObjective',
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
		},
	})

	await page.setViewportSize({ width: 1280, height: 720 })
	await page.goto(`/lists/${user.username}/liveaction/${watchlist.name}`)

	const row = page
		.locator('.ag-center-cols-container .ag-row')
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
	await expect(page.locator('.veud-grid-filter-icon').first()).toBeVisible()
	await expect(page.locator('.veud-grid-drag-icon').first()).toBeVisible()

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
			return {
				viewportHeight: window.innerHeight,
				mainBottom: mainRect.bottom,
				gridHeight: gridRect.height,
				headerHeight: headerRect.height,
				headerWhiteSpace: headerStyle.whiteSpace,
				headerWordBreak: headerStyle.wordBreak,
			}
		})

		expect(metrics.mainBottom).toBeLessThanOrEqual(metrics.viewportHeight + 1)
		expect(metrics.gridHeight).toBeGreaterThan(200)
		expect(metrics.headerHeight).toBeLessThanOrEqual(44)
		expect(metrics.headerWhiteSpace).toBe('nowrap')
		expect(metrics.headerWordBreak).toBe('normal')
	}

	await expectResponsiveGrid()
	await page.setViewportSize({ width: 390, height: 844 })
	await expectResponsiveGrid()
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
	const quickAddSearch = page.locator('.watchlist-search-inline input')
	await quickAddSearch.fill('long title')
	await quickAddSearch.press('Enter')

	const dialog = page.getByRole('dialog', { name: 'Choose a title' })
	await expect(dialog).toBeVisible()
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
	await page
		.getByRole('button', { name: 'Quick edit Hidden edit entry' })
		.click()

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

	await page
		.getByRole('button', { name: 'More actions for Hidden edit entry' })
		.click()
	await expect(page.getByText('Row actions', { exact: true })).toBeVisible()
	await expect(
		page.getByRole('menuitem', { name: 'Insert 1 row above' }),
	).toBeVisible()
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
		.locator('.ag-center-cols-container .ag-row')
		.filter({ hasText: 'Cross-list dragged entry' })
	const dragHandle = draggedRow.locator('.ag-row-drag')
	const destinationTab = page.getByRole('link', {
		name: 'Drag destination',
	})
	await expect(destinationTab).toHaveClass(/list-nav-drop-ready/)
	await dragHandle.hover()
	await page.mouse.down()
	await draggedRow.hover({ position: { x: 80, y: 20 }, force: true })
	await expect(page.locator('.ag-dnd-ghost')).toBeVisible()
	await destinationTab.hover({ force: true })
	await expect(
		page.getByRole('status').filter({ hasText: 'Drag destination' }),
	).toBeVisible()
	const firstDestinationRow = page
		.locator('.ag-center-cols-container .ag-row')
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
		.locator('.ag-center-cols-container .ag-row')
		.filter({ hasText: 'Scroll entry 01' })
	const dragHandle = firstRow.locator('.ag-row-drag')
	const viewport = page.locator('.ag-body-viewport')
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
	await page.getByLabel('Visibility').selectOption('private')
	await page.getByRole('button', { name: 'Submit' }).click()

	await expect(page.getByText('Private', { exact: true })).toBeVisible()
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
