import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

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
		await expect(page.getByRole('heading', { name: 'Following' })).toBeVisible()
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
