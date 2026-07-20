import { type Page } from '@playwright/test'
import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

const catalogTitles = {
	101: 'First catalog result',
	102: 'Second catalog result',
	103: 'Third catalog result',
} as const

function malDetails(id: keyof typeof catalogTitles) {
	return {
		id,
		title: catalogTitles[id],
		main_picture: { large: `https://example.com/${id}.jpg` },
		start_date: '2024-01-01',
		end_date: '2024-03-01',
		media_type: 'tv',
		start_season: { year: 2024, season: 'winter' },
		num_episodes: 12,
		average_episode_duration: 1440,
		rating: 'pg_13',
		genres: [],
		studios: [],
		mean: 8,
		synopsis: `${catalogTitles[id]} synopsis`,
		related_anime: [],
		related_manga: [],
	}
}

async function mockMalCatalog(page: Page) {
	await page.route('**/media/fetch-data/**', async route => {
		const encodedRequest = route.request().url().split('/media/fetch-data/')[1]
		const proxyParams = new URLSearchParams(decodeURIComponent(encodedRequest))
		const upstream = new URL(proxyParams.get('url') ?? '')

		if (upstream.hostname === 'graphql.anilist.co') {
			await route.fulfill({
				json: [
					{},
					{
						data: {
							Media: {
								nextAiringEpisode: {
									timeUntilAiring: 3600,
									episode: 2,
									mediaId: 101,
								},
								streamingEpisodes: [],
								duration: 24,
								coverImage: { extraLarge: null },
							},
						},
					},
				],
			})
			return
		}

		const detailMatch = upstream.pathname.match(/\/v2\/anime\/(\d+)$/)
		if (detailMatch) {
			const id = Number(detailMatch[1]) as keyof typeof catalogTitles
			await route.fulfill({ json: [{}, malDetails(id)] })
			return
		}

		const query = upstream.searchParams.get('q') ?? ''
		const id = (
			query.startsWith('Second') ? 102 : query.startsWith('Third') ? 103 : 101
		) as keyof typeof catalogTitles
		await route.fulfill({
			json: [
				{},
				{
					data: [
						{
							node: {
								id,
								title: catalogTitles[id],
								main_picture: {
									large: `https://example.com/${id}.jpg`,
								},
								start_date: '2024-01-01',
								media_type: 'tv',
								start_season: { year: 2024, season: 'winter' },
							},
						},
					],
				},
			],
		})
	})
}

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

test('member can keep adding search results across lists in one session', async ({
	page,
	login,
}) => {
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
	await mockMalCatalog(page)

	async function addCatalogResult(
		query: string,
		title: string,
		watchlistId: string,
		destinationLabel?: string,
	) {
		await page.getByRole('button', { name: 'Add title' }).click()
		const dialog = page.getByRole('dialog', { name: 'Choose a title' })
		await expect(dialog).toBeVisible()
		const search = dialog.getByRole('searchbox', {
			name: 'Search the catalog',
		})
		await search.fill(query)
		await search.press('Enter')
		if (destinationLabel) {
			await dialog.getByLabel('Add to list').selectOption({
				label: destinationLabel,
			})
		}
		await dialog.getByRole('button', { name: title }).click()
		await expect
			.poll(() => prisma.entry.count({ where: { watchlistId, title } }))
			.toBe(1)
		await expect(dialog).not.toBeVisible()
		await expect(page.getByRole('button', { name: 'Add title' })).toBeVisible()
	}

	await page.goto(`/lists/${user.username}/anime/${watching.name}`)
	await addCatalogResult('First query', catalogTitles[101], watching.id)
	await page.setViewportSize({ width: 390, height: 844 })
	await page.getByRole('button', { name: 'Add title' }).click()
	const trackedDialog = page.getByRole('dialog', { name: 'Choose a title' })
	await trackedDialog
		.getByRole('searchbox', { name: 'Search the catalog' })
		.fill('First query')
	await trackedDialog
		.getByRole('searchbox', { name: 'Search the catalog' })
		.press('Enter')
	const dialogBounds = await trackedDialog.evaluate(dialog => {
		const bounds = dialog.getBoundingClientRect()
		return {
			left: bounds.left,
			top: bounds.top,
			right: bounds.right,
			bottom: bounds.bottom,
		}
	})
	expect(dialogBounds.left).toBeGreaterThanOrEqual(-1)
	expect(dialogBounds.top).toBeGreaterThanOrEqual(-1)
	expect(dialogBounds.right).toBeLessThanOrEqual(391)
	expect(dialogBounds.bottom).toBeLessThanOrEqual(845)
	await expect(trackedDialog.locator('img')).toHaveAttribute(
		'src',
		'https://example.com/101.jpg',
	)
	await expect(trackedDialog.getByText('MAL', { exact: true })).toBeVisible()
	await expect(
		trackedDialog.getByText('TV Series', { exact: true }),
	).toBeVisible()
	await expect(trackedDialog.getByText('2024', { exact: true })).toBeVisible()
	await expect(trackedDialog.getByText('Currently in Watching')).toBeVisible()
	await expect(
		trackedDialog.getByRole('button', {
			name: `In Watching ${catalogTitles[101]}`,
		}),
	).toBeDisabled()
	await page.setViewportSize({ width: 1280, height: 720 })
	await trackedDialog
		.getByLabel('Add to list')
		.selectOption({ label: 'Completed' })
	await trackedDialog
		.getByRole('button', {
			name: `Move to Completed ${catalogTitles[101]}`,
		})
		.click()
	await expect
		.poll(() => prisma.entry.count({ where: { watchlistId: watching.id } }))
		.toBe(0)
	await expect
		.poll(() =>
			prisma.entry.count({
				where: { watchlistId: completed.id, title: catalogTitles[101] },
			}),
		)
		.toBe(1)

	await addCatalogResult(
		'Second query',
		catalogTitles[102],
		completed.id,
		'Completed',
	)

	await page.getByRole('link', { name: 'Completed' }).click()
	await expect(page).toHaveURL(
		new RegExp(`/lists/${user.username}/anime/${completed.name}$`),
	)
	await addCatalogResult('Third query', catalogTitles[103], completed.id)

	expect(
		await prisma.entry.findMany({
			where: { watchlistId: completed.id },
			orderBy: { position: 'asc' },
			select: { title: true, position: true },
		}),
	).toEqual([
		{ title: catalogTitles[101], position: 1 },
		{ title: catalogTitles[102], position: 2 },
		{ title: catalogTitles[103], position: 3 },
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
			}
		})
		.toEqual({
			story: 9,
			personal: 8.5,
			priority: 'High',
			notes: 'Watch the director commentary.',
			started: '2026-07-01T00:00:00.000Z',
			finished: '2026-07-18T00:00:00.000Z',
		})

	await page
		.getByRole('button', { name: 'More actions for Hidden edit entry' })
		.click()
	await expect(page.getByText('Row actions', { exact: true })).toBeVisible()
	await expect(
		page.getByRole('menuitem', { name: 'Insert 1 row above' }),
	).toBeVisible()
	await expect(page.getByRole('menuitem', { name: 'Delete row' })).toBeVisible()
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
