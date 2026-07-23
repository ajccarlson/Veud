import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

test('member dashboard preferences persist across reloads and stay calm on mobile', async ({
	page,
	login,
}) => {
	const viewer = await login()
	const genre = 'Dashboard browser genre'
	const [active, recommendation] = await Promise.all([
		prisma.media.create({
			data: {
				kind: 'anime',
				title: 'Dashboard Continue Fixture',
				genres: genre,
			},
		}),
		prisma.media.create({
			data: {
				kind: 'anime',
				title: 'Dashboard Recommendation Fixture',
				genres: genre,
			},
		}),
	])
	await prisma.trackingState.create({
		data: {
			ownerId: viewer.id,
			mediaId: active.id,
			status: 'watching',
			score: 9,
			progress: {
				create: { unit: 'episodes', current: 4, total: 12 },
			},
		},
	})

	try {
		await page.goto('/')
		await expect(
			page.getByRole('heading', { name: 'Continue', exact: true }),
		).toBeVisible()
		await expect(page.getByText('Episodes 4 of 12')).toBeVisible()
		await expect(
			page.getByRole('heading', { name: 'Recommendations', exact: true }),
		).toBeVisible()
    const recommendationsModule = page.locator(
      ".home-dashboard-module--recommendations",
    )
    await expect(
      recommendationsModule.getByText(recommendation.title!, { exact: true }),
    ).toBeVisible()

		await page.getByText('Customize home', { exact: true }).click()
		await page.getByRole('button', { name: 'Compact' }).click()
		await page
			.getByRole('button', { name: 'Collapse Following activity' })
			.click()
		await page
			.getByRole('button', { name: 'Move Recommendations earlier' })
			.click()
		await expect(
			page.getByRole('region', { name: 'Following activity' }),
		).toBeVisible()
		await expect(
			page.getByRole('heading', { name: 'Following', exact: true }),
		).not.toBeVisible()
		await expect
			.poll(async () => {
				const preference =
					await prisma.homeDashboardPreference.findUnique({
						where: { ownerId: viewer.id },
					})
				return {
					density: preference?.density,
					collapsed: preference?.collapsedModules,
				}
			})
			.toEqual({
				density: 'compact',
				collapsed: JSON.stringify(['following']),
			})

		await page.reload()
		await expect(page.locator('.home-personal-dashboard')).toHaveAttribute(
			'data-density',
			'compact',
		)
		await expect(
			page.getByRole('region', { name: 'Following activity' }),
		).toBeVisible()
		await page.setViewportSize({ width: 390, height: 844 })
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= window.innerWidth,
			),
		).toBe(true)
	} finally {
		await prisma.media
			.deleteMany({ where: { id: { in: [active.id, recommendation.id] } } })
			.catch(() => {})
	}
})

test('home shows a unified activity feed from followed members', async ({
	page,
	login,
	insertNewUser,
}) => {
	const viewer = await login()
	const followed = await insertNewUser()
	const media = await prisma.media.create({
		data: {
			kind: 'anime',
			title: 'Following Feed Browser Test',
			nextRelease: JSON.stringify({
				releaseDate: new Date(Date.now() + 24 * 60 * 60 * 1_000),
				episode: 2,
				name: 'The canonical home schedule',
			}),
		},
	})
	await Promise.all([
		prisma.follow.create({
			data: { followerId: viewer.id, followingId: followed.id },
		}),
		prisma.activityEvent.create({
			data: {
				type: 'status',
				actorId: followed.id,
				mediaId: media.id,
				status: 'completed',
				statusLabel: 'Completed',
			},
		}),
		prisma.review.create({
			data: {
				authorId: followed.id,
				mediaId: media.id,
				body: 'A followed browser-level review.',
				containsSpoilers: true,
				rating: 9,
			},
		}),
		prisma.diaryEntry.create({
			data: {
				ownerId: followed.id,
				mediaId: media.id,
				loggedOn: new Date('2026-07-19T00:00:00.000Z'),
				isRepeat: true,
				rating: 8.5,
			},
		}),
		prisma.trackingState.create({
			data: {
				ownerId: viewer.id,
				mediaId: media.id,
				status: 'watching',
				score: 8,
			},
		}),
	])

	try {
		await page.goto('/')
		await expect(
			page.getByRole('heading', { name: 'Following', exact: true }),
		).toBeVisible()
		const library = page.getByRole('region', { name: 'Your library' })
		await expect(library).toBeVisible()
		await expect(library.getByText('1', { exact: true }).first()).toBeVisible()
		await expect(library.getByText('Anime')).toBeVisible()
		await expect(
			page
				.getByText(followed.name ?? followed.username, { exact: true })
				.first(),
		).toBeVisible()
		await expect(page.getByText('published a review')).toBeVisible()
		await expect(page.getByText('logged a rewatch')).toBeVisible()
		await expect(page.getByText('added to completed')).toBeVisible()
		const upcoming = page.getByRole('region', { name: 'Upcoming releases' })
		await expect(upcoming).toBeVisible()
		await expect(
			upcoming.getByText('Following Feed Browser Test'),
		).toBeVisible()
		await expect(upcoming.getByText('Episode 2')).toBeVisible()
		await expect(
			upcoming.getByText('Watching · 8/10 · 1 member tracking'),
		).toBeVisible()
		await expect(
			upcoming.getByRole('link', { name: 'View full calendar' }),
		).toHaveAttribute('href', /scope=mine/)
		await page.getByText('Spoiler review — reveal').click()
		await expect(
			page.getByText('A followed browser-level review.'),
		).toBeVisible()
	} finally {
		await prisma.media.delete({ where: { id: media.id } }).catch(() => {})
	}
})

test('trending rails lead the homepage, scroll horizontally, and quick-track canonical media', async ({
	page,
	login,
}) => {
	await page.setViewportSize({ width: 1440, height: 900 })
	const viewer = await login()
	const liveActionType = await prisma.listType.upsert({
		where: { name: 'liveaction' },
		update: {},
		create: {
			name: 'liveaction',
			header: 'Live Action',
			columns: '{}',
			mediaType: '["movie","tv"]',
			completionType: '{}',
		},
	})
	const watching = await prisma.watchlist.create({
		data: {
			ownerId: viewer.id,
			typeId: liveActionType.id,
			name: 'watching',
			header: 'Watching',
			position: 1,
		},
	})
	const media = await Promise.all(
		Array.from({ length: 12 }, (_, index) =>
			prisma.media.create({
				data: {
					kind: 'movie',
					title:
						index === 0
							? 'Home Trending Ranked'
							: `Home Trending Fallback ${index}`,
					type: 'Movie',
					catalogPopularity: index === 0 ? 1 : 100 - index,
					catalogScore: 8 - index / 10,
				},
			}),
		),
	)
	await prisma.catalogFeedItem.create({
		data: {
			provider: 'tmdb',
			kind: 'movie',
			feed: 'trending',
			rank: 1,
			observedAt: new Date(),
			mediaId: media[0]!.id,
		},
	})

	try {
		await page.goto('/')
		const homeContainer = page.locator('.home-container')
		await expect(homeContainer).toBeVisible()
		await expect
			.poll(async () => {
				const box = await homeContainer.boundingBox()
				if (!box) return Number.POSITIVE_INFINITY

				const leftGutter = box.x
				const rightGutter = 1440 - (box.x + box.width)
				return Math.abs(leftGutter - rightGutter)
			})
			.toBeLessThanOrEqual(2)

		const trendingHeading = page.getByRole('heading', { name: 'Trending now' })
		const followingHeading = page.getByRole('heading', {
			name: 'Following',
			exact: true,
		})
		await expect(trendingHeading).toBeVisible()
		await expect(followingHeading).toBeVisible()
		const [trendingBox, followingBox] = await Promise.all([
			trendingHeading.boundingBox(),
			followingHeading.boundingBox(),
		])
		expect(trendingBox?.y).toBeLessThan(followingBox?.y ?? 0)

		const rail = page.getByTestId('trending-rail-movie')
		const scrollLeft = page.getByRole('button', {
			name: 'Scroll Trending movies left',
		})
		const scrollRight = page.getByRole('button', {
			name: 'Scroll Trending movies right',
		})
		const rankedCard = rail
			.locator('article')
			.filter({ hasText: 'Home Trending Ranked' })
		const watchlistSelect = rankedCard.getByLabel(
			'Tracking status for Home Trending Ranked',
		)
		await expect(watchlistSelect).toHaveAttribute(
			'data-tracking-state',
			'available',
		)
		await expect(watchlistSelect).toHaveCSS(
			'background-color',
			'rgb(46, 47, 43)',
		)
		await expect(rankedCard.getByText('Popular', { exact: true })).toHaveCount(
			0,
		)
		await expect(rankedCard.getByText('Trending', { exact: true })).toHaveCount(
			0,
		)
		await expect
			.poll(() =>
				rail.evaluate(element => element.scrollWidth > element.clientWidth),
			)
			.toBe(true)
		await expect(scrollLeft).toBeDisabled()
		await expect(scrollRight).toBeEnabled()
		await rail.focus()
		await page.keyboard.press('ArrowRight')
		await expect
			.poll(() => rail.evaluate(element => element.scrollLeft))
			.toBeGreaterThan(0)
		await expect(scrollLeft).toBeEnabled()
		await rail.evaluate(element => {
			element.scrollLeft = 0
		})
		await expect(scrollLeft).toBeDisabled()
		await scrollRight.click()
		await expect
			.poll(() => rail.evaluate(element => element.scrollLeft))
			.toBeGreaterThan(0)
		await expect(scrollLeft).toBeEnabled()

		await rankedCard
			.getByRole('button', { name: 'Track Home Trending Ranked' })
			.click()
		await expect(rankedCard.getByText('Saved', { exact: true })).toBeVisible()
		await expect(watchlistSelect).toHaveAttribute(
			'data-tracking-state',
			'tracked',
		)
		await expect(watchlistSelect).toHaveCSS(
			'background-color',
			'rgb(49, 87, 70)',
		)
		await expect
			.poll(() =>
				prisma.trackingState.findUnique({
					where: {
						ownerId_mediaId: {
							ownerId: viewer.id,
							mediaId: media[0]!.id,
						},
					},
					select: { statusWatchlistId: true },
				}),
			)
			.toEqual({ statusWatchlistId: watching.id })
	} finally {
		await prisma.media.deleteMany({
			where: { id: { in: media.map(item => item.id) } },
		})
	}
})
