import { afterEach, describe, expect, test, vi } from 'vitest'
import { z } from 'zod'
import {
	createMemoryCache,
	getCacheOperationsSnapshot,
	lruCache,
	resetCacheResourcesForTest,
	SAFE_CACHE_MAX_TTL_MS,
} from './cache.server.ts'
import {
	createPublicSurfaceCacheRuntimeForTest,
	getPublicSurfaceFragment,
	publicSurfaceCacheNamespaces,
	type PublicSurfaceCacheNamespace,
} from './public-surface-cache.server.ts'

const fragmentSchema = z
	.object({
		ids: z.array(z.string().trim().min(1).max(128)).max(8),
	})
	.strict()

function parseFragment(value: unknown) {
	return fragmentSchema.parse(value)
}

type Fragment = z.infer<typeof fragmentSchema>
type FragmentOptions = Parameters<typeof getPublicSurfaceFragment<Fragment>>[0]

function fragmentOptions(
	overrides: Partial<FragmentOptions> = {},
): FragmentOptions {
	return {
		namespace: 'home-trending-plan' as const,
		keyVersion: 1,
		keyPayload: { season: 'summer-2026' },
		ttl: 1_000,
		parse: parseFragment,
		getFreshValue: () => ({ ids: ['media-a'] }),
		...overrides,
	}
}

afterEach(() => {
	vi.useRealTimers()
	vi.unstubAllEnvs()
	resetCacheResourcesForTest()
})

describe('public surface cache policy', () => {
	test('registers only the three public fragment families', () => {
		expect(publicSurfaceCacheNamespaces).toEqual([
			'anonymous-home-summary',
			'home-trending-plan',
			'discovery-facets',
		])
	})

	test('bypasses by default in Vitest without cache state or metrics', async () => {
		const entriesBefore = lruCache.snapshot().entries
		const fresh = vi
			.fn<() => Promise<{ ids: string[] }>>()
			.mockResolvedValue({ ids: ['media-a'] })

		const first = await getPublicSurfaceFragment(
			fragmentOptions({ getFreshValue: fresh }),
		)
		const second = await getPublicSurfaceFragment(
			fragmentOptions({ getFreshValue: fresh }),
		)

		expect(first).toEqual({ ids: ['media-a'] })
		expect(second).toEqual(first)
		expect(fresh).toHaveBeenCalledTimes(2)
		expect(lruCache.snapshot().entries).toBe(entriesBefore)
		expect(getCacheOperationsSnapshot()).toEqual({})
		expect(Object.isFrozen(first)).toBe(true)
		expect(Object.isFrozen(first.ids)).toBe(true)
	})

	test('checks the browser-test bypass marker on every call', async () => {
		vi.stubEnv('NODE_ENV', 'production')
		vi.stubEnv('VEUD_E2E', '0')
		const fresh = vi.fn(() => ({ ids: ['media-a'] }))

		await getPublicSurfaceFragment(fragmentOptions({ getFreshValue: fresh }))
		const entriesBeforeBypass = lruCache.snapshot().entries
		const metricsBeforeBypass = getCacheOperationsSnapshot()

		vi.stubEnv('VEUD_E2E', '1')
		await getPublicSurfaceFragment(fragmentOptions({ getFreshValue: fresh }))

		expect(fresh).toHaveBeenCalledTimes(2)
		expect(lruCache.snapshot().entries).toBe(entriesBeforeBypass)
		expect(getCacheOperationsSnapshot()).toEqual(metricsBeforeBypass)
	})

	test('accepts branded runtime overrides only in the test process', async () => {
		const runtime = createPublicSurfaceCacheRuntimeForTest()
		vi.stubEnv('NODE_ENV', 'production')

		expect(() => createPublicSurfaceCacheRuntimeForTest()).toThrow(
			/only be created by tests/,
		)
		await expect(
			getPublicSurfaceFragment(fragmentOptions({ runtime })),
		).rejects.toThrow(/only be used by tests/)
	})

	test('validates namespace, version, key material, ttl, and callbacks before bypass', async () => {
		for (const input of [
			fragmentOptions({
				namespace: 'viewer-private' as PublicSurfaceCacheNamespace,
			}),
			fragmentOptions({ keyVersion: 0 }),
			fragmentOptions({ keyVersion: Number.NaN }),
			fragmentOptions({ keyPayload: { invalid: undefined } as never }),
			fragmentOptions({ ttl: 0 }),
			fragmentOptions({ ttl: SAFE_CACHE_MAX_TTL_MS + 1 }),
			fragmentOptions({ parse: null as never }),
			fragmentOptions({ getFreshValue: null as never }),
		]) {
			await expect(getPublicSurfaceFragment(input)).rejects.toThrow()
		}

		await expect(
			getPublicSurfaceFragment(fragmentOptions({ ttl: SAFE_CACHE_MAX_TTL_MS })),
		).resolves.toEqual({ ids: ['media-a'] })
	})
})

describe('public surface cache correctness', () => {
	test('coalesces concurrent refreshes and retains only opaque public keys', async () => {
		const privateMaterial = 'member-private-query'
		const timings = {}
		const runtime = createPublicSurfaceCacheRuntimeForTest()
		let release: (() => void) | undefined
		const gate = new Promise<void>(resolve => {
			release = resolve
		})
		const fresh = vi.fn(async () => {
			await gate
			return { ids: ['media-a'] }
		})

		const calls = Array.from({ length: 12 }, () =>
			getPublicSurfaceFragment(
				fragmentOptions({
					keyPayload: { semanticInput: privateMaterial },
					getFreshValue: fresh,
					timings,
					runtime,
				}),
			),
		)
		await vi.waitFor(() => expect(fresh).toHaveBeenCalledOnce())
		release?.()

		await expect(Promise.all(calls)).resolves.toEqual(
			Array.from({ length: 12 }, () => ({ ids: ['media-a'] })),
		)
		expect(runtime.cache.keys()).toHaveLength(1)
		expect(runtime.cache.keys()[0]).toMatch(
			/^ck1_home-trending-plan_v1_[A-Za-z0-9_-]{43}$/,
		)
		expect(
			JSON.stringify({
				keys: runtime.cache.keys(),
				metrics: getCacheOperationsSnapshot(),
				timings,
			}),
		).not.toContain(privateMaterial)
		expect(Object.keys(timings).sort()).toEqual([
			'cache:home-trending-plan',
			'getFreshValue:home-trending-plan',
		])
		expect(getCacheOperationsSnapshot()['home-trending-plan']).toMatchObject({
			miss: 12,
			refresh: 1,
		})
	})

	test('isolates semantic inputs, versions, namespaces, and datasources', async () => {
		const cache = createMemoryCache()
		const firstRuntime = createPublicSurfaceCacheRuntimeForTest({
			cache,
			datasourceUrl:
				'postgresql://first-user:first-secret@db.example.invalid/veud',
		})
		const secondRuntime = createPublicSurfaceCacheRuntimeForTest({
			cache,
			datasourceUrl:
				'postgresql://second-user:second-secret@db.example.invalid/other',
		})
		let sequence = 0
		const fresh = vi.fn(() => ({ ids: [`media-${++sequence}`] }))

		for (const options of [
			fragmentOptions({ runtime: firstRuntime, getFreshValue: fresh }),
			fragmentOptions({
				runtime: firstRuntime,
				keyPayload: { season: 'fall-2026' },
				getFreshValue: fresh,
			}),
			fragmentOptions({
				runtime: firstRuntime,
				keyVersion: 2,
				getFreshValue: fresh,
			}),
			fragmentOptions({
				namespace: 'discovery-facets',
				runtime: firstRuntime,
				getFreshValue: fresh,
			}),
			fragmentOptions({ runtime: secondRuntime, getFreshValue: fresh }),
		]) {
			await getPublicSurfaceFragment(options)
		}

		expect(fresh).toHaveBeenCalledTimes(5)
		expect(cache.keys()).toHaveLength(5)
		for (const key of cache.keys()) {
			expect(key).not.toContain('first-user')
			expect(key).not.toContain('first-secret')
			expect(key).not.toContain('second-user')
			expect(key).not.toContain('second-secret')
			expect(key).not.toContain('summer-2026')
		}
	})

	test('returns cached values until ttl then performs one blocking refresh', async () => {
		vi.useFakeTimers()
		vi.setSystemTime(1_000)
		const runtime = createPublicSurfaceCacheRuntimeForTest()
		let sequence = 0
		const fresh = vi.fn(() => ({ ids: [`media-${++sequence}`] }))
		const options = fragmentOptions({
			ttl: 1_000,
			getFreshValue: fresh,
			runtime,
		})

		await expect(getPublicSurfaceFragment(options)).resolves.toEqual({
			ids: ['media-1'],
		})
		vi.setSystemTime(1_999)
		await expect(getPublicSurfaceFragment(options)).resolves.toEqual({
			ids: ['media-1'],
		})
		vi.setSystemTime(2_001)
		const expiredCalls = Array.from({ length: 8 }, () =>
			getPublicSurfaceFragment(options),
		)
		await expect(Promise.all(expiredCalls)).resolves.toEqual(
			Array.from({ length: 8 }, () => ({ ids: ['media-2'] })),
		)

		expect(fresh).toHaveBeenCalledTimes(2)
	})

	test('rejects invalid fresh values without storing them', async () => {
		const runtime = createPublicSurfaceCacheRuntimeForTest()

		await expect(
			getPublicSurfaceFragment(
				fragmentOptions({
					runtime,
					getFreshValue: () => ({
						ids: ['media-a'],
						privateViewer: 'must-not-be-cached',
					}),
				}),
			),
		).rejects.toThrow()
		expect(runtime.cache.snapshot().entries).toBe(0)
		expect(getCacheOperationsSnapshot()['home-trending-plan']).toMatchObject({
			'refresh-error': 1,
		})
	})

	test('strictly parses bypassed fresh values without recording cache activity', async () => {
		const runtime = createPublicSurfaceCacheRuntimeForTest({ bypass: true })

		await expect(
			getPublicSurfaceFragment(
				fragmentOptions({
					runtime,
					getFreshValue: () => ({
						ids: ['media-a'],
						privateViewer: 'must-not-cross-the-boundary',
					}),
				}),
			),
		).rejects.toThrow()
		expect(runtime.cache.snapshot().entries).toBe(0)
		expect(getCacheOperationsSnapshot()).toEqual({})
	})

	test('evicts invalid cached values and refreshes through the strict parser', async () => {
		const runtime = createPublicSurfaceCacheRuntimeForTest()
		await getPublicSurfaceFragment(fragmentOptions({ runtime }))
		const [key] = runtime.cache.keys()
		if (!key) throw new Error('test setup: expected a cache key')
		runtime.cache.set(key, {
			metadata: { createdTime: Date.now(), ttl: 1_000, swr: 0 },
			value: { ids: ['media-a'], unexpected: 'poison' },
		})
		const fresh = vi.fn(() => ({ ids: ['media-b'] }))

		await expect(
			getPublicSurfaceFragment(
				fragmentOptions({ runtime, getFreshValue: fresh }),
			),
		).resolves.toEqual({ ids: ['media-b'] })
		expect(fresh).toHaveBeenCalledOnce()
		expect(await runtime.cache.get(key)).toMatchObject({
			value: { ids: ['media-b'] },
		})
		expect(getCacheOperationsSnapshot()['home-trending-plan']).toMatchObject({
			invalid: 1,
		})
	})

	test('never returns an expired or invalid value when refresh fails', async () => {
		vi.useFakeTimers()
		vi.setSystemTime(1_000)
		const expiredRuntime = createPublicSurfaceCacheRuntimeForTest()
		await getPublicSurfaceFragment(
			fragmentOptions({ ttl: 100, runtime: expiredRuntime }),
		)
		vi.setSystemTime(1_101)
		await expect(
			getPublicSurfaceFragment(
				fragmentOptions({
					ttl: 100,
					runtime: expiredRuntime,
					getFreshValue() {
						throw new Error('expired refresh failed')
					},
				}),
			),
		).rejects.toThrow('expired refresh failed')

		const invalidRuntime = createPublicSurfaceCacheRuntimeForTest()
		await getPublicSurfaceFragment(fragmentOptions({ runtime: invalidRuntime }))
		const [key] = invalidRuntime.cache.keys()
		if (!key) throw new Error('test setup: expected a cache key')
		invalidRuntime.cache.set(key, {
			metadata: { createdTime: Date.now(), ttl: 1_000, swr: 0 },
			value: { ids: [null] },
		})
		await expect(
			getPublicSurfaceFragment(
				fragmentOptions({
					runtime: invalidRuntime,
					getFreshValue() {
						throw new Error('invalid refresh failed')
					},
				}),
			),
		).rejects.toThrow('invalid refresh failed')
		expect(await invalidRuntime.cache.get(key)).toBeUndefined()
	})

	test('detaches and deeply freezes fresh, cached, and bypassed values', async () => {
		const runtime = createPublicSurfaceCacheRuntimeForTest()
		const producerValue = { ids: ['media-a'] }
		const first = await getPublicSurfaceFragment(
			fragmentOptions({
				runtime,
				getFreshValue: () => producerValue,
			}),
		)
		producerValue.ids[0] = 'producer-poison'
		expect(first).toEqual({ ids: ['media-a'] })
		expect(Object.isFrozen(first)).toBe(true)
		expect(Object.isFrozen(first.ids)).toBe(true)
		expect(Reflect.set(first.ids, '0', 'consumer-poison')).toBe(false)

		const second = await getPublicSurfaceFragment(
			fragmentOptions({
				runtime,
				getFreshValue: () => ({ ids: ['unexpected'] }),
			}),
		)
		expect(second).toEqual({ ids: ['media-a'] })
		expect(second).not.toBe(first)
		expect(second.ids).not.toBe(first.ids)
		expect(Object.isFrozen(second)).toBe(true)
		expect(Object.isFrozen(second.ids)).toBe(true)

		const bypassed = await getPublicSurfaceFragment(
			fragmentOptions({
				runtime: createPublicSurfaceCacheRuntimeForTest({ bypass: true }),
			}),
		)
		expect(Object.isFrozen(bypassed)).toBe(true)
		expect(Object.isFrozen(bypassed.ids)).toBe(true)
	})

	test('records aggregate metrics for every family without payload data', async () => {
		const privateText = 'private-member-id'
		const runtime = createPublicSurfaceCacheRuntimeForTest()
		for (const namespace of publicSurfaceCacheNamespaces) {
			await getPublicSurfaceFragment(
				fragmentOptions({
					namespace,
					keyPayload: { privateText },
					runtime,
				}),
			)
		}

		const snapshot = getCacheOperationsSnapshot()
		expect(Object.keys(snapshot).sort()).toEqual(
			[...publicSurfaceCacheNamespaces].sort(),
		)
		for (const namespace of publicSurfaceCacheNamespaces) {
			expect(snapshot[namespace]).toMatchObject({
				miss: 1,
				refresh: 1,
			})
		}
		expect(JSON.stringify(snapshot)).not.toContain(privateText)
	})
})
