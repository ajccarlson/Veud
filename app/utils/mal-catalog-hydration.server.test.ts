import { expect, test, vi } from 'vitest'
import {
	catalogHydrationPriorities,
	recordCatalogFetchSuccess,
	requestCatalogHydration,
	upsertCatalogIdentity,
} from './catalog-sync.server.ts'
import { prisma } from './db.server.ts'
import {
	getMalHydrationMetrics,
	hydrateMalCatalog,
	malDetailUrl,
	malRetryDeadline,
	normalizeMalDetails,
} from './mal-catalog-hydration.server.ts'
import { MalRequestError } from './mal-catalog-inventory.server.ts'
import { ensureMediaForIdentity } from './media.server.ts'

function animePayload(id: number, includeRelations = true) {
	return {
		id,
		title: `Anime ${id}`,
		main_picture: {
			large: `https://cdn.example.test/anime-${id}.jpg`,
		},
		alternative_titles: {
			synonyms: [`Series ${id}`],
			en: `English Anime ${id}`,
			ja: `アニメ ${id}`,
		},
		start_date: '2024-04-01',
		end_date: '2024-09-30',
		synopsis: `Anime ${id} synopsis`,
		mean: 8.4,
		popularity: 2,
		nsfw: 'white',
		updated_at: '2026-07-19T12:00:00+00:00',
		media_type: 'tv',
		status: 'finished_airing',
		genres: [
			{ id: 1, name: 'Drama' },
			{ id: 2, name: 'Mystery' },
		],
		num_episodes: 24,
		start_season: { year: 2024, season: 'spring' },
		average_episode_duration: 1_440,
		rating: 'pg_13',
		studios: [{ id: 7, name: 'Example Studio' }],
		related_anime: includeRelations
			? [
					{
						node: {
							id: id + 100,
							title: `Anime ${id + 100}`,
							main_picture: {
								medium: `https://cdn.example.test/anime-${id + 100}.jpg`,
							},
						},
						relation_type: 'Sequel',
					},
				]
			: [],
		related_manga: includeRelations
			? [
					{
						node: { id: id + 200, title: `Manga ${id + 200}` },
						relation_type: 'Adaptation',
					},
				]
			: [],
	}
}

function mangaPayload(id: number) {
	return {
		id,
		title: `Manga ${id}`,
		main_picture: {
			medium: `https://cdn.example.test/manga-${id}.jpg`,
		},
		alternative_titles: { synonyms: [], en: null, ja: `漫画 ${id}` },
		start_date: '2010-01',
		end_date: '2020',
		synopsis: `Manga ${id} synopsis`,
		mean: 9.1,
		popularity: 5,
		nsfw: 'gray',
		updated_at: '2026-07-18T00:00:00+00:00',
		media_type: 'one_shot',
		status: 'finished',
		genres: [{ name: 'Fantasy' }],
		num_volumes: 12,
		num_chapters: 120,
		authors: [
			{
				node: { id: 9, first_name: 'Ada', last_name: 'Artist' },
				role: 'Story & Art',
			},
		],
		serialization: [{ node: { id: 11, name: 'Example Magazine' } }],
		related_anime: [],
		related_manga: [],
	}
}

function jsonResponse(value: unknown, init?: ResponseInit) {
	return new Response(JSON.stringify(value), {
		status: 200,
		headers: { 'content-type': 'application/json' },
		...init,
	})
}

async function seedMal(
	id: number,
	input: { kind?: 'anime' | 'manga'; popularity?: number } = {},
) {
	const kind = input.kind ?? 'anime'
	return prisma.$transaction(tx =>
		upsertCatalogIdentity(tx, {
			provider: 'mal',
			kind,
			externalId: String(id),
			sourceTitle: `Inventory ${id}`,
			sourcePopularity: input.popularity ?? 1 / id,
			sourceUpdatedAt: new Date('2026-07-01T00:00:00.000Z'),
			seenAt: new Date('2026-07-01T00:00:00.000Z'),
		}),
	)
}

const committedOptions = {
	prisma,
	kind: 'anime' as const,
	clientId: 'test-client-id',
	policyApprovalReference: 'test-policy-approval',
	commit: true,
	requestDelayMs: 0,
	leaseOwner: 'mal-hydration-worker',
	now: () => new Date('2026-07-20T00:00:00.000Z'),
}

test('normalizes anime and manga metadata, titles, relations, URLs, and retry deadlines', () => {
	const anime = normalizeMalDetails(animePayload(42), 'anime')
	expect(anime).toEqual(
		expect.objectContaining({
			id: 42,
			sourceTitle: 'Anime 42',
			sourceUpdatedAt: new Date('2026-07-19T12:00:00.000Z'),
			sourcePopularity: 0.5,
			sourceIsAdult: false,
			catalog: expect.objectContaining({
				title: 'Anime 42',
				type: 'TV Series',
				startSeason: 'Spring 2024',
				startYear: '2024',
				length: '24 eps',
				rating: 'PG-13',
				genres: 'Drama, Mystery',
				studios: JSON.stringify([
					'Example Studio|https://myanimelist.net/anime/producer/7',
				]),
				malScore: 8.4,
				catalogScore: 8.4,
				catalogPopularity: 0.5,
				releaseStatus: 'Finished Airing',
			}),
		}),
	)
	expect(anime.titles).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ value: 'Anime 42', isPrimary: true }),
			expect.objectContaining({ value: 'English Anime 42', language: 'en' }),
			expect.objectContaining({ value: 'アニメ 42', language: 'ja' }),
			expect.objectContaining({ value: 'Series 42' }),
		]),
	)
	expect(anime.relations).toEqual([
		expect.objectContaining({
			relationType: 'sequel',
			targetIdentity: {
				provider: 'mal',
				kind: 'anime',
				externalId: '142',
			},
		}),
		expect.objectContaining({
			relationType: 'adaptation',
			targetIdentity: {
				provider: 'mal',
				kind: 'manga',
				externalId: '242',
			},
		}),
	])

	const manga = normalizeMalDetails(mangaPayload(7), 'manga')
	expect(manga.catalog).toEqual(
		expect.objectContaining({
			type: 'One-shot',
			releaseStart: new Date('2010-01-01T00:00:00.000Z'),
			releaseEnd: new Date('2020-01-01T00:00:00.000Z'),
			startYear: '2010',
			chapters: '120',
			volumes: '12',
			serialization: JSON.stringify([
				'Example Magazine|https://myanimelist.net/manga/magazine/11',
			]),
			authors: JSON.stringify([
				'Ada Artist (Story & Art)|https://myanimelist.net/people/9',
			]),
		}),
	)
	expect(new URL(malDetailUrl('anime', '42')).pathname).toBe('/v2/anime/42')
	expect(
		new URL(malDetailUrl('manga', '7')).searchParams.get('fields'),
	).toContain('authors{first_name,last_name}')
	expect(() => malDetailUrl('anime', '../ranking')).toThrow(
		'positive safe integer',
	)
	const now = new Date('2026-07-20T00:00:00.000Z')
	expect(
		malRetryDeadline({
			error: new MalRequestError('missing', 404),
			failureCount: 0,
			now,
		}),
	).toEqual(new Date('2026-08-19T00:00:00.000Z'))
	expect(
		malRetryDeadline({ error: new Error('network'), failureCount: 3, now }),
	).toEqual(new Date('2026-07-20T00:08:00.000Z'))
})

test('dry-run reports the queue without credentials, provider calls, or sync writes', async () => {
	await seedMal(1)
	await seedMal(2)
	const fetchImpl = vi.fn(() => {
		throw new Error('dry-run must not fetch')
	})

	const result = await hydrateMalCatalog({
		prisma,
		kind: 'anime',
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

test('member-demanded MAL identities receive top hydration priority', async () => {
	await prisma.$transaction(tx =>
		ensureMediaForIdentity(
			tx,
			{ provider: 'mal', kind: 'manga', externalId: '99' },
			{ title: 'Quick-added manga' },
		),
	)
	expect(
		await prisma.mediaExternalId.findUniqueOrThrow({
			where: {
				provider_kind_externalId: {
					provider: 'mal',
					kind: 'manga',
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

test('commit mode requires MAL credentials and a policy approval reference', async () => {
	await expect(
		hydrateMalCatalog({
			prisma,
			kind: 'anime',
			commit: true,
			leaseOwner: 'missing-client',
		}),
	).rejects.toThrow('client id is required')
	await expect(
		hydrateMalCatalog({
			prisma,
			kind: 'anime',
			clientId: 'test-client-id',
			commit: true,
			leaseOwner: 'missing-policy',
		}),
	).rejects.toThrow('policy approval reference is required')
	expect(await prisma.catalogSyncRun.count()).toBe(0)
})

test('hydrates user-demand first and persists canonical details, titles, relations, and freshness', async () => {
	await seedMal(1, { popularity: 1 })
	await seedMal(2, { popularity: 0.01 })
	await prisma.$transaction(tx =>
		requestCatalogHydration(tx, {
			provider: 'mal',
			kind: 'anime',
			externalId: '2',
			priority: catalogHydrationPriorities.userDemand,
			reason: 'user-demand',
			requestedAt: new Date('2026-07-20T00:00:00.000Z'),
		}),
	)
	const detailOrder: number[] = []
	const fetchImpl = vi.fn(
		async (input: string | URL | Request, _init?: RequestInit) => {
			const id = Number(new URL(String(input)).pathname.split('/').at(-1))
			detailOrder.push(id)
			return jsonResponse(animePayload(id))
		},
	)

	const result = await hydrateMalCatalog({
		...committedOptions,
		limit: 2,
		refreshDays: 180,
		fetchImpl: fetchImpl as unknown as typeof fetch,
	})
	expect(detailOrder).toEqual([2, 1])
	expect(result).toEqual(
		expect.objectContaining({
			recordsSeen: 2,
			recordsHandled: 2,
			recordsFailed: 0,
			requestsMade: 2,
			rateLimitEvents: 0,
		}),
	)
	const hydratedSource = await prisma.mediaExternalId.findUniqueOrThrow({
		where: {
			provider_kind_externalId: {
				provider: 'mal',
				kind: 'anime',
				externalId: '2',
			},
		},
		include: { media: true },
	})
	expect(hydratedSource).toEqual(
		expect.objectContaining({
			fetchStatus: 'fresh',
			lastFetchedAt: new Date('2026-07-20T00:00:00.000Z'),
			refreshAfter: new Date('2027-01-16T00:00:00.000Z'),
			failureCount: 0,
			hydrationPriority: 0,
			hydrationReason: null,
			media: expect.objectContaining({
				title: 'Anime 2',
				type: 'TV Series',
				genres: 'Drama, Mystery',
				catalogScore: 8.4,
			}),
		}),
	)
	expect(Number(hydratedSource.media.malScore)).toBe(8.4)
	expect(
		await prisma.mediaTitle.findMany({
			where: {
				media: {
					externalIds: {
						some: { provider: 'mal', kind: 'anime', externalId: '2' },
					},
				},
			},
			select: { value: true },
		}),
	).toEqual(
		expect.arrayContaining([
			{ value: 'Anime 2' },
			{ value: 'English Anime 2' },
			{ value: 'アニメ 2' },
			{ value: 'Series 2' },
		]),
	)
	expect(await prisma.mediaRelation.count()).toBe(4)
	expect(
		await prisma.mediaExternalId.findFirstOrThrow({
			where: { provider: 'mal', externalId: '102' },
		}),
	).toEqual(
		expect.objectContaining({
			hydrationPriority: 0,
			hydrationReason: null,
		}),
	)
	const firstCall = fetchImpl.mock.calls[0]
	expect(
		(firstCall[1]?.headers as Record<string, string>)['X-MAL-CLIENT-ID'],
	).toBe('test-client-id')
})

test('serializes detail requests at the configured provider pace', async () => {
	await seedMal(11)
	await seedMal(12)
	const delay = vi.fn(async () => {})
	const fetchImpl = vi.fn(async (input: string | URL | Request) => {
		const id = Number(new URL(String(input)).pathname.split('/').at(-1))
		return jsonResponse(animePayload(id, false))
	})
	await hydrateMalCatalog({
		...committedOptions,
		limit: 2,
		requestDelayMs: 1_000,
		delay,
		fetchImpl: fetchImpl as unknown as typeof fetch,
	})
	expect(fetchImpl).toHaveBeenCalledTimes(2)
	expect(delay).toHaveBeenCalledOnce()
	expect(delay).toHaveBeenCalledWith(1_000)
})

test('a 429 persists provider cooldown and resumes only after Retry-After', async () => {
	await seedMal(21)
	await seedMal(22)
	const rateLimited = vi.fn(
		async () =>
			new Response('', {
				status: 429,
				statusText: 'Too Many Requests',
				headers: { 'retry-after': '120' },
			}),
	)
	const first = await hydrateMalCatalog({
		...committedOptions,
		fetchImpl: rateLimited as unknown as typeof fetch,
	})
	expect(first).toEqual(
		expect.objectContaining({
			recordsSeen: 1,
			recordsHandled: 0,
			recordsFailed: 1,
			requestsMade: 1,
			rateLimitEvents: 1,
			providerRetryAfter: new Date('2026-07-20T00:02:00.000Z'),
		}),
	)

	const blockedFetch = vi.fn(() => {
		throw new Error('cooldown must prevent requests')
	})
	const blocked = await hydrateMalCatalog({
		...committedOptions,
		leaseOwner: 'blocked-worker',
		fetchImpl: blockedFetch as unknown as typeof fetch,
		now: () => new Date('2026-07-20T00:01:00.000Z'),
	})
	expect(blocked.requestsMade).toBe(0)
	expect(blockedFetch).not.toHaveBeenCalled()

	const resumedFetch = vi.fn(async (input: string | URL | Request) => {
		const id = Number(new URL(String(input)).pathname.split('/').at(-1))
		return jsonResponse(animePayload(id, false))
	})
	const resumed = await hydrateMalCatalog({
		...committedOptions,
		limit: 1,
		leaseOwner: 'resumed-worker',
		fetchImpl: resumedFetch as unknown as typeof fetch,
		now: () => new Date('2026-07-20T00:02:01.000Z'),
	})
	expect(resumed).toEqual(
		expect.objectContaining({
			recordsHandled: 1,
			recordsFailed: 0,
			providerRetryAfter: null,
		}),
	)
	expect(resumedFetch).toHaveBeenCalledOnce()
})

test('changed provider timestamps become immediately eligible after inventory', async () => {
	const source = await seedMal(31)
	await prisma.$transaction(tx =>
		recordCatalogFetchSuccess(tx, {
			provider: 'mal',
			kind: 'anime',
			externalId: '31',
			fetchedAt: new Date('2026-07-10T00:00:00.000Z'),
			refreshAfter: new Date('2027-01-10T00:00:00.000Z'),
		}),
	)
	await prisma.mediaExternalId.update({
		where: { id: source.id },
		data: {
			sourceUpdatedAt: new Date('2026-07-19T00:00:00.000Z'),
			fetchStatus: 'pending',
			refreshAfter: null,
		},
	})
	const metrics = await getMalHydrationMetrics(prisma, {
		kind: 'anime',
		now: new Date('2026-07-20T00:00:00.000Z'),
	})
	expect(metrics).toEqual(
		expect.objectContaining({
			active: 1,
			hydrated: 1,
			queueDepth: 1,
			coveragePercent: 100,
			freshnessPercent: 0,
		}),
	)
})

test('non-blocking failures use bounded retry state while later records continue', async () => {
	await seedMal(41)
	await seedMal(42)
	const fetchImpl = vi.fn(async (input: string | URL | Request) => {
		const id = Number(new URL(String(input)).pathname.split('/').at(-1))
		return id === 41
			? new Response('', { status: 500, statusText: 'Server Error' })
			: jsonResponse(animePayload(id, false))
	})
	const result = await hydrateMalCatalog({
		...committedOptions,
		limit: 2,
		fetchImpl: fetchImpl as unknown as typeof fetch,
	})
	expect(result).toEqual(
		expect.objectContaining({
			recordsSeen: 2,
			recordsHandled: 1,
			recordsFailed: 1,
			providerRetryAfter: null,
		}),
	)
	expect(
		await prisma.mediaExternalId.findUniqueOrThrow({
			where: {
				provider_kind_externalId: {
					provider: 'mal',
					kind: 'anime',
					externalId: '41',
				},
			},
		}),
	).toEqual(
		expect.objectContaining({
			fetchStatus: 'failed',
			failureCount: 1,
			refreshAfter: new Date('2026-07-20T00:01:00.000Z'),
		}),
	)
})
