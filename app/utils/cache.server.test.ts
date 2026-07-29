import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createBatch } from '@epic-web/cachified'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
	createOpaqueCacheKey,
	type OpaqueCacheKey,
} from './cache-key.server.ts'
import {
	cache,
	cacheMetricNamespaces,
	cachifiedSafely,
	createCacheResourceCloser,
	createMemoryCache,
	createSafeCacheReporter,
	createSqliteCacheAdapter,
	createSqliteCacheResource,
	getCacheOperationsSnapshot,
	initializeCacheDatabase,
	pruneCacheDatabase,
	resetCacheResourcesForTest,
	SAFE_CACHE_MAX_TTL_MS,
	type CacheMetricEvent,
	type CacheMetricNamespace,
	type InspectableMemoryCache,
} from './cache.server.ts'

const temporaryDirectories = new Set<string>()

function createTemporaryDirectory() {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'veud-cache-test-'))
	temporaryDirectories.add(directory)
	return directory
}

function cacheEntry<Value>(
	value: Value,
	{
		createdTime = Date.now(),
		ttl = 1_000,
		swr = 0,
	}: {
		createdTime?: number
		ttl?: number | null
		swr?: number | null
	} = {},
) {
	return {
		metadata: { createdTime, ttl, swr },
		value,
	}
}

function opaqueCacheKey({
	namespace = 'ranked-discovery',
	viewerId = 'viewer-a',
	query = 'private search terms',
}: {
	namespace?: 'ranked-discovery' | 'recommendation-graph'
	viewerId?: string
	query?: string
} = {}) {
	return createOpaqueCacheKey({
		namespace,
		version: 1,
		scope: { kind: 'viewer', viewerId },
		payload: { query },
		datasourceUrl: 'postgresql://cache-user:secret@db.example.invalid/veud',
	})
}

afterEach(() => {
	vi.useRealTimers()
	resetCacheResourcesForTest()
	for (const directory of temporaryDirectories) {
		fs.rmSync(directory, { recursive: true, force: true })
	}
	temporaryDirectories.clear()
})

describe('cache resource lifecycle', () => {
	test('does not open its configured database merely by being imported or reset', () => {
		const directory = createTemporaryDirectory()
		const databasePath = path.join(directory, 'lazy-cache.db')
		const moduleUrl = pathToFileURL(
			path.join(process.cwd(), 'app/utils/cache.server.ts'),
		).href

		const result = spawnSync(
			process.execPath,
			[
				'--experimental-strip-types',
				'--input-type=module',
				'--eval',
				`const cacheModule = await import(${JSON.stringify(moduleUrl)}); cacheModule.resetCacheResourcesForTest()`,
			],
			{
				cwd: process.cwd(),
				encoding: 'utf8',
				env: {
					...process.env,
					CACHE_DATABASE_PATH: databasePath,
					NODE_ENV: 'test',
				},
			},
		)

		expect(result.status, result.stderr).toBe(0)
		expect(fs.existsSync(databasePath)).toBe(false)
	})

	test('unified test reset empties an already-opened SQLite singleton', async () => {
		const safeKey = opaqueCacheKey()
		await cache.set('present', cacheEntry('value'))
		await cachifiedSafely('ranked-discovery', {
			key: safeKey,
			ttl: 1_000,
			getFreshValue: () => 'memory value',
		})
		expect(await cache.get('present')).toMatchObject({ value: 'value' })
		expect(getCacheOperationsSnapshot()['ranked-discovery']).toBeDefined()

		resetCacheResourcesForTest()

		expect(await cache.get('present')).toBeNull()
		expect(getCacheOperationsSnapshot()).toEqual({})

		const refresh = vi.fn(() => 'refreshed')
		await expect(
			cachifiedSafely('ranked-discovery', {
				key: safeKey,
				ttl: 1_000,
				getFreshValue: refresh,
			}),
		).resolves.toBe('refreshed')
		expect(refresh).toHaveBeenCalledOnce()
	})

	test('closes the database exactly once', () => {
		let databaseOpen = true
		const clearTimer = vi.fn()
		const closeDatabase = vi.fn(() => {
			databaseOpen = false
		})
		const closeCacheResources = createCacheResourceCloser({
			clearTimer,
			isDatabaseOpen: () => databaseOpen,
			closeDatabase,
		})

		closeCacheResources()
		closeCacheResources()

		expect(clearTimer).toHaveBeenCalledOnce()
		expect(closeDatabase).toHaveBeenCalledOnce()
		expect(databaseOpen).toBe(false)
	})

	test('owns and idempotently closes its SQLite resource', async () => {
		const resource = createSqliteCacheResource({
			databasePath: ':memory:',
			pruneIntervalMs: null,
		})
		await resource.cache.set('present', cacheEntry('value'))

		expect(resource.open).toBe(true)
		expect(resource.keys(10)).toEqual(['present'])
		expect(resource.clear()).toBe(1)
		expect(resource.keys(10)).toEqual([])

		resource.close()
		resource.close()

		expect(resource.open).toBe(false)
		expect(resource.prune()).toBe(0)
		expect(resource.keys(10)).toEqual([])
	})
})

describe('SQLite cache adapter', () => {
	test.each([
		['false', false],
		['zero', 0],
		['empty string', ''],
		['null', null],
	])('round-trips the falsey value %s', async (_label, value) => {
		const db = new Database(':memory:')
		initializeCacheDatabase(db)
		const sqliteCache = createSqliteCacheAdapter(db, {
			now: () => 1_000,
		})

		await sqliteCache.set(
			'falsey',
			cacheEntry(value, { createdTime: 1_000, ttl: 1_000 }),
		)

		expect(await sqliteCache.get('falsey')).toEqual(
			cacheEntry(value, { createdTime: 1_000, ttl: 1_000 }),
		)
		db.close()
	})

	test('serves stale values only inside their SWR window', async () => {
		const db = new Database(':memory:')
		initializeCacheDatabase(db)
		let now = 1_000
		const sqliteCache = createSqliteCacheAdapter(db, { now: () => now })
		await sqliteCache.set(
			'stale',
			cacheEntry('value', { createdTime: 800, ttl: 100, swr: 100 }),
		)

		// Cachified treats the exact expiration endpoint as readable.
		expect(await sqliteCache.get('stale')).toMatchObject({ value: 'value' })
		now = 1_001
		expect(await sqliteCache.get('stale')).toBeNull()
		expect(
			db.prepare('SELECT key FROM cache WHERE key = ?').get('stale'),
		).toBeUndefined()
		db.close()
	})

	test('preserves missing TTL and explicit infinite current or legacy SWR', async () => {
		const db = new Database(':memory:')
		initializeCacheDatabase(db)
		const sqliteCache = createSqliteCacheAdapter(db, {
			now: () => 10_000_000,
		})
		const entries = [
			{
				key: 'missing-ttl',
				entry: { metadata: { createdTime: 1 }, value: 'missing' },
			},
			{
				key: 'infinite-swr',
				entry: {
					metadata: { createdTime: 1, ttl: 10, swr: null },
					value: 'current',
				},
			},
			{
				key: 'infinite-swv',
				entry: {
					metadata: { createdTime: 1, ttl: 10, swv: null },
					value: 'legacy',
				},
			},
		]

		for (const { key, entry } of entries) {
			await sqliteCache.set(key, entry)
			expect(await sqliteCache.get(key)).toMatchObject({ value: entry.value })
		}
		db.close()
	})

	test('deletes malformed serialized rows instead of throwing', async () => {
		const db = new Database(':memory:')
		initializeCacheDatabase(db)
		const sqliteCache = createSqliteCacheAdapter(db)
		const insert = db.prepare(
			'INSERT INTO cache (key, metadata, value) VALUES (?, ?, ?)',
		)
		insert.run('bad-metadata-json', '{', JSON.stringify({ still: 'valid' }))
		insert.run(
			'bad-value-json',
			JSON.stringify({ createdTime: Date.now(), ttl: null }),
			'{',
		)
		insert.run(
			'bad-metadata-shape',
			JSON.stringify({ createdTime: 'yesterday', ttl: null }),
			JSON.stringify('value'),
		)

		expect(await sqliteCache.get('bad-metadata-json')).toBeNull()
		expect(await sqliteCache.get('bad-value-json')).toBeNull()
		expect(await sqliteCache.get('bad-metadata-shape')).toBeNull()
		expect(db.prepare('SELECT COUNT(*) AS count FROM cache').get()).toEqual({
			count: 0,
		})
		db.close()
	})

	test('prunes malformed and fully expired rows in bounded SQL batches', () => {
		const db = new Database(':memory:')
		initializeCacheDatabase(db)
		const insert = db.prepare(
			'INSERT INTO cache (key, metadata, value) VALUES (?, ?, ?)',
		)
		const insertEntry = (
			key: string,
			metadata: Record<string, unknown>,
			value = 'value',
		) => insert.run(key, JSON.stringify(metadata), JSON.stringify(value))

		insertEntry('fresh', { createdTime: 900, ttl: 200, swr: 0 })
		insertEntry('inside-swr', { createdTime: 850, ttl: 100, swr: 100 })
		insertEntry('unbounded-legacy', { createdTime: 0 })
		insertEntry('expired', { createdTime: 700, ttl: 100, swr: 100 })
		insert.run('bad-metadata', '{', JSON.stringify('value'))
		insert.run('bad-value', JSON.stringify({ createdTime: 900, ttl: 200 }), '{')

		expect(pruneCacheDatabase(db, { now: 1_000, limit: 2 })).toBe(2)
		expect(
			(
				db.prepare('SELECT COUNT(*) AS count FROM cache').get() as {
					count: number
				}
			).count,
		).toBe(4)
		expect(pruneCacheDatabase(db, { now: 1_000, limit: 2 })).toBe(1)
		expect(
			db
				.prepare('SELECT key FROM cache ORDER BY key')
				.all()
				.map(row => (row as { key: string }).key),
		).toEqual(['fresh', 'inside-swr', 'unbounded-legacy'])
		db.close()
	})

	test('pruning keeps exact endpoints and infinite stale windows', () => {
		const db = new Database(':memory:')
		initializeCacheDatabase(db)
		const insert = db.prepare(
			'INSERT INTO cache (key, metadata, value) VALUES (?, ?, ?)',
		)
		const insertEntry = (key: string, metadata: Record<string, unknown>) =>
			insert.run(key, JSON.stringify(metadata), JSON.stringify('value'))

		insertEntry('endpoint', { createdTime: 800, ttl: 100, swr: 100 })
		insertEntry('missing-ttl', { createdTime: 1 })
		insertEntry('infinite-swr', { createdTime: 1, ttl: 10, swr: null })
		insertEntry('infinite-swv', { createdTime: 1, ttl: 10, swv: null })

		expect(pruneCacheDatabase(db, { now: 1_000 })).toBe(0)
		expect(pruneCacheDatabase(db, { now: 1_001 })).toBe(1)
		expect(
			db
				.prepare('SELECT key FROM cache ORDER BY key')
				.all()
				.map(row => (row as { key: string }).key),
		).toEqual(['infinite-swr', 'infinite-swv', 'missing-ttl'])
		db.close()
	})

	test('recovers a corrupt regular cache file and restricts its mode', async () => {
		const directory = createTemporaryDirectory()
		const databasePath = path.join(directory, 'cache.db')
		fs.writeFileSync(databasePath, 'not a sqlite database', { mode: 0o644 })

		const resource = createSqliteCacheResource({
			databasePath,
			pruneIntervalMs: null,
		})
		await resource.cache.set('recovered', cacheEntry('yes', { ttl: null }))

		expect(await resource.cache.get('recovered')).toMatchObject({
			value: 'yes',
		})
		expect(fs.statSync(databasePath).mode & 0o777).toBe(0o600)
		resource.close()
	})

	test('recovers corruption first reached by initial pruning and removes regular sidecars', async () => {
		const directory = createTemporaryDirectory()
		const databasePath = path.join(directory, 'partial-cache.db')
		const original = new Database(databasePath)
		initializeCacheDatabase(original)
		original
			.prepare('INSERT INTO cache (key, metadata, value) VALUES (?, ?, ?)')
			.run(
				'old',
				JSON.stringify({ createdTime: 1, ttl: 1, swr: 0 }),
				JSON.stringify('old'),
			)
		const rootPage = original
			.prepare(
				"SELECT rootpage FROM sqlite_master WHERE type = 'table' AND name = 'cache'",
			)
			.pluck()
			.get() as number
		const pageSize = original.pragma('page_size', { simple: true }) as number
		original.close()

		const descriptor = fs.openSync(databasePath, 'r+')
		try {
			// A table b-tree page must begin with a recognized page type. Keep
			// sqlite_master intact so open/schema/adapter preparation still work.
			fs.writeSync(
				descriptor,
				Buffer.from([0]),
				0,
				1,
				(rootPage - 1) * pageSize,
			)
		} finally {
			fs.closeSync(descriptor)
		}

		const probe = new Database(databasePath)
		expect(() => initializeCacheDatabase(probe)).not.toThrow()
		expect(() => createSqliteCacheAdapter(probe)).not.toThrow()
		expect(() => pruneCacheDatabase(probe)).toThrow()
		probe.close()

		for (const suffix of ['-journal', '-wal', '-shm']) {
			fs.writeFileSync(`${databasePath}${suffix}`, 'stale sidecar')
		}
		const resource = createSqliteCacheResource({
			databasePath,
			pruneIntervalMs: null,
		})
		await resource.cache.set('new', cacheEntry('recovered', { ttl: null }))

		expect(await resource.cache.get('new')).toMatchObject({
			value: 'recovered',
		})
		expect(resource.keys(10)).toEqual(['new'])
		for (const suffix of ['-journal', '-wal', '-shm']) {
			expect(fs.existsSync(`${databasePath}${suffix}`)).toBe(false)
		}
		resource.close()
	})

	test('creates missing private parent directories', () => {
		const directory = createTemporaryDirectory()
		const parent = path.join(directory, 'private-cache')
		const resource = createSqliteCacheResource({
			databasePath: path.join(parent, 'cache.db'),
			pruneIntervalMs: null,
		})

		expect(fs.statSync(parent).mode & 0o077).toBe(0)
		expect(fs.statSync(path.join(parent, 'cache.db')).mode & 0o077).toBe(0)
		resource.close()
	})

	test('does not delete a non-corrupt path when opening fails', () => {
		const directory = createTemporaryDirectory()
		const databasePath = path.join(directory, 'cache.db')
		fs.mkdirSync(databasePath)

		expect(() =>
			createSqliteCacheResource({
				databasePath,
				pruneIntervalMs: null,
			}),
		).toThrow()
		expect(fs.statSync(databasePath).isDirectory()).toBe(true)
	})
})

describe('bounded in-memory cache', () => {
	test('restores only the remaining wall-clock TTL', () => {
		const wallClock = new Date('2026-07-28T12:00:00.000Z').getTime()
		let monotonicClock = 500
		const memoryCache = createMemoryCache({
			maxEntries: 10,
			maxSizeBytes: 10_000,
			maxEntrySizeBytes: 5_000,
			now: () => wallClock,
			monotonicNow: () => monotonicClock,
		})

		memoryCache.set(
			'expired',
			cacheEntry('expired', {
				createdTime: wallClock - 2_000,
				ttl: 1_000,
			}),
		)
		expect(memoryCache.get('expired')).toBeUndefined()

		memoryCache.set(
			'fresh',
			cacheEntry('fresh', { createdTime: wallClock - 250, ttl: 1_000 }),
		)
		expect(memoryCache.get('fresh')).toMatchObject({ value: 'fresh' })
		monotonicClock += 749
		expect(memoryCache.get('fresh')).toMatchObject({ value: 'fresh' })
		monotonicClock += 2
		expect(memoryCache.get('fresh')).toBeUndefined()

		memoryCache.set(
			'unbounded',
			cacheEntry('unbounded', { createdTime: wallClock, ttl: null }),
		)
		monotonicClock += 365 * 24 * 60 * 60 * 1_000
		expect(memoryCache.get('unbounded')).toMatchObject({
			value: 'unbounded',
		})
	})

	test('keeps exact endpoints and explicit infinite stale windows', () => {
		let wallClock = 1_000
		let monotonicClock = 500
		const memoryCache = createMemoryCache({
			maxEntries: 10,
			maxSizeBytes: 10_000,
			maxEntrySizeBytes: 5_000,
			now: () => wallClock,
			monotonicNow: () => monotonicClock,
		})

		memoryCache.set(
			'endpoint',
			cacheEntry('endpoint', { createdTime: 900, ttl: 100, swr: 0 }),
		)
		expect(memoryCache.get('endpoint')).toMatchObject({ value: 'endpoint' })
		wallClock += 1
		monotonicClock += 1
		expect(memoryCache.get('endpoint')).toBeUndefined()

		for (const [key, entry] of [
			['missing-ttl', { metadata: { createdTime: 1 }, value: 'missing' }],
			[
				'infinite-swr',
				{
					metadata: { createdTime: 1, ttl: 10, swr: null },
					value: 'current',
				},
			],
			[
				'infinite-swv',
				{
					metadata: { createdTime: 1, ttl: 10, swv: null },
					value: 'legacy',
				},
			],
		] as const) {
			memoryCache.set(key, entry)
			expect(memoryCache.get(key)).toMatchObject({ value: entry.value })
		}
	})

	test('enforces entry-count, total-byte, and per-entry byte bounds', () => {
		const countBounded = createMemoryCache({
			maxEntries: 2,
			maxSizeBytes: 10_000,
			maxEntrySizeBytes: 5_000,
		})
		countBounded.set('one', cacheEntry('one'))
		countBounded.set('two', cacheEntry('two'))
		countBounded.set('three', cacheEntry('three'))
		expect(countBounded.snapshot().entries).toBe(2)
		expect(countBounded.get('one')).toBeUndefined()

		const byteBounded = createMemoryCache({
			maxEntries: 10,
			maxSizeBytes: 300,
			maxEntrySizeBytes: 250,
		})
		byteBounded.set('first', cacheEntry('x'.repeat(100)))
		byteBounded.set('second', cacheEntry('y'.repeat(100)))
		expect(byteBounded.snapshot().entries).toBe(1)
		expect(byteBounded.snapshot().calculatedSizeBytes).toBeLessThanOrEqual(300)
		expect(byteBounded.get('first')).toBeUndefined()
		expect(byteBounded.get('second')).toBeDefined()

		byteBounded.set('oversized', cacheEntry('z'.repeat(500)))
		expect(byteBounded.get('oversized')).toBeUndefined()
	})

	test('rejects unserializable entries and invalid capacities', () => {
		const memoryCache = createMemoryCache({
			maxEntries: 10,
			maxSizeBytes: 1_000,
			maxEntrySizeBytes: 500,
		})
		const circular: { self?: unknown } = {}
		circular.self = circular

		expect(() =>
			memoryCache.set('circular', cacheEntry(circular)),
		).not.toThrow()
		expect(memoryCache.get('circular')).toBeUndefined()
		expect(() =>
			createMemoryCache({
				maxSizeBytes: 100,
				maxEntrySizeBytes: 101,
			}),
		).toThrow(/must not exceed/)
	})

	test('supports bounded inspection and prefix invalidation', () => {
		const memoryCache = createMemoryCache()
		memoryCache.set('rank:movie:one', cacheEntry(1))
		memoryCache.set('rank:movie:two', cacheEntry(2))
		memoryCache.set('rank:anime:one', cacheEntry(3))

		expect(memoryCache.keys(2)).toHaveLength(2)
		expect(memoryCache.deleteByPrefix('rank:movie:')).toBe(2)
		expect(memoryCache.keys().sort()).toEqual(['rank:anime:one'])
	})
})

describe('privacy-safe cache reporting', () => {
	test('accepts only registered static metric families', () => {
		expect(cacheMetricNamespaces).toEqual([
			'anonymous-home-summary',
			'discovery-facets',
			'home-trending-plan',
			'ranked-discovery',
			'recommendation-graph',
		])
		for (const namespace of cacheMetricNamespaces) {
			expect(() => createSafeCacheReporter(namespace)).not.toThrow()
		}
	})

	test('records aggregate event classes without retaining event payloads', () => {
		const privateText = 'viewer-123 secret query'
		const report = createSafeCacheReporter('ranked-discovery')({} as never)
		const events: Array<{
			name: string
			event: Record<string, unknown>
			metric: CacheMetricEvent
		}> = [
			{
				name: 'getCachedValueSuccess',
				event: { value: privateText, migrated: false },
				metric: 'hit',
			},
			{ name: 'getCachedValueEmpty', event: {}, metric: 'miss' },
			{ name: 'getFreshValueStart', event: {}, metric: 'refresh' },
			{
				name: 'getFreshValueError',
				event: { error: new Error(privateText) },
				metric: 'refresh-error',
			},
			{
				name: 'writeFreshValueError',
				event: { error: new Error(privateText) },
				metric: 'write-error',
			},
			{
				name: 'checkCachedValueErrorObj',
				event: { reason: privateText },
				metric: 'invalid',
			},
		]
		for (const { name, event } of events) {
			report({ name, ...event } as never)
		}

		const snapshot = getCacheOperationsSnapshot()
		for (const { metric } of events) {
			expect(snapshot['ranked-discovery'][metric]).toBe(1)
		}
		expect(JSON.stringify(snapshot)).not.toContain(privateText)
		expect(() =>
			createSafeCacheReporter(
				'cmz8q7z5w0001viewerprivate' as CacheMetricNamespace,
			),
		).toThrow(/registered static cache family/)
	})

	test('stores only opaque keys, uses namespace-only timings, and coalesces refreshes', async () => {
		const privateViewer = 'viewer-private-id'
		const privateQuery = 'secret query'
		const key = opaqueCacheKey({
			viewerId: privateViewer,
			query: privateQuery,
		})
		const timings = {}
		const memoryCache = createMemoryCache()
		const getFreshValue = vi.fn(async () => {
			await new Promise(resolve => setTimeout(resolve, 10))
			return { result: 'grounded' }
		})

		const values = await Promise.all(
			Array.from({ length: 20 }, () =>
				cachifiedSafely(
					'ranked-discovery',
					{
						key,
						ttl: 1_000,
						timings,
						getFreshValue,
					},
					memoryCache,
				),
			),
		)

		expect(getFreshValue).toHaveBeenCalledOnce()
		expect(values).toHaveLength(20)
		expect(memoryCache.keys()).toEqual([key])
		const storedEntry = await memoryCache.get(key)
		expect(storedEntry?.metadata.swr).toBe(0)
		const observableState = JSON.stringify({
			keys: memoryCache.keys(),
			timings,
			metrics: getCacheOperationsSnapshot(),
		})
		expect(observableState).not.toContain(privateViewer)
		expect(observableState).not.toContain(privateQuery)
		expect(Object.keys(timings).sort()).toEqual([
			'cache:ranked-discovery',
			'getFreshValue:ranked-discovery',
		])
	})

	test('detaches and deeply freezes canonical ranking plans', async () => {
		const memoryCache = createMemoryCache()
		const key = opaqueCacheKey()
		const originalPlan = {
			pages: [
				{
					ids: ['media-a', 'media-b'],
					scores: [0.9, 0.8],
				},
			],
		}

		const first = await cachifiedSafely(
			'ranked-discovery',
			{
				key,
				ttl: 1_000,
				getFreshValue: () => originalPlan,
			},
			memoryCache,
		)

		expect(Object.isFrozen(first)).toBe(true)
		expect(Object.isFrozen(first.pages)).toBe(true)
		expect(Object.isFrozen(first.pages[0])).toBe(true)
		expect(Object.isFrozen(first.pages[0]?.ids)).toBe(true)
		expect(Reflect.set(first.pages[0]!.ids, '0', 'consumer-poison')).toBe(false)

		originalPlan.pages[0]!.ids[0] = 'producer-poison'
		originalPlan.pages.push({ ids: ['media-c'], scores: [0.7] })

		const unexpectedRefresh = vi.fn(() => originalPlan)
		const second = await cachifiedSafely(
			'ranked-discovery',
			{
				key,
				ttl: 1_000,
				getFreshValue: unexpectedRefresh,
			},
			memoryCache,
		)
		const storedEntry = await memoryCache.get(key)

		expect(unexpectedRefresh).not.toHaveBeenCalled()
		expect(second).toEqual({
			pages: [
				{
					ids: ['media-a', 'media-b'],
					scores: [0.9, 0.8],
				},
			],
		})
		expect(second).not.toBe(first)
		expect(storedEntry?.value).toEqual(second)
		expect(storedEntry?.value).not.toBe(first)
		expect(storedEntry?.value).not.toBe(originalPlan)
	})

	test('rejects noncanonical fresh values without storing them', async () => {
		const memoryCache = createMemoryCache()
		const cyclic: Record<string, unknown> = {}
		cyclic.self = cyclic
		const invalidValues = [
			['undefined', undefined],
			['nested undefined', { ids: [undefined] }],
			['date', new Date()],
			['NaN', Number.NaN],
			['infinity', Infinity],
			['cycle', cyclic],
		] as const

		for (const [label, value] of invalidValues) {
			const key = opaqueCacheKey({ query: `invalid ${label}` })
			await expect(
				cachifiedSafely(
					'ranked-discovery',
					{
						key,
						ttl: 1_000,
						getFreshValue: () => value,
					} as never,
					memoryCache,
				),
			).rejects.toBeInstanceOf(TypeError)
			expect(memoryCache.keys()).not.toContain(key)
		}
	})

	test('sanitizes cached migrations before they can be stored or returned', async () => {
		vi.useFakeTimers()
		vi.setSystemTime(1_000)
		const memoryCache = createMemoryCache()
		const key = opaqueCacheKey()
		await cachifiedSafely(
			'ranked-discovery',
			{
				key,
				ttl: 1_000,
				getFreshValue: () => ({ ids: ['old-id'] }),
			},
			memoryCache,
		)

		const migratedPlan = {
			ids: ['new-id'],
			evidence: { source: 'migration' },
		}
		const migrated = await cachifiedSafely(
			'ranked-discovery',
			{
				key,
				ttl: 1_000,
				getFreshValue: () => ({ ids: ['unexpected'] }),
				checkValue(_value, migrate) {
					return migrate(migratedPlan)
				},
			},
			memoryCache,
		)
		expect(Object.isFrozen(migrated)).toBe(true)
		expect(Object.isFrozen(migrated.ids)).toBe(true)
		migratedPlan.ids[0] = 'migration-poison'

		await vi.runAllTimersAsync()
		expect((await memoryCache.get(key))?.value).toEqual({
			ids: ['new-id'],
			evidence: { source: 'migration' },
		})

		const nextHit = await cachifiedSafely(
			'ranked-discovery',
			{
				key,
				ttl: 1_000,
				getFreshValue: () => ({ ids: ['unexpected'] }),
			},
			memoryCache,
		)
		expect(nextHit).toEqual({
			ids: ['new-id'],
			evidence: { source: 'migration' },
		})
	})

	test('does not store an invalid cached migration', async () => {
		const memoryCache = createMemoryCache()
		const key = opaqueCacheKey()
		await cachifiedSafely(
			'ranked-discovery',
			{
				key,
				ttl: 1_000,
				getFreshValue: () => ({ ids: ['stable-id'] }),
			},
			memoryCache,
		)
		const cyclic: Record<string, unknown> = {}
		cyclic.self = cyclic

		await expect(
			cachifiedSafely(
				'ranked-discovery',
				{
					key,
					ttl: 1_000,
					getFreshValue() {
						throw new Error('refresh after invalid migration')
					},
					checkValue(_value, migrate) {
						return migrate(cyclic as never)
					},
				},
				memoryCache,
			),
		).rejects.toThrow('refresh after invalid migration')
		expect(memoryCache.keys()).not.toContain(key)
	})

	test('separates otherwise-identical viewer scopes', async () => {
		const memoryCache = createMemoryCache()
		const viewerAKey = opaqueCacheKey({ viewerId: 'viewer-a' })
		const viewerBKey = opaqueCacheKey({ viewerId: 'viewer-b' })
		expect(viewerAKey).not.toBe(viewerBKey)

		await cachifiedSafely(
			'ranked-discovery',
			{
				key: viewerAKey,
				ttl: 1_000,
				getFreshValue: () => 'viewer-a-result',
			},
			memoryCache,
		)
		await cachifiedSafely(
			'ranked-discovery',
			{
				key: viewerBKey,
				ttl: 1_000,
				getFreshValue: () => 'viewer-b-result',
			},
			memoryCache,
		)
		const unexpectedRefresh = vi.fn(() => 'wrong')
		const viewerAResult = await cachifiedSafely(
			'ranked-discovery',
			{
				key: viewerAKey,
				ttl: 1_000,
				getFreshValue: unexpectedRefresh,
			},
			memoryCache,
		)

		expect(viewerAResult).toBe('viewer-a-result')
		expect(unexpectedRefresh).not.toHaveBeenCalled()
		expect(memoryCache.keys().sort()).toEqual([viewerAKey, viewerBKey].sort())
	})

	test('rejects raw or mismatched keys and unsafe cache options', async () => {
		const memoryCache = createMemoryCache()
		const rankedKey = opaqueCacheKey()
		const graphKey = opaqueCacheKey({
			namespace: 'recommendation-graph',
		})
		const baseOptions = {
			key: rankedKey,
			ttl: 1_000,
			getFreshValue: () => 'value',
		}

		await expect(
			cachifiedSafely(
				'ranked-discovery',
				{
					...baseOptions,
					key: 'viewer-123:secret query' as OpaqueCacheKey,
				},
				memoryCache,
			),
		).rejects.toThrow(/does not match/)
		await expect(
			cachifiedSafely(
				'ranked-discovery',
				{ ...baseOptions, key: graphKey },
				memoryCache,
			),
		).rejects.toThrow(/does not match/)

		for (const [option, value] of [
			['cache', memoryCache],
			['fallbackToCache', true],
			['staleRefreshTimeout', 1],
			['staleWhileRevalidate', 1],
			['swr', 1],
			['traceId', 'viewer-private-id'],
		] as const) {
			await expect(
				cachifiedSafely(
					'ranked-discovery',
					{ ...baseOptions, [option]: value } as never,
					memoryCache,
				),
			).rejects.toThrow(option)
		}
		await expect(
			cachifiedSafely(
				'ranked-discovery',
				baseOptions,
				{} as InspectableMemoryCache,
			),
		).rejects.toThrow(/inspectable memory caches/)
	})

	test('requires a finite positive ttl no greater than five minutes', async () => {
		const memoryCache = createMemoryCache()
		const baseOptions = {
			key: opaqueCacheKey(),
			getFreshValue: () => 'value',
		}

		for (const ttl of [
			undefined,
			Infinity,
			Number.NaN,
			0,
			-1,
			SAFE_CACHE_MAX_TTL_MS + 1,
		]) {
			await expect(
				cachifiedSafely(
					'ranked-discovery',
					{ ...baseOptions, ttl } as never,
					memoryCache,
				),
			).rejects.toThrow(/ttl must be finite, positive/)
		}

		await expect(
			cachifiedSafely(
				'ranked-discovery',
				{
					...baseOptions,
					ttl: SAFE_CACHE_MAX_TTL_MS,
				},
				memoryCache,
			),
		).resolves.toBe('value')
	})

	test('gives refresh callbacks frozen detached safe metadata', async () => {
		const memoryCache = createMemoryCache()
		const key = opaqueCacheKey()
		let callbackCreatedTime: number | undefined

		await cachifiedSafely(
			'ranked-discovery',
			{
				key,
				ttl: 1_000,
				getFreshValue({ metadata }) {
					callbackCreatedTime = metadata.createdTime
					expect(Object.isFrozen(metadata)).toBe(true)
					expect(metadata).toEqual({
						createdTime: expect.any(Number),
						ttl: 1_000,
						swr: 0,
					})
					expect(Reflect.set(metadata, 'ttl', Infinity)).toBe(false)
					expect(Reflect.set(metadata, 'swr', Infinity)).toBe(false)
					expect(Reflect.set(metadata, 'traceId', 'viewer-private-id')).toBe(
						false,
					)
					return 'safe'
				},
			},
			memoryCache,
		)

		const storedEntry = await memoryCache.get(key)
		expect(storedEntry).toEqual({
			metadata: {
				createdTime: callbackCreatedTime,
				ttl: 1_000,
				swr: 0,
			},
			value: 'safe',
		})
	})

	test('preserves Cachified callback symbol handlers', async () => {
		const memoryCache = createMemoryCache()
		const key = opaqueCacheKey()
		await cachifiedSafely(
			'ranked-discovery',
			{
				key,
				ttl: 1_000,
				getFreshValue: () => 'cached',
			},
			memoryCache,
		)

		const batchLoader = vi.fn(async (parameters: string[]) =>
			parameters.map(() => 'unexpected'),
		)
		const batch = createBatch(batchLoader, false)
		const batchedFreshValue = batch.add('unused')
		await expect(
			cachifiedSafely(
				'ranked-discovery',
				{
					key,
					ttl: 1_000,
					getFreshValue: batchedFreshValue,
				},
				memoryCache,
			),
		).resolves.toBe('cached')

		const submitted = vi.fn()
		void batch.submit().then(submitted)
		await Promise.resolve()
		await Promise.resolve()

		expect(submitted).toHaveBeenCalledOnce()
		expect(batchLoader).not.toHaveBeenCalled()
	})

	test('never falls back to a cached value after a forced refresh fails', async () => {
		const memoryCache = createMemoryCache()
		const key = opaqueCacheKey()
		await cachifiedSafely(
			'ranked-discovery',
			{
				key,
				ttl: 1_000,
				getFreshValue: () => 'cached',
			},
			memoryCache,
		)

		await expect(
			cachifiedSafely(
				'ranked-discovery',
				{
					key,
					ttl: 1_000,
					forceFresh: true,
					getFreshValue() {
						throw new Error('refresh failed')
					},
				},
				memoryCache,
			),
		).rejects.toThrow('refresh failed')
	})
})
