import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { loader } from '#app/routes/users+/$username.tsx'
import { prisma } from '#app/utils/db.server.ts'
import { BASE_URL } from '#tests/utils.ts'

test('profile loader returns canonical tracking summaries without duplicate rows', async () => {
	const suffix = faker.string.alphanumeric({ length: 12 }).toLowerCase()
	const user = await prisma.user.create({
		data: {
			email: `${suffix}@example.com`,
			username: `u_${suffix}`,
		},
		select: { id: true, username: true },
	})
	const listType = await prisma.listType.upsert({
		where: { name: 'anime' },
		update: {},
		create: {
			name: 'anime',
			header: 'Anime',
			columns: '{"length":"string"}',
			mediaType: '["episode"]',
			completionType: '{"past":"watched"}',
		},
		select: { id: true },
	})
	const watching = await prisma.watchlist.create({
		data: {
			name: 'watching',
			header: 'Watching',
			position: 1,
			ownerId: user.id,
			typeId: listType.id,
		},
		select: { id: true },
	})
	const completed = await prisma.watchlist.create({
		data: {
			name: 'completed',
			header: 'Completed',
			position: 2,
			ownerId: user.id,
			typeId: listType.id,
		},
		select: { id: true },
	})
	const media = await prisma.media.create({
		data: {
			kind: 'anime',
			title: 'Canonical Activity Title',
			thumbnail: 'https://example.com/poster.jpg|https://example.com/title',
		},
		select: { id: true },
	})
	const state = await prisma.trackingState.create({
		data: {
			ownerId: user.id,
			mediaId: media.id,
			status: 'completed',
			statusWatchlistId: completed.id,
			score: 8.5,
			progress: {
				create: { unit: 'episode', current: 12, total: 12 },
			},
		},
		select: { id: true },
	})
	await prisma.entry.createMany({
		data: [
			{
				watchlistId: watching.id,
				position: 1,
				title: 'Duplicate source row',
				mediaId: media.id,
				trackingStateId: state.id,
			},
			{
				watchlistId: completed.id,
				position: 1,
				title: 'Canonical destination row',
				mediaId: media.id,
				trackingStateId: state.id,
			},
		],
	})
	const activity = await prisma.activityEvent.create({
		data: {
			type: 'score',
			actorId: user.id,
			mediaId: media.id,
			trackingStateId: state.id,
			score: 8.5,
		},
	})
	const [review, diaryEntry] = await Promise.all([
		prisma.review.create({
			data: {
				authorId: user.id,
				mediaId: media.id,
				body: 'A profile-visible review.',
				containsSpoilers: true,
				rating: 9,
			},
		}),
		prisma.diaryEntry.create({
			data: {
				ownerId: user.id,
				mediaId: media.id,
				loggedOn: new Date('2026-07-19T00:00:00.000Z'),
				isRepeat: true,
				rating: 8.5,
			},
		}),
	])

	const result = await loader({
		request: new Request(`${BASE_URL}/users/${user.username}`),
		params: { username: user.username },
	} as any)

	expect(result.data.trackingSummaries[listType.id]).toEqual({
		totalTitles: 1,
		meanScore: 8.5,
		repeatCount: 0,
		progress: [{ unit: 'episode', current: 12 }],
		statuses: [
			{ key: watching.id, label: 'Watching', count: 0 },
			{ key: completed.id, label: 'Completed', count: 1 },
		],
	})
	expect(result.data.activityEvents).toHaveLength(3)
	expect(result.data.activityEvents).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				action: 'Rated 8.5/10',
				typeId: listType.id,
				media: expect.objectContaining({
					id: media.id,
					title: 'Canonical Activity Title',
				}),
			}),
			expect.objectContaining({
				id: `review:${review.id}`,
				action: 'Published a review',
				typeId: listType.id,
			}),
			expect.objectContaining({
				id: `diary:${diaryEntry.id}`,
				action: 'Logged a rewatch',
				typeId: listType.id,
			}),
		]),
	)
	expect(result.data.activityStartedAt).toEqual(activity.createdAt)
	expect(result.data.reviews).toEqual([
		expect.objectContaining({
			id: review.id,
			body: 'A profile-visible review.',
			containsSpoilers: true,
			rating: 9,
			typeId: listType.id,
			media: expect.objectContaining({ id: media.id }),
		}),
	])
	expect(result.data.diaryEntries).toEqual([
		expect.objectContaining({
			id: diaryEntry.id,
			loggedOn: new Date('2026-07-19T00:00:00.000Z'),
			isRepeat: true,
			rating: 8.5,
			typeId: listType.id,
			media: expect.objectContaining({ id: media.id }),
		}),
	])
})
