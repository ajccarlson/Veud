import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

test('member can filter the catalog and discover an unseen personalized title', async ({
	page,
	login,
}) => {
	test.setTimeout(30_000)
	const viewer = await login()
	const listType = await prisma.listType.upsert({
		where: { name: 'anime' },
		update: {},
		create: {
			name: 'anime',
			header: 'Anime',
			columns: '{}',
			mediaType: '["episode"]',
			completionType: '{}',
		},
	})
	const completed = await prisma.watchlist.create({
		data: {
			ownerId: viewer.id,
			typeId: listType.id,
			name: 'completed',
			header: 'Completed',
		},
	})
	const [tracked, fantasyMatch, romanceMovie] = await Promise.all([
		prisma.media.create({
			data: {
				kind: 'anime',
				title: 'Browser Discovery Seed',
				genres: 'Fantasy, Adventure',
			},
		}),
		prisma.media.create({
			data: {
				kind: 'anime',
				title: 'Browser Fantasy Match',
				genres: 'Fantasy',
				description: 'An unseen fantasy recommendation.',
			},
		}),
		prisma.media.create({
			data: {
				kind: 'movie',
				title: 'Browser Romance Film',
				genres: 'Romance',
				description: 'A catalog search fixture.',
				releaseStart: new Date('2026-02-14T00:00:00.000Z'),
				releaseStatus: 'Released',
				catalogPopularity: 75,
				externalIds: {
					create: { provider: 'tmdb', kind: 'movie', externalId: '990123' },
				},
				titles: {
					create: {
						provider: 'tmdb',
						language: 'fr',
						titleType: 'alternate',
						value: 'Browser Amour Cinema',
						normalized: 'browser amour cinema',
					},
				},
			},
		}),
	])
	await prisma.trackingState.create({
		data: {
			ownerId: viewer.id,
			mediaId: tracked.id,
			status: 'completed',
			statusWatchlistId: completed.id,
			score: 9,
		},
	})

	try {
		await page.goto('/discover')
		await expect(
			page.getByRole('heading', { name: 'Discover', exact: true }),
		).toBeVisible()
		await expect(page.getByText('Browser Fantasy Match')).toBeVisible()

		const discoverPage = page.getByRole('main')
		await page.getByLabel('Title or keyword').fill('Browser Amour')
		await discoverPage.getByLabel('Media type').selectOption('movie')
		await page.getByLabel('Release year').fill('2026')
		await page.getByLabel('Release status').selectOption('Released')
		await page.getByLabel('Provider').selectOption('tmdb')
		await page
			.getByRole('button', { name: 'Search catalog', exact: true })
			.click()
		await expect(page).toHaveURL(/q=Browser\+Amour/)
		await expect(page.getByText('Browser Romance Film')).toBeVisible()
		await expect(
			page.getByText('Also known as Browser Amour Cinema'),
		).toBeVisible()
		await expect(page.getByText('Browser Fantasy Match')).not.toBeVisible()

		await page.getByLabel('Title or keyword').fill('')
		await discoverPage.getByLabel('Media type').selectOption('all')
		await page.getByLabel('Release year').fill('')
		await page.getByLabel('Release status').selectOption('')
		await page.getByLabel('Provider').selectOption('all')
		await page.getByLabel('Rank by').selectOption('for-you')
		await page
			.getByRole('button', { name: 'Search catalog', exact: true })
			.click()
		await expect(page).toHaveURL(/sort=for-you/)
		await expect(page.getByText('Browser Fantasy Match')).toBeVisible()
		await expect(page.getByText('Browser Discovery Seed')).not.toBeVisible()
		await expect(
			page.getByRole('heading', { name: 'Recommendations for you' }),
		).toBeVisible()
		await expect(
			page.getByRole('heading', { name: 'Matches your taste' }),
		).toBeVisible()
		await page.setViewportSize({ width: 390, height: 844 })

		let recommendation = page
			.getByRole('article')
			.filter({ hasText: 'Browser Fantasy Match' })
		await expect(
			recommendation.getByLabel('Why Browser Fantasy Match was recommended'),
		).toContainText('Fantasy')
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= window.innerWidth,
			),
		).toBe(true)
		await recommendation
			.getByRole('button', {
				name: 'Show fewer titles like Browser Fantasy Match',
			})
			.click()
		await expect(recommendation).not.toBeVisible()
		const hiddenRecommendations = page.getByText(
			/Review recent hidden recommendations \(1 of 1\)/,
		)
		await hiddenRecommendations.click()
		await page
			.getByRole('button', {
				name: 'Restore Browser Fantasy Match to recommendations',
			})
			.click()
		recommendation = page
			.getByRole('article')
			.filter({ hasText: 'Browser Fantasy Match' })
		await expect(recommendation).toBeVisible()
		await expect(
			recommendation.getByLabel('Tracking status for Browser Fantasy Match'),
		).toHaveValue(completed.id)
		await recommendation
			.getByRole('button', { name: 'Track Browser Fantasy Match' })
			.click()
		await expect(recommendation).not.toBeVisible()
		await expect
			.poll(() =>
				prisma.trackingState.findUnique({
					where: {
						ownerId_mediaId: {
							ownerId: viewer.id,
							mediaId: fantasyMatch.id,
						},
					},
				}),
			)
			.toEqual(
				expect.objectContaining({
					status: 'completed',
					statusWatchlistId: completed.id,
				}),
			)
		expect(
			await prisma.entry.count({
				where: { mediaId: fantasyMatch.id, watchlistId: completed.id },
			}),
		).toBe(1)
	} finally {
		await prisma.media
			.deleteMany({
				where: { id: { in: [tracked.id, fantasyMatch.id, romanceMovie.id] } },
			})
			.catch(() => {})
	}
})

test('global advanced search returns five grounded memory matches without AI', async ({
	page,
}) => {
	const matches = await Promise.all(
		Array.from({ length: 5 }, (_, index) =>
			prisma.media.create({
				data: {
					kind: 'movie',
					title: `Cobalt Lighthouse Memory ${index + 1}`,
					description:
						'A violinist climbs a cobalt lighthouse during a winter storm.',
					catalogPopularity: 100 - index,
				},
			}),
		),
	)

	try {
		await page.goto('/discover')
		const siteSearch = page.locator('form.site-search')
		await siteSearch
			.locator('summary[aria-label="Advanced search settings"]')
			.click()
		const memoryMode = siteSearch.getByLabel('Enable Tip of My Tongue search')
		await expect(memoryMode).toBeEnabled()
		await memoryMode.check()
		await siteSearch
			.getByLabel('Search movies, TV, anime, and manga')
			.fill('A violinist in a cobalt lighthouse during a winter storm')
		await siteSearch.getByLabel('Media type').selectOption('movie')
		await siteSearch.getByRole('button', { name: 'Search' }).click()

		await expect(page).toHaveURL(/mode=memory/)
		await expect(
			page.getByRole('heading', { name: 'Closest matches' }),
		).toBeVisible()
		await expect(page.getByText(/5 of 5 matches/)).toBeVisible()
		await expect(page.getByText(/Local match/)).toBeVisible()
		await expect(
			siteSearch.getByLabel('Enable Tip of My Tongue search'),
		).toBeChecked()
		const resultCards = page.getByRole('article')
		for (const match of matches) {
			const card = resultCards.filter({ hasText: match.title! })
			await expect(card).toBeVisible()
			await expect(
				card.getByLabel('Details matching your description'),
			).toContainText('cobalt')
			await expect(
				card.getByLabel('Details matching your description'),
			).toContainText('lighthouse')
			await expect(
				card.getByLabel('Memory match explanation').locator('mark'),
			).not.toHaveCount(0)
		}
		await expect(
			resultCards.first().getByRole('link', {
				name: /Log in to track/,
			}),
		).toBeVisible()
	} finally {
		await prisma.media
			.deleteMany({ where: { id: { in: matches.map(match => match.id) } } })
			.catch(() => {})
	}
})

test('Tip of My Tongue keeps text and image clues in one prompt', async ({
	page,
	login,
}) => {
	await login()
	await page.goto('/discover?mode=memory')
	const prompt = page.locator('.discover-memory-input')
	await expect(prompt.getByLabel('What do you remember?')).toBeVisible()
	await expect(prompt.getByLabel('Add a screenshot or cover')).toBeVisible()
	await expect(
		page.getByRole('heading', { name: 'Search from a screenshot or cover' }),
	).toHaveCount(0)
})

test('Tip of My Tongue makes its loading state unmistakable', async ({
	page,
}) => {
	await page.goto('/discover?mode=memory')
	await page.route('**/discover*', async route => {
		if (route.request().resourceType() !== 'image') {
			await new Promise(resolve => setTimeout(resolve, 1_000))
		}
		await route.continue()
	})
	await page
		.getByLabel('What do you remember?')
		.fill('A red balloon follows a child through Paris')
	await page.locator('#discover-kind').selectOption('movie')

	const submission = page
		.getByRole('button', { name: 'Find matches' })
		.click({ noWaitAfter: true })
	const loading = page.getByRole('status', {
		name: 'Tip of My Tongue search in progress',
	})
	await expect(loading).toBeVisible()
	await expect(loading).toContainText('Finding five matches')
	await expect(loading).toContainText('Checking your clues')
	await expect(
		page.getByRole('button', { name: 'Finding matches…' }),
	).toBeDisabled()
	await submission
})
