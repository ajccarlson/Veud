import { createHash } from 'node:crypto'
import path from 'node:path'

const CACHE_KEY_FORMAT_VERSION = 1
const MAX_CANONICAL_BYTES = 64 * 1024
const MAX_CANONICAL_DEPTH = 32
const MAX_CANONICAL_NODES = 10_000
const MAX_VIEWER_ID_BYTES = 512
const CACHE_NAMESPACE_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/
const OPAQUE_CACHE_KEY_PATTERN =
	/^ck1_([a-z0-9][a-z0-9-]{0,63})_v([1-9]\d{0,9})_([A-Za-z0-9_-]{43})$/

declare const opaqueCacheKeyBrand: unique symbol
export type OpaqueCacheKey = string & {
	readonly [opaqueCacheKeyBrand]: true
}

export type CacheKeyScope =
	| { readonly kind: 'public' }
	| { readonly kind: 'viewer'; readonly viewerId: string }

export type CanonicalCacheValue =
	| null
	| boolean
	| number
	| string
	| readonly CanonicalCacheValue[]
	| { readonly [key: string]: CanonicalCacheValue }

function canonicalValue(value: unknown) {
	const activeObjects = new WeakSet<object>()
	let nodes = 0

	function serialize(current: unknown, depth: number): string {
		nodes += 1
		if (nodes > MAX_CANONICAL_NODES || depth > MAX_CANONICAL_DEPTH) {
			throw new TypeError('Cache key payload exceeds canonical JSON limits')
		}

		if (current === null) return 'null'
		if (typeof current === 'string' || typeof current === 'boolean') {
			return JSON.stringify(current)
		}
		if (typeof current === 'number') {
			if (!Number.isFinite(current)) {
				throw new TypeError('Cache key payload contains a non-finite number')
			}
			return JSON.stringify(Object.is(current, -0) ? 0 : current)
		}
		if (typeof current !== 'object') {
			throw new TypeError('Cache key payload is not canonical JSON')
		}

		if (activeObjects.has(current)) {
			throw new TypeError('Cache key payload must not contain cycles')
		}
		activeObjects.add(current)
		try {
			if (Array.isArray(current)) {
				if (Object.getOwnPropertySymbols(current).length) {
					throw new TypeError(
						'Cache key payload arrays must contain only indexed values',
					)
				}
				const descriptors = Object.getOwnPropertyDescriptors(current)
				for (const key of Object.getOwnPropertyNames(current)) {
					if (key === 'length') continue
					const descriptor = descriptors[key]
					if (!descriptor || !('value' in descriptor)) {
						throw new TypeError(
							'Cache key payload arrays must not contain accessors',
						)
					}
					if (!descriptor.enumerable) {
						throw new TypeError(
							'Cache key payload arrays must not contain non-enumerable values',
						)
					}
					if (!/^(?:0|[1-9]\d*)$/.test(key)) {
						throw new TypeError(
							'Cache key payload arrays must contain only indexed values',
						)
					}
					const index = Number(key)
					if (
						!Number.isSafeInteger(index) ||
						index >= 0xffff_ffff ||
						index >= current.length
					) {
						throw new TypeError(
							'Cache key payload arrays must contain only indexed values',
						)
					}
				}
				const values: string[] = []
				for (let index = 0; index < current.length; index += 1) {
					const descriptor = descriptors[String(index)]
					if (!descriptor) {
						throw new TypeError(
							'Cache key payload arrays must not contain empty slots',
						)
					}
					if (!('value' in descriptor)) {
						throw new TypeError(
							'Cache key payload arrays must not contain accessors',
						)
					}
					values.push(serialize(descriptor.value, depth + 1))
				}
				return `[${values.join(',')}]`
			}

			const prototype = Object.getPrototypeOf(current)
			if (prototype !== Object.prototype && prototype !== null) {
				throw new TypeError('Cache key payload must contain only plain objects')
			}
			if (Object.getOwnPropertySymbols(current).length) {
				throw new TypeError(
					'Cache key payload objects must not contain symbol keys',
				)
			}
			const descriptors = Object.getOwnPropertyDescriptors(current)
			const entries = Object.getOwnPropertyNames(current)
				.sort()
				.map(key => {
					const descriptor = descriptors[key]
					if (!descriptor || !('value' in descriptor)) {
						throw new TypeError(
							'Cache key payload objects must not contain accessors',
						)
					}
					if (!descriptor.enumerable) {
						throw new TypeError(
							'Cache key payload objects must not contain non-enumerable values',
						)
					}
					return `${JSON.stringify(key)}:${serialize(
						descriptor.value,
						depth + 1,
					)}`
				})
			return `{${entries.join(',')}}`
		} finally {
			activeObjects.delete(current)
		}
	}

	return serialize(value, 0)
}

/**
 * Produces deterministic JSON for cache-key material. Objects are key-sorted;
 * arrays retain their order. Values outside JSON's lossless scalar/object
 * model are rejected instead of being silently omitted or coerced.
 */
export function canonicalCachePayload(value: unknown) {
	const canonical = canonicalValue(value)
	if (Buffer.byteLength(canonical, 'utf8') > MAX_CANONICAL_BYTES) {
		throw new TypeError('Cache key payload exceeds canonical JSON limits')
	}
	return canonical
}

function requiredCacheNamespace(value: unknown) {
	if (typeof value !== 'string' || !CACHE_NAMESPACE_PATTERN.test(value)) {
		throw new TypeError('Cache key namespace is invalid')
	}
	return value
}

function validCacheKeyVersion(value: unknown): value is number {
	return (
		Number.isSafeInteger(value) &&
		(value as number) >= 1 &&
		(value as number) <= 1_000_000_000
	)
}

function invalidCacheScope(): never {
	throw new TypeError('Cache key scope is invalid')
}

function cacheScopeMaterial(scope: CacheKeyScope): CanonicalCacheValue {
	if (typeof scope !== 'object' || scope === null || Array.isArray(scope)) {
		return invalidCacheScope()
	}
	const prototype = Object.getPrototypeOf(scope)
	if (prototype !== Object.prototype && prototype !== null) {
		return invalidCacheScope()
	}
	if (Object.getOwnPropertySymbols(scope).length) {
		return invalidCacheScope()
	}
	const descriptors = Object.getOwnPropertyDescriptors(scope)
	const propertyNames = Object.getOwnPropertyNames(scope).sort()
	const kindDescriptor = descriptors.kind
	if (!kindDescriptor || !('value' in kindDescriptor)) {
		return invalidCacheScope()
	}

	if (
		kindDescriptor.value === 'public' &&
		propertyNames.length === 1 &&
		propertyNames[0] === 'kind'
	) {
		return { kind: 'public' }
	}
	const viewerIdDescriptor = descriptors.viewerId
	if (
		kindDescriptor.value !== 'viewer' ||
		propertyNames.length !== 2 ||
		propertyNames[0] !== 'kind' ||
		propertyNames[1] !== 'viewerId' ||
		!viewerIdDescriptor ||
		!('value' in viewerIdDescriptor)
	) {
		return invalidCacheScope()
	}
	const viewerId = viewerIdDescriptor.value
	if (
		typeof viewerId !== 'string' ||
		!viewerId.trim() ||
		viewerId !== viewerId.trim() ||
		Buffer.byteLength(viewerId, 'utf8') > MAX_VIEWER_ID_BYTES
	) {
		return invalidCacheScope()
	}
	return { kind: 'viewer', viewerId }
}

function decodeDatasourceComponent(value: string) {
	try {
		return decodeURIComponent(value)
	} catch {
		throw new TypeError('DATABASE_URL is not a supported datasource URL')
	}
}

function uniqueDatasourceParameter(parameters: URLSearchParams, name: string) {
	const values = parameters.getAll(name)
	if (values.length > 1) {
		throw new TypeError('DATABASE_URL is not a supported datasource URL')
	}
	return values[0] ?? null
}

function sqliteDatasourceIdentity(databaseUrl: string, sqliteBasePath: string) {
	const raw = databaseUrl.slice('file:'.length)
	const fragmentIndex = raw.indexOf('#')
	if (fragmentIndex !== -1) {
		throw new TypeError('DATABASE_URL is not a supported datasource URL')
	}
	const queryIndex = raw.indexOf('?')
	const encodedPath = queryIndex === -1 ? raw : raw.slice(0, queryIndex)
	const query = queryIndex === -1 ? '' : raw.slice(queryIndex + 1)
	if (!encodedPath || encodedPath.startsWith('//')) {
		throw new TypeError('DATABASE_URL is not a supported datasource URL')
	}
	const decodedPath = decodeDatasourceComponent(encodedPath)
	if (!decodedPath.trim() || decodedPath !== decodedPath.trim()) {
		throw new TypeError('DATABASE_URL is not a supported datasource URL')
	}

	const parameters = new URLSearchParams(query)
	const mode = uniqueDatasourceParameter(parameters, 'mode')
	const sharedCache = uniqueDatasourceParameter(parameters, 'cache')
	return {
		provider: 'sqlite',
		database:
			decodedPath === ':memory:'
				? decodedPath
				: path.resolve(sqliteBasePath, decodedPath),
		...(mode ? { mode } : {}),
		...(sharedCache ? { cache: sharedCache } : {}),
	}
}

function postgresDatasourceIdentity(databaseUrl: string) {
	let parsed: URL
	try {
		parsed = new URL(databaseUrl)
	} catch {
		throw new TypeError('DATABASE_URL is not a supported datasource URL')
	}
	if (
		(parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') ||
		!parsed.hostname ||
		parsed.hash
	) {
		throw new TypeError('DATABASE_URL is not a supported datasource URL')
	}
	const database = decodeDatasourceComponent(parsed.pathname.slice(1))
	if (
		!database.trim() ||
		database !== database.trim() ||
		database.includes('/')
	) {
		throw new TypeError('DATABASE_URL is not a supported datasource URL')
	}
	const schema =
		uniqueDatasourceParameter(parsed.searchParams, 'schema') ?? 'public'
	if (!schema.trim() || schema !== schema.trim()) {
		throw new TypeError('DATABASE_URL is not a supported datasource URL')
	}
	const socketHost = uniqueDatasourceParameter(parsed.searchParams, 'host')
	if (
		socketHost !== null &&
		(!socketHost.trim() || socketHost !== socketHost.trim())
	) {
		throw new TypeError('DATABASE_URL is not a supported datasource URL')
	}
	return {
		provider: 'postgresql',
		host: parsed.hostname.toLocaleLowerCase('en-US'),
		port: parsed.port ? Number(parsed.port) : 5432,
		database,
		schema,
		...(socketHost ? { socketHost } : {}),
	}
}

/**
 * Returns a stable, credential-free identity for the database addressed by a
 * Prisma SQLite or PostgreSQL datasource URL. Connection tuning, usernames,
 * passwords, and TLS parameters deliberately do not affect the identity.
 */
export function cacheDatasourceIdentity(
	databaseUrl: string | undefined,
	{
		sqliteBasePath = path.resolve(process.cwd(), 'prisma'),
	}: { sqliteBasePath?: string } = {},
) {
	if (
		typeof databaseUrl !== 'string' ||
		!databaseUrl.trim() ||
		databaseUrl !== databaseUrl.trim()
	) {
		throw new TypeError('DATABASE_URL is not a supported datasource URL')
	}
	const identity = databaseUrl.startsWith('file:')
		? sqliteDatasourceIdentity(databaseUrl, path.resolve(sqliteBasePath))
		: postgresDatasourceIdentity(databaseUrl)
	return canonicalCachePayload(identity)
}

export function createOpaqueCacheKey({
	namespace,
	version,
	scope,
	payload,
	datasourceUrl = process.env.DATABASE_URL,
	sqliteBasePath,
}: {
	namespace: string
	version: number
	scope: CacheKeyScope
	payload: CanonicalCacheValue
	datasourceUrl?: string
	sqliteBasePath?: string
}): OpaqueCacheKey {
	const safeNamespace = requiredCacheNamespace(namespace)
	const safeScope = cacheScopeMaterial(scope)
	if (!validCacheKeyVersion(version)) {
		throw new TypeError('Cache key version is invalid')
	}
	const material = canonicalCachePayload({
		namespace: safeNamespace,
		version,
		datasource: cacheDatasourceIdentity(datasourceUrl, { sqliteBasePath }),
		scope: safeScope,
		payload,
	})
	const digest = createHash('sha256')
		.update(material, 'utf8')
		.digest('base64url')
	return `ck${CACHE_KEY_FORMAT_VERSION}_${safeNamespace}_v${version}_${digest}` as OpaqueCacheKey
}

export function isOpaqueCacheKey(
	value: unknown,
	expectedNamespace?: string,
): value is OpaqueCacheKey {
	if (typeof value !== 'string') return false
	const match = OPAQUE_CACHE_KEY_PATTERN.exec(value)
	if (!match) return false
	const [, namespace, version] = match
	if (!validCacheKeyVersion(Number(version))) return false
	if (
		expectedNamespace !== undefined &&
		(!CACHE_NAMESPACE_PATTERN.test(expectedNamespace) ||
			namespace !== expectedNamespace)
	) {
		return false
	}
	return true
}
