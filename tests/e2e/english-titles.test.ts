import { type Page } from '@playwright/test'
import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

/**
 * "Always display anime/manga in English".
 *
 * MAL's canonical title is the romaji one. The preference lives on the member
 * so it follows them between devices, which means a signed-out reader gets the
 * provider's title — that is the trade, and it is tested here too.
 */
async function animeFixture() {
	return prisma.media.create({
		data: {
			kind: 'anime',
			title: 'Shingeki no Kyojin Fixture',
			englishTitle: 'Attack on Titan Fixture',
			type: 'TV Series',
			catalogPopularity: 900,
		},
	})
}

/**
 * Choose the English setting and wait for it to land.
 *
 * The control saves on change through a fetcher, so navigating straight after
 * the click races the write — the next page can load with the old preference.
 */
async function chooseEnglishTitles(page: Page) {
	await page.goto('/settings/profile')
	const save = page.waitForResponse(
		response =>
			response.request().method() === 'POST' && response.status() < 400,
	)
	await page.getByRole('radio', { name: /English where available/i }).click()
	await save
}

test('a member who asked for English sees it across the site', async ({
	page,
	login,
}) => {
	const media = await animeFixture()
	try {
		await login()
		await chooseEnglishTitles(page)

		// The title page.
		await page.goto(`/media/${media.id}`)
		await expect(
			page.getByRole('heading', { name: 'Attack on Titan Fixture' }),
		).toBeVisible()

		// And the search bar, which must offer the same name it will land on.
		const suggestions = await page.request.get(
			`/resources/search-suggestions?q=${encodeURIComponent('Fixture')}`,
		)
		const body = (await suggestions.json()) as {
			suggestions: Array<{ id: string; title: string }>
		}
		const row = body.suggestions.find(entry => entry.id === media.id)
		expect(row?.title).toBe('Attack on Titan Fixture')
	} finally {
		await prisma.media.delete({ where: { id: media.id } }).catch(() => {})
	}
})

test('everyone else still sees the title the provider uses', async ({
	page,
}) => {
	// Signed out there is no member to read a preference from, which is the cost
	// of putting it on the account rather than in a cookie.
	const media = await animeFixture()
	try {
		await page.goto(`/media/${media.id}`)
		await expect(
			page.getByRole('heading', { name: 'Shingeki no Kyojin Fixture' }),
		).toBeVisible()
	} finally {
		await prisma.media.delete({ where: { id: media.id } }).catch(() => {})
	}
})

test('a title with no English name recorded keeps the one it has', async ({
	page,
	login,
}) => {
	// MAL supplies an English title for some works and not others, so this is
	// the common case rather than the exception.
	const media = await prisma.media.create({
		data: {
			kind: 'anime',
			title: 'Only Romaji Fixture',
			englishTitle: null,
			type: 'TV Series',
		},
	})
	try {
		await login()
		await chooseEnglishTitles(page)
		await page.goto(`/media/${media.id}`)
		await expect(
			page.getByRole('heading', { name: 'Only Romaji Fixture' }),
		).toBeVisible()
	} finally {
		await prisma.media.delete({ where: { id: media.id } }).catch(() => {})
	}
})

test('a watchlist row uses the same name as the title page', async ({
	page,
	login,
}) => {
	// Watchlist rows carry a denormalized title snapshot, which is a global
	// column and could never be per-viewer. They are overlaid from canonical
	// Media at read time, which is where the preference is applied — so the grid
	// follows without the snapshot being touched.
	const user = await login()
	const listType = await prisma.listType.findUniqueOrThrow({
		where: { name: 'anime' },
	})
	const media = await animeFixture()
	const watchlist = await prisma.watchlist.create({
		data: {
			name: 'title-language',
			header: 'Title language',
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
			mediaId: media.id,
			// The stale snapshot, deliberately: the overlay is what must win.
			title: 'Shingeki no Kyojin Fixture',
			type: 'TV Series',
		},
	})

	try {
		await chooseEnglishTitles(page)
		await page.goto(`/lists/${user.username}/anime/${watchlist.name}`)
		await expect(
			page.locator('.ag-row').filter({ hasText: 'Attack on Titan Fixture' }),
		).toBeVisible()
	} finally {
		await prisma.media.delete({ where: { id: media.id } }).catch(() => {})
	}
})
