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
	const [watching, completed] = await Promise.all([
		prisma.watchlist.create({
			data: {
				name: 'watching',
				header: 'Watching',
				position: 1,
				ownerId: user.id,
				typeId: listType.id,
			},
		}),
		prisma.watchlist.create({
			data: {
				name: 'completed',
				header: 'Completed',
				position: 2,
				ownerId: user.id,
				typeId: listType.id,
			},
		}),
	])
	const media = await prisma.media.create({
		data: {
			kind: 'anime',
			externalIds: {
				create: {
					provider: 'mal',
					kind: 'anime',
					externalId: faker.string.numeric(10),
				},
			},
			entries: {
				create: {
					watchlistId: watching.id,
					position: 1,
					title: 'Canonical Media Browser Test',
					length: '12 eps',
					description: 'A browser-level canonical media fixture.',
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
	} finally {
		await prisma.media.delete({ where: { id: media.id } }).catch(() => {})
	}
})
