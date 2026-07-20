#!/usr/bin/env node
import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { PrismaClient } from '@prisma/client'
import {
	assertSafeLoadDatabaseUrl,
	bytesLabel,
	summarizeExplain,
} from './postgres-load-utils.mjs'

const args = process.argv.slice(2)
const prefix = 'load-catalog-'
const usage = `Usage: npm run db:loadtest:postgres -- [options]

Options:
  --count N                 Synthetic media identities (default: 100000)
  --batch-size N            Rows per generate_series batch (default: 10000)
  --search-iterations N     Concurrent search reads (default: 20)
  --update-batches N        Concurrent hydration-style updates (default: 5)
  --report PATH             JSON report path (default: test-results/...)
  --commit                  Generate data and run measurements (default: dry-run)
  --resume                  Continue a deterministic interrupted load
  --cleanup-after           Delete only load-catalog-* records after reporting
  --require-trigram-indexes Fail if measured text searches avoid trigram indexes
  --help                    Show this help

DATABASE_URL must use PostgreSQL and its database name must contain a clearly
delimited load, bench, perf, stag, stage, staging, or test marker. Synthetic
records never use provider content.`

function valueFor(flag) {
	const index = args.indexOf(flag)
	if (index < 0) return undefined
	const value = args[index + 1]
	if (!value || value.startsWith('--'))
		throw new Error(`${flag} requires a value`)
	return value
}

function integer(flag, fallback, { minimum = 1, maximum = 2_000_000 } = {}) {
	const raw = valueFor(flag)
	if (raw === undefined) return fallback
	const value = Number(raw)
	if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
		throw new Error(
			`${flag} must be an integer from ${minimum} through ${maximum}`,
		)
	}
	return value
}

function assertKnownArguments() {
	const values = new Set([
		'--count',
		'--batch-size',
		'--search-iterations',
		'--update-batches',
		'--report',
	])
	const booleans = new Set([
		'--commit',
		'--resume',
		'--cleanup-after',
		'--require-trigram-indexes',
		'--help',
	])
	for (let index = 0; index < args.length; index++) {
		const argument = args[index]
		if (booleans.has(argument)) continue
		if (values.has(argument)) {
			index++
			continue
		}
		throw new Error(`Unknown argument: ${argument}`)
	}
}

function kindSql(series = 'n') {
	return `CASE ${series} % 4
		WHEN 0 THEN 'movie'
		WHEN 1 THEN 'tv'
		WHEN 2 THEN 'anime'
		ELSE 'manga' END`
}

async function databaseMetrics(prisma) {
	const rows = await prisma.$queryRaw`
		SELECT
			pg_database_size(current_database())::bigint AS "databaseBytes",
			pg_total_relation_size('"Media"')::bigint AS "mediaBytes",
			pg_total_relation_size('"MediaTitle"')::bigint AS "titleBytes",
			pg_total_relation_size('"MediaExternalId"')::bigint AS "identityBytes"
	`
	const row = rows[0]
	return Object.fromEntries(
		Object.entries(row).map(([key, value]) => [key, Number(value)]),
	)
}

async function syntheticCount(prisma) {
	const rows = await prisma.$queryRaw`
		SELECT COUNT(*)::int AS count FROM "Media"
		WHERE id LIKE 'load-catalog-media-%'
	`
	return Number(rows[0].count)
}

async function insertBatch(prisma, start, end) {
	const kind = kindSql()
	await prisma.$executeRawUnsafe(
		`INSERT INTO "Media" (
			"id", "kind", "title", "description", "genres", "catalogScore",
			"catalogPopularity", "releaseStatus", "createdAt", "updatedAt"
		)
		SELECT
			'${prefix}media-' || n,
			${kind},
			'Synthetic ' || ${kind} || ' Catalog Work ' || n ||
				CASE n % 7 WHEN 0 THEN ' Aurora' WHEN 1 THEN ' Meridian'
				WHEN 2 THEN ' Chronicle' ELSE '' END,
			'Shared synthetic load description for indexed discovery. Record ' || n ||
				CASE n % 997 WHEN 0 THEN ' rare-nebula-token' ELSE '' END,
			CASE n % 5 WHEN 0 THEN 'Drama, Mystery' WHEN 1 THEN 'Action, Fantasy'
				WHEN 2 THEN 'Comedy' WHEN 3 THEN 'Science Fiction' ELSE 'Romance' END,
			((n % 100)::double precision / 10.0),
			(1.0 / n::double precision),
			CASE n % 3 WHEN 0 THEN 'Released' WHEN 1 THEN 'Returning Series' ELSE 'Planned' END,
			CURRENT_TIMESTAMP,
			CURRENT_TIMESTAMP
		FROM generate_series($1::int, $2::int) AS n
		ON CONFLICT ("id") DO NOTHING`,
		start,
		end,
	)
	await prisma.$executeRawUnsafe(
		`INSERT INTO "MediaExternalId" (
			"id", "provider", "kind", "externalId", "sourceTitle",
			"sourcePopularity", "fetchStatus", "mediaId"
		)
		SELECT
			'${prefix}external-' || n,
			CASE WHEN ${kindSql()} IN ('movie', 'tv') THEN 'tmdb' ELSE 'mal' END,
			${kindSql()},
			(9000000 + n)::text,
			'Synthetic Catalog Work ' || n,
			(1.0 / n::double precision),
			'fresh',
			'${prefix}media-' || n
		FROM generate_series($1::int, $2::int) AS n
		ON CONFLICT ("id") DO NOTHING`,
		start,
		end,
	)
	await prisma.$executeRawUnsafe(
		`INSERT INTO "MediaTitle" (
			"id", "provider", "language", "titleType", "value", "normalized",
			"isPrimary", "createdAt", "updatedAt", "mediaId"
		)
		SELECT
			'${prefix}title-' || n,
			CASE WHEN ${kindSql()} IN ('movie', 'tv') THEN 'tmdb' ELSE 'mal' END,
			'en',
			'primary',
			'Synthetic Catalog Work ' || n,
			'synthetic catalog work ' || n,
			true,
			CURRENT_TIMESTAMP,
			CURRENT_TIMESTAMP,
			'${prefix}media-' || n
		FROM generate_series($1::int, $2::int) AS n
		ON CONFLICT ("id") DO NOTHING`,
		start,
		end,
	)
	await prisma.$executeRawUnsafe(
		`INSERT INTO "MediaTitle" (
			"id", "provider", "language", "titleType", "value", "normalized",
			"isPrimary", "createdAt", "updatedAt", "mediaId"
		)
		SELECT
			'${prefix}alternate-' || n,
			CASE WHEN ${kindSql()} IN ('movie', 'tv') THEN 'tmdb' ELSE 'mal' END,
			'en',
			'alternate',
			'Alternate Load Alias ' || n,
			'alternate load alias ' || n,
			false,
			CURRENT_TIMESTAMP,
			CURRENT_TIMESTAMP,
			'${prefix}media-' || n
		FROM generate_series($1::int, $2::int) AS n
		WHERE n % 4 = 0
		ON CONFLICT ("id") DO NOTHING`,
		start,
		end,
	)
}

async function explain(prisma, name, sql, values = []) {
	const wallStarted = performance.now()
	const rows = await prisma.$queryRawUnsafe(
		`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`,
		...values,
	)
	return {
		name,
		wallMs: Number((performance.now() - wallStarted).toFixed(3)),
		...summarizeExplain(rows),
	}
}

async function queryMetrics(prisma, count) {
	const needle = Math.max(4, Math.floor(count * 0.73))
	const alternate = Math.max(4, Math.floor((count * 0.44) / 4) * 4)
	return Promise.all([
		explain(
			prisma,
			'canonical-title',
			'SELECT id FROM "Media" WHERE title LIKE $1 LIMIT 24',
			[`%Catalog Work ${needle}%`],
		),
		explain(
			prisma,
			'alternate-title',
			'SELECT "mediaId" FROM "MediaTitle" WHERE normalized LIKE $1 LIMIT 24',
			[`%alternate load alias ${alternate}%`],
		),
		explain(
			prisma,
			'rare-description',
			'SELECT id FROM "Media" WHERE description LIKE $1 LIMIT 24',
			['%rare-nebula-token%'],
		),
		explain(
			prisma,
			'broad-description',
			'SELECT id FROM "Media" WHERE description LIKE $1 LIMIT 24',
			['%shared synthetic load description%'],
		),
		explain(
			prisma,
			'no-match',
			'SELECT id FROM "MediaTitle" WHERE normalized LIKE $1 LIMIT 24',
			['%term-that-does-not-exist-7f01%'],
		),
		explain(
			prisma,
			'popular-page',
			`SELECT id FROM "Media"
			 WHERE id LIKE 'load-catalog-media-%'
			 ORDER BY "catalogPopularity" DESC NULLS LAST, id
			 LIMIT 24 OFFSET $1`,
			[Math.min(10_000, Math.max(0, count - 24))],
		),
	])
}

async function concurrentMetrics(prisma, count, searches, updateBatches) {
	const started = performance.now()
	const jobs = []
	for (let index = 0; index < searches; index++) {
		const needle = 1 + ((index * 7919) % count)
		jobs.push(
			prisma.$queryRawUnsafe(
				'SELECT id FROM "Media" WHERE title LIKE $1 LIMIT 24',
				`%Catalog Work ${needle}%`,
			),
		)
	}
	for (let index = 0; index < updateBatches; index++) {
		const start = 1 + index * 200
		const end = Math.min(count, start + 199)
		jobs.push(
			prisma.$executeRawUnsafe(
				`UPDATE "MediaExternalId"
				 SET "hydrationPriority" = "hydrationPriority" + 1,
				     "hydrationRequestedAt" = CURRENT_TIMESTAMP
				 WHERE id = ANY(
				   SELECT '${prefix}external-' || n
				   FROM generate_series($1::int, $2::int) AS n
				 )`,
				start,
				end,
			),
		)
	}
	await Promise.all(jobs)
	return {
		searches,
		updateBatches,
		wallMs: Number((performance.now() - started).toFixed(3)),
	}
}

async function cleanup(prisma) {
	const started = performance.now()
	const result = await prisma.media.deleteMany({
		where: { id: { startsWith: `${prefix}media-` } },
	})
	return {
		deletedMedia: result.count,
		wallMs: Number((performance.now() - started).toFixed(3)),
	}
}

async function main() {
	assertKnownArguments()
	if (args.includes('--help')) {
		console.log(usage)
		return
	}
	const count = integer('--count', 100_000)
	const batchSize = integer('--batch-size', 10_000, { maximum: 100_000 })
	const searches = integer('--search-iterations', 20, { maximum: 1_000 })
	const updateBatches = integer('--update-batches', 5, { maximum: 100 })
	const commit = args.includes('--commit')
	const resume = args.includes('--resume')
	const cleanupAfter = args.includes('--cleanup-after')
	const requireIndexes = args.includes('--require-trigram-indexes')
	const target = assertSafeLoadDatabaseUrl(process.env.DATABASE_URL)
	const reportPath = path.resolve(
		valueFor('--report') ??
			`test-results/postgres-load-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
	)
	console.log(`Target: ${target.identity}`)
	console.log(`Synthetic identities: ${count}`)
	console.log(
		`Mode: ${commit ? (resume ? 'COMMIT/RESUME' : 'COMMIT') : 'DRY-RUN'}`,
	)
	console.log(`Report: ${reportPath}`)
	if (!commit) return

	const generatedSchema = fs.readFileSync(
		path.resolve('node_modules/.prisma/client/schema.prisma'),
		'utf8',
	)
	if (!generatedSchema.includes('provider = "postgresql"')) {
		throw new Error('Generate the PostgreSQL Prisma client before commit mode')
	}
	const prisma = new PrismaClient()
	try {
		const existing = await syntheticCount(prisma)
		if (existing && !resume) {
			throw new Error(
				`Target already contains ${existing} synthetic rows; use --resume or --cleanup-after with the original run`,
			)
		}
		const storageBefore = await databaseMetrics(prisma)
		const insertStarted = performance.now()
		for (let start = 1; start <= count; start += batchSize) {
			const end = Math.min(count, start + batchSize - 1)
			await insertBatch(prisma, start, end)
			console.log(`Loaded ${end}/${count} synthetic identities`)
		}
		const insertMs = performance.now() - insertStarted
		const loaded = await syntheticCount(prisma)
		if (loaded !== count) {
			throw new Error(
				`Synthetic load count mismatch: expected ${count}, found ${loaded}`,
			)
		}
		await prisma.$executeRawUnsafe('ANALYZE "Media"')
		await prisma.$executeRawUnsafe('ANALYZE "MediaTitle"')
		await prisma.$executeRawUnsafe('ANALYZE "MediaExternalId"')
		const queries = await queryMetrics(prisma, count)
		const concurrency = await concurrentMetrics(
			prisma,
			count,
			searches,
			updateBatches,
		)
		const storageAfter = await databaseMetrics(prisma)
		const requiredIndexes = new Set([
			'Media_title_trgm_idx',
			'Media_description_trgm_idx',
			'MediaTitle_normalized_trgm_idx',
		])
		const usedIndexes = new Set(queries.flatMap(query => query.indexes))
		const missingIndexes = [...requiredIndexes].filter(
			index => !usedIndexes.has(index),
		)
		const insertedRows = loaded - existing
		const report = {
			version: 1,
			measuredAt: new Date().toISOString(),
			target: target.identity,
			requestedRows: count,
			loadedRows: loaded,
			existingRows: existing,
			insertedRows,
			insert: {
				wallMs: Number(insertMs.toFixed(3)),
				rowsPerSecond: insertedRows
					? Number((insertedRows / (insertMs / 1_000)).toFixed(2))
					: 0,
			},
			storageBefore,
			storageAfter,
			storageGrowthBytes:
				storageAfter.databaseBytes - storageBefore.databaseBytes,
			queries,
			concurrency,
			missingTrigramIndexes: missingIndexes,
		}
		fs.mkdirSync(path.dirname(reportPath), { recursive: true })
		fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
			mode: 0o600,
		})
		fs.chmodSync(reportPath, 0o600)
		console.log(
			`Inserted ${insertedRows} identities at ${report.insert.rowsPerSecond} rows/s; database growth ${bytesLabel(report.storageGrowthBytes)}.`,
		)
		for (const query of queries) {
			console.log(
				`${query.name}: ${query.executionMs.toFixed(3)}ms; indexes=${query.indexes.join(', ') || 'none'}`,
			)
		}
		console.log(
			`Concurrent work: ${searches} searches + ${updateBatches} update batches in ${concurrency.wallMs}ms.`,
		)
		console.log(`Report written: ${reportPath}`)
		if (cleanupAfter) {
			const cleaned = await cleanup(prisma)
			console.log(
				`Cleanup removed ${cleaned.deletedMedia} media rows in ${cleaned.wallMs}ms.`,
			)
		}
		if (requireIndexes && missingIndexes.length) {
			throw new Error(
				`Required trigram indexes were not used: ${missingIndexes.join(', ')}`,
			)
		}
	} finally {
		await prisma.$disconnect()
	}
}

main().catch(error => {
	console.error(error)
	process.exitCode = 1
})
