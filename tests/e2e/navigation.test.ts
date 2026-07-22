import { expect, test } from '#tests/playwright-utils.ts'

test('provider credits live in the quiet site footer instead of community navigation', async ({
	page,
}) => {
	await page.goto('/')

	await page.getByRole('button', { name: /Community/ }).click()
	const communityMenu = page.getByRole('menu')
	await expect(communityMenu).toBeVisible()
	await expect(communityMenu).not.toContainText(/data sources|credits/i)
	await page.keyboard.press('Escape')
	await expect(communityMenu).toBeHidden()

	const footer = page.getByRole('contentinfo', { name: 'Site information' })
	await expect(footer).toContainText(
		'Metadata from TMDB, MyAnimeList, AniList, and Trakt.',
	)
	await footer.getByRole('link', { name: 'About & data sources' }).click()

	await expect(page).toHaveURL(/\/credits$/)
	await expect(
		page.getByRole('heading', { name: 'Data sources & credits' }),
	).toBeVisible()
})
