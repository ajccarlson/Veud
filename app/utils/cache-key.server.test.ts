import { describe, expect, test } from 'vitest'
import {
	cacheDatasourceIdentity,
	canonicalCachePayload,
	createOpaqueCacheKey,
	isOpaqueCacheKey,
	type OpaqueCacheKey,
} from './cache-key.server.ts'

const sqliteUrl = 'file:./tests/prisma/cache-key.db?connection_limit=1'

describe('canonical cache payloads', () => {
	test('sorts object keys recursively while preserving array order', () => {
		expect(
			canonicalCachePayload({
				z: [{ second: 2, first: 1 }],
				a: { truthy: true, empty: null },
			}),
		).toBe('{"a":{"empty":null,"truthy":true},"z":[{"first":1,"second":2}]}')
		expect(canonicalCachePayload({ values: ['a', 'b'] })).not.toBe(
			canonicalCachePayload({ values: ['b', 'a'] }),
		)
		expect(canonicalCachePayload({ value: -0 })).toBe('{"value":0}')
	})

	test.each([
		['undefined', { value: undefined }],
		['NaN', { value: Number.NaN }],
		['infinity', { value: Number.POSITIVE_INFINITY }],
		['bigint', { value: 1n }],
		['date', { value: new Date('2026-07-28T00:00:00.000Z') }],
		['function', { value: () => undefined }],
	])('rejects %s instead of silently coercing it', (_label, value) => {
		expect(() => canonicalCachePayload(value)).toThrow(TypeError)
	})

	test('rejects cycles, sparse arrays, accessors, and oversized payloads', () => {
		const cycle: Record<string, unknown> = {}
		cycle.self = cycle
		expect(() => canonicalCachePayload(cycle)).toThrow('cycles')

		const sparse = Array.from({ length: 2 }) as unknown[]
		delete sparse[0]
		expect(() => canonicalCachePayload(sparse)).toThrow('empty slots')

		const accessor = Object.defineProperty({}, 'secret', {
			enumerable: true,
			get: () => 'not-evaluated',
		})
		expect(() => canonicalCachePayload(accessor)).toThrow('accessors')

		expect(() => canonicalCachePayload('x'.repeat(65 * 1024))).toThrow(
			'canonical JSON limits',
		)
	})

	test('rejects array accessors without executing them', () => {
		let accesses = 0
		const accessor = Object.defineProperty([], '0', {
			enumerable: true,
			get: () => {
				accesses += 1
				return 'not-evaluated'
			},
		})

		expect(() => canonicalCachePayload(accessor)).toThrow('accessors')
		expect(accesses).toBe(0)
	})

	test('rejects hidden object properties instead of colliding with an empty object', () => {
		const hidden = Object.defineProperty({}, 'private', {
			enumerable: false,
			value: 'must-not-be-omitted',
		})

		expect(canonicalCachePayload({})).toBe('{}')
		expect(() => canonicalCachePayload(hidden)).toThrow('non-enumerable values')
	})

	test('rejects hidden object accessors without executing them', () => {
		let accesses = 0
		const hiddenAccessor = Object.defineProperty({}, 'private', {
			enumerable: false,
			get: () => {
				accesses += 1
				return 'must-not-be-evaluated'
			},
		})

		expect(() => canonicalCachePayload(hiddenAccessor)).toThrow('accessors')
		expect(accesses).toBe(0)
	})

	test('rejects enumerable numeric-looking array properties instead of omitting them', () => {
		const ordinary = ['value']
		const disguised = Object.defineProperty(['value'], '4294967295', {
			enumerable: true,
			value: 'must-not-be-omitted',
		})

		expect(() => canonicalCachePayload(disguised)).toThrow('indexed values')
		expect(() => canonicalCachePayload(disguised)).toThrow(TypeError)
		expect(canonicalCachePayload(ordinary)).toBe('["value"]')
	})

	test('rejects hidden array values while allowing the built-in length property', () => {
		const ordinary = ['value']
		const hiddenIndex = Object.defineProperty([], '0', {
			enumerable: false,
			value: 'must-not-be-omitted',
		})
		const hiddenExtra = Object.defineProperty(['value'], 'private', {
			enumerable: false,
			value: 'must-not-be-omitted',
		})

		expect(canonicalCachePayload(ordinary)).toBe('["value"]')
		expect(() => canonicalCachePayload(hiddenIndex)).toThrow(
			'non-enumerable values',
		)
		expect(() => canonicalCachePayload(hiddenExtra)).toThrow(
			'non-enumerable values',
		)
	})

	test('rejects hidden array accessors without executing them', () => {
		let accesses = 0
		const hiddenAccessor = Object.defineProperty(['value'], 'private', {
			enumerable: false,
			get: () => {
				accesses += 1
				return 'must-not-be-evaluated'
			},
		})

		expect(() => canonicalCachePayload(hiddenAccessor)).toThrow('accessors')
		expect(accesses).toBe(0)
	})
})

describe('cache datasource identity', () => {
	test('normalizes SQLite paths and ignores connection tuning', () => {
		expect(
			cacheDatasourceIdentity(
				'file:./tests/prisma/../prisma/cache-key.db?connection_limit=1',
			),
		).toBe(
			cacheDatasourceIdentity(
				'file:./tests/prisma/cache-key.db?connection_limit=20',
			),
		)
		expect(cacheDatasourceIdentity('file::memory:')).toContain(':memory:')
		expect(
			cacheDatasourceIdentity('file:./tests/prisma/other-cache-key.db'),
		).not.toBe(cacheDatasourceIdentity(sqliteUrl))
	})

	test('resolves relative SQLite URLs from the Prisma schema directory', () => {
		const sqliteBasePath = '/repo/prisma'
		const relative = cacheDatasourceIdentity('file:./data.db', {
			sqliteBasePath,
		})
		const schemaAbsolute = cacheDatasourceIdentity(
			'file:/repo/prisma/data.db',
			{ sqliteBasePath },
		)
		const repositoryAbsolute = cacheDatasourceIdentity('file:/repo/data.db', {
			sqliteBasePath,
		})

		expect(JSON.parse(relative)).toMatchObject({
			provider: 'sqlite',
			database: '/repo/prisma/data.db',
		})
		expect(relative).toBe(schemaAbsolute)
		expect(relative).not.toBe(repositoryAbsolute)
	})

	test('normalizes PostgreSQL aliases, credentials, host case, and default port', () => {
		const first = cacheDatasourceIdentity(
			'postgresql://alice:first-secret@DB.EXAMPLE.invalid/veud?schema=public&sslmode=require',
		)
		const rotated = cacheDatasourceIdentity(
			'postgres://bob:second-secret@db.example.invalid:5432/veud?schema=public&sslmode=disable',
		)
		expect(rotated).toBe(first)
		expect(first).not.toContain('alice')
		expect(first).not.toContain('first-secret')
		expect(first).not.toContain('sslmode')
	})

	test('distinguishes database, schema, host, port, and SQLite memory modes', () => {
		const base = cacheDatasourceIdentity(
			'postgresql://user:secret@db.example.invalid/veud?schema=public',
		)
		for (const candidate of [
			'postgresql://user:secret@other.example.invalid/veud?schema=public',
			'postgresql://user:secret@db.example.invalid:5433/veud?schema=public',
			'postgresql://user:secret@db.example.invalid/other?schema=public',
			'postgresql://user:secret@db.example.invalid/veud?schema=tenant',
		]) {
			expect(cacheDatasourceIdentity(candidate)).not.toBe(base)
		}
		expect(
			cacheDatasourceIdentity('file:memory?mode=memory&cache=shared'),
		).not.toBe(cacheDatasourceIdentity('file:memory?mode=memory&cache=private'))
	})

	test.each([
		'file:memory?mode=memory&mode=ro',
		'file:memory?cache=shared&cache=private',
		'postgresql://user:secret@db.example.invalid/veud?schema=public&schema=private',
		'postgresql://user:secret@db.example.invalid/veud?host=%2Ffirst&host=%2Fsecond',
	])('rejects duplicate identity parameters: %s', databaseUrl => {
		expect(() => cacheDatasourceIdentity(databaseUrl)).toThrow(
			'DATABASE_URL is not a supported datasource URL',
		)
	})

	test.each([
		undefined,
		'',
		' postgres://user:secret@example.invalid/veud',
		'https://user:secret@example.invalid/veud',
		'postgresql://user:secret@example.invalid/',
		'file:',
		'file://server/share/cache.db',
	])('rejects unsupported datasources without reflecting input: %s', value => {
		let error: unknown
		try {
			cacheDatasourceIdentity(value)
		} catch (caught) {
			error = caught
		}
		expect(error).toBeInstanceOf(TypeError)
		expect(String(error)).not.toContain('secret')
		expect(String(error)).not.toContain('example.invalid')
	})
})

describe('opaque cache keys', () => {
	function key(
		overrides: Partial<Parameters<typeof createOpaqueCacheKey>[0]> = {},
	) {
		return createOpaqueCacheKey({
			namespace: 'discovery',
			version: 1,
			scope: { kind: 'public' },
			payload: {
				query: 'a private search phrase',
				filters: { kind: 'movie', page: 1 },
			},
			datasourceUrl:
				'postgresql://cache-user:database-secret@db.example.invalid/veud',
			...overrides,
		})
	}

	test('is branded, fixed-format, deterministic, and canonical', () => {
		const first = key()
		const branded: OpaqueCacheKey = first
		const reordered = key({
			payload: {
				filters: { page: 1, kind: 'movie' },
				query: 'a private search phrase',
			},
		})
		expect(first).toBe(reordered)
		expect(branded).toMatch(/^ck1_discovery_v1_[A-Za-z0-9_-]{43}$/)
		expect(isOpaqueCacheKey(first)).toBe(true)
		expect(isOpaqueCacheKey(first, 'discovery')).toBe(true)
	})

	test('exposes only namespace and version while hashing private material', () => {
		const first = key({
			scope: { kind: 'viewer', viewerId: 'viewer-private-id' },
		})
		for (const secret of [
			'viewer',
			'viewer-private-id',
			'a private search phrase',
			'cache-user',
			'database-secret',
			'db.example.invalid',
			'veud',
		]) {
			expect(first).not.toContain(secret)
		}
		expect(first).toMatch(/^ck1_discovery_v1_/)
	})

	test('separates public, viewer, and distinct viewer scopes automatically', () => {
		const publicKey = key({ scope: { kind: 'public' } })
		const viewerA = key({
			scope: { kind: 'viewer', viewerId: 'viewer-a' },
		})
		const viewerB = key({
			scope: { kind: 'viewer', viewerId: 'viewer-b' },
		})

		expect(viewerA).not.toBe(publicKey)
		expect(viewerB).not.toBe(publicKey)
		expect(viewerA).not.toBe(viewerB)
		expect(key({ scope: { kind: 'viewer', viewerId: 'viewer-a' } })).toBe(
			viewerA,
		)
	})

	test('changes for every semantic key dimension but not credential rotation', () => {
		const base = key()
		for (const candidate of [
			key({ namespace: 'recommendations' }),
			key({ version: 2 }),
			key({ scope: { kind: 'viewer', viewerId: 'viewer-a' } }),
			key({ payload: { filters: { kind: 'tv', page: 1 } } }),
			key({
				datasourceUrl:
					'postgresql://cache-user:database-secret@db.example.invalid/other',
			}),
		]) {
			expect(candidate).not.toBe(base)
		}
		expect(
			key({
				datasourceUrl:
					'postgres://rotated-user:new-secret@DB.EXAMPLE.invalid:5432/veud?sslmode=require',
			}),
		).toBe(base)
	})

	test('keeps namespace and version inside the digest as well as the prefix', () => {
		const digest = (value: OpaqueCacheKey) => value.split('_').at(-1)

		expect(digest(key({ namespace: 'recommendations' }))).not.toBe(
			digest(key()),
		)
		expect(digest(key({ version: 2 }))).not.toBe(digest(key()))
	})

	test('threads the SQLite schema base through opaque key construction', () => {
		const input = {
			namespace: 'discovery',
			version: 1,
			scope: { kind: 'public' },
			payload: { kind: 'movie' },
			sqliteBasePath: '/repo/prisma',
		} as const
		const relative = createOpaqueCacheKey({
			...input,
			datasourceUrl: 'file:./data.db',
		})
		const schemaAbsolute = createOpaqueCacheKey({
			...input,
			datasourceUrl: 'file:/repo/prisma/data.db',
		})
		const repositoryAbsolute = createOpaqueCacheKey({
			...input,
			datasourceUrl: 'file:/repo/data.db',
		})

		expect(relative).toBe(schemaAbsolute)
		expect(relative).not.toBe(repositoryAbsolute)
	})

	test.each([
		{ namespace: '', version: 1 },
		{ namespace: 'Contains-private-text', version: 1 },
		{ namespace: 'private_text', version: 1 },
		{ namespace: 'valid', version: 0 },
		{ namespace: 'valid', version: Number.NaN },
	])('rejects invalid labels and versions', invalid => {
		expect(() =>
			key({
				namespace: invalid.namespace,
				version: invalid.version,
			}),
		).toThrow(TypeError)
	})

	test.each([
		{ kind: 'viewer' },
		{ kind: 'viewer', viewerId: '' },
		{ kind: 'viewer', viewerId: ' padded' },
		{ kind: 'viewer', viewerId: 'x'.repeat(513) },
		{ kind: 'public', viewerId: 'must-not-be-ignored' },
		{ kind: 'other' },
	])('rejects an invalid or ambiguous scope: %o', scope => {
		expect(() => key({ scope: scope as never })).toThrow(
			'Cache key scope is invalid',
		)
	})

	test('rejects scope accessors without executing them', () => {
		let accesses = 0
		const scope = Object.defineProperty({}, 'kind', {
			enumerable: true,
			get: () => {
				accesses += 1
				return 'public'
			},
		})

		expect(() => key({ scope: scope as never })).toThrow(
			'Cache key scope is invalid',
		)
		expect(accesses).toBe(0)
	})

	test.each([
		undefined,
		null,
		'',
		'ck1_discovery_v1_short',
		`ck2_discovery_v1_${'a'.repeat(43)}`,
		`ck1_Discovery_v1_${'a'.repeat(43)}`,
		`ck1_discovery_v0_${'a'.repeat(43)}`,
		`ck1_discovery_v1000000001_${'a'.repeat(43)}`,
		`ck1_discovery_v1_${'a'.repeat(44)}`,
		`ck1_discovery_v1_${'a'.repeat(43)}_extra`,
	])('runtime matcher rejects malformed keys: %s', value => {
		expect(isOpaqueCacheKey(value)).toBe(false)
	})

	test('runtime matcher enforces an expected safe namespace', () => {
		const value = key()

		expect(isOpaqueCacheKey(value, 'discovery')).toBe(true)
		expect(isOpaqueCacheKey(value, 'recommendations')).toBe(false)
		expect(isOpaqueCacheKey(value, 'invalid_namespace')).toBe(false)
	})
})
