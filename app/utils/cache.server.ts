import fs from 'fs'
import {
	cachified as baseCachified,
	verboseReporter,
	mergeReporters,
	type CacheEntry,
	type Cache as CachifiedCache,
	type CachifiedOptions,
	type Cache,
	totalTtl,
	type CreateReporter,
} from '@epic-web/cachified'
import { remember } from '@epic-web/remember'
import Database from 'better-sqlite3'
import { LRUCache } from 'lru-cache'
import { z } from 'zod'
import { cachifiedTimingReporter, type Timings } from './timing.server.ts'

const CACHE_DATABASE_PATH = process.env.CACHE_DATABASE_PATH

const cacheDb = remember('cacheDb', createDatabase)

function createDatabase(tryAgain = true): Database.Database {
	const db = new Database(CACHE_DATABASE_PATH)

	try {
		// create cache table with metadata JSON column and value JSON column if it does not exist already
		db.exec(`
			CREATE TABLE IF NOT EXISTS cache (
				key TEXT PRIMARY KEY,
				metadata TEXT,
				value TEXT
			)
		`)
		pruneDatabase(db)
	} catch (error: unknown) {
		fs.unlinkSync(CACHE_DATABASE_PATH)
		if (tryAgain) {
			console.error(
				`Error creating cache database, deleting the file at "${CACHE_DATABASE_PATH}" and trying again...`,
			)
			return createDatabase(false)
		}
		throw error
	}
	return db
}

function pruneDatabase(db: Database.Database, now = Date.now()) {
	const rows = db.prepare('SELECT key, metadata FROM cache').all() as Array<{
		key: string
		metadata: string
	}>
	const expiredKeys: string[] = []
	for (const row of rows) {
		try {
			const metadata = JSON.parse(row.metadata) as {
				createdTime?: unknown
				ttl?: unknown
				swr?: unknown
			}
			const createdTime = Number(metadata.createdTime)
			const ttl = metadata.ttl == null ? Infinity : Number(metadata.ttl)
			const swr = metadata.swr == null ? 0 : Number(metadata.swr)
			if (
				Number.isFinite(createdTime) &&
				Number.isFinite(ttl) &&
				Number.isFinite(swr) &&
				createdTime + ttl + swr <= now
			) {
				expiredKeys.push(row.key)
			}
		} catch {
			expiredKeys.push(row.key)
		}
	}
	if (!expiredKeys.length) return 0
	const remove = db.prepare('DELETE FROM cache WHERE key = ?')
	db.transaction((keys: string[]) => {
		for (const key of keys) remove.run(key)
	})(expiredKeys)
	return expiredKeys.length
}

const cacheCleanupTimer = remember('cache-cleanup-timer', () => {
	const timer = setInterval(() => pruneDatabase(cacheDb), 60 * 60 * 1_000)
	timer.unref()
	return timer
})
void cacheCleanupTimer

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
		clearTimer()
		if (isDatabaseOpen()) closeDatabase()
		closed = true
	}
}

const closeCacheResourcesOnce = remember('cache-resource-closer', () =>
	createCacheResourceCloser({
		clearTimer: () => clearInterval(cacheCleanupTimer),
		isDatabaseOpen: () => cacheDb.open,
		closeDatabase: () => cacheDb.close(),
	}),
)

export function closeCacheResources() {
	closeCacheResourcesOnce()
}

export function pruneExpiredCacheEntries(now = Date.now()) {
	return pruneDatabase(cacheDb, now)
}

const lru = remember(
	'lru-cache',
	() => new LRUCache<string, CacheEntry<unknown>>({ max: 5000 }),
)

export const lruCache = {
	name: 'app-memory-cache',
	set: (key, value) => {
		const ttl = totalTtl(value?.metadata)
		lru.set(key, value, {
			ttl: ttl === Infinity ? undefined : ttl,
			start: value?.metadata?.createdTime,
		})
		return value
	},
	get: key => lru.get(key),
	delete: key => lru.delete(key),
} satisfies Cache

const cacheEntrySchema = z.object({
	metadata: z.object({
		createdTime: z.number(),
		ttl: z.number().nullable().optional(),
		swr: z.number().nullable().optional(),
	}),
	value: z.unknown(),
})
const cacheQueryResultSchema = z.object({
	metadata: z.string(),
	value: z.string(),
})

export const cache: CachifiedCache = {
	name: 'SQLite cache',
	get(key) {
		const result = cacheDb
			.prepare('SELECT value, metadata FROM cache WHERE key = ?')
			.get(key)
		const parseResult = cacheQueryResultSchema.safeParse(result)
		if (!parseResult.success) return null

		const parsedEntry = cacheEntrySchema.safeParse({
			metadata: JSON.parse(parseResult.data.metadata),
			value: JSON.parse(parseResult.data.value),
		})
		if (!parsedEntry.success) return null
		const { metadata, value } = parsedEntry.data
		if (!value) return null
		const ttl = totalTtl(metadata)
		if (Number.isFinite(ttl) && metadata.createdTime + ttl <= Date.now()) {
			cacheDb.prepare('DELETE FROM cache WHERE key = ?').run(key)
			return null
		}
		return { metadata, value }
	},
	async set(key, entry) {
		cacheDb
			.prepare(
				'INSERT OR REPLACE INTO cache (key, value, metadata) VALUES (@key, @value, @metadata)',
			)
			.run({
				key,
				value: JSON.stringify(entry.value),
				metadata: JSON.stringify(entry.metadata),
			})
	},
	async delete(key) {
		cacheDb.prepare('DELETE FROM cache WHERE key = ?').run(key)
	},
}

export async function getAllCacheKeys(limit: number) {
	return {
		sqlite: cacheDb
			.prepare('SELECT key FROM cache LIMIT ?')
			.all(limit)
			.map(row => (row as { key: string }).key),
		lru: [...lru.keys()],
	}
}

export async function searchCacheKeys(search: string, limit: number) {
	return {
		sqlite: cacheDb
			.prepare('SELECT key FROM cache WHERE key LIKE ? LIMIT ?')
			.all(`%${search}%`, limit)
			.map(row => (row as { key: string }).key),
		lru: [...lru.keys()].filter(key => key.includes(search)),
	}
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
