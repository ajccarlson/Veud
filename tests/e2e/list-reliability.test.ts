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
			json: [{}, { data: [{ node: { id, title: catalogTitles[id] } }] }],
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
	) {
		const search = page.getByRole('searchbox', { name: 'Search' })
		await search.fill(query)
		await search.press('Enter')
		await page.getByRole('button', { name: title }).click()
		await expect
			.poll(() => prisma.entry.count({ where: { watchlistId, title } }))
			.toBe(1)
		await expect(page.getByRole('searchbox', { name: 'Search' })).toHaveValue(
			'',
		)
	}

	await page.goto(`/lists/${user.username}/anime/${watching.name}`)
	await addCatalogResult('First query', catalogTitles[101], watching.id)

	await page.getByRole('link', { name: 'Completed' }).click()
	await expect(page).toHaveURL(
		new RegExp(`/lists/${user.username}/anime/${completed.name}$`),
	)
	await addCatalogResult('Second query', catalogTitles[102], completed.id)
	await addCatalogResult('Third query', catalogTitles[103], completed.id)

	expect(
		await prisma.entry.findMany({
			where: { watchlistId: completed.id },
			orderBy: { position: 'asc' },
			select: { title: true, position: true },
		}),
	).toEqual([
		{ title: catalogTitles[102], position: 1 },
		{ title: catalogTitles[103], position: 2 },
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
