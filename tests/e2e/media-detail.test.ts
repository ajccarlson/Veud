import { faker } from '@faker-js/faker'
import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

test('member can open a canonical media page and change status', async ({
	page,
	login,
	insertNewUser,
}) => {
	const user = await login()
	const [watchingMember, plannedMember] = await Promise.all([
		insertNewUser(),
		insertNewUser(),
	])
	const listType = await prisma.listType.findUniqueOrThrow({
		where: { name: 'anime' },
	})
	const completed = await prisma.watchlist.create({
		data: {
			name: 'completed',
			header: 'Completed',
			position: 1,
			ownerId: user.id,
			typeId: listType.id,
		},
	})
	const [media, recommendedMedia, trackedMatch, unrelatedMedia] =
		await Promise.all([
			prisma.media.create({
				data: {
					kind: 'anime',
					title: 'Canonical Media Browser Test',
					genres: 'Action, Fantasy',
					length: '12 eps',
					description: 'A browser-level canonical media fixture.',
					externalIds: {
						create: {
							provider: 'mal',
							kind: 'anime',
							externalId: faker.string.numeric(10),
						},
					},
				},
			}),
			prisma.media.create({
				data: {
					kind: 'anime',
					title: 'Recommended Browser Match',
					genres: 'Action, Fantasy, Adventure',
				},
			}),
			prisma.media.create({
				data: {
					kind: 'anime',
					title: 'Hidden Tracked Match',
					genres: 'Action, Fantasy',
				},
			}),
			prisma.media.create({
				data: {
					kind: 'anime',
					title: 'Unrelated Browser Romance',
					genres: 'Romance',
				},
			}),
		])
	await Promise.all([
		prisma.follow.create({
			data: { followerId: user.id, followingId: watchingMember.id },
		}),
		prisma.trackingState.create({
			data: {
				ownerId: watchingMember.id,
				mediaId: media.id,
				status: 'watching',
				score: 8.4,
			},
		}),
		prisma.trackingState.create({
			data: {
				ownerId: plannedMember.id,
				mediaId: media.id,
				status: 'plan-to-watch',
				score: 8.5,
			},
		}),
		prisma.trackingState.create({
			data: {
				ownerId: user.id,
				mediaId: trackedMatch.id,
				status: 'completed',
				statusWatchlistId: completed.id,
			},
		}),
	])

	try {
		await page.goto(`/media/${media.id}`)
		await expect(
			page.getByRole('heading', { name: 'Canonical Media Browser Test' }),
		).toBeVisible()
		await expect(
			page.getByRole('heading', { name: 'Community insights' }),
		).toBeVisible()
		await expect(page.getByText('8.45', { exact: true })).toBeVisible()
		await expect(page.getByLabel('Score 8: 1 rating')).toBeVisible()
		await expect(page.getByLabel('Score 9: 1 rating')).toBeVisible()
		await expect(page.getByLabel('Watching: 1 member')).toBeVisible()
		await expect(page.getByLabel('Plan To Watch: 1 member')).toBeVisible()
		await expect(
			page.getByRole('heading', { name: 'From people you follow' }),
		).toBeVisible()
		await expect(page.getByText('8.40', { exact: true })).toBeVisible()
		await expect(
			page.getByRole('link', {
				name: new RegExp(watchingMember.name ?? watchingMember.username),
			}),
		).toBeVisible()
		await expect(
			page.getByText(plannedMember.name ?? plannedMember.username, {
				exact: true,
			}),
		).toHaveCount(0)
		await expect(
			page.getByRole('heading', { name: 'More like this' }),
		).toBeVisible()
		await expect(
			page.getByRole('link', { name: /Recommended Browser Match/ }),
		).toBeVisible()
		await expect(page.getByText('Hidden Tracked Match')).toHaveCount(0)
		await expect(page.getByText('Unrelated Browser Romance')).toHaveCount(0)
		await page.getByLabel('Status').selectOption(completed.id)
		await page.getByRole('button', { name: 'Save status' }).click()
		await expect
			.poll(() =>
				prisma.trackingState.findUnique({
					where: {
						ownerId_mediaId: { ownerId: user.id, mediaId: media.id },
					},
					select: { status: true, statusWatchlistId: true },
				}),
			)
			.toEqual({ status: 'completed', statusWatchlistId: completed.id })
		await expect
			.poll(() =>
				prisma.entry.findFirst({
					where: { mediaId: media.id, watchlistId: completed.id },
					select: { title: true },
				}),
			)
			.toEqual({ title: 'Canonical Media Browser Test' })
		await expect(
			page.getByText('added to completed', { exact: true }),
		).toBeVisible()
		await expect
			.poll(() =>
				prisma.activityEvent.count({
					where: { actorId: user.id, mediaId: media.id, type: 'status' },
				}),
			)
			.toBe(1)

		await page.getByLabel('Date').fill('2026-07-19')
		await page.getByLabel('Diary rating').fill('8.8')
		await page.getByLabel('Rewatch').check()
		await page.getByRole('button', { name: 'Log watch' }).click()
		await expect(page.getByText('Rewatch Jul 19, 2026 · 8.8/10')).toBeVisible()
		await expect
			.poll(() =>
				prisma.diaryEntry.count({
					where: { ownerId: user.id, mediaId: media.id },
				}),
			)
			.toBe(1)

		await page
			.getByLabel('Review', { exact: true })
			.fill('A browser-level review.')
		await page.getByLabel('Review rating').fill('9.1')
		await page.getByLabel('Contains spoilers').check()
		await page.getByRole('button', { name: 'Publish review' }).click()
		await expect(
			page.getByText('Contains spoilers — reveal review'),
		).toBeVisible()
		await expect
			.poll(() =>
				prisma.review
					.findUnique({
						where: {
							authorId_mediaId: { authorId: user.id, mediaId: media.id },
						},
						select: { body: true, containsSpoilers: true, rating: true },
					})
					.then(review =>
						review
							? {
									...review,
									rating: review.rating ? Number(review.rating) : null,
								}
							: null,
					),
			)
			.toEqual({
				body: 'A browser-level review.',
				containsSpoilers: true,
				rating: 9.1,
			})

		await page.goto(`/users/${user.username}/reviews`)
		await expect(page.getByRole('heading', { name: 'Reviews' })).toBeVisible()
		await expect(
			page.getByText('Contains spoilers — reveal review'),
		).toBeVisible()

		await page.goto(`/users/${user.username}/diary`)
		await expect(page.getByRole('heading', { name: 'Diary' })).toBeVisible()
		await expect(page.getByText('Rewatch')).toBeVisible()
		await expect(page.getByText('8.8/10')).toBeVisible()

		await page.goto(`/users/${user.username}/activity`)
		await expect(page.getByText('Published a review')).toBeVisible()
		await expect(page.getByText('Logged a rewatch')).toBeVisible()
	} finally {
		await prisma.media
			.deleteMany({
				where: {
					id: {
						in: [
							media.id,
							recommendedMedia.id,
							trackedMatch.id,
							unrelatedMedia.id,
						],
					},
				},
			})
			.catch(() => {})
	}
})
