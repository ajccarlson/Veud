import { faker } from '@faker-js/faker'
import { afterEach, expect, test, vi } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import * as discoveryServer from '#app/utils/discovery.server.ts'
import { type NaturalLanguageDiscoveryPlan } from '#app/utils/natural-language-discovery.ts'
import * as recommendationGraphServer from '#app/utils/recommendation-graph.server.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { action, loader } from './discover.tsx'

vi.mock('#app/utils/discovery.server.ts', async importOriginal => {
	const actual = (await importOriginal()) as typeof discoveryServer
	return {
		...actual,
		getDiscoveryFacets: vi.fn(actual.getDiscoveryFacets),
		getDiscoveryGenres: vi.fn(actual.getDiscoveryGenres),
		getDiscoveryResults: vi.fn(actual.getDiscoveryResults),
		getDiscoveryStatuses: vi.fn(actual.getDiscoveryStatuses),
	}
})

vi.mock('#app/utils/recommendation-graph.server.ts', async importOriginal => {
	const actual = (await importOriginal()) as typeof recommendationGraphServer
	return {
		...actual,
		getRecommendationGraph: vi.fn(actual.getRecommendationGraph),
	}
})

afterEach(() => {
	vi.clearAllMocks()
	vi.unstubAllEnvs()
	vi.unstubAllGlobals()
})

async function createUser(prefix: string) {
	const suffix = faker.string.alphanumeric({ length: 10 }).toLowerCase()
	return prisma.user.create({
		data: {
			email: `${prefix}_${suffix}@example.com`,
			username: `${prefix}_${suffix}`,
		},
	})
}

async function cookieFor(userId: string) {
	const session = await prisma.session.create({
		data: { userId, expirationDate: getSessionExpirationDate() },
	})
	return getSessionCookieHeader(session)
}

test('anonymous discovery loads filters and falls back from personalized ranking', async () => {
	await prisma.media.create({
		data: {
			kind: 'movie',
			title: 'Anonymous Discovery',
			genres: 'Drama',
			releaseStatus: 'Released',
		},
	})

	const result = await loader({
		request: new Request(
			`${BASE_URL}/discover?q=Anonymous&kind=movie&sort=for-you`,
		),
		params: {},
	} as any)

	expect(result.data.isSignedIn).toBe(false)
	expect(result.data.filters).toEqual({
		q: 'Anonymous',
		mode: 'standard',
		kind: 'movie',
		genre: '',
		year: null,
		status: '',
		provider: 'all',
		sort: 'popular',
		page: 1,
	})
	expect(result.data.items).toEqual([
		expect.objectContaining({ title: 'Anonymous Discovery' }),
	])
	expect(result.data.genres).toEqual(['Drama'])
	expect(result.data.statuses).toEqual(['Released'])
	expect(discoveryServer.getDiscoveryFacets).toHaveBeenCalledOnce()
	expect(discoveryServer.getDiscoveryGenres).not.toHaveBeenCalled()
	expect(discoveryServer.getDiscoveryStatuses).not.toHaveBeenCalled()
	expect(result.data).not.toHaveProperty('truncated')
})

test('plain catalog searches include bounded people results on the first page', async () => {
	const tag = faker.string.alphanumeric({ length: 8 }).toLowerCase()
	const person = await prisma.person.create({
		data: {
			name: `${tag} Director`,
			normalized: `${tag} director`,
			knownForDepartment: 'Directing',
		},
	})
	const media = await prisma.media.create({
		data: { kind: 'movie', title: `Unrelated ${faker.string.uuid()}` },
	})
	await prisma.mediaCredit.create({
		data: {
			mediaId: media.id,
			personId: person.id,
			provider: 'tmdb',
			creditType: 'crew',
			role: 'Director',
			department: 'Directing',
		},
	})

	const result = await loader({
		request: new Request(`${BASE_URL}/discover?q=${tag}`),
		params: {},
	} as any)
	expect(result.data.people).toEqual([
		expect.objectContaining({
			id: person.id,
			name: `${tag} Director`,
			knownForDepartment: 'Directing',
			creditCount: 1,
		}),
	])

	const filtered = await loader({
		request: new Request(`${BASE_URL}/discover?q=${tag}&kind=movie`),
		params: {},
	} as any)
	expect(filtered.data.people).toEqual([])

	const laterPage = await loader({
		request: new Request(`${BASE_URL}/discover?q=${tag}&page=2`),
		params: {},
	} as any)
	expect(laterPage.data.people).toEqual([])
})

test('signed-in discovery returns unseen recommendation graph results', async () => {
	const viewer = await createUser('discover_viewer')
	const listType = await prisma.listType.upsert({
		where: { name: 'anime' },
		update: {},
		create: {
			name: 'anime',
			header: 'Anime',
			columns: '{}',
			mediaType: '["episode"]',
			completionType: '{}',
		},
	})
	const watchlist = await prisma.watchlist.create({
		data: {
			ownerId: viewer.id,
			typeId: listType.id,
			name: 'completed',
			header: 'Completed',
		},
	})
	const [tracked, unseen] = await Promise.all([
		prisma.media.create({
			data: { kind: 'anime', title: 'Seen Fantasy', genres: 'Fantasy' },
		}),
		prisma.media.create({
			data: { kind: 'anime', title: 'Unseen Fantasy', genres: 'Fantasy' },
		}),
	])
	await prisma.trackingState.create({
		data: {
			ownerId: viewer.id,
			mediaId: tracked.id,
			status: 'completed',
			statusWatchlistId: watchlist.id,
			score: 9,
		},
	})
	const cookie = await cookieFor(viewer.id)
	const popular = await loader({
		request: new Request(`${BASE_URL}/discover`, { headers: { cookie } }),
		params: {},
	} as any)
	expect(popular.data.watchlists).toEqual([
		expect.objectContaining({ id: watchlist.id, name: 'completed' }),
	])
	expect(
		popular.data.items.find(item => item.id === tracked.id)?.viewerTracking,
	).toEqual({ status: 'completed', statusWatchlistId: watchlist.id })

	const result = await loader({
		request: new Request(`${BASE_URL}/discover?sort=for-you`, {
			headers: { cookie },
		}),
		params: {},
	} as any)

	expect(result.data.isSignedIn).toBe(true)
	expect(result.data.items).toEqual([])
	expect(
		result.data.recommendationGraph?.lanes
			.flatMap(lane => lane.items)
			.map(item => item.id),
	).toContain(unseen.id)

	await prisma.recommendationFeedback.create({
		data: {
			ownerId: viewer.id,
			mediaId: unseen.id,
			feedbackType: 'not_interested',
			sourceLane: 'taste',
		},
	})
	const afterFeedback = await loader({
		request: new Request(`${BASE_URL}/discover?sort=for-you`, {
			headers: { cookie },
		}),
		params: {},
	} as any)
	expect(afterFeedback.data.items).toEqual([])
	expect(afterFeedback.data.recommendationGraph?.hiddenItems).toEqual([
		expect.objectContaining({ id: unseen.id }),
	])
})

test('recommendation graph-only state skips discovery while variants retain it', async () => {
	const viewer = await createUser('discover_graph_only')
	const cookie = await cookieFor(viewer.id)
	const getDiscoveryResults = vi.mocked(discoveryServer.getDiscoveryResults)
	const getRecommendationGraph = vi.mocked(
		recommendationGraphServer.getRecommendationGraph,
	)

	const graphOnly = await loader({
		request: new Request(`${BASE_URL}/discover?sort=for-you`, {
			headers: { cookie },
		}),
		params: {},
	} as any)

	expect(getDiscoveryResults).not.toHaveBeenCalled()
	expect(getRecommendationGraph).toHaveBeenCalledOnce()
	expect(getRecommendationGraph).toHaveBeenCalledWith(viewer.id)
	expect(graphOnly.data.recommendationGraph).not.toBeNull()
	expect(graphOnly.data).toEqual(
		expect.objectContaining({
			items: [],
			total: 0,
			pageCount: 1,
			preferredGenres: [],
			filters: expect.objectContaining({
				mode: 'standard',
				kind: 'all',
				sort: 'for-you',
				page: 1,
			}),
		}),
	)

	const variants = [
		['query', 'sort=for-you&q=clue', true],
		['mode', 'sort=for-you&mode=memory', false],
		['kind', 'sort=for-you&kind=movie', true],
		['genre', 'sort=for-you&genre=Drama', true],
		['year', 'sort=for-you&year=2026', true],
		['status', 'sort=for-you&status=Released', true],
		['provider', 'sort=for-you&provider=tmdb', true],
		['sort', 'sort=popular', true],
		['page', 'sort=for-you&page=2', true],
	] as const
	for (const [label, search, callsDiscovery] of variants) {
		const discoveryCalls = getDiscoveryResults.mock.calls.length
		const graphCalls = getRecommendationGraph.mock.calls.length
		const result = await loader({
			request: new Request(`${BASE_URL}/discover?${search}`, {
				headers: { cookie },
			}),
			params: {},
		} as any)

		expect(
			result.data.recommendationGraph,
			`${label} must disable the recommendation graph`,
		).toBeNull()
		expect(getRecommendationGraph).toHaveBeenCalledTimes(graphCalls)
		expect(getDiscoveryResults).toHaveBeenCalledTimes(
			discoveryCalls + Number(callsDiscovery),
		)
	}

	const discoveryCalls = getDiscoveryResults.mock.calls.length
	const graphCalls = getRecommendationGraph.mock.calls.length
	const anonymous = await loader({
		request: new Request(`${BASE_URL}/discover?sort=for-you`),
		params: {},
	} as any)
	expect(anonymous.data.isSignedIn).toBe(false)
	expect(anonymous.data.recommendationGraph).toBeNull()
	expect(getRecommendationGraph).toHaveBeenCalledTimes(graphCalls)
	expect(getDiscoveryResults).toHaveBeenCalledTimes(discoveryCalls + 1)
	expect(getDiscoveryResults).toHaveBeenLastCalledWith(
		expect.objectContaining({ sort: 'for-you' }),
		null,
	)
})

test('memory-search GET remains local even when AI is configured', async () => {
	const expected = await prisma.media.create({
		data: {
			kind: 'movie',
			title: 'Silver Observatory Match',
			description:
				'A child finds a silver observatory hidden beneath a desert town.',
			catalogPopularity: 100,
		},
	})
	vi.stubEnv('OPENAI_API_KEY', 'configured-key')
	const fetchMock = vi.fn<typeof fetch>()
	vi.stubGlobal('fetch', fetchMock)

	const result = await loader({
		request: new Request(
			`${BASE_URL}/discover?mode=memory&kind=movie&q=silver+observatory+under+a+desert+town`,
		),
		params: {},
	} as any)

	expect(fetchMock).not.toHaveBeenCalled()
	expect(result.data.aiSearchAvailable).toBe(true)
	expect(result.data.memorySearchSource).toBe('catalog-match')
	expect(result.data.memorySearchFallbackReason).toBe('sign-in-required')
	expect(result.data.items).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				id: expected.id,
				title: 'Silver Observatory Match',
				memoryMatch: expect.objectContaining({ summary: expect.any(String) }),
			}),
		]),
	)
})

test('discovery refinement is owner-scoped and undo restores the exact prior plan', async () => {
	const [owner, other] = await Promise.all([
		createUser('discovery_session_owner'),
		createUser('discovery_session_other'),
	])
	const plan: NaturalLanguageDiscoveryPlan = {
		kinds: ['anime'],
		includeGenres: ['Psychological'],
		excludeGenres: ['Romance'],
		includeTerms: [],
		excludeTerms: [],
		yearFrom: null,
		yearTo: null,
		releaseStatus: null,
		language: null,
		toneTerms: [],
		pace: null,
		lengthUnit: 'episodes',
		lengthFrom: null,
		lengthTo: 23,
		sort: 'popular',
		explanation: 'Short psychological anime.',
		unsupportedConstraints: [],
	}
	const session = await prisma.aiDiscoverySession.create({
		data: {
			ownerId: owner.id,
			phrases: JSON.stringify(['short psychological anime']),
			plans: JSON.stringify([plan]),
			expiresAt: new Date(Date.now() + 60_000),
		},
	})
	const otherCookie = await cookieFor(other.id)
	const ownerCookie = await cookieFor(owner.id)
	const form = new URLSearchParams({
		intent: 'describe-remove',
		sessionId: session.id,
		chipType: 'excluded genre',
		chipValue: 'Romance',
	})

	await expect(
		action({
			request: new Request(`${BASE_URL}/discover`, {
				method: 'POST',
				headers: {
					cookie: otherCookie,
					'content-type': 'application/x-www-form-urlencoded',
				},
				body: form,
			}),
			params: {},
		} as any),
	).rejects.toMatchObject({ status: 404 })
	expect(
		await prisma.aiDiscoverySession.findUniqueOrThrow({
			where: { id: session.id },
		}),
	).toEqual(
		expect.objectContaining({ currentStep: 0, plans: JSON.stringify([plan]) }),
	)

	await expect(
		action({
			request: new Request(`${BASE_URL}/discover`, {
				method: 'POST',
				headers: {
					cookie: ownerCookie,
					'content-type': 'application/x-www-form-urlencoded',
				},
				body: form,
			}),
			params: {},
		} as any),
	).rejects.toMatchObject({ status: 302 })
	const refined = await prisma.aiDiscoverySession.findUniqueOrThrow({
		where: { id: session.id },
	})
	expect(refined.currentStep).toBe(1)
	expect(
		(JSON.parse(refined.plans) as NaturalLanguageDiscoveryPlan[])[1]
			?.excludeGenres,
	).toEqual([])

	await expect(
		action({
			request: new Request(`${BASE_URL}/discover`, {
				method: 'POST',
				headers: {
					cookie: ownerCookie,
					'content-type': 'application/x-www-form-urlencoded',
				},
				body: new URLSearchParams({
					intent: 'describe-undo',
					sessionId: session.id,
				}),
			}),
			params: {},
		} as any),
	).rejects.toMatchObject({ status: 302 })
	const undone = await prisma.aiDiscoverySession.findUniqueOrThrow({
		where: { id: session.id },
	})
	expect(undone.currentStep).toBe(0)
	expect(
		(JSON.parse(undone.plans) as NaturalLanguageDiscoveryPlan[])[0],
	).toEqual(plan)
})
