import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { loader as activityLoader } from '#app/routes/users+/$username.activity.tsx'
import { loader as diaryLoader } from '#app/routes/users+/$username.diary.tsx'
import { loader as overviewLoader } from '#app/routes/users+/$username.index.tsx'
import { loader as reviewsLoader } from '#app/routes/users+/$username.reviews.tsx'
import { loader as statsLoader } from '#app/routes/users+/$username.stats.tsx'
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
			malScore: 9.1,
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
				personal: 6,
				malScore: 5,
			},
			{
				watchlistId: completed.id,
				position: 1,
				title: 'Canonical destination row',
				mediaId: media.id,
				trackingStateId: state.id,
				personal: 6,
				malScore: 5,
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
			publicEligible: true,
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
	const [
		result,
		overviewResult,
		statsResult,
		activityResult,
		reviewsResult,
		diaryResult,
	] = await Promise.all([
		profileLoader(loaderArgs),
		overviewLoader(loaderArgs),
		statsLoader(loaderArgs),
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
	expect(activityResult.data.activityLimited).toBe(false)
	expect(statsResult.data.scoreBuckets[listType.id].personal[7]).toBe(2)
	expect(statsResult.data.providerScoreBuckets[listType.id].malScore[8]).toBe(2)
})

test('profile activity returns a bounded recent window with an explicit partial marker', async () => {
	const suffix = faker.string.alphanumeric({ length: 12 }).toLowerCase()
	const user = await prisma.user.create({
		data: {
			email: `activity-bound-${suffix}@example.com`,
			username: `activity_bound_${suffix}`,
		},
	})
	const media = await prisma.media.create({
		data: { kind: 'movie', title: 'Bounded activity fixture' },
	})
	await prisma.activityEvent.createMany({
		data: Array.from({ length: 101 }, (_, index) => ({
			type: 'status',
			actorId: user.id,
			mediaId: media.id,
			status: 'watching',
			publicEligible: true,
			createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)),
		})),
	})

	const result = await activityLoader({
		request: new Request(`${BASE_URL}/users/${user.username}/activity`),
		params: { username: user.username },
	} as any)

	expect(result.data.activityEvents).toHaveLength(100)
	expect(result.data.activityLimited).toBe(true)
	expect(result.data.activityEvents[0]?.time).toEqual(
		new Date(Date.UTC(2026, 0, 1, 1, 40)),
	)
})

test('visitor activity keeps media-type mappings when the only list is private', async () => {
	const suffix = faker.string.alphanumeric({ length: 12 }).toLowerCase()
	const user = await prisma.user.create({
		data: {
			email: `private-type-${suffix}@example.com`,
			username: `private_type_${suffix}`,
		},
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
	})
	await prisma.watchlist.create({
		data: {
			ownerId: user.id,
			typeId: listType.id,
			name: 'private-only',
			header: 'Private only',
			position: 1,
			isPublic: false,
		},
	})
	const media = await prisma.media.create({
		data: { kind: 'anime', title: 'Private-only type mapping fixture' },
	})
	const [review, diary] = await Promise.all([
		prisma.review.create({
			data: {
				authorId: user.id,
				mediaId: media.id,
				body: 'Public review without a public list.',
			},
		}),
		prisma.diaryEntry.create({
			data: {
				ownerId: user.id,
				mediaId: media.id,
				loggedOn: new Date('2026-07-28T00:00:00.000Z'),
			},
		}),
	])

	const result = await activityLoader({
		request: new Request(`${BASE_URL}/users/${user.username}/activity`),
		params: { username: user.username },
	} as any)

	expect(result.data.activityEvents).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				id: `review:${review.id}`,
				typeId: listType.id,
			}),
			expect.objectContaining({ id: `diary:${diary.id}`, typeId: listType.id }),
		]),
	)
})

test('profile activity keeps newer legacy events for owners but not visitors', async () => {
	const suffix = faker.string.alphanumeric({ length: 12 }).toLowerCase()
	const user = await prisma.user.create({
		data: {
			email: `activity-parity-${suffix}@example.com`,
			username: `activity_parity_${suffix}`,
		},
	})
	const listType = await prisma.listType.create({
		data: {
			name: `activity-parity-${suffix}`,
			header: 'Activity parity',
			columns: '{"title":"string"}',
			mediaType: '["episode"]',
			completionType: '{"past":"watched"}',
		},
	})
	const watchlist = await prisma.watchlist.create({
		data: {
			ownerId: user.id,
			typeId: listType.id,
			name: 'watching',
			header: 'Watching',
			position: 1,
			isPublic: true,
		},
	})
	const media = await prisma.media.create({
		data: { kind: 'anime', title: 'Legacy parity fixture' },
	})
	const normalizedAt = new Date('2026-07-28T12:00:00.000Z')
	const legacyFinishedAt = new Date('2026-07-28T12:02:00.000Z')
	await Promise.all([
		prisma.entry.create({
			data: {
				watchlistId: watchlist.id,
				mediaId: media.id,
				position: 1,
				title: 'Legacy parity fixture',
				history: JSON.stringify({
					finished: legacyFinishedAt.getTime(),
				}),
			},
		}),
		prisma.activityEvent.create({
			data: {
				type: 'score',
				actorId: user.id,
				mediaId: media.id,
				score: 8,
				publicEligible: true,
				createdAt: normalizedAt,
			},
		}),
	])

	const visitorResult = await activityLoader({
		request: new Request(`${BASE_URL}/users/${user.username}/activity`),
		params: { username: user.username },
	} as any)

	expect(visitorResult.data.activityEvents).toEqual([
		expect.objectContaining({ action: 'Rated 8/10', time: normalizedAt }),
	])

	const session = await prisma.session.create({
		data: { userId: user.id, expirationDate: getSessionExpirationDate() },
	})
	const ownerResult = await activityLoader({
		request: new Request(`${BASE_URL}/users/${user.username}/activity`, {
			headers: { cookie: await getSessionCookieHeader(session) },
		}),
		params: { username: user.username },
	} as any)
	expect(ownerResult.data.activityEvents).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ action: 'Rated 8/10', time: normalizedAt }),
			expect.objectContaining({ action: 'Finished', time: legacyFinishedAt }),
		]),
	)
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
	const unrelatedOwner = await prisma.user.create({
		data: {
			email: `unrelated_${suffix}@example.com`,
			username: `unrelated_${suffix}`,
		},
	})
	const unrelatedMedia = await prisma.media.create({
		data: { kind: 'anime', title: 'Cross-owner state fixture' },
	})
	const [mismatchedStateMedia, mismatchedEntryMedia] = await Promise.all([
		prisma.media.create({
			data: { kind: 'anime', title: 'Mismatched state media' },
		}),
		prisma.media.create({
			data: { kind: 'anime', title: 'Mismatched entry media' },
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
				score: 9,
				repeatCount: 4,
				progress: {
					create: { unit: 'episode', current: 12, total: 12 },
				},
			},
		}),
	])
	const unrelatedState = await prisma.trackingState.create({
		data: {
			ownerId: unrelatedOwner.id,
			mediaId: unrelatedMedia.id,
			status: 'watching',
			score: 10,
			repeatCount: 7,
			progress: {
				create: { unit: 'episode', current: 99, total: 99 },
			},
		},
	})
	const mismatchedState = await prisma.trackingState.create({
		data: {
			ownerId: user.id,
			mediaId: mismatchedStateMedia.id,
			status: 'watching',
			score: 7,
			repeatCount: 3,
			progress: {
				create: { unit: 'episode', current: 24, total: 24 },
			},
		},
	})
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
				type: 'Private sentinel type',
				genres: 'Private Sentinel Genre',
				mediaId: privateMedia.id,
				trackingStateId: privateState.id,
			},
		}),
		prisma.entry.create({
			data: {
				watchlistId: publicList.id,
				position: 2,
				title: 'Public duplicate with a private canonical state',
				mediaId: privateMedia.id,
				trackingStateId: privateState.id,
				personal: 9,
				length: '12 / 12 eps',
				history: JSON.stringify({
					started: Date.UTC(2026, 0, 1),
					finished: Date.UTC(2026, 0, 2),
					repeatCount: 4,
					progress: {
						episode: {
							12: { finishDate: [Date.UTC(2026, 0, 2)] },
						},
					},
				}),
			},
		}),
		prisma.entry.create({
			data: {
				watchlistId: publicList.id,
				position: 3,
				title: 'Entry with an unrelated tracking state',
				mediaId: unrelatedMedia.id,
				trackingStateId: unrelatedState.id,
			},
		}),
		prisma.entry.create({
			data: {
				watchlistId: publicList.id,
				position: 4,
				title: 'Entry with a mismatched media state',
				mediaId: mismatchedEntryMedia.id,
				trackingStateId: mismatchedState.id,
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
				publicEligible: true,
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
				publicEligible: true,
			},
		}),
	])

	const visitorArgs = {
		request: new Request(`${BASE_URL}/users/${user.username}`),
		params: { username: user.username },
	} as any
	const [
		visitorResult,
		visitorActivityResult,
		visitorOverviewResult,
		visitorStatsResult,
	] = await Promise.all([
		profileLoader(visitorArgs),
		activityLoader(visitorArgs),
		overviewLoader(visitorArgs),
		statsLoader(visitorArgs),
	])
	expect(visitorResult.data).not.toHaveProperty('watchLists')
	expect(
		visitorActivityResult.data.activityEvents.map(event => event.media.title),
	).toEqual(['Public profile title'])
	expect(
		visitorOverviewResult.data.trackingSummaries[listType.id],
	).toMatchObject({
		totalTitles: 4,
		meanScore: null,
		repeatCount: 0,
		progress: [],
	})
	expect(visitorOverviewResult.data.completionHistory.days).toEqual([])
	expect(visitorStatsResult.data.scoreBuckets[listType.id].personal).toEqual(
		Array.from({ length: 10 }, () => 0),
	)
	expect(visitorStatsResult.data.completionYears[listType.id]).toEqual([])
	expect(
		visitorStatsResult.data.genreMatrices[listType.id].labels,
	).not.toContain('Private Sentinel Genre')
	expect(visitorStatsResult.data.listTypeCounts[listType.id]).toBe(4)

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
	const [
		ownerResult,
		ownerActivityResult,
		ownerOverviewResult,
		ownerStatsResult,
	] = await Promise.all([
		profileLoader(ownerArgs),
		activityLoader(ownerArgs),
		overviewLoader(ownerArgs),
		statsLoader(ownerArgs),
	])
	expect(ownerResult.data).not.toHaveProperty('watchLists')
	expect(ownerActivityResult.data.activityEvents).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ id: expect.stringMatching(/^tracking:/) }),
			expect.objectContaining({ action: 'Finished' }),
		]),
	)
	expect(ownerOverviewResult.data.trackingSummaries[listType.id]).toMatchObject(
		{
			totalTitles: 4,
			meanScore: 9,
			repeatCount: 4,
			progress: [{ unit: 'episode', current: 12 }],
		},
	)
	expect(ownerOverviewResult.data.completionHistory.days).toContainEqual({
		day: '2026-01-02',
		value: 1,
	})
	expect(ownerStatsResult.data.scoreBuckets[listType.id].personal[8]).toBe(2)
	expect(ownerStatsResult.data.completionYears[listType.id]).toContainEqual({
		year: 2026,
		count: 1,
	})
	expect(ownerStatsResult.data.genreMatrices[listType.id].labels).toContain(
		'Private Sentinel Genre',
	)
	expect(ownerStatsResult.data.listTypeCounts[listType.id]).toBe(5)
})
