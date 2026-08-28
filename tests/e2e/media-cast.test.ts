import { prisma } from '#app/utils/db.server.ts'
import { normalizePersonName } from '#app/utils/media-credits.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

/**
 * Cast on a title page, and the page that holds the rest of it.
 */

async function titleWithCredits() {
	const media = await prisma.media.create({
		data: {
			kind: 'movie',
			title: 'Cast Browser Fixture',
			description: 'A film with people in it.',
		},
	})

	const cast = [
		['Ana Lead', 'The Lead'],
		['Ben Second', 'The Friend'],
		['Cara Third', 'The Rival'],
	] as const
	for (const [index, [name, character]] of cast.entries()) {
		await prisma.person.create({
			data: {
				name,
				normalized: normalizePersonName(name),
				credits: {
					create: {
						mediaId: media.id,
						provider: 'tmdb',
						creditType: 'cast',
						role: character,
						billingOrder: index,
					},
				},
			},
		})
	}

	// A director, and a grip who belongs on the full page but not under the
	// overview.
	await prisma.person.create({
		data: {
			name: 'Dana Director',
			normalized: normalizePersonName('Dana Director'),
			credits: {
				create: {
					mediaId: media.id,
					provider: 'tmdb',
					creditType: 'crew',
					role: 'Director',
					department: 'Directing',
				},
			},
		},
	})
	await prisma.person.create({
		data: {
			name: 'Gus Grip',
			normalized: normalizePersonName('Gus Grip'),
			credits: {
				create: {
					mediaId: media.id,
					provider: 'tmdb',
					creditType: 'crew',
					role: 'Grip',
					department: 'Lighting',
				},
			},
		},
	})

	return media
}

test('a title page shows its billed cast and who directed it', async ({
	page,
}) => {
	const media = await titleWithCredits()
	try {
		await page.goto(`/media/${media.id}`)

		// Whose is this? Directly under the description.
		await expect(page.getByText('Director', { exact: true })).toBeVisible()
		await expect(
			page.getByRole('link', { name: 'Dana Director' }),
		).toBeVisible()
		// The crew list proper has its own page; a grip does not belong here.
		await expect(page.getByText('Gus Grip')).toHaveCount(0)

		const strip = page.getByRole('list', { name: 'Top billed cast' })
		await expect(strip).toBeVisible()
		// Billing order is the information: the production put the lead first.
		const names = await strip.getByRole('link').allInnerTexts()
		expect(names[0]).toContain('Ana Lead')
		expect(names[1]).toContain('Ben Second')
		await expect(strip.getByText('The Lead')).toBeVisible()

		// A cast card leads to that person.
		await strip.getByRole('link', { name: /Ana Lead/ }).click()
		await expect(page).toHaveURL(/\/people\//)
	} finally {
		await prisma.media.delete({ where: { id: media.id } }).catch(() => {})
	}
})

test('the full cast and crew page holds everyone, grouped by department', async ({
	page,
}) => {
	const media = await titleWithCredits()
	try {
		await page.goto(`/media/${media.id}`)
		await page.getByRole('link', { name: 'Full cast & crew' }).click()
		await expect(page).toHaveURL(new RegExp(`/media/${media.id}/cast$`))

		// The count is part of the heading, so it says how many without a caption.
		await expect(page.getByRole('heading', { name: 'Cast 3' })).toBeVisible()
		for (const name of ['Ana Lead', 'Ben Second', 'Cara Third']) {
			await expect(page.getByRole('link', { name })).toBeVisible()
		}

		// Crew is grouped the way a call sheet is: department first, person second.
		await expect(page.getByRole('heading', { name: 'Directing' })).toBeVisible()
		await expect(page.getByRole('heading', { name: 'Lighting' })).toBeVisible()
		await expect(page.getByRole('link', { name: 'Gus Grip' })).toBeVisible()

		// Back where we came from.
		await page.getByRole('link', { name: /Cast Browser Fixture/ }).click()
		await expect(page).toHaveURL(new RegExp(`/media/${media.id}$`))
	} finally {
		await prisma.media.delete({ where: { id: media.id } }).catch(() => {})
	}
})

test('a title with no credits says so instead of showing an empty shelf', async ({
	page,
}) => {
	const media = await prisma.media.create({
		data: { kind: 'movie', title: 'Uncredited Browser Fixture' },
	})
	try {
		await page.goto(`/media/${media.id}`)
		// No heading for a section with nothing in it.
		await expect(
			page.getByRole('heading', { name: 'Top billed cast' }),
		).toHaveCount(0)

		await page.goto(`/media/${media.id}/cast`)
		await expect(
			page.getByText('No cast or crew has been recorded'),
		).toBeVisible()
	} finally {
		await prisma.media.delete({ where: { id: media.id } }).catch(() => {})
	}
})

test('a person page answers what else they have been in', async ({ page }) => {
	// The reason people are their own row rather than a string on a title.
	const [series, film] = await Promise.all([
		prisma.media.create({
			data: {
				kind: 'tv',
				title: 'Person Fixture Series',
				releaseStart: new Date('2021-01-01T00:00:00Z'),
				catalogPopularity: 90,
			},
		}),
		prisma.media.create({
			data: {
				kind: 'movie',
				title: 'Person Fixture Film',
				releaseStart: new Date('2015-01-01T00:00:00Z'),
				catalogPopularity: 10,
			},
		}),
	])
	const person = await prisma.person.create({
		data: {
			name: 'Mira Fixture',
			normalized: 'mira fixture',
			knownForDepartment: 'Acting',
			biography: 'Mira works both in front of and behind the camera.',
			birthday: new Date('1984-05-12T00:00:00Z'),
			placeOfBirth: 'Portland, Oregon, USA',
			gender: 'Female',
			homepage: 'https://mira.example.test/about',
			detailsFetchedAt: new Date(),
			credits: {
				create: [
					{
						mediaId: series.id,
						provider: 'tmdb',
						creditType: 'cast',
						role: 'Eleanor',
						billingOrder: 0,
						episodeCount: 42,
					},
					{
						mediaId: film.id,
						provider: 'tmdb',
						creditType: 'cast',
						role: 'Herself',
						billingOrder: 0,
					},
					// Same person, other side of the camera: a separate group.
					{
						mediaId: film.id,
						provider: 'tmdb',
						creditType: 'crew',
						role: 'Director',
						department: 'Directing',
					},
				],
			},
		},
	})

	try {
		await page.goto(`/people/${person.id}`)
		await expect(
			page.getByRole('heading', { name: 'Mira Fixture', level: 1 }),
		).toBeVisible()
		await expect(page.getByText('May 12, 1984')).toBeVisible()
		await expect(page.getByText('Portland, Oregon, USA')).toBeVisible()
		await expect(page.getByText('Female', { exact: true })).toBeVisible()
		await expect(
			page.getByRole('link', { name: 'mira.example.test' }),
		).toHaveAttribute('href', 'https://mira.example.test/about')
		await expect(
			page.getByText('Mira works both in front of and behind the camera.'),
		).toBeVisible()

		// Acting and Directing are separate sections, as TMDB separates them.
		await expect(page.getByRole('heading', { name: 'Acting' })).toBeVisible()
		await expect(page.getByRole('heading', { name: 'Directing' })).toBeVisible()

		// A filmography reads backwards from now.
		const acting = page.locator('section', {
			has: page.getByRole('heading', { name: 'Acting' }),
		})
		const years = await acting.locator('li span').first().innerText()
		expect(years).toBe('2021')
		await expect(acting.getByText('as Eleanor · 42 episodes')).toBeVisible()

		// The strip leads with the better-known title regardless of date.
		const knownFor = page.getByRole('list', { name: 'Known for' })
		const first = await knownFor.getByRole('link').first().innerText()
		expect(first).toContain('Person Fixture Series')
		// One card per title, even though this person has two credits on the film.
		await expect(knownFor.getByRole('link')).toHaveCount(2)

		await knownFor.getByRole('link').first().click()
		await expect(page).toHaveURL(new RegExp(`/media/${series.id}$`))
	} finally {
		await prisma.media
			.deleteMany({ where: { id: { in: [series.id, film.id] } } })
			.catch(() => {})
		await prisma.person.delete({ where: { id: person.id } }).catch(() => {})
	}
})

test('an unknown person is a 404, not a blank page', async ({ page }) => {
	const response = await page.goto('/people/does-not-exist')
	expect(response?.status()).toBe(404)
	await expect(
		page.getByText('Nobody by that id is in the catalog'),
	).toBeVisible()
})
