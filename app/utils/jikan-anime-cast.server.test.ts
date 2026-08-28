import { faker } from '@faker-js/faker'
import { expect, test, vi } from 'vitest'
import { upsertCatalogIdentity } from './catalog-sync.server.ts'
import { prisma } from './db.server.ts'
import {
	getJikanAnimeCastMetrics,
	hydrateJikanAnimeCast,
	jikanAnimeCharactersUrl,
	JikanRequestError,
	jikanRetryDeadline,
	normalizeJikanAnimeCast,
	parseJikanRetryAfter,
} from './jikan-anime-cast.server.ts'

const NOW = new Date('2026-08-11T12:00:00.000Z')

function voiceActor(
	id: number,
	name: string,
	language: string,
	imageUrl = `https://cdn.myanimelist.net/images/voiceactors/${id}.jpg`,
) {
	return {
		person: {
			mal_id: id,
			name,
			images: { jpg: { image_url: imageUrl } },
		},
		language,
	}
}

function castPayload(id: number) {
	return {
		data: [
			{
				character: { mal_id: id * 10, name: `Lead ${id}` },
				role: 'Main',
				voice_actors: [
					voiceActor(id * 100 + 1, `English Actor ${id}`, 'English'),
					voiceActor(id * 100 + 2, `Japanese Actor ${id}`, 'Japanese'),
				],
			},
		],
	}
}

function jsonResponse(value: unknown, init?: ResponseInit) {
	return new Response(JSON.stringify(value), {
		status: 200,
		headers: { 'content-type': 'application/json' },
		...init,
	})
}

async function seedHydratedAnime(
	id: number,
	input: { popularity?: number; favorite?: boolean } = {},
) {
	const source = await prisma.$transaction(tx =>
		upsertCatalogIdentity(tx, {
			provider: 'mal',
			kind: 'anime',
			externalId: String(id),
			sourceTitle: `Anime ${id}`,
			sourcePopularity: input.popularity ?? 1 / id,
			seenAt: NOW,
		}),
	)
	await prisma.mediaExternalId.update({
		where: { id: source.id },
		data: {
			fetchStatus: 'fresh',
			lastFetchedAt: NOW,
			refreshAfter: new Date('2027-01-01T00:00:00.000Z'),
		},
	})
	if (input.favorite) {
		const suffix = faker.string.alphanumeric({ length: 8 }).toLowerCase()
		const [owner, type] = await Promise.all([
			prisma.user.create({
				data: {
					email: `jikan_${suffix}@example.com`,
					username: `jikan_${suffix}`,
				},
			}),
			prisma.listType.upsert({
				where: { name: 'anime' },
				update: {},
				create: {
					name: 'anime',
					header: 'Anime',
					columns: '{}',
					mediaType: '[]',
					completionType: '{}',
				},
			}),
		])
		await prisma.userFavorite.create({
			data: {
				ownerId: owner.id,
				mediaId: source.mediaId,
				typeId: type.id,
				position: 1,
				title: `Anime ${id}`,
			},
		})
	}
	return source
}

const committedOptions = {
	prisma,
	commit: true,
	policyApprovalReference: 'test-mal-policy-approval',
	leaseOwner: 'jikan-test-worker',
	requestDelayMs: 1_000,
	delay: vi.fn(async () => {}),
	now: () => NOW,
}

test('normalizes one Japanese voice actor per character with a safe fallback', () => {
	const credits = normalizeJikanAnimeCast({
		data: [
			{
				character: { name: '  Main   Character ' },
				voice_actors: [
					voiceActor(1, 'English Voice', 'English'),
					voiceActor(2, ' Japanese   Voice ', 'Japanese'),
				],
			},
			{
				character: { name: 'Fallback Character' },
				voice_actors: [
					voiceActor(
						3,
						'Fallback Voice',
						'French',
						'https://untrusted.example/portrait.jpg',
					),
				],
			},
			{
				character: { name: 'No Identified Voice' },
				voice_actors: [voiceActor(0, 'No Id', 'Japanese')],
			},
			{ character: null, voice_actors: [] },
			{
				character: { name: 'Malformed Voice' },
				voice_actors: [{ person: null, language: 'Japanese' }],
			},
		],
	})

	expect(credits).toEqual([
		expect.objectContaining({
			externalId: '2',
			name: 'Japanese Voice',
			role: 'Main Character',
			imageUrl: 'https://cdn.myanimelist.net/images/voiceactors/2.jpg',
			knownForDepartment: 'Acting',
			creditType: 'cast',
			billingOrder: 0,
		}),
		expect.objectContaining({
			externalId: '3',
			name: 'Fallback Voice',
			role: 'Fallback Character',
			imageUrl: null,
			billingOrder: 1,
		}),
	])
})

test('validates ids, bounds cast, and rejects malformed response shapes', () => {
	expect(jikanAnimeCharactersUrl('42')).toBe(
		'https://api.jikan.moe/v4/anime/42/characters',
	)
	expect(() => jikanAnimeCharactersUrl('../42')).toThrow(
		'positive safe integer',
	)
	expect(() => normalizeJikanAnimeCast({ data: null })).toThrow(
		'data must be an array',
	)
	const credits = normalizeJikanAnimeCast({
		data: Array.from({ length: 40 }, (_, index) => ({
			character: { name: `Character ${index}` },
			voice_actors: [voiceActor(index + 1, `Actor ${index}`, 'Japanese')],
		})),
	})
	expect(credits).toHaveLength(25)
	expect(credits.at(-1)?.billingOrder).toBe(24)
})

test('parses provider retry instructions and computes bounded fallbacks', () => {
	expect(parseJikanRetryAfter('120', NOW)).toEqual(
		new Date('2026-08-11T12:02:00.000Z'),
	)
	expect(parseJikanRetryAfter('Tue, 11 Aug 2026 12:03:00 GMT', NOW)).toEqual(
		new Date('2026-08-11T12:03:00.000Z'),
	)
	expect(
		jikanRetryDeadline({
			error: new JikanRequestError('missing', 404),
			failureCount: 0,
			now: NOW,
		}),
	).toEqual(new Date('2026-09-10T12:00:00.000Z'))
	expect(
		jikanRetryDeadline({
			error: new JikanRequestError('unavailable', 503),
			failureCount: 1,
			now: NOW,
		}),
	).toEqual(new Date('2026-08-11T12:30:00.000Z'))
})

test('dry-run reports only hydrated MAL anime without provider calls or writes', async () => {
	await seedHydratedAnime(1)
	const pending = await prisma.$transaction(tx =>
		upsertCatalogIdentity(tx, {
			provider: 'mal',
			kind: 'anime',
			externalId: '2',
			sourceTitle: 'Pending anime',
		}),
	)
	const fetchImpl = vi.fn(() => {
		throw new Error('dry-run must not fetch')
	})
	const result = await hydrateJikanAnimeCast({
		prisma,
		limit: 10,
		fetchImpl,
	})
	expect(result).toMatchObject({
		dryRun: true,
		recordsSeen: 1,
		requestsMade: 0,
		queueBefore: 1,
	})
	expect(fetchImpl).not.toHaveBeenCalled()
	expect(await prisma.mediaCreditSyncState.count()).toBe(0)
	expect(pending.fetchStatus).toBe('pending')
})

test('hydrates member-demand first and shares MAL people across credit providers', async () => {
	const popular = await seedHydratedAnime(10, { popularity: 1 })
	const demanded = await seedHydratedAnime(20, {
		popularity: 0.001,
		favorite: true,
	})
	// The actor already exists as a MAL-authored person on another title.
	const existingPerson = await prisma.person.create({
		data: {
			name: 'Existing Person',
			normalized: 'existing person',
			externalIds: { create: { provider: 'mal', externalId: '2002' } },
		},
	})
	const requested: number[] = []
	const fetchImpl = vi.fn(
		async (input: string | URL | Request, _init?: RequestInit) => {
			const id = Number(new URL(String(input)).pathname.split('/').at(-2))
			requested.push(id)
			return jsonResponse(castPayload(id))
		},
	)
	const delay = vi.fn(async () => {})
	const result = await hydrateJikanAnimeCast({
		...committedOptions,
		limit: 2,
		delay,
		fetchImpl: fetchImpl as unknown as typeof fetch,
	})

	expect(requested).toEqual([20, 10])
	expect(delay).toHaveBeenCalledOnce()
	expect(delay).toHaveBeenCalledWith(1_000)
	expect(result).toMatchObject({
		recordsHandled: 2,
		recordsFailed: 0,
		creditsWritten: 2,
		requestsMade: 2,
		queueAfter: 0,
	})
	const cast = await prisma.mediaCredit.findFirstOrThrow({
		where: { mediaId: demanded.mediaId, provider: 'jikan' },
	})
	expect(cast).toMatchObject({
		personId: existingPerson.id,
		role: 'Lead 20',
		billingOrder: 0,
	})
	expect(
		await prisma.personExternalId.count({
			where: { provider: 'mal', externalId: '2002' },
		}),
	).toBe(1)
	expect(
		await prisma.mediaCreditSyncState.count({
			where: { mediaId: { in: [popular.mediaId, demanded.mediaId] } },
		}),
	).toBe(2)
	expect(await getJikanAnimeCastMetrics(prisma, NOW)).toEqual(
		expect.objectContaining({
			active: 2,
			synced: 2,
			fresh: 2,
			queueDepth: 0,
			failedDeferred: 0,
			credits: 2,
			coveragePercent: 100,
		}),
	)
	const firstCall = fetchImpl.mock.calls[0]
	expect(firstCall[1]?.headers).toMatchObject({
		accept: 'application/json',
		'user-agent': 'Veud/0.1 (+https://www.veud.net/)',
	})
	expect(firstCall[1]?.redirect).toBe('error')
})

test('candidate fallback partitions by demand without a caller-sized id exclusion', async () => {
	await seedHydratedAnime(21, { favorite: true })
	await seedHydratedAnime(22)
	const findMany = vi.spyOn(prisma.mediaExternalId, 'findMany')

	const result = await hydrateJikanAnimeCast({ prisma, limit: 2 })

	expect(result.recordsSeen).toBe(2)
	expect(findMany).toHaveBeenCalledTimes(2)
	const fallback = JSON.stringify(findMany.mock.calls[1]?.[0]?.where)
	expect(fallback).toContain('"NOT"')
	expect(fallback).not.toContain('"notIn"')
})

test('a successful empty response is fresh instead of being fetched forever', async () => {
	const source = await seedHydratedAnime(30)
	const fetchImpl = vi.fn(async () => jsonResponse({ data: [] }))
	const first = await hydrateJikanAnimeCast({
		...committedOptions,
		fetchImpl: fetchImpl as unknown as typeof fetch,
	})
	expect(first).toMatchObject({ recordsHandled: 1, creditsWritten: 0 })
	expect(
		await prisma.mediaCreditSyncState.findUniqueOrThrow({
			where: {
				mediaId_provider_scope: {
					mediaId: source.mediaId,
					provider: 'jikan',
					scope: 'anime-cast',
				},
			},
		}),
	).toMatchObject({ status: 'fresh', failureCount: 0 })

	const blockedFetch = vi.fn(() => {
		throw new Error('fresh empty cast must not refetch')
	})
	const second = await hydrateJikanAnimeCast({
		prisma,
		fetchImpl: blockedFetch,
	})
	expect(second.queueBefore).toBe(0)
	expect(blockedFetch).not.toHaveBeenCalled()
})

test('429 state stops the batch and blocks requests until its cooldown expires', async () => {
	await seedHydratedAnime(40)
	await seedHydratedAnime(41)
	const rateLimited = vi.fn(
		async () =>
			new Response('', {
				status: 429,
				statusText: 'Too Many Requests',
				headers: { 'retry-after': '120' },
			}),
	)
	const first = await hydrateJikanAnimeCast({
		...committedOptions,
		fetchImpl: rateLimited as unknown as typeof fetch,
	})
	expect(first).toMatchObject({
		recordsSeen: 1,
		recordsFailed: 1,
		requestsMade: 1,
		rateLimitEvents: 1,
		providerRetryAfter: new Date('2026-08-11T12:02:00.000Z'),
	})

	const blockedFetch = vi.fn(() => {
		throw new Error('cooldown must block all requests')
	})
	const blocked = await hydrateJikanAnimeCast({
		...committedOptions,
		leaseOwner: 'jikan-blocked-worker',
		now: () => new Date('2026-08-11T12:01:00.000Z'),
		fetchImpl: blockedFetch,
	})
	expect(blocked.requestsMade).toBe(0)
	expect(blockedFetch).not.toHaveBeenCalled()
})

test.each([
	{
		label: 'network failure',
		response: () => Promise.reject(new Error('connection reset')),
		retryAt: new Date('2026-08-11T12:01:00.000Z'),
	},
	{
		label: 'bad gateway',
		response: () =>
			Promise.resolve(
				new Response('', { status: 502, statusText: 'Bad Gateway' }),
			),
		retryAt: new Date('2026-08-11T12:01:00.000Z'),
	},
	{
		label: 'service unavailable response',
		response: () =>
			Promise.resolve(
				new Response('', { status: 503, statusText: 'Service Unavailable' }),
			),
		retryAt: new Date('2026-08-11T12:15:00.000Z'),
	},
	{
		label: 'gateway timeout',
		response: () =>
			Promise.resolve(
				new Response('', { status: 504, statusText: 'Gateway Timeout' }),
			),
		retryAt: new Date('2026-08-11T12:01:00.000Z'),
	},
])(
	'a $label defers the provider instead of burning the batch',
	async fixture => {
		await seedHydratedAnime(42)
		await seedHydratedAnime(43)
		const fetchImpl = vi.fn(fixture.response)

		const result = await hydrateJikanAnimeCast({
			...committedOptions,
			limit: 2,
			fetchImpl: fetchImpl as unknown as typeof fetch,
		})

		expect(result).toMatchObject({
			recordsSeen: 1,
			recordsFailed: 1,
			requestsMade: 1,
			providerRetryAfter: fixture.retryAt,
		})
		expect(fetchImpl).toHaveBeenCalledOnce()
	},
)

test('a title failure is deferred while later titles continue', async () => {
	const failed = await seedHydratedAnime(50)
	const healthy = await seedHydratedAnime(51)
	const fetchImpl = vi.fn(async (input: string | URL | Request) => {
		const id = Number(new URL(String(input)).pathname.split('/').at(-2))
		return id === 50
			? new Response('', { status: 500, statusText: 'Server Error' })
			: jsonResponse(castPayload(id))
	})
	const result = await hydrateJikanAnimeCast({
		...committedOptions,
		limit: 2,
		fetchImpl: fetchImpl as unknown as typeof fetch,
	})
	expect(result).toMatchObject({
		recordsHandled: 1,
		recordsFailed: 1,
		requestsMade: 2,
		providerRetryAfter: null,
	})
	expect(
		await prisma.mediaCreditSyncState.findUniqueOrThrow({
			where: {
				mediaId_provider_scope: {
					mediaId: failed.mediaId,
					provider: 'jikan',
					scope: 'anime-cast',
				},
			},
		}),
	).toMatchObject({
		status: 'failed',
		failureCount: 1,
		refreshAfter: new Date('2026-08-11T12:01:00.000Z'),
	})
	expect(
		await prisma.mediaCredit.count({
			where: { mediaId: healthy.mediaId, provider: 'jikan' },
		}),
	).toBe(1)
})

test('committed runs require policy approval, an owner, and safe pacing', async () => {
	await expect(
		hydrateJikanAnimeCast({
			prisma,
			commit: true,
			leaseOwner: 'no-policy',
		}),
	).rejects.toThrow('policy approval reference is required')
	await expect(
		hydrateJikanAnimeCast({
			prisma,
			commit: true,
			policyApprovalReference: 'approved',
		}),
	).rejects.toThrow('leaseOwner is required')
	await expect(
		hydrateJikanAnimeCast({ prisma, requestDelayMs: 999 }),
	).rejects.toThrow('at least 1000')
})
