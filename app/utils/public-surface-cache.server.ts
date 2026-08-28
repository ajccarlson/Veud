import {
	canonicalCachePayload,
	createOpaqueCacheKey,
	type CanonicalCacheValue,
} from './cache-key.server.ts'
import {
	cachifiedSafely,
	createMemoryCache,
	SAFE_CACHE_MAX_TTL_MS,
	type CacheMetricNamespace,
	type InspectableMemoryCache,
} from './cache.server.ts'
import { type Timings } from './timing.server.ts'

export const publicSurfaceCacheNamespaces = [
	'anonymous-home-summary',
	'home-trending-plan',
	'discovery-facets',
	'root-list-types',
] as const satisfies readonly CacheMetricNamespace[]

export type PublicSurfaceCacheNamespace =
	(typeof publicSurfaceCacheNamespaces)[number]

const publicSurfaceCacheNamespaceSet = new Set<string>(
	publicSurfaceCacheNamespaces,
)
const publicSurfaceCacheRuntimeBrand = Symbol('public-surface-cache-runtime')

export type PublicSurfaceCacheRuntime = Readonly<{
	bypass: boolean
	cache: InspectableMemoryCache
	datasourceUrl: string
	[publicSurfaceCacheRuntimeBrand]: true
}>

type PublicSurfaceFragmentOptions<Value extends CanonicalCacheValue> = {
	namespace: PublicSurfaceCacheNamespace
	keyVersion: number
	keyPayload: CanonicalCacheValue
	ttl: number
	parse: (value: unknown) => Value
	getFreshValue: () => Value | Promise<Value>
	timings?: Timings
	runtime?: PublicSurfaceCacheRuntime
}

function deepFreeze<Value extends CanonicalCacheValue>(value: Value): Value {
	if (value === null || typeof value !== 'object') return value
	if (Array.isArray(value)) {
		for (const child of value as readonly CanonicalCacheValue[]) {
			deepFreeze(child)
		}
	} else {
		for (const child of Object.values(
			value as Readonly<Record<string, CanonicalCacheValue>>,
		)) {
			deepFreeze(child)
		}
	}
	return Object.freeze(value)
}

function canonicalCloneAndFreeze<Value extends CanonicalCacheValue>(
	value: Value,
): Value {
	const canonical = canonicalCachePayload(value)
	if (value === null || typeof value !== 'object') return value
	return deepFreeze(JSON.parse(canonical) as Value)
}

function parseFragment<Value extends CanonicalCacheValue>(
	parse: (value: unknown) => Value,
	value: unknown,
) {
	return canonicalCloneAndFreeze(parse(value))
}

function validateBoundary(input: {
	namespace: PublicSurfaceCacheNamespace
	keyVersion: number
	keyPayload: CanonicalCacheValue
	ttl: number
}) {
	if (!publicSurfaceCacheNamespaceSet.has(input.namespace)) {
		throw new TypeError('Public surface cache namespace is not registered.')
	}
	if (
		!Number.isSafeInteger(input.keyVersion) ||
		input.keyVersion < 1 ||
		input.keyVersion > 1_000_000_000
	) {
		throw new TypeError('Public surface cache key version is invalid.')
	}
	if (
		!Number.isFinite(input.ttl) ||
		input.ttl <= 0 ||
		input.ttl > SAFE_CACHE_MAX_TTL_MS
	) {
		throw new RangeError(
			`Public surface cache ttl must be finite, positive, and no greater than ${SAFE_CACHE_MAX_TTL_MS} milliseconds.`,
		)
	}
	canonicalCachePayload(input.keyPayload)
}

function isBypassed(runtime: PublicSurfaceCacheRuntime | undefined) {
	if (runtime) {
		if (
			process.env.NODE_ENV !== 'test' ||
			runtime[publicSurfaceCacheRuntimeBrand] !== true
		) {
			throw new Error(
				'Public surface cache runtimes can only be used by tests.',
			)
		}
		return runtime.bypass
	}
	return process.env.NODE_ENV === 'test' || process.env.VEUD_E2E === '1'
}

/**
 * Creates an isolated cache runtime for boundary tests. Production callers
 * cannot replace the shared cache or override bypass policy.
 */
export function createPublicSurfaceCacheRuntimeForTest({
	bypass = false,
	cache = createMemoryCache({ name: 'public-surface-test-cache' }),
	datasourceUrl = 'file::memory:',
}: {
	bypass?: boolean
	cache?: InspectableMemoryCache
	datasourceUrl?: string
} = {}): PublicSurfaceCacheRuntime {
	if (process.env.NODE_ENV !== 'test') {
		throw new Error(
			'Public surface cache runtimes can only be created by tests.',
		)
	}
	if (typeof bypass !== 'boolean') {
		throw new TypeError('Public surface cache bypass must be a boolean.')
	}
	return Object.freeze({
		bypass,
		cache,
		datasourceUrl,
		[publicSurfaceCacheRuntimeBrand]: true as const,
	})
}

/**
 * Cache a bounded, schema-owned public fragment. Scope is always public and
 * callers cannot provide raw keys, cache adapters, stale windows, or fallback
 * behavior. The parse callback must reject every value outside the fragment's
 * strict canonical JSON schema.
 */
export async function getPublicSurfaceFragment<
	Value extends CanonicalCacheValue,
>({
	namespace,
	keyVersion,
	keyPayload,
	ttl,
	parse,
	getFreshValue,
	timings,
	runtime,
}: PublicSurfaceFragmentOptions<Value>): Promise<Value> {
	validateBoundary({ namespace, keyVersion, keyPayload, ttl })
	if (typeof parse !== 'function' || typeof getFreshValue !== 'function') {
		throw new TypeError(
			'Public surface cache requires parse and getFreshValue callbacks.',
		)
	}

	if (isBypassed(runtime)) {
		return parseFragment(parse, await getFreshValue())
	}

	const key = createOpaqueCacheKey({
		namespace,
		version: keyVersion,
		scope: { kind: 'public' },
		payload: keyPayload,
		...(runtime ? { datasourceUrl: runtime.datasourceUrl } : {}),
	})
	const value = await cachifiedSafely(
		namespace,
		{
			key,
			ttl,
			timings,
			checkValue(cachedValue) {
				try {
					parseFragment(parse, cachedValue)
					return true
				} catch {
					return false
				}
			},
			getFreshValue: async () => parseFragment(parse, await getFreshValue()),
		},
		runtime?.cache,
	)
	return parseFragment(parse, value)
}
