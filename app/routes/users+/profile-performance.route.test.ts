import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { loader as activityLoader } from '#app/routes/users+/$username.activity.tsx'
import { loader as favoritesLoader } from '#app/routes/users+/$username.favorites.tsx'
import { loader as overviewLoader } from '#app/routes/users+/$username.index.tsx'
import { loader as statsLoader } from '#app/routes/users+/$username.stats.tsx'
import {
	loader as profileLoader,
	shouldRevalidate,
} from '#app/routes/users+/$username.tsx'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import {
	PROFILE_ACTIVITY_ACTION_LENGTH_LIMIT,
	PROFILE_ACTIVITY_RESPONSE_BYTE_LIMIT,
	PROFILE_ACTIVITY_TITLE_LENGTH_LIMIT,
} from '#app/utils/profile-activity.ts'
import { PROFILE_ANALYTICS_ENTRY_LIMIT } from '#app/utils/profile-analytics.ts'
import {
	PROFILE_CATEGORY_CANDIDATE_CODE_UNIT_LIMIT,
	PROFILE_CATEGORY_CANDIDATE_RAW_CODE_UNIT_LIMIT,
	PROFILE_CATEGORY_EXACT_CODE_UNIT_LIMIT,
	PROFILE_CATEGORY_EXACT_RAW_CODE_UNIT_LIMIT,
	PROFILE_CATEGORY_GENRES_CODE_UNIT_LIMIT,
	PROFILE_CATEGORY_RAW_REQUEST_CODE_UNIT_LIMIT,
	PROFILE_CATEGORY_REQUEST_CODE_UNIT_LIMIT,
	PROFILE_CATEGORY_TYPE_CODE_UNIT_LIMIT,
} from '#app/utils/profile-data.server.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'

test('profile category projections share one fixed and fair request budget', () => {
	const semanticCodeUnitsPerPass =
		(PROFILE_CATEGORY_TYPE_CODE_UNIT_LIMIT +
			PROFILE_CATEGORY_GENRES_CODE_UNIT_LIMIT) *
		PROFILE_ANALYTICS_ENTRY_LIMIT
	const rawCodeUnitsPerPass =
		2 *
		(PROFILE_CATEGORY_TYPE_CODE_UNIT_LIMIT +
			1 +
			PROFILE_CATEGORY_GENRES_CODE_UNIT_LIMIT +
			1) *
		PROFILE_ANALYTICS_ENTRY_LIMIT

	expect(PROFILE_CATEGORY_REQUEST_CODE_UNIT_LIMIT).toBe(48 * 1024 * 1024)
	expect(PROFILE_CATEGORY_CANDIDATE_CODE_UNIT_LIMIT).toBe(
		PROFILE_CATEGORY_EXACT_CODE_UNIT_LIMIT,
	)
	expect(
		PROFILE_CATEGORY_CANDIDATE_CODE_UNIT_LIMIT +
			PROFILE_CATEGORY_EXACT_CODE_UNIT_LIMIT,
	).toBe(PROFILE_CATEGORY_REQUEST_CODE_UNIT_LIMIT)
	expect(PROFILE_CATEGORY_TYPE_CODE_UNIT_LIMIT).toBe(64)
	expect(PROFILE_CATEGORY_GENRES_CODE_UNIT_LIMIT).toBe(
		Math.floor(
			PROFILE_CATEGORY_CANDIDATE_CODE_UNIT_LIMIT /
				PROFILE_ANALYTICS_ENTRY_LIMIT,
		) - PROFILE_CATEGORY_TYPE_CODE_UNIT_LIMIT,
	)
	expect(PROFILE_CATEGORY_GENRES_CODE_UNIT_LIMIT).toBe(187)
	expect(semanticCodeUnitsPerPass).toBeLessThanOrEqual(
		PROFILE_CATEGORY_CANDIDATE_CODE_UNIT_LIMIT,
	)
	expect(semanticCodeUnitsPerPass * 2).toBeLessThanOrEqual(
		PROFILE_CATEGORY_REQUEST_CODE_UNIT_LIMIT,
	)
	expect(PROFILE_CATEGORY_CANDIDATE_RAW_CODE_UNIT_LIMIT).toBe(
		rawCodeUnitsPerPass,
	)
	expect(PROFILE_CATEGORY_EXACT_RAW_CODE_UNIT_LIMIT).toBe(rawCodeUnitsPerPass)
	expect(PROFILE_CATEGORY_RAW_REQUEST_CODE_UNIT_LIMIT).toBe(
		rawCodeUnitsPerPass * 2,
	)
})

test('profile tab navigation keeps the stable shell without blocking explicit refreshes', () => {
	const base = {
		currentParams: { username: 'sample' },
		nextParams: { username: 'sample' },
		currentUrl: new URL(`${BASE_URL}/users/sample`),
		nextUrl: new URL(`${BASE_URL}/users/sample/reviews`),
		defaultShouldRevalidate: true,
	} as any

	expect(shouldRevalidate(base)).toBe(false)
	expect(
		shouldRevalidate({
			...base,
			nextParams: { username: 'another-member' },
		}),
	).toBe(true)
	expect(
		shouldRevalidate({
			...base,
			nextUrl: base.currentUrl,
		}),
	).toBe(true)
})

test('profile shell and analytics stay compact as a library grows', async () => {
	const suffix = faker.string.alphanumeric({ length: 12 }).toLowerCase()
	const user = await prisma.user.create({
		data: {
			email: `profile_perf_${suffix}@example.com`,
			username: `profile_perf_${suffix}`,
			bio: 'A representative profile with a substantial tracking history.',
		},
	})
	const listType = await prisma.listType.create({
		data: {
			name: `profile-perf-${suffix}`,
			header: 'Profile performance fixtures',
			columns: JSON.stringify({
				title: 'string',
				length: 'string',
				personal: 'number',
			}),
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
		},
	})
	const omittedSentinel = `OMITTED_${suffix}`
	const entries = Array.from({ length: 5_000 }, (_, index) => {
		// Seed the newest 1,000 completion days first, then older history. This
		// proves the bounded payload is stable while still exercising eviction.
		const completionDay = index < 1_000 ? index + 4_000 : index - 1_000
		return {
			watchlistId: watchlist.id,
			position: index + 1,
			title: `Representative title ${index + 1}`,
			type: 'TV',
			length: `${(index % 24) + 1} / 24 eps`,
			personal: (index % 10) + 1,
			history: JSON.stringify({
				added: Date.UTC(2025, 0, 1) + index,
				lastUpdated: Date.UTC(2025, 0, 1) + index,
				finished: Date.UTC(2012, 9, 1) + completionDay * 86_400_000,
			}),
			description: `${omittedSentinel}:${'description '.repeat(180)}`,
			notes: `${omittedSentinel}:${'private note '.repeat(120)}`,
		}
	})
	async function insertEntries(from: number, to: number) {
		for (let index = from; index < to; index += 100) {
			await prisma.entry.createMany({
				data: entries.slice(index, Math.min(index + 100, to)),
			})
		}
	}

	const args = {
		request: new Request(`${BASE_URL}/users/${user.username}`),
		params: { username: user.username },
	} as any
	await insertEntries(0, 1_000)
	const [shellResult, smallOverviewResult] = await Promise.all([
		profileLoader(args),
		overviewLoader(args),
	])
	await insertEntries(1_000, entries.length)
	const [overviewResult, statsResult] = await Promise.all([
		overviewLoader(args),
		statsLoader(args),
	])
	const shellPayload = JSON.stringify(shellResult.data)
	const smallOverviewPayload = JSON.stringify(smallOverviewResult.data)
	const overviewPayload = JSON.stringify(overviewResult.data)
	const statsPayload = JSON.stringify(statsResult.data)
	const overviewRoundTrip = JSON.parse(overviewPayload) as {
		trackingSummaries: Record<string, { totalTitles: number }>
		diagnostic: { processed: number; truncated: boolean }
	}
	const statsRoundTrip = JSON.parse(statsPayload) as {
		scoreBuckets: Record<string, { personal: number[] }>
		diagnostic: { processed: number; truncated: boolean }
	}

	expect(Buffer.byteLength(shellPayload)).toBeLessThan(32 * 1024)
	expect(Buffer.byteLength(overviewPayload)).toBeLessThan(64 * 1024)
	expect(Buffer.byteLength(statsPayload)).toBeLessThan(128 * 1024)
	expect(
		Math.abs(
			Buffer.byteLength(overviewPayload) -
				Buffer.byteLength(smallOverviewPayload),
		),
	).toBeLessThan(2 * 1024)
	expect(shellPayload).not.toContain('typedEntries')
	expect(overviewPayload).not.toContain('typedEntries')
	expect(statsPayload).not.toContain('typedEntries')
	expect(overviewPayload).not.toContain(omittedSentinel)
	expect(statsPayload).not.toContain(omittedSentinel)
	expect(overviewPayload).not.toContain('Representative title')
	expect(statsPayload).not.toContain('Representative title')
	expect(overviewRoundTrip.trackingSummaries[listType.id]?.totalTitles).toBe(
		5_000,
	)
	expect(overviewRoundTrip.diagnostic).toMatchObject({
		processed: 5_000,
		truncated: false,
		limit: 100_000,
		completionDaysTruncated: true,
	})
	expect(statsRoundTrip.diagnostic).toMatchObject({
		processed: 5_000,
		truncated: false,
		limit: 100_000,
	})
	expect(statsRoundTrip.scoreBuckets[listType.id]?.personal).toEqual(
		Array.from({ length: 10 }, () => 500),
	)
	expect(new Headers(shellResult.init?.headers).get('Server-Timing')).toContain(
		'profile_shell',
	)
	expect(
		new Headers(overviewResult.init?.headers).get('Server-Timing'),
	).toContain('profile_overview')
})

test('profile text projection and activity stay byte-bounded for hostile legacy rows', async () => {
	const suffix = faker.string.alphanumeric({ length: 12 }).toLowerCase()
	const user = await prisma.user.create({
		data: {
			email: `profile-bytes-${suffix}@example.com`,
			username: `profile_bytes_${suffix}`,
		},
	})
	const listType = await prisma.listType.create({
		data: {
			name: `profile-bytes-${suffix}`,
			header: 'Profile byte bounds',
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
	await prisma.entry.createMany({
		data: [
			{
				watchlistId: watchlist.id,
				position: 1,
				title: 'T'.repeat(300_000),
				thumbnail: `https://example.com/${'x'.repeat(4_000)}`,
				type: 'Y'.repeat(1_000),
				genres: 'Genre,'.repeat(10_000),
				history: JSON.stringify({
					['A'.repeat(20_000)]: Date.UTC(2026, 0, 1),
				}),
			},
			{
				watchlistId: watchlist.id,
				position: 2,
				title: 'Oversized history',
				history: JSON.stringify({ note: 'z'.repeat(200_000) }),
			},
		],
	})
	const session = await prisma.session.create({
		data: { userId: user.id, expirationDate: getSessionExpirationDate() },
	})
	const args = {
		request: new Request(`${BASE_URL}/users/${user.username}`, {
			headers: { cookie: await getSessionCookieHeader(session) },
		}),
		params: { username: user.username },
	} as any

	const [overviewResult, statsResult, activityResult] = await Promise.all([
		overviewLoader(args),
		statsLoader(args),
		activityLoader(args),
	])
	const overviewPayload = JSON.stringify(overviewResult.data)
	const statsPayload = JSON.stringify(statsResult.data)
	const activityPayload = JSON.stringify(activityResult.data)

	expect(Buffer.byteLength(overviewPayload)).toBeLessThan(64 * 1024)
	expect(Buffer.byteLength(statsPayload)).toBeLessThan(128 * 1024)
	expect(Buffer.byteLength(activityPayload)).toBeLessThan(64 * 1024)
	expect(overviewResult.data.diagnostic.historyEntriesRejected).toBeGreaterThan(
		0,
	)
	expect(statsResult.data.diagnostic.categoryCandidatesTruncated).toBe(true)
	expect(activityResult.data.activityLimited).toBe(true)
	expect(activityResult.data.activityEvents[0]?.action.length).toBeLessThan(512)
	expect(
		activityResult.data.activityEvents[0]?.media.title.length,
	).toBeLessThan(512)
	expect(activityResult.data.activityEvents[0]?.media.thumbnail).toBeNull()
})

test('emoji-heavy profile text stays within UTF-16 projection ceilings', async () => {
	const suffix = faker.string.alphanumeric({ length: 12 }).toLowerCase()
	const user = await prisma.user.create({
		data: {
			email: `profile-emoji-${suffix}@example.com`,
			username: `profile_emoji_${suffix}`,
		},
	})
	const listType = await prisma.listType.create({
		data: {
			name: `profile-emoji-${suffix}`,
			header: 'Emoji profile bounds',
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
		},
	})
	const omittedSentinel = `EMOJI_OMITTED_${suffix}`
	const media = await prisma.media.create({
		data: {
			kind: 'anime',
			title: `${'😀'.repeat(200)}${omittedSentinel}`,
			type: '😀'.repeat(200),
			genres: '😀'.repeat(5_000),
		},
	})
	const state = await prisma.trackingState.create({
		data: {
			ownerId: user.id,
			mediaId: media.id,
			status: `${'😀'.repeat(200_000)}${omittedSentinel}`,
			statusWatchlistId: watchlist.id,
		},
	})
	await Promise.all([
		prisma.entry.create({
			data: {
				watchlistId: watchlist.id,
				mediaId: media.id,
				trackingStateId: state.id,
				position: 1,
				title: media.title!,
				type: '😀'.repeat(200),
				genres: '😀'.repeat(5_000),
				history: JSON.stringify({
					finished: Date.UTC(2026, 0, 1),
					note: `${'😀'.repeat(70_000)}${omittedSentinel}`,
				}),
			},
		}),
		prisma.activityEvent.create({
			data: {
				type: 'status',
				status: '😀'.repeat(100),
				actorId: user.id,
				mediaId: media.id,
				publicEligible: true,
			},
		}),
	])
	const args = {
		request: new Request(`${BASE_URL}/users/${user.username}`),
		params: { username: user.username },
	} as any

	const [overviewResult, statsResult, activityResult] = await Promise.all([
		overviewLoader(args),
		statsLoader(args),
		activityLoader(args),
	])
	const payload = JSON.stringify({
		overview: overviewResult.data,
		stats: statsResult.data,
		activity: activityResult.data,
	})
	const activityTitle = activityResult.data.activityEvents[0]?.media.title ?? ''

	expect(overviewResult.data.diagnostic.historyEntriesRejected).toBe(1)
	expect(statsResult.data.diagnostic.categoryCandidatesTruncated).toBe(true)
	expect(activityResult.data.activityLimited).toBe(true)
	expect(activityTitle.length).toBeLessThanOrEqual(241)
	expect(activityTitle).not.toContain('\uFFFD')
	expect(payload).not.toContain(omittedSentinel)
	expect(Buffer.byteLength(payload)).toBeLessThan(256 * 1024)
})

test('hostile early category values do not starve a later page', async () => {
	const suffix = faker.string.alphanumeric({ length: 12 }).toLowerCase()
	const user = await prisma.user.create({
		data: {
			email: `profile-category-fairness-${suffix}@example.com`,
			username: `profile_category_fairness_${suffix}`,
		},
	})
	const listType = await prisma.listType.create({
		data: {
			name: `profile-category-fairness-${suffix}`,
			header: 'Category projection fairness',
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
		},
	})
	const hostileEntries = Array.from({ length: 500 }, (_, index) => ({
		id: `category-fair-${suffix}-${String(index).padStart(4, '0')}`,
		watchlistId: watchlist.id,
		position: index + 1,
		title: `Hostile category ${index + 1}`,
		type: '😀'.repeat(100),
		genres: 'Hostile Genre,'.repeat(100),
	}))
	for (let index = 0; index < hostileEntries.length; index += 100) {
		await prisma.entry.createMany({
			data: hostileEntries.slice(index, index + 100),
		})
	}
	await prisma.entry.create({
		data: {
			id: `category-fair-${suffix}-9999-tail`,
			watchlistId: watchlist.id,
			position: hostileEntries.length + 1,
			title: 'Tail category',
			type: 'Tail Type',
			genres: 'Tail Fairness',
		},
	})

	const result = await statsLoader({
		request: new Request(`${BASE_URL}/users/${user.username}`),
		params: { username: user.username },
	} as any)

	expect(result.data.diagnostic).toMatchObject({
		processed: 501,
		truncated: false,
		categoryCandidatesTruncated: true,
	})
	expect(result.data.mediaTypeCounts[listType.id]).toContainEqual({
		key: 'tail type',
		label: 'Tail Type',
		count: 1,
	})
	expect(result.data.genreMatrices[listType.id]?.labels).toContain(
		'Tail Fairness',
	)
})

test('profile stats use canonical media for linked historical categories', async () => {
	const suffix = faker.string.alphanumeric({ length: 12 }).toLowerCase()
	const sentinel = `PRIVATE_PROFILE_CATEGORY_${suffix}`
	const [user, listType, canonical, sparse] = await Promise.all([
		prisma.user.create({
			data: {
				email: `profile-category-provenance-${suffix}@example.com`,
				username: `profile_category_provenance_${suffix}`,
			},
		}),
		prisma.listType.create({
			data: {
				name: `profile-category-provenance-${suffix}`,
				header: 'Profile category provenance',
				columns: '{"title":"string"}',
				mediaType: '["movie"]',
				completionType: '{"past":"watched"}',
			},
		}),
		prisma.media.create({
			data: {
				kind: 'movie',
				title: 'Canonical profile category',
				type: 'Canonical Feature',
				genres: 'Canonical Genre, Trusted Genre',
				releaseStart: new Date('2024-03-01T00:00:00.000Z'),
				airYear: '2024',
			},
		}),
		prisma.media.create({ data: { kind: 'movie' } }),
	])
	const watchlist = await prisma.watchlist.create({
		data: {
			ownerId: user.id,
			typeId: listType.id,
			name: 'watched',
			header: 'Watched',
			position: 1,
			isPublic: true,
		},
	})
	await prisma.entry.createMany({
		data: [
			{
				watchlistId: watchlist.id,
				mediaId: canonical.id,
				position: 1,
				title: `${sentinel} title`,
				type: `${sentinel} type`,
				genres: `${sentinel} genre`,
				releaseStart: new Date('2099-01-01T00:00:00.000Z'),
				airYear: '2099',
				tmdbScore: 1,
				malScore: 1,
			},
			{
				watchlistId: watchlist.id,
				mediaId: sparse.id,
				position: 2,
				title: `${sentinel} sparse title`,
				type: `${sentinel} sparse type`,
				genres: `${sentinel} sparse genre`,
				airYear: '2098',
			},
		],
	})

	const result = await statsLoader({
		request: new Request(`${BASE_URL}/users/${user.username}/stats`),
		params: { username: user.username },
	} as any)

	expect(JSON.stringify(result.data)).not.toContain(sentinel)
	expect(result.data.mediaTypeCounts[listType.id]).toContainEqual({
		key: 'canonical feature',
		label: 'Canonical Feature',
		count: 1,
	})
	expect(result.data.genreMatrices[listType.id]?.labels).toEqual(
		expect.arrayContaining(['Canonical Genre', 'Trusted Genre']),
	)
	expect(result.data.releaseYears[listType.id]).toContainEqual({
		year: 2024,
		count: 1,
	})
	expect(result.data.releaseYears[listType.id]).not.toEqual(
		expect.arrayContaining([
			{ year: 2098, count: expect.any(Number) },
			{ year: 2099, count: expect.any(Number) },
		]),
	)
})

test('BMP profile titles retain half, half-plus-one, and full-limit values', async () => {
	const suffix = faker.string.alphanumeric({ length: 12 }).toLowerCase()
	const user = await prisma.user.create({
		data: {
			email: `profile-bmp-${suffix}@example.com`,
			username: `profile_bmp_${suffix}`,
		},
	})
	const titles = ['A'.repeat(120), 'B'.repeat(121), 'C'.repeat(240)]
	const media = await Promise.all(
		titles.map(title =>
			prisma.media.create({ data: { kind: 'movie', title } }),
		),
	)
	await prisma.activityEvent.createMany({
		data: media.map((item, index) => ({
			type: 'status',
			status: 'planned',
			actorId: user.id,
			mediaId: item.id,
			publicEligible: true,
			createdAt: new Date(Date.UTC(2026, 6, 28, 0, index)),
		})),
	})

	const result = await activityLoader({
		request: new Request(`${BASE_URL}/users/${user.username}`),
		params: { username: user.username },
	} as any)

	expect(
		[...result.data.activityEvents]
			.map(event => event.media.title)
			.sort((left, right) => left.length - right.length),
	).toEqual(titles)
	expect(result.data.activityLimited).toBe(false)
})

test('normalized activity, review, diary, and media text stay bounded before serialization', async () => {
	const suffix = faker.string.alphanumeric({ length: 12 }).toLowerCase()
	const user = await prisma.user.create({
		data: {
			email: `profile-normalized-${suffix}@example.com`,
			username: `profile_normalized_${suffix}`,
		},
	})
	const listType = await prisma.listType.create({
		data: {
			name: `profile-normalized-${suffix}`,
			header: 'Normalized profile text',
			columns: '{"title":"string"}',
			mediaType: '["movie"]',
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
	const omittedSentinel = `NORMALIZED_OMITTED_${suffix}`
	const hostileText = (prefix: string) =>
		`${prefix}${'x'.repeat(5_000)}${omittedSentinel}`
	const [trackingMedia, reviewMedia, diaryMedia] = await Promise.all(
		['tracking', 'review', 'diary'].map(source =>
			prisma.media.create({
				data: {
					kind: 'movie',
					title: hostileText(`${source} title `),
					thumbnail: hostileText(`https://example.com/${source}/`),
				},
			}),
		),
	)
	const [unknownEvent, statusEvent, progressEvent, review, diary] =
		await Promise.all([
			prisma.activityEvent.create({
				data: {
					type: hostileText('unknown event '),
					actorId: user.id,
					mediaId: trackingMedia!.id,
					publicEligible: true,
					createdAt: new Date('2026-07-28T12:05:00.000Z'),
				},
			}),
			prisma.activityEvent.create({
				data: {
					type: 'status',
					status: hostileText('watching '),
					statusLabel: hostileText('Watching '),
					previousStatus: hostileText('planned '),
					previousStatusLabel: hostileText('Planned '),
					statusWatchlistId: watchlist.id,
					previousStatusWatchlistId: watchlist.id,
					actorId: user.id,
					mediaId: trackingMedia!.id,
					publicEligible: true,
					createdAt: new Date('2026-07-28T12:04:00.000Z'),
				},
			}),
			prisma.activityEvent.create({
				data: {
					type: 'progress',
					progressUnit: hostileText('episode '),
					progressCurrent: 2,
					progressPrevious: 1,
					progressTotal: 12,
					actorId: user.id,
					mediaId: trackingMedia!.id,
					publicEligible: true,
					createdAt: new Date('2026-07-28T12:03:00.000Z'),
				},
			}),
			prisma.review.create({
				data: {
					authorId: user.id,
					mediaId: reviewMedia!.id,
					body: hostileText('review body '),
					createdAt: new Date('2026-07-28T12:02:00.000Z'),
				},
			}),
			prisma.diaryEntry.create({
				data: {
					ownerId: user.id,
					mediaId: diaryMedia!.id,
					loggedOn: new Date('2026-07-27T00:00:00.000Z'),
					createdAt: new Date('2026-07-28T12:01:00.000Z'),
				},
			}),
		])

	const result = await activityLoader({
		request: new Request(`${BASE_URL}/users/${user.username}`),
		params: { username: user.username },
	} as any)
	const payload = JSON.stringify(result.data)
	const eventIds = result.data.activityEvents.map(event => event.id)

	expect(Buffer.byteLength(payload)).toBeLessThan(
		PROFILE_ACTIVITY_RESPONSE_BYTE_LIMIT,
	)
	expect(result.data.activityLimited).toBe(true)
	expect(eventIds).toEqual(
		expect.arrayContaining([
			`tracking:${unknownEvent.id}`,
			`tracking:${statusEvent.id}`,
			`tracking:${progressEvent.id}`,
			`review:${review.id}`,
			`diary:${diary.id}`,
		]),
	)
	expect(payload).not.toContain(omittedSentinel)
	for (const event of result.data.activityEvents) {
		expect(event.action.length).toBeLessThanOrEqual(
			PROFILE_ACTIVITY_ACTION_LENGTH_LIMIT,
		)
		expect(event.media.title.length).toBeLessThanOrEqual(
			PROFILE_ACTIVITY_TITLE_LENGTH_LIMIT,
		)
		expect(event.media.thumbnail).toBeNull()
	}
})

test('profile favorites enforce a fixed row cap and bound hostile display text', async () => {
	const suffix = faker.string.alphanumeric({ length: 12 }).toLowerCase()
	const user = await prisma.user.create({
		data: {
			email: `profile-favorites-${suffix}@example.com`,
			username: `profile_favorites_${suffix}`,
		},
	})
	const listType = await prisma.listType.create({
		data: {
			name: `profile-favorites-${suffix}`,
			header: 'Favorite profile fixtures',
			columns: '{"title":"string"}',
			mediaType: '["movie"]',
			completionType: '{"past":"watched"}',
		},
	})
	const omittedSentinel = `FAVORITE_OMITTED_${suffix}`
	const hostileTail = `${'f'.repeat(5_000)}${omittedSentinel}`
	await prisma.userFavorite.createMany({
		data: Array.from({ length: 301 }, (_, index) => ({
			ownerId: user.id,
			typeId: listType.id,
			position: index + 1,
			title:
				index === 0 ? `Hostile favorite ${hostileTail}` : `Favorite ${index}`,
			thumbnail: index === 0 ? `https://example.com/${hostileTail}` : null,
			mediaType: index === 0 ? `Movie ${hostileTail}` : 'Movie',
			startYear: index === 0 ? `2026 ${hostileTail}` : '2026',
		})),
	})

	const result = await favoritesLoader({
		request: new Request(`${BASE_URL}/users/${user.username}/favorites`),
		params: { username: user.username },
	} as any)
	const payload = JSON.stringify(result.data)
	const hostileFavorite = result.data.favorites.find(
		favorite => favorite.position === 1,
	)

	expect(result.data.favorites).toHaveLength(300)
	expect(result.data.favoritesLimited).toBe(true)
	expect(Buffer.byteLength(payload)).toBeLessThan(64 * 1024)
	expect(payload).not.toContain(omittedSentinel)
	expect(hostileFavorite).toMatchObject({ thumbnail: null })
	expect(hostileFavorite?.title.length).toBeLessThanOrEqual(241)
	expect(hostileFavorite?.mediaType.length).toBeLessThanOrEqual(120)
	expect(hostileFavorite?.startYear.length).toBeLessThanOrEqual(64)
})

test('profile favorites use canonical media for linked historical snapshots', async () => {
	const suffix = faker.string.alphanumeric({ length: 12 }).toLowerCase()
	const privateSentinel = `PRIVATE_FAVORITE_SNAPSHOT_${suffix}`
	const [user, listType, canonical, sparse] = await Promise.all([
		prisma.user.create({
			data: {
				email: `profile-favorite-provenance-${suffix}@example.com`,
				username: `profile_favorite_provenance_${suffix}`,
			},
		}),
		prisma.listType.create({
			data: {
				name: `profile-favorite-provenance-${suffix}`,
				header: 'Favorite provenance fixtures',
				columns: '{"title":"string"}',
				mediaType: '["movie"]',
				completionType: '{"past":"watched"}',
			},
		}),
		prisma.media.create({
			data: {
				kind: 'movie',
				title: 'Canonical favorite title',
				thumbnail: 'https://canonical.example/favorite.jpg',
				type: 'Movie',
				releaseStart: new Date('2024-03-01T00:00:00.000Z'),
			},
		}),
		prisma.media.create({ data: { kind: 'anime' } }),
	])
	await prisma.userFavorite.createMany({
		data: [
			{
				ownerId: user.id,
				typeId: listType.id,
				mediaId: canonical.id,
				position: 1,
				title: `${privateSentinel} title`,
				thumbnail: `${privateSentinel} thumbnail`,
				mediaType: `${privateSentinel} type`,
				startYear: `${privateSentinel} year`,
			},
			{
				ownerId: user.id,
				typeId: listType.id,
				mediaId: sparse.id,
				position: 2,
				title: `${privateSentinel} sparse title`,
				thumbnail: `${privateSentinel} sparse thumbnail`,
				mediaType: `${privateSentinel} sparse type`,
				startYear: `${privateSentinel} sparse year`,
			},
			{
				ownerId: user.id,
				typeId: listType.id,
				position: 3,
				title: 'Unlinked legacy favorite',
				thumbnail: 'https://legacy.example/favorite.jpg',
				mediaType: 'Legacy type',
				startYear: '1999',
			},
		],
	})

	const result = await favoritesLoader({
		request: new Request(`${BASE_URL}/users/${user.username}/favorites`),
		params: { username: user.username },
	} as any)

	expect(result.data.favorites).toEqual([
		expect.objectContaining({
			position: 1,
			mediaId: canonical.id,
			title: 'Canonical favorite title',
			thumbnail: 'https://canonical.example/favorite.jpg',
			mediaType: 'Movie',
			startYear: '2024',
		}),
		expect.objectContaining({
			position: 2,
			mediaId: sparse.id,
			title: 'Untitled anime',
			thumbnail: null,
			mediaType: '',
			startYear: '',
		}),
		expect.objectContaining({
			position: 3,
			mediaId: null,
			title: 'Unlinked legacy favorite',
			thumbnail: 'https://legacy.example/favorite.jpg',
			mediaType: 'Legacy type',
			startYear: '1999',
		}),
	])
	expect(JSON.stringify(result.data)).not.toContain(privateSentinel)
})

test('profile history projection enforces an aggregate transfer budget', async () => {
	const suffix = faker.string.alphanumeric({ length: 12 }).toLowerCase()
	const user = await prisma.user.create({
		data: {
			email: `profile-history-budget-${suffix}@example.com`,
			username: `profile_history_budget_${suffix}`,
		},
	})
	const listType = await prisma.listType.create({
		data: {
			name: `profile-history-budget-${suffix}`,
			header: 'History projection budget',
			columns: '{"title":"string"}',
			mediaType: '["movie"]',
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
		},
	})
	const omittedSentinel = `HISTORY_BUDGET_OMITTED_${suffix}`
	// Every row is below the per-entry parser ceiling, while their combined
	// 24 MiB source would exceed the request-level 16 MiB projection budget.
	const history = JSON.stringify({
		finished: Date.UTC(2026, 0, 1),
		note: `${'h'.repeat(40_000)}${omittedSentinel}`,
	})
	const entries = Array.from({ length: 600 }, (_, index) => ({
		watchlistId: watchlist.id,
		position: index + 1,
		title: `Budgeted history ${index + 1}`,
		history,
	}))
	for (let index = 0; index < entries.length; index += 50) {
		await prisma.entry.createMany({ data: entries.slice(index, index + 50) })
	}

	const result = await overviewLoader({
		request: new Request(`${BASE_URL}/users/${user.username}`),
		params: { username: user.username },
	} as any)
	const payload = JSON.stringify(result.data)

	expect(result.data.diagnostic).toMatchObject({
		processed: 600,
		truncated: false,
		historyEntriesRejected: 600,
	})
	expect(result.data.trackingSummaries[listType.id]?.totalTitles).toBe(600)
	expect(result.data.completionHistory.days).toEqual([])
	expect(Buffer.byteLength(payload)).toBeLessThan(64 * 1024)
	expect(payload).not.toContain(omittedSentinel)
})
