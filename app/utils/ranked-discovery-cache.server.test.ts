import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
	getCacheOperationsSnapshot,
	lruCache,
	resetCacheResourcesForTest,
} from './cache.server.ts'
import {
	createRankedDiscoveryCacheRuntimeForTest,
	createRankedDiscoveryViewerFingerprint,
	getRankedDiscoveryPlan,
	RANKED_DISCOVERY_CACHE_TTL_MS,
	RANKED_DISCOVERY_PLAN_MAX_IDS,
	type RankedDiscoveryPlan,
	type RankedDiscoveryPlanRequest,
} from './ranked-discovery-cache.server.ts'

type StandardPublicRequest = Extract<
	RankedDiscoveryPlanRequest,
	{ source: 'standard'; sort: 'popular' | 'top-rated' }
>
type NaturalPublicRequest = Extract<
	RankedDiscoveryPlanRequest,
	{ source: 'natural'; sort: 'popular' | 'top-rated' }
>
type StandardViewerRequest = Extract<
	RankedDiscoveryPlanRequest,
	{ source: 'standard'; sort: 'for-you' }
>

function standardRequest(
	overrides: Partial<StandardPublicRequest> = {},
): StandardPublicRequest {
	return {
		source: 'standard',
		q: '',
		kind: 'all',
		genre: '',
		year: null,
		status: '',
		provider: 'all',
		sort: 'popular',
		...overrides,
	}
}

function naturalRequest(
	overrides: Partial<NaturalPublicRequest> = {},
): NaturalPublicRequest {
	return {
		source: 'natural',
		kinds: ['movie', 'tv'],
		includeGenres: ['Mystery'],
		excludeGenres: ['Horror'],
		includeTerms: ['locked room'],
		excludeTerms: ['slasher'],
		yearFrom: 1990,
		yearTo: 2026,
		releaseStatus: 'completed',
		language: 'English',
		toneTerms: ['atmospheric'],
		pace: 'slow',
		lengthUnit: 'minutes',
		lengthFrom: 60,
		lengthTo: 180,
		sort: 'top-rated',
		...overrides,
	}
}

function viewerRequest(
	overrides: Partial<StandardViewerRequest> = {},
): StandardViewerRequest {
	return {
		...standardRequest(),
		sort: 'for-you',
		viewerFingerprint: createRankedDiscoveryViewerFingerprint({
			stateDigest: 'viewer-state-a',
		}),
		...overrides,
	}
}

beforeEach(() => {
	resetCacheResourcesForTest()
})

afterEach(() => {
	vi.unstubAllEnvs()
	resetCacheResourcesForTest()
})

describe('ranked discovery plan boundaries', () => {
	test('bypasses by default in tests without creating cache state or metrics', async () => {
		const fresh = vi
			.fn<() => Promise<RankedDiscoveryPlan>>()
			.mockResolvedValue({ ids: ['media-a', 'media-b'] })
		const entriesBefore = lruCache.snapshot().entries

		const first = await getRankedDiscoveryPlan({
			request: standardRequest(),
			scope: { kind: 'public' },
			getFreshValue: fresh,
		})
		const second = await getRankedDiscoveryPlan({
			request: standardRequest(),
			scope: { kind: 'public' },
			getFreshValue: fresh,
		})

		expect(first).toEqual({ ids: ['media-a', 'media-b'] })
		expect(second).toEqual(first)
		expect(fresh).toHaveBeenCalledTimes(2)
		expect(lruCache.snapshot().entries).toBe(entriesBefore)
		expect(getCacheOperationsSnapshot()).toEqual({})
		expect(Object.isFrozen(first)).toBe(true)
		expect(Object.isFrozen(first.ids)).toBe(true)
	})

	test('checks the E2E bypass environment on every call', async () => {
		vi.stubEnv('NODE_ENV', 'production')
		vi.stubEnv('VEUD_E2E', '0')
		const fresh = vi.fn(() => ({ ids: ['media-a'] as const }))

		await getRankedDiscoveryPlan({
			request: standardRequest(),
			scope: { kind: 'public' },
			getFreshValue: fresh,
		})
		const entriesBeforeBypass = lruCache.snapshot().entries
		const metricsBeforeBypass = getCacheOperationsSnapshot()

		vi.stubEnv('VEUD_E2E', '1')
		await getRankedDiscoveryPlan({
			request: standardRequest(),
			scope: { kind: 'public' },
			getFreshValue: fresh,
		})

		expect(fresh).toHaveBeenCalledTimes(2)
		expect(lruCache.snapshot().entries).toBe(entriesBeforeBypass)
		expect(getCacheOperationsSnapshot()).toEqual(metricsBeforeBypass)
	})

	test('rejects pages, explanations, and other non-semantic request fields', async () => {
		const fresh = vi.fn(() => ({ ids: ['media-a'] as const }))

		await expect(
			getRankedDiscoveryPlan({
				request: {
					...standardRequest(),
					page: 2,
				} as unknown as RankedDiscoveryPlanRequest,
				scope: { kind: 'public' },
				getFreshValue: fresh,
			}),
		).rejects.toThrow()
		await expect(
			getRankedDiscoveryPlan({
				request: {
					...naturalRequest(),
					explanation: 'This must never fragment the ranked plan.',
				} as unknown as RankedDiscoveryPlanRequest,
				scope: { kind: 'public' },
				getFreshValue: fresh,
			}),
		).rejects.toThrow()
		await expect(
			getRankedDiscoveryPlan({
				request: {
					...standardRequest(),
					q: ' surrounding whitespace ',
				},
				scope: { kind: 'public' },
				getFreshValue: fresh,
			}),
		).rejects.toThrow()
		expect(fresh).not.toHaveBeenCalled()
	})

	test('validates natural request relationships before producing a plan', async () => {
		const fresh = vi.fn(() => ({ ids: [] as const }))
		for (const request of [
			naturalRequest({ yearFrom: 2020, yearTo: 2000 }),
			naturalRequest({ lengthUnit: null, lengthFrom: 60 }),
			naturalRequest({ lengthFrom: 200, lengthTo: 100 }),
			naturalRequest({
				kinds: ['manga'],
				lengthUnit: 'episodes',
			}),
			naturalRequest({
				includeGenres: ['Mystery'],
				excludeGenres: ['mystery'],
			}),
			naturalRequest({
				includeTerms: ['locked room'],
				excludeTerms: ['LOCKED ROOM'],
			}),
		]) {
			await expect(
				getRankedDiscoveryPlan({
					request,
					scope: { kind: 'public' },
					getFreshValue: fresh,
				}),
			).rejects.toThrow()
		}
		expect(fresh).not.toHaveBeenCalled()
	})

	test('requires public scope for public plans and viewer scope for for-you', async () => {
		const fresh = vi.fn(() => ({ ids: [] as const }))

		await expect(
			getRankedDiscoveryPlan({
				request: standardRequest(),
				scope: { kind: 'viewer', viewerId: 'viewer-a' },
				getFreshValue: fresh,
			}),
		).rejects.toThrow('require public scope')
		await expect(
			getRankedDiscoveryPlan({
				request: viewerRequest(),
				scope: { kind: 'public' },
				getFreshValue: fresh,
			}),
		).rejects.toThrow('require viewer scope')
		expect(fresh).not.toHaveBeenCalled()
	})

	test('rejects malformed or non-exact viewer scopes even while bypassed', async () => {
		const fresh = vi.fn(() => ({ ids: [] as const }))

		for (const scope of [
			{ kind: 'viewer', viewerId: ' viewer-a' },
			{ kind: 'viewer', viewerId: '' },
			{ kind: 'viewer', viewerId: 'x'.repeat(513) },
			{ kind: 'viewer', viewerId: 'viewer-a', displayName: 'Private Name' },
		]) {
			await expect(
				getRankedDiscoveryPlan({
					request: viewerRequest(),
					scope: scope as never,
					getFreshValue: fresh,
				}),
			).rejects.toThrow()
		}
		expect(fresh).not.toHaveBeenCalled()
	})

	test('accepts only an exact, unique, bounded ID envelope', async () => {
		async function expectInvalid(value: unknown) {
			await expect(
				getRankedDiscoveryPlan({
					request: standardRequest(),
					scope: { kind: 'public' },
					getFreshValue: () => value as RankedDiscoveryPlan,
				}),
			).rejects.toThrow()
		}

		await expectInvalid({
			ids: ['media-a'],
			total: 1,
		})
		await expectInvalid({ ids: ['media-a', 'media-a'] })
		await expectInvalid({ ids: [' media-a'] })
		await expectInvalid({ ids: ['media/a'] })
		await expectInvalid({
			ids: Array.from(
				{ length: RANKED_DISCOVERY_PLAN_MAX_IDS + 1 },
				(_, index) => `media-${index}`,
			),
		})
	})

	test('clones and freezes producer values instead of retaining aliases', async () => {
		const runtime = createRankedDiscoveryCacheRuntimeForTest()
		const producerIds = ['media-a']
		const first = await getRankedDiscoveryPlan({
			request: standardRequest(),
			scope: { kind: 'public' },
			runtime,
			getFreshValue: () => ({ ids: producerIds }),
		})

		producerIds.push('media-b')
		expect(first).toEqual({ ids: ['media-a'] })
		expect(() => (first.ids as string[]).push('media-c')).toThrow()

		const cached = await getRankedDiscoveryPlan({
			request: standardRequest(),
			scope: { kind: 'public' },
			runtime,
			getFreshValue: () => ({ ids: ['unexpected'] }),
		})
		expect(cached).toEqual({ ids: ['media-a'] })
		expect(Object.isFrozen(cached)).toBe(true)
		expect(Object.isFrozen(cached.ids)).toBe(true)
	})

	test('passes a deeply immutable parsed request to the producer', async () => {
		const runtime = createRankedDiscoveryCacheRuntimeForTest()
		let producerRequest: RankedDiscoveryPlanRequest | undefined

		await getRankedDiscoveryPlan({
			request: naturalRequest({
				kinds: ['tv', 'movie'],
				includeGenres: ['Mystery', 'Drama'],
			}),
			scope: { kind: 'public' },
			runtime,
			getFreshValue: request => {
				producerRequest = request
				return { ids: ['media-a'] }
			},
		})

		expect(Object.isFrozen(producerRequest)).toBe(true)
		const parsedRequest = producerRequest
		if (parsedRequest?.source !== 'natural') {
			throw new TypeError('Expected a natural request.')
		}
		expect(Object.isFrozen(parsedRequest.kinds)).toBe(true)
		expect(Object.isFrozen(parsedRequest.includeGenres)).toBe(true)
		expect(() => (parsedRequest.kinds as string[]).push('anime')).toThrow()
		expect(parsedRequest.kinds).toEqual(['tv', 'movie'])
	})
})

describe('ranked discovery cache semantics', () => {
	test('serves hits from one memory-only test runtime', async () => {
		const runtime = createRankedDiscoveryCacheRuntimeForTest()
		const fresh = vi.fn(() => ({ ids: ['media-a'] as const }))

		const first = await getRankedDiscoveryPlan({
			request: standardRequest(),
			scope: { kind: 'public' },
			runtime,
			getFreshValue: fresh,
		})
		const second = await getRankedDiscoveryPlan({
			request: standardRequest(),
			scope: { kind: 'public' },
			runtime,
			getFreshValue: fresh,
		})

		expect(first).toEqual({ ids: ['media-a'] })
		expect(second).toEqual(first)
		expect(fresh).toHaveBeenCalledOnce()
		expect(runtime.cache.snapshot().entries).toBe(1)
		expect(getCacheOperationsSnapshot()['ranked-discovery']).toMatchObject({
			hit: 1,
			miss: 1,
			refresh: 1,
		})
	})

	test('keeps the ranked-plan TTL at two minutes', () => {
		expect(RANKED_DISCOVERY_CACHE_TTL_MS).toBe(120_000)
	})

	test('coalesces concurrent refreshes for the same semantic plan', async () => {
		const runtime = createRankedDiscoveryCacheRuntimeForTest()
		let release: (() => void) | undefined
		const gate = new Promise<void>(resolve => {
			release = resolve
		})
		const fresh = vi.fn(async () => {
			await gate
			return { ids: ['media-a'] as const }
		})

		const calls = Array.from({ length: 8 }, () =>
			getRankedDiscoveryPlan({
				request: standardRequest({ q: 'one private query' }),
				scope: { kind: 'public' },
				runtime,
				getFreshValue: fresh,
			}),
		)
		await vi.waitFor(() => expect(fresh).toHaveBeenCalledOnce())
		release?.()

		await expect(Promise.all(calls)).resolves.toEqual(
			Array.from({ length: 8 }, () => ({ ids: ['media-a'] })),
		)
		expect(fresh).toHaveBeenCalledOnce()
		expect(runtime.cache.snapshot().entries).toBe(1)
	})

	test('uses every standard and natural ranking input in opaque keys', async () => {
		const runtime = createRankedDiscoveryCacheRuntimeForTest()
		let sequence = 0
		const fresh = vi.fn(() => ({ ids: [`media-${++sequence}`] }))

		const standardInputs = [
			standardRequest(),
			standardRequest({ q: 'different query' }),
			standardRequest({ kind: 'anime' }),
			standardRequest({ genre: 'Drama' }),
			standardRequest({ year: 2025 }),
			standardRequest({ status: 'Finished Airing' }),
			standardRequest({ provider: 'mal' }),
			standardRequest({ sort: 'top-rated' }),
		]
		for (const request of standardInputs) {
			await getRankedDiscoveryPlan({
				request,
				scope: { kind: 'public' },
				runtime,
				getFreshValue: fresh,
			})
		}

		const naturalInputs = [
			naturalRequest(),
			naturalRequest({ kinds: ['anime'] }),
			naturalRequest({ includeGenres: ['Drama'] }),
			naturalRequest({ excludeGenres: ['Comedy'] }),
			naturalRequest({ includeTerms: ['detective'] }),
			naturalRequest({ excludeTerms: ['war'] }),
			naturalRequest({ yearFrom: 2000 }),
			naturalRequest({ yearTo: 2020 }),
			naturalRequest({ releaseStatus: 'ongoing' }),
			naturalRequest({ language: 'Japanese' }),
			naturalRequest({ toneTerms: ['hopeful'] }),
			naturalRequest({ pace: 'fast' }),
			naturalRequest({ lengthUnit: null, lengthFrom: null, lengthTo: null }),
			naturalRequest({ lengthFrom: 90 }),
			naturalRequest({ lengthTo: 120 }),
			naturalRequest({ sort: 'popular' }),
		]
		for (const request of naturalInputs) {
			await getRankedDiscoveryPlan({
				request,
				scope: { kind: 'public' },
				runtime,
				getFreshValue: fresh,
			})
		}

		expect(fresh).toHaveBeenCalledTimes(
			standardInputs.length + naturalInputs.length,
		)
		expect(runtime.cache.snapshot().entries).toBe(
			standardInputs.length + naturalInputs.length,
		)
	})

	test('keeps exact producer-visible array semantics in cache keys', async () => {
		const runtime = createRankedDiscoveryCacheRuntimeForTest()
		const fresh = vi.fn(() => ({ ids: ['media-a'] as const }))
		const first = naturalRequest({
			kinds: ['tv', 'movie'],
			includeGenres: ['Mystery', 'Drama', 'Mystery'],
			includeTerms: ['locked room', 'detective'],
		})
		const reordered = naturalRequest({
			kinds: ['movie', 'tv'],
			includeGenres: ['Drama', 'Mystery'],
			includeTerms: ['detective', 'locked room'],
		})

		await getRankedDiscoveryPlan({
			request: first,
			scope: { kind: 'public' },
			runtime,
			getFreshValue: fresh,
		})
		await getRankedDiscoveryPlan({
			request: reordered,
			scope: { kind: 'public' },
			runtime,
			getFreshValue: fresh,
		})

		expect(fresh).toHaveBeenCalledTimes(2)
		expect(runtime.cache.snapshot().entries).toBe(2)
	})

	test('isolates viewers and fingerprints without exposing raw material', async () => {
		const runtime = createRankedDiscoveryCacheRuntimeForTest()
		const fresh = vi.fn(() => ({ ids: ['media-a'] as const }))
		const secretQuery = 'a query that must remain private'
		const secretViewer = 'private-viewer-identifier'
		const firstFingerprint = createRankedDiscoveryViewerFingerprint({
			stateDigest: 'private-taste-and-exclusion-digest-a',
		})
		const secondFingerprint = createRankedDiscoveryViewerFingerprint({
			stateDigest: 'private-taste-and-exclusion-digest-b',
		})

		for (const [viewerId, viewerFingerprint] of [
			[secretViewer, firstFingerprint],
			['other-viewer', firstFingerprint],
			[secretViewer, secondFingerprint],
		] as const) {
			await getRankedDiscoveryPlan({
				request: viewerRequest({
					q: secretQuery,
					viewerFingerprint,
				}),
				scope: { kind: 'viewer', viewerId },
				runtime,
				getFreshValue: fresh,
			})
		}

		expect(fresh).toHaveBeenCalledTimes(3)
		expect(runtime.cache.snapshot().entries).toBe(3)
		for (const key of runtime.cache.keys()) {
			expect(key).toMatch(/^ck1_ranked-discovery_v1_[A-Za-z0-9_-]{43}$/)
			expect(key).not.toContain(secretQuery)
			expect(key).not.toContain(secretViewer)
			expect(key).not.toContain('private-taste')
		}
		expect(Object.keys(getCacheOperationsSnapshot())).toEqual([
			'ranked-discovery',
		])
	})

	test('builds deterministic, opaque fingerprints from compact state', () => {
		const first = createRankedDiscoveryViewerFingerprint({
			counts: { feedback: 2, favorites: 3, tracking: 10 },
			stateDigest: 'complete-streaming-digest',
		})
		const reordered = createRankedDiscoveryViewerFingerprint({
			stateDigest: 'complete-streaming-digest',
			counts: { tracking: 10, favorites: 3, feedback: 2 },
		})
		const changed = createRankedDiscoveryViewerFingerprint({
			counts: { feedback: 2, favorites: 4, tracking: 10 },
			stateDigest: 'complete-streaming-digest',
		})

		expect(first).toBe(reordered)
		expect(first).not.toBe(changed)
		expect(first).toMatch(/^rdf1_[A-Za-z0-9_-]{43}$/)
		expect(first).not.toContain('complete-streaming-digest')
	})

	test('does not allow production callers to inject a cache runtime', async () => {
		const runtime = createRankedDiscoveryCacheRuntimeForTest()
		vi.stubEnv('NODE_ENV', 'production')

		await expect(
			getRankedDiscoveryPlan({
				request: standardRequest(),
				scope: { kind: 'public' },
				runtime,
				getFreshValue: () => ({ ids: [] }),
			}),
		).rejects.toThrow('only be used by tests')
		expect(() => createRankedDiscoveryCacheRuntimeForTest()).toThrow(
			'only be created by tests',
		)
	})
})
