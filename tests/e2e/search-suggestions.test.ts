import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

async function seedCatalog() {
	const tag = 'sugg' + Math.abs(Number(process.hrtime.bigint() % 100000n))
	const rows = await Promise.all(
		[
			{ title: `${tag} Popular Show`, kind: 'anime', popularity: 900 },
			{ title: `${tag} Second Show`, kind: 'anime', popularity: 800 },
			{ title: `${tag} Third Show`, kind: 'movie', popularity: 700 },
		].map(row =>
			prisma.media.create({
				data: {
					kind: row.kind,
					title: row.title,
					type: row.kind === 'movie' ? 'Movie' : 'TV Series',
					startYear: '2021',
					catalogPopularity: row.popularity,
				},
			}),
		),
	)
	return { tag, rows }
}

test('typing in the search bar offers titles without leaving the page', async ({
	page,
}) => {
	const { tag, rows } = await seedCatalog()
	await page.goto('/')
	const input = page.getByLabel('Search movies, TV, anime, manga, and people')
	await input.fill(tag)

	const listbox = page.getByRole('listbox', { name: 'Search suggestions' })
	await expect(listbox).toBeVisible()
	const options = listbox.getByRole('option')
	await expect(options).toHaveCount(3)
	// Best-known first, so the title most people mean is the one under the cursor.
	await expect(options.nth(0)).toContainText(`${tag} Popular Show`)

	// The bar becomes a combobox rather than a field with something unexplained
	// under it.
	await expect(input).toHaveAttribute('aria-expanded', 'true')

	// Still on the page it was typed on: this is a dropdown, not a search.
	expect(new URL(page.url()).pathname).toBe('/')

	// Arrow keys move through the list and Enter opens the highlighted title.
	await input.press('ArrowDown')
	await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true')
	await input.press('ArrowDown')
	await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true')
	await input.press('Enter')
	await expect(page).toHaveURL(new RegExp(`/media/${rows[1]!.id}$`))
})

test('the media type narrows the suggestions, and a short query offers none', async ({
	page,
}) => {
	const { tag } = await seedCatalog()
	await page.goto('/')
	const input = page.getByLabel('Search movies, TV, anime, manga, and people')

	// One letter is not a query worth answering.
	await input.fill('a')
	await expect(
		page.getByRole('listbox', { name: 'Search suggestions' }),
	).toHaveCount(0)

	await input.fill(tag)
	const listbox = page.getByRole('listbox', { name: 'Search suggestions' })
	await expect(listbox.getByRole('option')).toHaveCount(3)

	await page.getByLabel('Media type', { exact: true }).selectOption('movie')
	await expect(listbox.getByRole('option')).toHaveCount(1)
	await expect(listbox.getByRole('option').first()).toContainText('Third Show')

	// Escape dismisses the list. The field also empties, which is the browser's
	// own behaviour for `type="search"` and what people expect from a search
	// box, so it is left alone rather than fought.
	await input.press('Escape')
	await expect(
		page.getByRole('listbox', { name: 'Search suggestions' }),
	).toHaveCount(0)
	await expect(input).toHaveValue('')
})

test('people have their own suggestion group and open a person page', async ({
	page,
}) => {
	const tag = 'person' + Math.abs(Number(process.hrtime.bigint() % 100000n))
	const person = await prisma.person.create({
		data: {
			name: `${tag} Performer`,
			normalized: `${tag} performer`,
			knownForDepartment: 'Acting',
		},
	})
	const media = await prisma.media.create({
		data: { kind: 'movie', title: `Unrelated work ${tag.slice(-4)}` },
	})
	await prisma.mediaCredit.create({
		data: {
			mediaId: media.id,
			personId: person.id,
			provider: 'tmdb',
			creditType: 'cast',
			role: 'Lead',
		},
	})

	await page.goto('/')
	const input = page.getByLabel('Search movies, TV, anime, manga, and people')
	await input.fill(tag)

	const listbox = page.getByRole('listbox', { name: 'Search suggestions' })
	await expect(listbox.getByText('People', { exact: true })).toBeVisible()
	const personOption = listbox.getByRole('option').filter({
		hasText: `${tag} Performer`,
	})
	await expect(personOption).toContainText('Acting · 1 credit')

	await page.getByRole('link', { name: `See all results for “${tag}”` }).click()
	await expect(page).toHaveURL(new RegExp(`/discover\\?q=${tag}$`))
	const people = page.getByRole('region', { name: 'People' })
	await expect(
		people.getByRole('link', { name: `${tag} Performer` }),
	).toBeVisible()
	await people.getByRole('link', { name: `${tag} Performer` }).click()
	await expect(page).toHaveURL(new RegExp(`/people/${person.id}$`))
})
