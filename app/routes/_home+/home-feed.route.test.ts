import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { loader } from './index.tsx'

async function createUser(prefix: string) {
	const suffix = faker.string.alphanumeric({ length: 10 }).toLowerCase()
	return prisma.user.create({
		data: {
			email: `${prefix}_${suffix}@example.com`,
			username: `${prefix}_${suffix}`,
			name: `${prefix} member`,
		},
	})
}

test('signed-in home feed contains activity only from followed members', async () => {
	const [viewer, followed, unrelated] = await Promise.all([
		createUser('viewer'),
		createUser('followed'),
		createUser('unrelated'),
	])
	const media = await prisma.media.create({
		data: {
			kind: 'movie',
			title: 'Personalized Home Fixture',
			catalogPopularity: 1,
			releaseStart: new Date(Date.now() + 24 * 60 * 60 * 1_000),
		},
	})
	await Promise.all([
		prisma.follow.create({
			data: { followerId: viewer.id, followingId: followed.id },
		}),
		prisma.review.create({
			data: {
				authorId: followed.id,
				mediaId: media.id,
				body: 'Visible followed review.',
			},
		}),
		prisma.review.create({
			data: {
				authorId: unrelated.id,
				mediaId: media.id,
				body: 'Hidden unrelated review.',
			},
		}),
		prisma.trackingState.create({
			data: {
				ownerId: viewer.id,
				mediaId: media.id,
				status: 'plan-to-watch',
				score: 8.5,
				repeatCount: 2,
			},
		}),
	])
	const session = await prisma.session.create({
		data: {
			userId: viewer.id,
			expirationDate: getSessionExpirationDate(),
		},
	})
	const cookie = await getSessionCookieHeader(session)

	const result = await loader({
		request: new Request(BASE_URL, { headers: { cookie } }),
		params: {},
	} as any)

	expect(result.data.followingCount).toBe(1)
	expect(result.data.isSignedIn).toBe(true)
	expect(result.data.watchlists).toEqual([])
	expect(result.data.librarySummary).toEqual({
		totalTitles: 1,
		meanScore: 8.5,
		repeatCount: 2,
		groups: [
			{ key: 'liveaction', label: 'Live action', count: 1 },
			{ key: 'anime', label: 'Anime', count: 0 },
			{ key: 'manga', label: 'Manga', count: 0 },
		],
	})
	expect(result.data.trendingRails).toEqual([
		expect.objectContaining({
			kind: 'movie',
			items: [
				expect.objectContaining({
					id: media.id,
					title: 'Personalized Home Fixture',
					viewerTracking: expect.objectContaining({
						status: 'plan-to-watch',
					}),
				}),
			],
		}),
	])
	expect(result.data.followingFeed).toEqual([
		expect.objectContaining({
			kind: 'review',
			actor: expect.objectContaining({ id: followed.id }),
			review: expect.objectContaining({ body: 'Visible followed review.' }),
		}),
	])
	expect(result.data.suggestedMembers).toEqual([])
	expect(result.data.upcomingCalendar).toMatchObject({
		timeZone: 'UTC',
		total: 1,
		days: expect.arrayContaining([
			expect.objectContaining({
				items: [
					expect.objectContaining({
						mediaId: media.id,
						title: 'Personalized Home Fixture',
						eventLabel: 'Premiere',
						viewerTracking: expect.objectContaining({
							statusLabel: 'Plan To Watch',
						}),
					}),
				],
			}),
		]),
	})
})

test('anonymous home loader does not expose a personalized feed', async () => {
	const result = await loader({
		request: new Request(BASE_URL),
		params: {},
	} as any)

	expect(result.data.followingCount).toBe(0)
	expect(result.data.isSignedIn).toBe(false)
	expect(result.data.watchlists).toEqual([])
	expect(result.data.librarySummary).toBeNull()
	expect(result.data.trendingRails).toEqual([])
	expect(result.data.followingFeed).toEqual([])
	expect(result.data.suggestedMembers).toEqual([])
	expect(result.data.upcomingCalendar).toBeNull()
	expect(result.data.anonymousHomeProof).toEqual({
		catalogTotal: 0,
		reviewTotal: 0,
		publicCollectionTotal: 0,
		kinds: [],
		activity: [],
	})
})

test('new members receive discovery suggestions that exclude themselves', async () => {
	const [viewer, candidate] = await Promise.all([
		createUser('new_viewer'),
		createUser('candidate'),
	])
	const session = await prisma.session.create({
		data: {
			userId: viewer.id,
			expirationDate: getSessionExpirationDate(),
		},
	})
	const cookie = await getSessionCookieHeader(session)

	const result = await loader({
		request: new Request(BASE_URL, { headers: { cookie } }),
		params: {},
	} as any)

	expect(result.data.followingCount).toBe(0)
	expect(result.data.isSignedIn).toBe(true)
	expect(result.data.watchlists).toEqual([])
	expect(result.data.librarySummary).toEqual({
		totalTitles: 0,
		meanScore: null,
		repeatCount: 0,
		groups: [
			{ key: 'liveaction', label: 'Live action', count: 0 },
			{ key: 'anime', label: 'Anime', count: 0 },
			{ key: 'manga', label: 'Manga', count: 0 },
		],
	})
	expect(result.data.trendingRails).toEqual([])
	expect(result.data.followingFeed).toEqual([])
	expect(result.data.suggestedMembers).toEqual([
		expect.objectContaining({ id: candidate.id }),
	])
	expect(
		result.data.suggestedMembers.some(member => member.id === viewer.id),
	).toBe(false)
	expect(result.data.upcomingCalendar).toMatchObject({ total: 0 })
})

test('collapsed dashboard modules preserve their order without loading personalized data', async () => {
	const viewer = await createUser('collapsed_viewer')
	const media = await prisma.media.create({
		data: {
			kind: 'movie',
			title: 'Collapsed Home Fixture',
			releaseStart: new Date(Date.now() + 24 * 60 * 60 * 1_000),
		},
	})
	await Promise.all([
		prisma.trackingState.create({
			data: {
				ownerId: viewer.id,
				mediaId: media.id,
				status: 'watching',
			},
		}),
		prisma.homeDashboardPreference.create({
			data: {
				ownerId: viewer.id,
				density: 'compact',
				moduleOrder: JSON.stringify([
					'continue',
					'recommendations',
					'trending',
					'following',
					'library',
					'upcoming',
				]),
				collapsedModules: JSON.stringify([
					'trending',
					'continue',
					'recommendations',
					'following',
					'library',
					'upcoming',
				]),
			},
		}),
	])
	const session = await prisma.session.create({
		data: {
			userId: viewer.id,
			expirationDate: getSessionExpirationDate(),
		},
	})
	const cookie = await getSessionCookieHeader(session)

	const result = await loader({
		request: new Request(BASE_URL, { headers: { cookie } }),
		params: {},
	} as any)

	expect(result.data.dashboardConfig).toEqual({
		density: 'compact',
		moduleOrder: [
			'continue',
			'recommendations',
			'trending',
			'following',
			'library',
			'upcoming',
		],
		collapsedModules: [
			'trending',
			'continue',
			'recommendations',
			'following',
			'library',
			'upcoming',
		],
	})
	expect(result.data.trendingRails).toEqual([])
	expect(result.data.continuationQueue).toEqual([])
	expect(result.data.recommendationGraph).toBeNull()
	expect(result.data.followingFeed).toEqual([])
	expect(result.data.suggestedMembers).toEqual([])
	expect(result.data.followingCount).toBe(0)
	expect(result.data.librarySummary).toBeNull()
	expect(result.data.upcomingCalendar).toBeNull()
	expect(result.data.watchlists).toEqual([])
})
