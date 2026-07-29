import fs from 'node:fs'
import path from 'node:path'
import {
	cachified as baseCachified,
	verboseReporter,
	mergeReporters,
	type CacheEntry,
	type Cache as CachifiedCache,
	type CachifiedOptions,
	type Cache,
	type CreateReporter,
	type GetFreshValue,
} from '@epic-web/cachified'
import { remember } from '@epic-web/remember'
import Database from 'better-sqlite3'
import { LRUCache } from 'lru-cache'
import { z } from 'zod'
import {
	canonicalCachePayload,
	isOpaqueCacheKey,
	type CanonicalCacheValue,
	type OpaqueCacheKey,
} from './cache-key.server.ts'
import { cachifiedTimingReporter, type Timings } from './timing.server.ts'

const DEFAULT_PRUNE_INTERVAL_MS = 60 * 60 * 1_000
const DEFAULT_MAX_PRUNE_ROWS = 5_000
const DEFAULT_MEMORY_MAX_ENTRIES = 5_000
const DEFAULT_MEMORY_MAX_SIZE_BYTES = 32 * 1024 * 1024
const DEFAULT_MEMORY_MAX_ENTRY_SIZE_BYTES = 512 * 1024
const MAX_SQL_LIMIT = 100_000
const SQLITE_MAX_FINITE_NUMBER = 1.7976931348623157e308
export const SAFE_CACHE_MAX_TTL_MS = 5 * 60 * 1_000

const cacheMetadataSchema = z
	.object({
		createdTime: z.number().finite(),
		ttl: z.number().finite().nullable().optional(),
		swr: z.number().finite().nullable().optional(),
		swv: z.number().finite().nullable().optional(),
		traceId: z.unknown().optional(),
	})
	.passthrough()
const cacheEntrySchema = z.object({
	metadata: cacheMetadataSchema,
	value: z.unknown(),
})
const cacheQueryResultSchema = z.object({
	metadata: z.string(),
	value: z.string(),
})

function normalizeSqlLimit(limit: number) {
	if (!Number.isFinite(limit) || limit <= 0) return 0
	return Math.min(Math.floor(limit), MAX_SQL_LIMIT)
}

function getCacheMetadataLifetime(metadata: {
	ttl?: number | null
	swr?: number | null
	swv?: number | null
}) {
	// Old cache rows can predate the explicit `ttl: null` representation.
	// Missing/null TTLs and explicit null stale windows are unbounded.
	if (metadata.ttl == null) return Infinity
	const staleWhileRevalidate =
		metadata.swr === undefined ? metadata.swv : metadata.swr
	if (staleWhileRevalidate === null) return Infinity
	return metadata.ttl + (staleWhileRevalidate ?? 0)
}

function isCacheMetadataExpired(
	metadata: {
		createdTime: number
		ttl?: number | null
		swr?: number | null
		swv?: number | null
	},
	now: number,
) {
	const lifetime = getCacheMetadataLifetime(metadata)
	return Number.isFinite(lifetime) && metadata.createdTime + lifetime < now
}

export function initializeCacheDatabase(db: Database.Database) {
	db.exec(`
		CREATE TABLE IF NOT EXISTS cache (
			key TEXT PRIMARY KEY,
			metadata TEXT,
			value TEXT
		)
	`)
}

export function pruneCacheDatabase(
	db: Database.Database,
	{
		now = Date.now(),
		limit = DEFAULT_MAX_PRUNE_ROWS,
	}: {
		now?: number
		limit?: number
	} = {},
) {
	const normalizedLimit = normalizeSqlLimit(limit)
	if (!normalizedLimit) return 0
	if (!Number.isFinite(now)) {
		throw new RangeError('Cache prune time must be a finite number.')
	}

	// CASE expressions are evaluated lazily by SQLite. Keeping JSON validity
	// checks first prevents malformed rows from reaching json_type/extract.
	const result = db
		.prepare(
			`
				DELETE FROM cache
				WHERE key IN (
					SELECT key
					FROM cache
					WHERE
						CASE
							WHEN json_valid(metadata) <> 1 THEN 1
							WHEN json_valid(value) <> 1 THEN 1
							WHEN json_type(metadata) <> 'object' THEN 1
							WHEN COALESCE(
								json_type(metadata, '$.createdTime') NOT IN ('integer', 'real'),
								1
							) THEN 1
							WHEN abs(json_extract(metadata, '$.createdTime')) > @maxFinite THEN 1
							WHEN json_type(metadata, '$.ttl') IS NOT NULL
								AND json_type(metadata, '$.ttl') NOT IN ('null', 'integer', 'real')
								THEN 1
							WHEN json_type(metadata, '$.ttl') IN ('integer', 'real')
								AND abs(json_extract(metadata, '$.ttl')) > @maxFinite
								THEN 1
							WHEN json_type(metadata, '$.swr') IS NOT NULL
								AND json_type(metadata, '$.swr') NOT IN ('null', 'integer', 'real')
								THEN 1
							WHEN json_type(metadata, '$.swr') IN ('integer', 'real')
								AND abs(json_extract(metadata, '$.swr')) > @maxFinite
								THEN 1
							WHEN json_type(metadata, '$.swv') IS NOT NULL
								AND json_type(metadata, '$.swv') NOT IN ('null', 'integer', 'real')
								THEN 1
							WHEN json_type(metadata, '$.swv') IN ('integer', 'real')
								AND abs(json_extract(metadata, '$.swv')) > @maxFinite
								THEN 1
							WHEN json_type(metadata, '$.ttl') IN ('integer', 'real')
								AND json_type(metadata, '$.swr') IS NOT 'null'
								AND NOT (
									json_type(metadata, '$.swr') IS NULL
									AND json_type(metadata, '$.swv') IS 'null'
								)
								AND (
									json_extract(metadata, '$.createdTime')
									+ json_extract(metadata, '$.ttl')
									+ CASE
										WHEN json_type(metadata, '$.swr') IN ('integer', 'real')
											THEN json_extract(metadata, '$.swr')
										WHEN json_type(metadata, '$.swr') IS NULL
											AND json_type(metadata, '$.swv') IN ('integer', 'real')
											THEN json_extract(metadata, '$.swv')
										ELSE 0
									END
								) < @now
								THEN 1
							ELSE 0
						END = 1
					LIMIT @limit
				)
			`,
		)
		.run({
			limit: normalizedLimit,
			maxFinite: SQLITE_MAX_FINITE_NUMBER,
			now,
		})
	return result.changes
}

export function createSqliteCacheAdapter(
	db: Database.Database,
	{ now = Date.now }: { now?: () => number } = {},
): CachifiedCache {
	const selectEntry = db.prepare(
		'SELECT value, metadata FROM cache WHERE key = ?',
	)
	const deleteEntry = db.prepare('DELETE FROM cache WHERE key = ?')
	const writeEntry = db.prepare(
		'INSERT OR REPLACE INTO cache (key, value, metadata) VALUES (@key, @value, @metadata)',
	)

	return {
		name: 'SQLite cache',
		get(key) {
			const result = selectEntry.get(key)
			if (result == null) return null

			const parseResult = cacheQueryResultSchema.safeParse(result)
			if (!parseResult.success) {
				deleteEntry.run(key)
				return null
			}

			try {
				const parsedEntry = cacheEntrySchema.safeParse({
					metadata: JSON.parse(parseResult.data.metadata),
					value: JSON.parse(parseResult.data.value),
				})
				if (!parsedEntry.success) {
					deleteEntry.run(key)
					return null
				}

				const entry = parsedEntry.data
				if (isCacheMetadataExpired(entry.metadata, now())) {
					deleteEntry.run(key)
					return null
				}
				return {
					metadata: entry.metadata,
					value: entry.value,
				}
			} catch {
				deleteEntry.run(key)
				return null
			}
		},
		async set(key, entry) {
			writeEntry.run({
				key,
				value: JSON.stringify(entry.value),
				metadata: JSON.stringify(entry.metadata),
			})
		},
		async delete(key) {
			deleteEntry.run(key)
		},
	}
}

function isSqliteCorruption(error: unknown) {
	const code =
		typeof error === 'object' && error !== null && 'code' in error
			? (error as { code?: unknown }).code
			: undefined
	return (
		typeof code === 'string' &&
		(code === 'SQLITE_NOTADB' || code.startsWith('SQLITE_CORRUPT'))
	)
}

function normalizeCacheDatabasePath(databasePath: string) {
	if (!databasePath || databasePath.trim() !== databasePath) {
		throw new Error(
			'CACHE_DATABASE_PATH must be a non-empty path without surrounding whitespace.',
		)
	}
	if (databasePath === ':memory:') return databasePath

	const resolvedPath = path.resolve(databasePath)
	if (
		fs.existsSync(resolvedPath) &&
		fs.lstatSync(resolvedPath).isSymbolicLink()
	) {
		throw new Error('CACHE_DATABASE_PATH must not point to a symbolic link.')
	}
	fs.mkdirSync(path.dirname(resolvedPath), { recursive: true, mode: 0o700 })
	return resolvedPath
}

function closeDatabaseAfterFailure(db: Database.Database | undefined) {
	if (!db?.open) return
	try {
		db.close()
	} catch {
		// Preserve the operation error which caused recovery.
	}
}

function removeCorruptDatabaseFiles(databasePath: string) {
	const mainStat = fs.lstatSync(databasePath)
	if (!mainStat.isFile()) return false

	for (const suffix of ['-journal', '-wal', '-shm', '']) {
		const candidate = `${databasePath}${suffix}`
		if (!fs.existsSync(candidate)) continue
		const stat = fs.lstatSync(candidate)
		if (stat.isFile()) fs.unlinkSync(candidate)
	}
	return true
}

function openPreparedCacheDatabase({
	databasePath,
	now,
	maxPruneRows,
	canRecover = true,
}: {
	databasePath: string
	now: () => number
	maxPruneRows: number
	canRecover?: boolean
}) {
	const normalizedPath = normalizeCacheDatabasePath(databasePath)
	let db: Database.Database | undefined
	try {
		db = new Database(normalizedPath)
		initializeCacheDatabase(db)
		if (normalizedPath !== ':memory:') fs.chmodSync(normalizedPath, 0o600)
		const sqliteCache = createSqliteCacheAdapter(db, { now })
		pruneCacheDatabase(db, {
			now: now(),
			limit: maxPruneRows,
		})
		return { db, sqliteCache }
	} catch (error) {
		closeDatabaseAfterFailure(db)

		if (
			!canRecover ||
			normalizedPath === ':memory:' ||
			!isSqliteCorruption(error)
		) {
			throw error
		}

		if (!removeCorruptDatabaseFiles(normalizedPath)) throw error
		return openPreparedCacheDatabase({
			databasePath: normalizedPath,
			now,
			maxPruneRows,
			canRecover: false,
		})
	}
}

export type SqliteCacheResource = {
	cache: CachifiedCache
	prune: (now?: number, limit?: number) => number
	clear: () => number
	keys: (limit: number) => string[]
	searchKeys: (search: string, limit: number) => string[]
	close: () => void
	readonly open: boolean
}

export function createSqliteCacheResource({
	databasePath,
	now = Date.now,
	pruneIntervalMs = DEFAULT_PRUNE_INTERVAL_MS,
	maxPruneRows = DEFAULT_MAX_PRUNE_ROWS,
}: {
	databasePath: string
	now?: () => number
	pruneIntervalMs?: number | null
	maxPruneRows?: number
}): SqliteCacheResource {
	const normalizedMaxPruneRows = normalizeSqlLimit(maxPruneRows)
	if (!normalizedMaxPruneRows) {
		throw new RangeError('maxPruneRows must be a positive finite number.')
	}
	if (
		pruneIntervalMs !== null &&
		(!Number.isFinite(pruneIntervalMs) || pruneIntervalMs <= 0)
	) {
		throw new RangeError(
			'pruneIntervalMs must be null or a positive finite number.',
		)
	}

	const { db, sqliteCache } = openPreparedCacheDatabase({
		databasePath,
		now,
		maxPruneRows: normalizedMaxPruneRows,
	})
	let closed = false
	const prune = (pruneNow = now(), limit: number = normalizedMaxPruneRows) => {
		if (closed || !db.open) return 0
		return pruneCacheDatabase(db, { now: pruneNow, limit })
	}

	const cleanupTimer =
		pruneIntervalMs === null
			? null
			: setInterval(() => {
					try {
						prune()
					} catch (error) {
						console.error('SQLite cache pruning failed.', error)
					}
				}, pruneIntervalMs)
	cleanupTimer?.unref()

	const close = () => {
		if (closed) return
		closed = true
		if (cleanupTimer) clearInterval(cleanupTimer)
		if (db.open) db.close()
	}

	return {
		cache: sqliteCache,
		prune,
		clear() {
			if (closed || !db.open) return 0
			return db.prepare('DELETE FROM cache').run().changes
		},
		keys(limit) {
			const normalizedLimit = normalizeSqlLimit(limit)
			if (!normalizedLimit || closed) return []
			return db
				.prepare('SELECT key FROM cache LIMIT ?')
				.all(normalizedLimit)
				.map(row => (row as { key: string }).key)
		},
		searchKeys(search, limit) {
			const normalizedLimit = normalizeSqlLimit(limit)
			if (!normalizedLimit || closed) return []
			return db
				.prepare('SELECT key FROM cache WHERE key LIKE ? LIMIT ?')
				.all(`%${search}%`, normalizedLimit)
				.map(row => (row as { key: string }).key)
		},
		close,
		get open() {
			return !closed && db.open
		},
	}
}

export function createCacheResourceCloser({
	clearTimer,
	isDatabaseOpen,
	closeDatabase,
}: {
	clearTimer: () => void
	isDatabaseOpen: () => boolean
	closeDatabase: () => void
}) {
	let closed = false
	return () => {
		if (closed) return
		closed = true
		clearTimer()
		if (isDatabaseOpen()) closeDatabase()
	}
}

type CacheResourceState = {
	resource: SqliteCacheResource | null
	closed: boolean
}

const cacheResourceState = remember<CacheResourceState>(
	'cache-resource-state-v2',
	() => ({ resource: null, closed: false }),
)

function getSqliteCacheResource() {
	if (cacheResourceState.closed) {
		throw new Error('The SQLite cache resource has already been closed.')
	}
	if (!cacheResourceState.resource) {
		cacheResourceState.resource = createSqliteCacheResource({
			databasePath: process.env.CACHE_DATABASE_PATH ?? '',
		})
	}
	return cacheResourceState.resource
}

export function closeCacheResources() {
	if (cacheResourceState.closed) return
	cacheResourceState.closed = true
	cacheResourceState.resource?.close()
}

export function pruneExpiredCacheEntries(
	now = Date.now(),
	limit = DEFAULT_MAX_PRUNE_ROWS,
) {
	return getSqliteCacheResource().prune(now, limit)
}

export type MemoryCacheSnapshot = {
	entries: number
	calculatedSizeBytes: number
	maxSizeBytes: number
}

export type InspectableMemoryCache = Cache & {
	keys: (limit?: number) => string[]
	deleteByPrefix: (prefix: string) => number
	clear: () => void
	snapshot: () => MemoryCacheSnapshot
}

function requirePositiveInteger(value: number, name: string) {
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new RangeError(`${name} must be a positive safe integer.`)
	}
	return value
}

export function createMemoryCache({
	name = 'app-memory-cache',
	maxEntries = DEFAULT_MEMORY_MAX_ENTRIES,
	maxSizeBytes = DEFAULT_MEMORY_MAX_SIZE_BYTES,
	maxEntrySizeBytes = DEFAULT_MEMORY_MAX_ENTRY_SIZE_BYTES,
	now = Date.now,
	monotonicNow,
}: {
	name?: string
	maxEntries?: number
	maxSizeBytes?: number
	maxEntrySizeBytes?: number
	now?: () => number
	monotonicNow?: () => number
} = {}): InspectableMemoryCache {
	requirePositiveInteger(maxEntries, 'maxEntries')
	requirePositiveInteger(maxSizeBytes, 'maxSizeBytes')
	requirePositiveInteger(maxEntrySizeBytes, 'maxEntrySizeBytes')
	if (maxEntrySizeBytes > maxSizeBytes) {
		throw new RangeError('maxEntrySizeBytes must not exceed maxSizeBytes.')
	}

	const lru = new LRUCache<string, CacheEntry<unknown>>({
		max: maxEntries,
		maxSize: maxSizeBytes,
		maxEntrySize: maxEntrySizeBytes,
		perf: monotonicNow ? { now: monotonicNow } : undefined,
		ttlResolution: monotonicNow ? 0 : 1,
		sizeCalculation: (entry, key) => {
			try {
				const serialized = JSON.stringify(entry)
				if (serialized === undefined) return maxEntrySizeBytes + 1
				return Math.max(
					1,
					Buffer.byteLength(key, 'utf8') +
						Buffer.byteLength(serialized, 'utf8'),
				)
			} catch {
				return maxEntrySizeBytes + 1
			}
		},
	})

	return {
		name,
		set(key, entry) {
			const createdTime = entry?.metadata?.createdTime
			const lifetime = getCacheMetadataLifetime(entry?.metadata ?? {})
			if (
				!Number.isFinite(createdTime) ||
				(lifetime !== Infinity && !Number.isFinite(lifetime))
			) {
				lru.delete(key)
				return entry
			}

			const currentTime = now()
			if (!Number.isFinite(currentTime)) {
				lru.delete(key)
				return entry
			}
			const remainingTtl =
				lifetime === Infinity ? Infinity : createdTime + lifetime - currentTime
			if (remainingTtl !== Infinity && remainingTtl < 0) {
				lru.delete(key)
				return entry
			}

			lru.set(key, entry, {
				ttl: remainingTtl === Infinity ? undefined : Math.max(1, remainingTtl),
			})
			return entry
		},
		get(key) {
			const entry = lru.get(key)
			if (!entry) return
			const currentTime = now()
			if (
				!Number.isFinite(currentTime) ||
				isCacheMetadataExpired(entry.metadata, currentTime)
			) {
				lru.delete(key)
				return
			}
			return entry
		},
		delete: key => lru.delete(key),
		keys(limit = maxEntries) {
			const normalizedLimit = normalizeSqlLimit(limit)
			if (!normalizedLimit) return []
			const keys: string[] = []
			for (const key of lru.keys()) {
				keys.push(key)
				if (keys.length >= normalizedLimit) break
			}
			return keys
		},
		deleteByPrefix(prefix) {
			let deleted = 0
			for (const key of [...lru.keys()]) {
				if (key.startsWith(prefix) && lru.delete(key)) deleted++
			}
			return deleted
		},
		clear: () => lru.clear(),
		snapshot: () => ({
			entries: lru.size,
			calculatedSizeBytes: lru.calculatedSize,
			maxSizeBytes,
		}),
	}
}

export const lruCache = remember<InspectableMemoryCache>(
	'lru-cache-v2',
	createMemoryCache,
)

export function resetMemoryCacheForTest() {
	if (process.env.NODE_ENV !== 'test') {
		throw new Error('The memory cache can only be reset by the test runtime.')
	}
	lruCache.clear()
}

export const cache: CachifiedCache = {
	name: 'SQLite cache',
	get(key) {
		return getSqliteCacheResource().cache.get(key)
	},
	set(key, entry) {
		return getSqliteCacheResource().cache.set(key, entry)
	},
	delete(key) {
		return getSqliteCacheResource().cache.delete(key)
	},
}

export async function getAllCacheKeys(limit: number) {
	return {
		sqlite: getSqliteCacheResource().keys(limit),
		lru: lruCache.keys(limit),
	}
}

export async function searchCacheKeys(search: string, limit: number) {
	return {
		sqlite: getSqliteCacheResource().searchKeys(search, limit),
		lru: lruCache
			.keys()
			.filter(key => key.includes(search))
			.slice(0, normalizeSqlLimit(limit)),
	}
}

export type CacheMetricEvent =
	'hit' | 'miss' | 'refresh' | 'refresh-error' | 'write-error' | 'invalid'

export type CacheMetricCounts = Record<CacheMetricEvent, number>
export type CacheOperationsSnapshot = Readonly<
	Record<string, Readonly<CacheMetricCounts>>
>

export const cacheMetricNamespaces = [
	'ranked-discovery',
	'recommendation-graph',
] as const
export type CacheMetricNamespace = (typeof cacheMetricNamespaces)[number]

const cacheMetricNamespaceSet = new Set<string>(cacheMetricNamespaces)
const cacheMetricEvents = [
	'hit',
	'miss',
	'refresh',
	'refresh-error',
	'write-error',
	'invalid',
] as const satisfies readonly CacheMetricEvent[]

const cacheOperations = remember<Map<string, CacheMetricCounts>>(
	'cache-operations-v1',
	() => new Map(),
)

function validateCacheMetricNamespace(
	namespace: CacheMetricNamespace,
): CacheMetricNamespace {
	if (!cacheMetricNamespaceSet.has(namespace)) {
		throw new Error(
			'Cache metric namespace must be a registered static cache family.',
		)
	}
	return namespace
}

function getCacheMetricCounts(namespace: CacheMetricNamespace) {
	const existing = cacheOperations.get(namespace)
	if (existing) return existing
	const counts = Object.fromEntries(
		cacheMetricEvents.map(event => [event, 0]),
	) as CacheMetricCounts
	cacheOperations.set(namespace, counts)
	return counts
}

function incrementCacheMetric(
	counts: CacheMetricCounts,
	event: CacheMetricEvent,
) {
	counts[event] = Math.min(Number.MAX_SAFE_INTEGER, counts[event] + 1)
}

export function createSafeCacheReporter<Value = unknown>(
	namespace: CacheMetricNamespace,
): CreateReporter<Value> {
	const safeNamespace = validateCacheMetricNamespace(namespace)
	return () => event => {
		const counts = getCacheMetricCounts(safeNamespace)
		switch (event.name) {
			case 'getCachedValueSuccess':
				incrementCacheMetric(counts, 'hit')
				break
			case 'getCachedValueEmpty':
				incrementCacheMetric(counts, 'miss')
				break
			case 'getFreshValueStart':
			case 'refreshValueStart':
				incrementCacheMetric(counts, 'refresh')
				break
			case 'getFreshValueError':
			case 'refreshValueError':
				incrementCacheMetric(counts, 'refresh-error')
				break
			case 'writeFreshValueError':
				incrementCacheMetric(counts, 'write-error')
				break
			case 'checkFreshValueErrorObj':
			case 'checkCachedValueErrorObj':
			case 'getCachedValueError':
				incrementCacheMetric(counts, 'invalid')
				break
		}
	}
}

export function getCacheOperationsSnapshot(): CacheOperationsSnapshot {
	return Object.fromEntries(
		[...cacheOperations.entries()]
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([namespace, counts]) => [namespace, { ...counts }]),
	)
}

export function resetCacheOperationsForTest() {
	cacheOperations.clear()
}

export function resetCacheResourcesForTest() {
	if (process.env.NODE_ENV !== 'test') {
		throw new Error('Cache resources can only be reset by the test runtime.')
	}
	lruCache.clear()
	cacheOperations.clear()
	cacheResourceState.resource?.clear()
}

function addSafeTiming(timings: Timings, type: string, start: number) {
	const timing = timings[type] ?? (timings[type] = [])
	timing.push({ time: performance.now() - start })
}

function createSafeTimingReporter<Value>(
	namespace: CacheMetricNamespace,
	timings?: Timings,
): CreateReporter<Value> | undefined {
	if (!timings) return
	const safeNamespace = validateCacheMetricNamespace(namespace)
	return () => {
		const retrievalStart = performance.now()
		let freshValueStart: number | undefined
		return event => {
			switch (event.name) {
				case 'getFreshValueStart':
					freshValueStart = performance.now()
					break
				case 'getFreshValueSuccess':
				case 'getFreshValueError':
					if (freshValueStart !== undefined) {
						addSafeTiming(
							timings,
							`getFreshValue:${safeNamespace}`,
							freshValueStart,
						)
						freshValueStart = undefined
					}
					break
				case 'done':
					addSafeTiming(timings, `cache:${safeNamespace}`, retrievalStart)
					break
			}
		}
	}
}

type UnsafePrivateCacheOption =
	| 'cache'
	| 'fallbackToCache'
	| 'staleRefreshTimeout'
	| 'staleWhileRevalidate'
	| 'swr'
	| 'traceId'

export type SafeCachifiedOptions<Value extends CanonicalCacheValue> = Omit<
	CachifiedOptions<Value>,
	UnsafePrivateCacheOption | 'key' | 'ttl'
> & {
	key: OpaqueCacheKey
	ttl: number
	timings?: Timings
}

const forbiddenSafeCacheOptions = [
	'cache',
	'fallbackToCache',
	'staleRefreshTimeout',
	'staleWhileRevalidate',
	'swr',
	'traceId',
] as const satisfies readonly UnsafePrivateCacheOption[]

function assertInspectableMemoryCache(
	value: unknown,
): asserts value is InspectableMemoryCache {
	if (
		typeof value !== 'object' ||
		value === null ||
		!('get' in value) ||
		typeof value.get !== 'function' ||
		!('set' in value) ||
		typeof value.set !== 'function' ||
		!('delete' in value) ||
		typeof value.delete !== 'function' ||
		!('keys' in value) ||
		typeof value.keys !== 'function' ||
		!('deleteByPrefix' in value) ||
		typeof value.deleteByPrefix !== 'function' ||
		!('clear' in value) ||
		typeof value.clear !== 'function' ||
		!('snapshot' in value) ||
		typeof value.snapshot !== 'function'
	) {
		throw new TypeError(
			'Safe cache test overrides must be inspectable memory caches.',
		)
	}
}

function validateSafeCacheTtl(ttl: unknown) {
	if (
		typeof ttl !== 'number' ||
		!Number.isFinite(ttl) ||
		ttl <= 0 ||
		ttl > SAFE_CACHE_MAX_TTL_MS
	) {
		throw new RangeError(
			`Safe cache ttl must be finite, positive, and no greater than ${SAFE_CACHE_MAX_TTL_MS} milliseconds.`,
		)
	}
	return ttl
}

function deepFreezeCanonicalCacheValue(
	value: CanonicalCacheValue,
): CanonicalCacheValue {
	if (value === null || typeof value !== 'object') return value
	if (Array.isArray(value)) {
		for (const child of value as readonly CanonicalCacheValue[]) {
			deepFreezeCanonicalCacheValue(child)
		}
	} else {
		for (const child of Object.values(
			value as Readonly<Record<string, CanonicalCacheValue>>,
		)) {
			deepFreezeCanonicalCacheValue(child)
		}
	}
	return Object.freeze(value)
}

function cloneAndFreezeCanonicalCacheValue<Value extends CanonicalCacheValue>(
	value: Value,
): Value {
	const canonical = canonicalCachePayload(value)
	if (value === null || typeof value !== 'object') return value
	return deepFreezeCanonicalCacheValue(
		JSON.parse(canonical) as CanonicalCacheValue,
	) as Value
}

function cloneSafeCacheMetadata(metadata: CacheEntry['metadata']) {
	if (!Number.isFinite(metadata.createdTime)) {
		throw new TypeError('Safe cache metadata must have a finite creation time.')
	}
	const ttl = validateSafeCacheTtl(metadata.ttl)
	if (metadata.swr !== 0) {
		throw new TypeError('Safe cache metadata must not use stale revalidation.')
	}
	return Object.freeze({
		createdTime: metadata.createdTime,
		ttl,
		swr: 0,
	})
}

function cloneSafeCacheEntry<Value extends CanonicalCacheValue>(
	entry: CacheEntry<Value>,
): CacheEntry<Value> {
	return Object.freeze({
		metadata: cloneSafeCacheMetadata(entry.metadata),
		value: cloneAndFreezeCanonicalCacheValue(entry.value),
	})
}

const safeMemoryCacheFacades = remember<
	WeakMap<InspectableMemoryCache, Cache<CanonicalCacheValue>>
>('safe-memory-cache-facades-v1', () => new WeakMap())

function getSafeMemoryCacheFacade(
	memoryCache: InspectableMemoryCache,
): Cache<CanonicalCacheValue> {
	const existing = safeMemoryCacheFacades.get(memoryCache)
	if (existing) return existing

	const safeCache: Cache<CanonicalCacheValue> = {
		name: memoryCache.name,
		async get(key) {
			const entry = await memoryCache.get(key)
			if (entry == null) return entry
			return cloneSafeCacheEntry(entry as CacheEntry<CanonicalCacheValue>)
		},
		set(key, entry) {
			return memoryCache.set(key, cloneSafeCacheEntry(entry))
		},
		delete(key) {
			return memoryCache.delete(key)
		},
	}
	safeMemoryCacheFacades.set(memoryCache, safeCache)
	return safeCache
}

function createSafeCheckValue<Value extends CanonicalCacheValue>(
	checkValue: CachifiedOptions<Value>['checkValue'],
): CachifiedOptions<Value>['checkValue'] {
	if (typeof checkValue !== 'function') return checkValue
	return (value, migrate) =>
		checkValue(value, (migratedValue, updateCache) =>
			migrate(cloneAndFreezeCanonicalCacheValue(migratedValue), updateCache),
		)
}

function createSafeGetFreshValue<Value extends CanonicalCacheValue>(
	getFreshValue: GetFreshValue<Value>,
	ttl: number,
): GetFreshValue<Value> {
	const wrappedGetFreshValue: GetFreshValue<Value> = async context => {
		const metadata = Object.freeze({
			createdTime: context.metadata.createdTime,
			ttl,
			swr: 0,
		})
		return cloneAndFreezeCanonicalCacheValue(
			await getFreshValue({
				background: context.background,
				metadata,
			}),
		)
	}

	for (const symbol of Object.getOwnPropertySymbols(getFreshValue)) {
		const descriptor = Object.getOwnPropertyDescriptor(getFreshValue, symbol)
		if (descriptor) {
			Object.defineProperty(wrappedGetFreshValue, symbol, descriptor)
		}
	}

	return wrappedGetFreshValue
}

export async function cachifiedSafely<Value extends CanonicalCacheValue>(
	namespace: CacheMetricNamespace,
	safeOptions: SafeCachifiedOptions<Value>,
	memoryCache: InspectableMemoryCache = lruCache,
): Promise<Value> {
	const safeNamespace = validateCacheMetricNamespace(namespace)
	const rawOptions = safeOptions as unknown as Record<string, unknown>
	for (const option of forbiddenSafeCacheOptions) {
		if (Object.hasOwn(rawOptions, option)) {
			throw new TypeError(`Safe cache options must not include "${option}".`)
		}
	}
	assertInspectableMemoryCache(memoryCache)
	if (memoryCache !== lruCache && process.env.NODE_ENV !== 'test') {
		throw new TypeError(
			'Safe cache overrides are available only in the test runtime.',
		)
	}

	const { timings, key, ttl, getFreshValue, checkValue, ...options } =
		safeOptions
	if (!isOpaqueCacheKey(key, safeNamespace)) {
		throw new TypeError(
			'Opaque cache key does not match the registered cache namespace.',
		)
	}
	const validatedTtl = validateSafeCacheTtl(ttl)
	const safeGetFreshValue = createSafeGetFreshValue(getFreshValue, validatedTtl)
	const safeCheckValue = createSafeCheckValue(checkValue)
	const safeCache = getSafeMemoryCacheFacade(memoryCache)

	const value = await baseCachified(
		{
			...options,
			key,
			getFreshValue: safeGetFreshValue,
			checkValue: safeCheckValue,
			cache: safeCache,
			fallbackToCache: false,
			staleWhileRevalidate: 0,
			swr: 0,
			ttl: validatedTtl,
		},
		mergeReporters(
			createSafeTimingReporter<Value>(safeNamespace, timings),
			createSafeCacheReporter<Value>(safeNamespace),
		),
	)
	return cloneAndFreezeCanonicalCacheValue(value)
}

export async function cachified<Value>(
	{
		timings,
		...options
	}: CachifiedOptions<Value> & {
		timings?: Timings
	},
	reporter: CreateReporter<Value> = verboseReporter<Value>(),
): Promise<Value> {
	return baseCachified(
		options,
		mergeReporters(cachifiedTimingReporter(timings), reporter),
	)
}
