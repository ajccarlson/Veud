import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { loader as activityLoader } from '#app/routes/users+/$username.activity.tsx'
import { loader as diaryLoader } from '#app/routes/users+/$username.diary.tsx'
import { loader as overviewLoader } from '#app/routes/users+/$username.index.tsx'
import { loader as reviewsLoader } from '#app/routes/users+/$username.reviews.tsx'
import { loader as profileLoader } from '#app/routes/users+/$username.tsx'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'

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
	await prisma.activityEvent.create({
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

	const loaderArgs = {
		request: new Request(`${BASE_URL}/users/${user.username}`),
		params: { username: user.username },
	} as any
	const [result, overviewResult, activityResult, reviewsResult, diaryResult] =
		await Promise.all([
			profileLoader(loaderArgs),
			overviewLoader(loaderArgs),
			activityLoader(loaderArgs),
			reviewsLoader(loaderArgs),
			diaryLoader(loaderArgs),
		])

	expect(result.data).not.toHaveProperty('typedEntries')
	expect(result.data).not.toHaveProperty('activityEvents')
	expect(overviewResult.data.trackingSummaries[listType.id]).toEqual({
		totalTitles: 1,
		meanScore: 8.5,
		repeatCount: 0,
		progress: [{ unit: 'episode', current: 12 }],
		statuses: [
			{ key: watching.id, label: 'Watching', count: 0 },
			{ key: completed.id, label: 'Completed', count: 1 },
		],
	})
	expect(activityResult.data.activityEvents).toHaveLength(3)
	expect(activityResult.data.activityEvents).toEqual(
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
	expect(reviewsResult.data.reviews).toEqual([
		expect.objectContaining({
			id: review.id,
			body: 'A profile-visible review.',
			containsSpoilers: true,
			rating: 9,
			typeId: listType.id,
			media: expect.objectContaining({ id: media.id }),
		}),
	])
	expect(diaryResult.data.diaryEntries).toEqual([
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

test('profile loader hides private lists and their tracking activity from visitors', async () => {
	const suffix = faker.string.alphanumeric({ length: 12 }).toLowerCase()
	const user = await prisma.user.create({
		data: {
			email: `private_${suffix}@example.com`,
			username: `private_${suffix}`,
		},
	})
	const listType = await prisma.listType.create({
		data: {
			name: `private-profile-${suffix}`,
			header: 'Private profile fixtures',
			columns: '{"title":"string"}',
			mediaType: '["episode"]',
			completionType: '{"past":"watched"}',
		},
	})
	const [publicList, privateList] = await Promise.all([
		prisma.watchlist.create({
			data: {
				ownerId: user.id,
				typeId: listType.id,
				name: 'public-profile-list',
				header: 'Public profile list',
				position: 1,
				isPublic: true,
			},
		}),
		prisma.watchlist.create({
			data: {
				ownerId: user.id,
				typeId: listType.id,
				name: 'private-profile-list',
				header: 'Private profile list',
				position: 2,
				isPublic: false,
			},
		}),
	])
	const [publicMedia, privateMedia] = await Promise.all([
		prisma.media.create({
			data: { kind: 'anime', title: 'Public profile title' },
		}),
		prisma.media.create({
			data: { kind: 'anime', title: 'Private profile title' },
		}),
	])
	const [publicState, privateState] = await Promise.all([
		prisma.trackingState.create({
			data: {
				ownerId: user.id,
				mediaId: publicMedia.id,
				status: 'watching',
				statusWatchlistId: publicList.id,
			},
		}),
		prisma.trackingState.create({
			data: {
				ownerId: user.id,
				mediaId: privateMedia.id,
				status: 'watching',
				statusWatchlistId: privateList.id,
			},
		}),
	])
	await Promise.all([
		prisma.entry.create({
			data: {
				watchlistId: publicList.id,
				position: 1,
				title: 'Public profile title',
				mediaId: publicMedia.id,
				trackingStateId: publicState.id,
			},
		}),
		prisma.entry.create({
			data: {
				watchlistId: privateList.id,
				position: 1,
				title: 'Private profile title',
				mediaId: privateMedia.id,
				trackingStateId: privateState.id,
			},
		}),
		prisma.activityEvent.create({
			data: {
				type: 'status',
				actorId: user.id,
				mediaId: publicMedia.id,
				trackingStateId: publicState.id,
				status: 'watching',
				statusLabel: publicList.header,
				statusWatchlistId: publicList.id,
				isPublic: true,
			},
		}),
		prisma.activityEvent.create({
			data: {
				type: 'status',
				actorId: user.id,
				mediaId: privateMedia.id,
				trackingStateId: privateState.id,
				status: 'watching',
				statusLabel: privateList.header,
				statusWatchlistId: privateList.id,
				isPublic: false,
			},
		}),
	])

	const visitorArgs = {
		request: new Request(`${BASE_URL}/users/${user.username}`),
		params: { username: user.username },
	} as any
	const [visitorResult, visitorActivityResult, visitorOverviewResult] =
		await Promise.all([
			profileLoader(visitorArgs),
			activityLoader(visitorArgs),
			overviewLoader(visitorArgs),
		])
	expect(visitorResult.data.watchLists.map(list => list.id)).toEqual([
		publicList.id,
	])
	expect(
		visitorActivityResult.data.activityEvents.map(event => event.media.title),
	).toEqual(['Public profile title'])
	expect(
		visitorOverviewResult.data.trackingSummaries[listType.id].totalTitles,
	).toBe(1)

	const session = await prisma.session.create({
		data: { userId: user.id, expirationDate: getSessionExpirationDate() },
		select: { id: true },
	})
	const cookie = await getSessionCookieHeader(session)
	const ownerArgs = {
		request: new Request(`${BASE_URL}/users/${user.username}`, {
			headers: { cookie },
		}),
		params: { username: user.username },
	} as any
	const [ownerResult, ownerActivityResult, ownerOverviewResult] =
		await Promise.all([
			profileLoader(ownerArgs),
			activityLoader(ownerArgs),
			overviewLoader(ownerArgs),
		])
	expect(ownerResult.data.watchLists.map(list => list.id).sort()).toEqual(
		[publicList.id, privateList.id].sort(),
	)
	expect(ownerActivityResult.data.activityEvents).toHaveLength(2)
	expect(
		ownerOverviewResult.data.trackingSummaries[listType.id].totalTitles,
	).toBe(2)
})
