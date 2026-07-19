import { faker } from '@faker-js/faker'
import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

test('member can open a canonical media page and change status', async ({
	page,
	login,
}) => {
	const user = await login()
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
	const media = await prisma.media.create({
		data: {
			kind: 'anime',
			title: 'Canonical Media Browser Test',
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
	})

	try {
		await page.goto(`/media/${media.id}`)
		await expect(
			page.getByRole('heading', { name: 'Canonical Media Browser Test' }),
		).toBeVisible()
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
		await expect(page.getByText('added to completed', { exact: true })).toBeVisible()
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
				prisma.review.findUnique({
					where: {
						authorId_mediaId: { authorId: user.id, mediaId: media.id },
					},
					select: { body: true, containsSpoilers: true, rating: true },
				}).then(review =>
					review
						? { ...review, rating: review.rating ? Number(review.rating) : null }
						: null,
				),
			)
			.toEqual({
				body: 'A browser-level review.',
				containsSpoilers: true,
				rating: 9.1,
			})
	} finally {
		await prisma.media.delete({ where: { id: media.id } }).catch(() => {})
	}
})
