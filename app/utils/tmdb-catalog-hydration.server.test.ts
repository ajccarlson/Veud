import { expect, test, vi } from 'vitest'
import {
	catalogHydrationPriorities,
	requestCatalogHydration,
	upsertCatalogIdentity,
} from './catalog-sync.server.ts'
import { prisma } from './db.server.ts'
import { ensureMediaForIdentity } from './media.server.ts'
import {
	getTmdbHydrationMetrics,
	hydrateTmdbCatalog,
	normalizeTmdbDetails,
	parseTmdbRetryAfter,
	tmdbDetailUrl,
	tmdbPriorityFeedUrl,
	tmdbRetryDeadline,
	TmdbRequestError,
} from './tmdb-catalog-hydration.server.ts'

function moviePayload(id: number, title = `Movie ${id}`) {
	return {
		adult: false,
		alternative_titles: {
			titles: [{ iso_3166_1: 'US', title: `${title}: Alternate` }],
		},
		genres: [
			{ id: 1, name: 'Drama' },
			{ id: 2, name: 'Mystery' },
		],
		id,
		original_language: 'fr',
		original_title: `${title} Original`,
		overview: `${title} overview`,
		popularity: id * 10,
		poster_path: `/movie-${id}.jpg`,
		production_companies: [{ id: 3, name: 'Studio Example' }],
		release_date: '2026-05-04',
		release_dates: {
			results: [
				{
					iso_3166_1: 'US',
					release_dates: [{ certification: 'PG-13', type: 3 }],
				},
			],
		},
		runtime: 125,
		status: 'Released',
		title,
		video: false,
		vote_average: 8.25,
	}
}

function tvPayload(id: number) {
	return {
		adult: false,
		alternative_titles: { results: [{ title: 'Alternate Series' }] },
		content_ratings: {
			results: [{ iso_3166_1: 'US', rating: 'TV-14' }],
		},
		first_air_date: '2024-01-02',
		genres: [{ name: 'Animation' }],
		id,
		last_air_date: '2026-01-02',
		name: 'Localized Series',
		number_of_episodes: 24,
		original_language: 'ja',
		original_name: 'Original Series',
		overview: 'Series overview',
		popularity: 50,
		poster_path: '/series.jpg',
		production_companies: [{ name: 'Series Studio' }],
		status: 'Returning Series',
		vote_average: 7.5,
	}
}

function jsonResponse(value: unknown, init?: ResponseInit) {
	return new Response(JSON.stringify(value), {
		status: 200,
		headers: { 'content-type': 'application/json' },
		...init,
	})
}

async function seedMovie(id: number, popularity = id) {
	return prisma.$transaction(tx =>
		upsertCatalogIdentity(tx, {
			provider: 'tmdb',
			kind: 'movie',
			externalId: String(id),
			sourceTitle: `Inventory ${id}`,
			sourcePopularity: popularity,
			seenAt: new Date('2026-07-01T00:00:00.000Z'),
		}),
	)
}

test('normalizes movie and TV details, URLs, and provider retry deadlines', () => {
	const observedAt = new Date('2026-07-20T12:00:00.000Z')
	const movie = normalizeTmdbDetails(
		moviePayload(42, 'Amélie'),
		'movie',
		observedAt,
	)
	expect(movie).toEqual(
		expect.objectContaining({
			id: 42,
			sourceTitle: 'Amélie Original',
			sourcePopularity: 420,
			sourceIsAdult: false,
			sourceIsVideo: false,
			catalog: expect.objectContaining({
				title: 'Amélie',
				type: 'Movie',
				releaseStart: new Date('2026-05-04T00:00:00.000Z'),
				startYear: '2026',
				length: '2h 5m',
				genres: 'Drama, Mystery',
				rating: 'PG-13',
				language: 'French',
				studios: 'Studio Example',
				tmdbScore: 8.25,
				catalogScore: 8.25,
				catalogPopularity: 420,
				releaseStatus: 'Released',
			}),
		}),
	)
	expect(movie.catalog.nextRelease).toBeNull()
	expect(movie.titles).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ value: 'Amélie', isPrimary: true }),
			expect.objectContaining({ value: 'Amélie Original' }),
			expect.objectContaining({ value: 'Amélie: Alternate' }),
		]),
	)

	const tv = normalizeTmdbDetails(tvPayload(7), 'tv', observedAt)
	expect(tv.catalog).toEqual(
		expect.objectContaining({
			title: 'Localized Series',
			type: 'TV Series',
			length: '24 eps',
			rating: 'TV-14',
			language: 'Japanese',
			catalogScore: 7.5,
			releaseStatus: 'Returning Series',
		}),
	)
	expect(tv.catalog.nextRelease).toBeNull()
	const scheduledTv = normalizeTmdbDetails(
		{
			...tvPayload(8),
			next_episode_to_air: {
				id: 81,
				name: 'Provider-confirmed episode',
				air_date: '2026-07-27',
				episode_number: 25,
				season_number: 2,
				runtime: 24,
				still_path: '/episode.jpg',
			},
		},
		'tv',
		observedAt,
	)
	expect(JSON.parse(scheduledTv.catalog.nextRelease as string)).toMatchObject({
		source: 'tmdb',
		observedAt: observedAt.toISOString(),
		releaseDate: '2026-07-27',
		episode: 25,
		season: 2,
	})
	expect(
		new URL(tmdbDetailUrl('movie', '42')).searchParams.get(
			'append_to_response',
		),
	).toBe('alternative_titles,release_dates')
	expect(() => tmdbDetailUrl('movie', '../search')).toThrow(
		'positive safe integer',
	)
	expect(new URL(tmdbPriorityFeedUrl('tv', 'upcoming')).pathname).toBe(
		'/3/tv/on_the_air',
	)

	const now = new Date('2026-07-20T00:00:00.000Z')
	expect(parseTmdbRetryAfter('120', now)).toEqual(
		new Date('2026-07-20T00:02:00.000Z'),
	)
	expect(
		tmdbRetryDeadline({
			error: new TmdbRequestError('missing', 404),
			failureCount: 0,
			now,
		}),
	).toEqual(new Date('2026-08-19T00:00:00.000Z'))
	expect(
		tmdbRetryDeadline({ error: new Error('network'), failureCount: 3, now }),
	).toEqual(new Date('2026-07-20T00:08:00.000Z'))
})

test('dry-run reports the eligible queue without fetching or writing a run', async () => {
	await seedMovie(1)
	await seedMovie(2)
	const fetchImpl = vi.fn(() => {
		throw new Error('dry-run must not fetch')
	})

	const result = await hydrateTmdbCatalog({
		prisma,
		kind: 'movie',
		limit: 1,
		fetchImpl,
	})

	expect(result).toEqual(
		expect.objectContaining({
			dryRun: true,
			runId: null,
			queueBefore: 2,
			queueAfter: 2,
			recordsSeen: 1,
			requestsMade: 0,
		}),
	)
	expect(fetchImpl).not.toHaveBeenCalled()
	expect(await prisma.catalogSyncRun.count()).toBe(0)
})

test('successful provider hydration clears stale canonical and legacy schedules', async () => {
	const source = await prisma.$transaction(tx =>
		upsertCatalogIdentity(tx, {
			provider: 'tmdb',
			kind: 'tv',
			externalId: '77',
			sourceTitle: 'Previously scheduled series',
			seenAt: new Date('2026-07-01T00:00:00.000Z'),
		}),
	)
	const staleSchedule = JSON.stringify({
		releaseDate: '2026-09-01',
		episode: 99,
	})
	await prisma.media.update({
		where: { id: source.mediaId },
		data: { nextRelease: staleSchedule },
	})
	const listType = await prisma.listType.upsert({
		where: { name: 'liveaction' },
		update: {},
		create: {
			name: 'liveaction',
			header: 'Live Action',
			columns: '{}',
			mediaType: 'liveaction',
			completionType: 'watched',
		},
	})
	const owner = await prisma.user.create({
		data: { email: 'schedule-clear@example.com', username: 'schedule_clear' },
	})
	const watchlist = await prisma.watchlist.create({
		data: {
			name: 'watching',
			header: 'Watching',
			ownerId: owner.id,
			typeId: listType.id,
		},
	})
	const entry = await prisma.entry.create({
		data: {
			watchlistId: watchlist.id,
			position: 1,
			title: 'Previously scheduled series',
			type: 'TV Series',
			nextRelease: staleSchedule,
			mediaId: source.mediaId,
		},
	})

	const result = await hydrateTmdbCatalog({
		prisma,
		kind: 'tv',
		apiToken: 'test-token',
		commit: true,
		limit: 1,
		concurrency: 1,
		leaseOwner: 'schedule-clear-worker',
		fetchImpl: vi.fn(async () =>
			jsonResponse({ ...tvPayload(77), next_episode_to_air: null }),
		) as typeof fetch,
		now: () => new Date('2026-07-20T12:00:00.000Z'),
	})

	expect(result.recordsHandled).toBe(1)
	expect(
		await prisma.media.findUniqueOrThrow({
			where: { id: source.mediaId },
			select: { nextRelease: true },
		}),
	).toEqual({ nextRelease: null })
	expect(
		await prisma.entry.findUniqueOrThrow({
			where: { id: entry.id },
			select: { nextRelease: true },
		}),
	).toEqual({ nextRelease: null })
})

test('quick-add demand outranks seeded upcoming, trending, popular, and inventory work', async () => {
	await seedMovie(1, 999_999)
	await prisma.$transaction(async tx => {
		await upsertCatalogIdentity(tx, {
			provider: 'tmdb',
			kind: 'movie',
			externalId: '2',
			sourceTitle: 'User Requested',
		})
		await requestCatalogHydration(tx, {
			provider: 'tmdb',
			kind: 'movie',
			externalId: '2',
			priority: catalogHydrationPriorities.userDemand,
			reason: 'user-demand',
			requestedAt: new Date('2026-07-20T00:00:00.000Z'),
		})
	})

	const detailOrder: number[] = []
	const fetchImpl = vi.fn(
		async (input: string | URL | Request, _init?: RequestInit) => {
			const url = new URL(String(input))
			if (url.pathname === '/3/movie/upcoming') {
				return jsonResponse({
					results: [{ id: 3, original_title: 'Upcoming' }],
				})
			}
			if (url.pathname === '/3/trending/movie/week') {
				return jsonResponse({
					results: [{ id: 4, original_title: 'Trending' }],
				})
			}
			if (url.pathname === '/3/movie/popular') {
				return jsonResponse({ results: [{ id: 5, original_title: 'Popular' }] })
			}
			const id = Number(url.pathname.split('/').at(-1))
			detailOrder.push(id)
			return jsonResponse(moviePayload(id))
		},
	)

	const result = await hydrateTmdbCatalog({
		prisma,
		kind: 'movie',
		apiToken: 'test-token',
		commit: true,
		limit: 4,
		concurrency: 1,
		seedPriorities: true,
		leaseOwner: 'priority-worker',
		fetchImpl: fetchImpl as typeof fetch,
		now: () => new Date('2026-07-20T00:00:00.000Z'),
	})

	expect(detailOrder).toEqual([2, 3, 4, 5])
	expect(result).toEqual(
		expect.objectContaining({
			seeded: 3,
			recordsSeen: 4,
			recordsHandled: 4,
			recordsFailed: 0,
			requestsMade: 7,
			rateLimitEvents: 0,
		}),
	)
	expect(
		await prisma.mediaExternalId.findUniqueOrThrow({
			where: {
				provider_kind_externalId: {
					provider: 'tmdb',
					kind: 'movie',
					externalId: '2',
				},
			},
		}),
	).toEqual(
		expect.objectContaining({
			fetchStatus: 'fresh',
			lastFetchedAt: new Date('2026-07-20T00:00:00.000Z'),
			refreshAfter: new Date('2026-12-17T00:00:00.000Z'),
			hydrationPriority: 0,
			hydrationReason: null,
		}),
	)
	expect(
		await prisma.media.findFirstOrThrow({
			where: {
				externalIds: {
					some: { provider: 'tmdb', kind: 'movie', externalId: '2' },
				},
			},
		}),
	).toEqual(
		expect.objectContaining({
			title: 'Movie 2',
			genres: 'Drama, Mystery',
			length: '2h 5m',
			catalogScore: 8.25,
			catalogPopularity: 20,
			releaseStatus: 'Released',
		}),
	)
	expect(await prisma.mediaTitle.count()).toBe(12)
	expect(
		await prisma.catalogFeedItem.findMany({
			orderBy: { feed: 'asc' },
			select: {
				provider: true,
				kind: true,
				feed: true,
				rank: true,
				observedAt: true,
			},
		}),
	).toEqual([
		{
			provider: 'tmdb',
			kind: 'movie',
			feed: 'popular',
			rank: 1,
			observedAt: new Date('2026-07-20T00:00:00.000Z'),
		},
		{
			provider: 'tmdb',
			kind: 'movie',
			feed: 'trending',
			rank: 1,
			observedAt: new Date('2026-07-20T00:00:00.000Z'),
		},
		{
			provider: 'tmdb',
			kind: 'movie',
			feed: 'upcoming',
			rank: 1,
			observedAt: new Date('2026-07-20T00:00:00.000Z'),
		},
	])
	expect(
		await prisma.mediaExternalId.findUniqueOrThrow({
			where: {
				provider_kind_externalId: {
					provider: 'tmdb',
					kind: 'movie',
					externalId: '1',
				},
			},
		}),
	).toEqual(expect.objectContaining({ fetchStatus: 'pending' }))

	const firstCall = fetchImpl.mock.calls[0]
	expect((firstCall[1]?.headers as Record<string, string>).Authorization).toBe(
		'Bearer test-token',
	)
})

test('detail requests never exceed configured concurrency', async () => {
	await Promise.all([
		seedMovie(11),
		seedMovie(12),
		seedMovie(13),
		seedMovie(14),
	])
	let active = 0
	let maximumActive = 0
	const fetchImpl = vi.fn(async (input: string | URL | Request) => {
		active += 1
		maximumActive = Math.max(maximumActive, active)
		await new Promise(resolve => setTimeout(resolve, 5))
		active -= 1
		const id = Number(new URL(String(input)).pathname.split('/').at(-1))
		return jsonResponse(moviePayload(id))
	})

	await hydrateTmdbCatalog({
		prisma,
		kind: 'movie',
		apiToken: 'test-token',
		commit: true,
		limit: 4,
		concurrency: 2,
		leaseOwner: 'bounded-worker',
		fetchImpl: fetchImpl as typeof fetch,
		now: () => new Date('2026-07-20T00:00:00.000Z'),
	})

	expect(maximumActive).toBe(2)
	expect(fetchImpl).toHaveBeenCalledTimes(4)
})

test('a 429 checkpoints successes, defers the provider, and resumes after Retry-After', async () => {
	await seedMovie(21)
	await seedMovie(22)
	const firstFetch = vi.fn(async (input: string | URL | Request) => {
		const id = Number(new URL(String(input)).pathname.split('/').at(-1))
		if (id === 21) {
			return new Response('', {
				status: 429,
				statusText: 'Too Many Requests',
				headers: { 'retry-after': '120' },
			})
		}
		return jsonResponse(moviePayload(id))
	})
	const first = await hydrateTmdbCatalog({
		prisma,
		kind: 'movie',
		apiToken: 'test-token',
		commit: true,
		limit: 2,
		concurrency: 2,
		leaseOwner: 'rate-limited-worker',
		fetchImpl: firstFetch as typeof fetch,
		now: () => new Date('2026-07-20T00:00:00.000Z'),
	})

	expect(first).toEqual(
		expect.objectContaining({
			recordsSeen: 2,
			recordsHandled: 1,
			recordsFailed: 1,
			requestsMade: 2,
			rateLimitEvents: 1,
			providerRetryAfter: new Date('2026-07-20T00:02:00.000Z'),
		}),
	)
	expect(
		await prisma.mediaExternalId.findUniqueOrThrow({
			where: {
				provider_kind_externalId: {
					provider: 'tmdb',
					kind: 'movie',
					externalId: '21',
				},
			},
		}),
	).toEqual(
		expect.objectContaining({
			fetchStatus: 'failed',
			failureCount: 1,
			refreshAfter: new Date('2026-07-20T00:02:00.000Z'),
		}),
	)

	const blockedFetch = vi.fn(() => {
		throw new Error('provider deadline must prevent requests')
	})
	const blocked = await hydrateTmdbCatalog({
		prisma,
		kind: 'movie',
		apiToken: 'test-token',
		commit: true,
		leaseOwner: 'blocked-worker',
		fetchImpl: blockedFetch as unknown as typeof fetch,
		now: () => new Date('2026-07-20T00:01:00.000Z'),
	})
	expect(blocked.requestsMade).toBe(0)
	expect(blocked.providerRetryAfter).toEqual(
		new Date('2026-07-20T00:02:00.000Z'),
	)
	expect(blockedFetch).not.toHaveBeenCalled()

	const resumedFetch = vi.fn(async (input: string | URL | Request) => {
		const id = Number(new URL(String(input)).pathname.split('/').at(-1))
		return jsonResponse(moviePayload(id))
	})
	const resumed = await hydrateTmdbCatalog({
		prisma,
		kind: 'movie',
		apiToken: 'test-token',
		commit: true,
		leaseOwner: 'resumed-worker',
		fetchImpl: resumedFetch as typeof fetch,
		now: () => new Date('2026-07-20T00:02:01.000Z'),
	})
	expect(resumed).toEqual(
		expect.objectContaining({
			recordsHandled: 1,
			recordsFailed: 0,
			providerRetryAfter: null,
		}),
	)
	expect(resumedFetch).toHaveBeenCalledTimes(1)

	const metrics = await getTmdbHydrationMetrics(prisma, {
		kind: 'movie',
		now: new Date('2026-07-20T00:03:00.000Z'),
	})
	expect(metrics).toEqual(
		expect.objectContaining({
			active: 2,
			hydrated: 2,
			fresh: 2,
			queueDepth: 0,
			coveragePercent: 100,
			freshnessPercent: 100,
			requestsMade: 3,
			rateLimitEvents: 1,
		}),
	)
})

test('ensuring a TMDB identity queues user-demand hydration', async () => {
	await prisma.$transaction(tx =>
		ensureMediaForIdentity(
			tx,
			{ provider: 'tmdb', kind: 'movie', externalId: '99' },
			{ title: 'Quick Added Movie' },
		),
	)

	expect(
		await prisma.mediaExternalId.findUniqueOrThrow({
			where: {
				provider_kind_externalId: {
					provider: 'tmdb',
					kind: 'movie',
					externalId: '99',
				},
			},
		}),
	).toEqual(
		expect.objectContaining({
			hydrationPriority: catalogHydrationPriorities.userDemand,
			hydrationReason: 'user-demand',
			hydrationRequestedAt: expect.any(Date),
		}),
	)
})
