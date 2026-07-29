import { createHash } from 'node:crypto'
import { z } from 'zod'
import {
	canonicalCachePayload,
	createOpaqueCacheKey,
	type CacheKeyScope,
	type CanonicalCacheValue,
} from './cache-key.server.ts'
import {
	cachifiedSafely,
	createMemoryCache,
	type InspectableMemoryCache,
} from './cache.server.ts'

const RANKED_DISCOVERY_CACHE_NAMESPACE = 'ranked-discovery'
const RANKED_DISCOVERY_CACHE_KEY_VERSION = 1
const VIEWER_FINGERPRINT_PATTERN = /^rdf1_[A-Za-z0-9_-]{43}$/
const MEDIA_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
const MAX_VIEWER_ID_BYTES = 512

export const RANKED_DISCOVERY_CACHE_TTL_MS = 2 * 60 * 1_000
export const RANKED_DISCOVERY_PLAN_MAX_IDS = 1_000

const publicScopeSchema = z
	.object({
		kind: z.literal('public'),
	})
	.strict()

const viewerScopeSchema = z
	.object({
		kind: z.literal('viewer'),
		viewerId: z
			.string()
			.min(1)
			.refine(value => value === value.trim(), {
				message: 'viewerId must not have surrounding whitespace',
			})
			.refine(
				value => Buffer.byteLength(value, 'utf8') <= MAX_VIEWER_ID_BYTES,
				{
					message: 'viewerId is too long',
				},
			),
	})
	.strict()

const rankedDiscoveryScopeSchema = z.union([
	publicScopeSchema,
	viewerScopeSchema,
])

const rankedSortSchema = z.enum(['popular', 'top-rated'])
const viewerRankedSortSchema = z.literal('for-you')
const viewerFingerprintSchema = z.string().regex(VIEWER_FINGERPRINT_PATTERN)

function exactString(minimum: number, maximum: number) {
	return z
		.string()
		.min(minimum)
		.max(maximum)
		.refine(value => value === value.trim(), {
			message: 'value must not have surrounding whitespace',
		})
}

const standardRequestShape = {
	source: z.literal('standard'),
	q: exactString(0, 100),
	kind: z.enum(['all', 'movie', 'tv', 'anime', 'manga']),
	genre: exactString(0, 80),
	year: z.number().int().min(1870).max(2200).nullable(),
	status: exactString(0, 60),
	provider: z.enum(['all', 'tmdb', 'mal']),
}

const standardPublicRequestSchema = z
	.object({
		...standardRequestShape,
		sort: rankedSortSchema,
	})
	.strict()

const standardViewerRequestSchema = z
	.object({
		...standardRequestShape,
		sort: viewerRankedSortSchema,
		viewerFingerprint: viewerFingerprintSchema,
	})
	.strict()

const naturalRequestShape = {
	source: z.literal('natural'),
	kinds: z
		.array(z.enum(['movie', 'tv', 'anime', 'manga']))
		.min(1)
		.max(4),
	includeGenres: z.array(exactString(1, 80)).max(8),
	excludeGenres: z.array(exactString(1, 80)).max(8),
	includeTerms: z.array(exactString(2, 80)).max(12),
	excludeTerms: z.array(exactString(2, 80)).max(12),
	yearFrom: z.number().int().min(1870).max(2200).nullable(),
	yearTo: z.number().int().min(1870).max(2200).nullable(),
	releaseStatus: z
		.enum(['upcoming', 'ongoing', 'completed', 'hiatus', 'cancelled'])
		.nullable(),
	language: exactString(2, 60).nullable(),
	toneTerms: z.array(exactString(2, 80)).max(6),
	pace: z.enum(['slow', 'moderate', 'fast']).nullable(),
	lengthUnit: z.enum(['minutes', 'episodes', 'chapters', 'volumes']).nullable(),
	lengthFrom: z.number().int().min(0).max(1_000_000).nullable(),
	lengthTo: z.number().int().min(0).max(1_000_000).nullable(),
}

const naturalPublicRequestSchema = z
	.object({
		...naturalRequestShape,
		sort: rankedSortSchema,
	})
	.strict()

const naturalViewerRequestSchema = z
	.object({
		...naturalRequestShape,
		sort: viewerRankedSortSchema,
		viewerFingerprint: viewerFingerprintSchema,
	})
	.strict()

const rankedDiscoveryPlanRequestSchema = z
	.union([
		standardPublicRequestSchema,
		standardViewerRequestSchema,
		naturalPublicRequestSchema,
		naturalViewerRequestSchema,
	])
	.superRefine((request, context) => {
		if (request.source !== 'natural') return
		const includedGenres = new Set(
			request.includeGenres.map(value => value.toLocaleLowerCase('en-US')),
		)
		const excludedGenres = new Set(
			request.excludeGenres.map(value => value.toLocaleLowerCase('en-US')),
		)
		const includedTerms = new Set(
			[...request.includeTerms, ...request.toneTerms].map(value =>
				value.toLocaleLowerCase('en-US'),
			),
		)
		const excludedTerms = new Set(
			request.excludeTerms.map(value => value.toLocaleLowerCase('en-US')),
		)
		if ([...includedGenres].some(value => excludedGenres.has(value))) {
			context.addIssue({
				code: 'custom',
				path: ['excludeGenres'],
				message: 'a genre cannot be both included and excluded',
			})
		}
		if ([...includedTerms].some(value => excludedTerms.has(value))) {
			context.addIssue({
				code: 'custom',
				path: ['excludeTerms'],
				message: 'a concept cannot be both included and excluded',
			})
		}
		if (
			request.yearFrom !== null &&
			request.yearTo !== null &&
			request.yearFrom > request.yearTo
		) {
			context.addIssue({
				code: 'custom',
				path: ['yearTo'],
				message: 'yearTo must be greater than or equal to yearFrom',
			})
		}
		if (
			(request.lengthFrom !== null || request.lengthTo !== null) &&
			request.lengthUnit === null
		) {
			context.addIssue({
				code: 'custom',
				path: ['lengthUnit'],
				message: 'lengthUnit is required when a length bound is supplied',
			})
		}
		if (
			request.lengthFrom !== null &&
			request.lengthTo !== null &&
			request.lengthFrom > request.lengthTo
		) {
			context.addIssue({
				code: 'custom',
				path: ['lengthTo'],
				message: 'lengthTo must be greater than or equal to lengthFrom',
			})
		}
		const compatibleKinds = {
			minutes: ['movie', 'tv', 'anime'],
			episodes: ['tv', 'anime'],
			chapters: ['manga'],
			volumes: ['manga'],
		} as const
		const allowedKinds: readonly string[] = request.lengthUnit
			? compatibleKinds[request.lengthUnit]
			: []
		if (
			request.lengthUnit &&
			request.kinds.some(kind => !allowedKinds.includes(kind))
		) {
			context.addIssue({
				code: 'custom',
				path: ['lengthUnit'],
				message:
					'length bounds are incompatible with one or more selected media kinds',
			})
		}
	})

const rankedDiscoveryPlanSchema = z
	.object({
		ids: z
			.array(z.string().regex(MEDIA_ID_PATTERN))
			.max(RANKED_DISCOVERY_PLAN_MAX_IDS),
	})
	.strict()
	.superRefine((plan, context) => {
		const ids = new Set<string>()
		for (const [index, id] of plan.ids.entries()) {
			if (ids.has(id)) {
				context.addIssue({
					code: 'custom',
					path: ['ids', index],
					message: 'ranked discovery IDs must be unique',
				})
			}
			ids.add(id)
		}
	})

type DeepReadonly<Value> = Value extends readonly (infer Item)[]
	? readonly DeepReadonly<Item>[]
	: Value extends object
		? { readonly [Key in keyof Value]: DeepReadonly<Value[Key]> }
		: Value

export type RankedDiscoveryPlanRequest = DeepReadonly<
	z.infer<typeof rankedDiscoveryPlanRequestSchema>
>
export type RankedDiscoveryPlan = Readonly<{
	ids: readonly string[]
}>

function canonicalClone(value: unknown) {
	return JSON.parse(canonicalCachePayload(value)) as unknown
}

function parseRequest(value: unknown): RankedDiscoveryPlanRequest {
	const request = rankedDiscoveryPlanRequestSchema.parse(canonicalClone(value))
	if (request.source === 'standard') return Object.freeze(request)
	return Object.freeze({
		...request,
		// Preserve exact array order and cardinality: the producer receives this
		// immutable request, so its complete semantics and the key cannot diverge.
		kinds: Object.freeze([...request.kinds]),
		includeGenres: Object.freeze([...request.includeGenres]),
		excludeGenres: Object.freeze([...request.excludeGenres]),
		includeTerms: Object.freeze([...request.includeTerms]),
		excludeTerms: Object.freeze([...request.excludeTerms]),
		toneTerms: Object.freeze([...request.toneTerms]),
	})
}

function parseScope(value: unknown): CacheKeyScope {
	return rankedDiscoveryScopeSchema.parse(canonicalClone(value))
}

function parsePlan(value: unknown): RankedDiscoveryPlan {
	const plan = rankedDiscoveryPlanSchema.parse(canonicalClone(value))
	return Object.freeze({
		ids: Object.freeze([...plan.ids]),
	})
}

function assertScopeMatchesRequest(
	request: RankedDiscoveryPlanRequest,
	scope: CacheKeyScope,
) {
	if (request.sort === 'for-you' && scope.kind !== 'viewer') {
		throw new TypeError('For-you ranked discovery plans require viewer scope.')
	}
	if (request.sort !== 'for-you' && scope.kind !== 'public') {
		throw new TypeError('Public ranked discovery plans require public scope.')
	}
}

/**
 * Hash compact, complete viewer taste and exclusion state before it reaches a
 * cache key. The caller owns selecting every semantic input; this boundary
 * ensures those inputs cannot be recovered from the request or cache reports.
 */
export function createRankedDiscoveryViewerFingerprint(
	material: CanonicalCacheValue,
) {
	return `rdf1_${createHash('sha256')
		.update(canonicalCachePayload(material), 'utf8')
		.digest('base64url')}` as const
}

const rankedDiscoveryTestRuntimeBrand = Symbol('ranked-discovery-test-runtime')

export type RankedDiscoveryCacheRuntime = Readonly<{
	bypass: boolean
	cache: InspectableMemoryCache
	datasourceUrl: string
	[rankedDiscoveryTestRuntimeBrand]: true
}>

/**
 * Production callers cannot replace the shared cache or override bypass
 * policy. Tests can use this explicit runtime to verify hits and single-flight
 * behavior while Vitest's default NODE_ENV=test policy remains a hard bypass.
 */
export function createRankedDiscoveryCacheRuntimeForTest({
	bypass = false,
	cache = createMemoryCache({ name: 'ranked-discovery-test-cache' }),
	datasourceUrl = 'file::memory:',
}: {
	bypass?: boolean
	cache?: InspectableMemoryCache
	datasourceUrl?: string
} = {}): RankedDiscoveryCacheRuntime {
	if (process.env.NODE_ENV !== 'test') {
		throw new Error(
			'Ranked discovery cache runtimes can only be created by tests.',
		)
	}
	if (typeof bypass !== 'boolean') {
		throw new TypeError('Ranked discovery cache bypass must be a boolean.')
	}
	return Object.freeze({
		bypass,
		cache,
		datasourceUrl,
		[rankedDiscoveryTestRuntimeBrand]: true as const,
	})
}

function isBypassed(runtime: RankedDiscoveryCacheRuntime | undefined) {
	if (runtime) {
		if (
			process.env.NODE_ENV !== 'test' ||
			runtime[rankedDiscoveryTestRuntimeBrand] !== true
		) {
			throw new Error(
				'Ranked discovery cache runtimes can only be used by tests.',
			)
		}
		return runtime.bypass
	}
	return process.env.NODE_ENV === 'test' || process.env.VEUD_E2E === '1'
}

export async function getRankedDiscoveryPlan({
	request: rawRequest,
	scope: rawScope,
	getFreshValue,
	runtime,
}: {
	request: RankedDiscoveryPlanRequest
	scope: CacheKeyScope
	getFreshValue: (
		request: RankedDiscoveryPlanRequest,
	) => RankedDiscoveryPlan | Promise<RankedDiscoveryPlan>
	runtime?: RankedDiscoveryCacheRuntime
}): Promise<RankedDiscoveryPlan> {
	const request = parseRequest(rawRequest)
	const scope = parseScope(rawScope)
	assertScopeMatchesRequest(request, scope)

	if (isBypassed(runtime)) {
		return parsePlan(await getFreshValue(request))
	}

	const key = createOpaqueCacheKey({
		namespace: RANKED_DISCOVERY_CACHE_NAMESPACE,
		version: RANKED_DISCOVERY_CACHE_KEY_VERSION,
		scope,
		payload: request,
		...(runtime ? { datasourceUrl: runtime.datasourceUrl } : {}),
	})
	const plan = await cachifiedSafely(
		RANKED_DISCOVERY_CACHE_NAMESPACE,
		{
			key,
			ttl: RANKED_DISCOVERY_CACHE_TTL_MS,
			checkValue(value) {
				try {
					parsePlan(value)
					return true
				} catch {
					return false
				}
			},
			getFreshValue: async () => parsePlan(await getFreshValue(request)),
		},
		runtime?.cache,
	)
	return parsePlan(plan)
}
