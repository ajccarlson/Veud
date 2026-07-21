#!/usr/bin/env node
import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { PrismaClient } from '@prisma/client'
import {
	assertSafeLoadDatabaseUrl,
	bytesLabel,
	representativeLoadShape,
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
  --member-count N          Synthetic members (default: 0; staging requires >0)
  --tracking-per-member N   Titles tracked by each member (default: 100)
  --activity-per-member N   Activity events per member (default: 20)
  --member-read-iterations N Concurrent profile/activity reads (default: 20)
  --tracking-write-batches N Concurrent member tracking updates (default: 5)
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
		'--member-count',
		'--tracking-per-member',
		'--activity-per-member',
		'--member-read-iterations',
		'--tracking-write-batches',
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
			pg_total_relation_size('"MediaExternalId"')::bigint AS "identityBytes",
			pg_total_relation_size('"MediaRelation"')::bigint AS "relationBytes",
			pg_total_relation_size('"TrackingState"')::bigint AS "trackingBytes",
			pg_total_relation_size('"Entry"')::bigint AS "entryBytes",
			pg_total_relation_size('"ActivityEvent"')::bigint AS "activityBytes"
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
			"id", "kind", "thumbnail", "title", "type", "releaseStart",
			"releaseEnd", "description", "genres", "language", "studios",
			"serialization", "authors", "catalogScore", "catalogPopularity",
			"releaseStatus", "createdAt", "updatedAt"
		)
		SELECT
			'${prefix}media-' || n,
			${kind},
			'https://synthetic.invalid/posters/' || n || '.jpg',
			'Synthetic ' || ${kind} || ' Catalog Work ' || n ||
				CASE n % 7 WHEN 0 THEN ' Aurora' WHEN 1 THEN ' Meridian'
				WHEN 2 THEN ' Chronicle' ELSE '' END,
			CASE ${kind} WHEN 'movie' THEN 'Movie' WHEN 'tv' THEN 'Series'
				WHEN 'anime' THEN 'TV' ELSE 'Manga' END,
			DATE '1960-01-01' + ((n * 17) % 24000),
			CASE WHEN n % 3 = 0 THEN DATE '1960-01-01' + ((n * 17) % 24000) + (n % 800) ELSE NULL END,
			'Shared synthetic load description for indexed discovery. Record ' || n || '. ' ||
				repeat('Cast, setting, themes, and release metadata vary across this representative catalog record. ', (n % 4) + 1) ||
				CASE n % 997 WHEN 0 THEN 'rare-nebula-token' ELSE '' END,
			CASE n % 5 WHEN 0 THEN 'Drama, Mystery' WHEN 1 THEN 'Action, Fantasy'
				WHEN 2 THEN 'Comedy' WHEN 3 THEN 'Science Fiction' ELSE 'Romance' END,
			CASE WHEN ${kind} IN ('movie', 'tv') THEN 'en' ELSE 'ja' END,
			CASE WHEN ${kind} = 'anime' THEN 'Synthetic Studio ' || (n % 30) ELSE NULL END,
			CASE WHEN ${kind} = 'manga' THEN 'Synthetic Magazine ' || (n % 20) ELSE NULL END,
			CASE WHEN ${kind} = 'manga' THEN 'Synthetic Author ' || (n % 100) ELSE NULL END,
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

async function insertCatalogContext(prisma, count) {
	await prisma.$executeRawUnsafe(
		`INSERT INTO "MediaRelation" (
			"id", "relationType", "provider", "createdAt", "updatedAt",
			"sourceMediaId", "targetMediaId"
		)
		SELECT
			'${prefix}relation-' || n,
			CASE n % 30 WHEN 0 THEN 'prequel' ELSE 'sequel' END,
			CASE WHEN ${kindSql()} IN ('movie', 'tv') THEN 'tmdb' ELSE 'mal' END,
			CURRENT_TIMESTAMP,
			CURRENT_TIMESTAMP,
			'${prefix}media-' || n,
			'${prefix}media-' || (n + 1)
		FROM generate_series(10, $1::int, 10) AS n
		WHERE n < $1::int
		ON CONFLICT DO NOTHING`,
		count,
	)
	await prisma.$executeRawUnsafe(
		`INSERT INTO "CatalogFeedItem" (
			"id", "provider", "kind", "feed", "rank", "observedAt", "mediaId"
		)
		SELECT
			'${prefix}feed-' || n,
			CASE WHEN ${kindSql()} IN ('movie', 'tv') THEN 'tmdb' ELSE 'mal' END,
			${kindSql()},
			CASE n % 300 WHEN 0 THEN 'popular' ELSE 'trending' END,
			(n / 100)::int,
			CURRENT_TIMESTAMP,
			'${prefix}media-' || n
		FROM generate_series(100, $1::int, 100) AS n
		ON CONFLICT DO NOTHING`,
		count,
	)
}

async function ensureRepresentativeListTypes(prisma) {
	await prisma.$executeRawUnsafe(
		`INSERT INTO "ListType" (
			"id", "name", "header", "columns", "mediaType", "completionType"
		) VALUES
			('${prefix}listtype-liveaction', 'liveaction', 'Live Action', '{}', '["episode"]', '{"continuous":"watching"}'),
			('${prefix}listtype-anime', 'anime', 'Anime', '{}', '["episode"]', '{"continuous":"watching"}'),
			('${prefix}listtype-manga', 'manga', 'Manga', '{}', '["chapter","volume"]', '{"continuous":"reading"}')
		ON CONFLICT ("name") DO NOTHING`,
	)
}

async function insertRepresentativeMemberBatch(
	prisma,
	start,
	end,
	shape,
	mediaCount,
) {
	await prisma.$executeRawUnsafe(
		`INSERT INTO "User" (
			"id", "email", "username", "name", "bio", "createdAt", "updatedAt", "lastActiveAt"
		)
		SELECT
			'${prefix}member-' || n,
			'load-catalog-member-' || n || '@synthetic.invalid',
			'load_catalog_member_' || n,
			'Synthetic Member ' || n,
			'Representative PostgreSQL load-test member.',
			CURRENT_TIMESTAMP - ((n % 180) || ' days')::interval,
			CURRENT_TIMESTAMP,
			CURRENT_TIMESTAMP - ((n % 72) || ' hours')::interval
		FROM generate_series($1::int, $2::int) AS n
		ON CONFLICT DO NOTHING`,
		start,
		end,
	)
	await prisma.$executeRawUnsafe(
		`INSERT INTO "Watchlist" (
			"id", "position", "name", "header", "typeId", "isPublic",
			"createdAt", "updatedAt", "ownerId"
		)
		SELECT
			'${prefix}watchlist-' || member_number || '-' || desired.name,
			desired.position,
			desired.status,
			desired.header,
			list_type.id,
			(member_number % 7) <> 0,
			CURRENT_TIMESTAMP,
			CURRENT_TIMESTAMP,
			'${prefix}member-' || member_number
		FROM generate_series($1::int, $2::int) AS member_number
		CROSS JOIN (VALUES
			('liveaction', 'watching', 'Watching', 1),
			('anime', 'watching', 'Watching', 2),
			('manga', 'reading', 'Reading', 3)
		) AS desired(name, status, header, position)
		JOIN "ListType" AS list_type ON list_type.name = desired.name
		ON CONFLICT DO NOTHING`,
		start,
		end,
	)
	await prisma.$executeRawUnsafe(
		`WITH assignments AS (
			SELECT
				member_number,
				slot,
				(1 + mod(
					((member_number - 1)::bigint * $3::bigint) + slot - 1,
					$4::bigint
				))::int AS media_number
			FROM generate_series($1::int, $2::int) AS member_number
			CROSS JOIN generate_series(1, $3::int) AS slot
		)
		INSERT INTO "TrackingState" (
			"id", "status", "score", "repeatCount", "createdAt", "updatedAt",
			"ownerId", "mediaId", "statusWatchlistId"
		)
		SELECT
			'${prefix}tracking-' || member_number || '-' || slot,
			CASE WHEN slot % 4 = 0 THEN 'completed'
				WHEN media.kind = 'manga' THEN 'reading' ELSE 'watching' END,
			CASE WHEN slot % 5 = 0 THEN NULL ELSE ((slot % 10) + 1)::numeric END,
			CASE WHEN slot % 19 = 0 THEN 1 ELSE 0 END,
			CURRENT_TIMESTAMP - ((slot % 730) || ' days')::interval,
			CURRENT_TIMESTAMP - ((slot % 48) || ' hours')::interval,
			'${prefix}member-' || member_number,
			media.id,
			'${prefix}watchlist-' || member_number || '-' ||
				CASE WHEN media.kind IN ('movie', 'tv') THEN 'liveaction' ELSE media.kind END
		FROM assignments
		JOIN "Media" AS media ON media.id = '${prefix}media-' || media_number
		ON CONFLICT DO NOTHING`,
		start,
		end,
		shape.trackingPerMember,
		mediaCount,
	)
	await prisma.$executeRawUnsafe(
		`WITH assigned AS (
			SELECT
				tracking.id AS tracking_id,
				tracking."ownerId" AS owner_id,
				tracking."mediaId" AS media_id,
				media.kind,
				media.title,
				media.thumbnail,
				ROW_NUMBER() OVER (
					PARTITION BY tracking."ownerId",
						CASE WHEN media.kind IN ('movie', 'tv') THEN 'liveaction' ELSE media.kind END
					ORDER BY tracking.id
				)::int AS position
			FROM "TrackingState" AS tracking
			JOIN "Media" AS media ON media.id = tracking."mediaId"
			WHERE tracking."ownerId" IN (
				SELECT '${prefix}member-' || n
				FROM generate_series($1::int, $2::int) AS n
			)
		)
		INSERT INTO "Entry" (
			"id", "watchlistId", "mediaId", "trackingStateId", "position",
			"thumbnail", "title", "type"
		)
		SELECT
			'${prefix}entry-' || substring(tracking_id from length('${prefix}tracking-') + 1),
			'${prefix}watchlist-' || substring(owner_id from length('${prefix}member-') + 1) || '-' ||
				CASE WHEN kind IN ('movie', 'tv') THEN 'liveaction' ELSE kind END,
			media_id,
			tracking_id,
			position,
			thumbnail,
			title,
			CASE kind WHEN 'movie' THEN 'Movie' WHEN 'tv' THEN 'Series'
				WHEN 'anime' THEN 'TV' ELSE 'Manga' END
		FROM assigned
		ON CONFLICT DO NOTHING`,
		start,
		end,
	)
	if (shape.activityPerMember > 0) {
		await prisma.$executeRawUnsafe(
			`WITH activity_rows AS (
				SELECT member_number, slot
				FROM generate_series($1::int, $2::int) AS member_number
				CROSS JOIN generate_series(1, $3::int) AS slot
			)
			INSERT INTO "ActivityEvent" (
				"id", "type", "status", "statusLabel", "score", "isPublic",
				"createdAt", "actorId", "mediaId", "trackingStateId",
				"statusWatchlistId"
			)
			SELECT
				'${prefix}activity-' || member_number || '-' || slot,
				CASE WHEN slot % 4 = 0 THEN 'completed' ELSE 'status' END,
				tracking.status,
				CASE WHEN media.kind = 'manga' THEN 'Reading' ELSE 'Watching' END,
				tracking.score,
				watchlist."isPublic",
				CURRENT_TIMESTAMP - ((slot % 365) || ' days')::interval,
				tracking."ownerId",
				tracking."mediaId",
				tracking.id,
				tracking."statusWatchlistId"
			FROM activity_rows
			JOIN "TrackingState" AS tracking
				ON tracking.id = '${prefix}tracking-' || member_number || '-' || slot
			JOIN "Media" AS media ON media.id = tracking."mediaId"
			JOIN "Watchlist" AS watchlist ON watchlist.id = tracking."statusWatchlistId"
			ON CONFLICT DO NOTHING`,
			start,
			end,
			shape.activityPerMember,
		)
	}
}

async function insertRepresentativeMembers(prisma, shape, mediaCount) {
	if (!shape.memberCount) return
	await ensureRepresentativeListTypes(prisma)
	const memberBatchSize = Math.max(
		1,
		Math.min(1_000, Math.floor(100_000 / shape.trackingPerMember)),
	)
	for (let start = 1; start <= shape.memberCount; start += memberBatchSize) {
		const end = Math.min(shape.memberCount, start + memberBatchSize - 1)
		await insertRepresentativeMemberBatch(prisma, start, end, shape, mediaCount)
		console.log(`Loaded representative members ${end}/${shape.memberCount}`)
	}
}

async function representativeCounts(prisma) {
	const rows = await prisma.$queryRawUnsafe(
		`SELECT
			(SELECT COUNT(*)::int FROM "MediaRelation" WHERE id LIKE '${prefix}relation-%') AS "relationRows",
			(SELECT COUNT(*)::int FROM "CatalogFeedItem" WHERE id LIKE '${prefix}feed-%') AS "feedRows",
			(SELECT COUNT(*)::int FROM "User" WHERE id LIKE '${prefix}member-%') AS "memberCount",
			(SELECT COUNT(*)::int FROM "Watchlist" WHERE id LIKE '${prefix}watchlist-%') AS "watchlistRows",
			(SELECT COUNT(*)::int FROM "TrackingState" WHERE id LIKE '${prefix}tracking-%') AS "trackingRows",
			(SELECT COUNT(*)::int FROM "Entry" WHERE id LIKE '${prefix}entry-%') AS "entryRows",
			(SELECT COUNT(*)::int FROM "ActivityEvent" WHERE id LIKE '${prefix}activity-%') AS "activityRows"`,
	)
	return Object.fromEntries(
		Object.entries(rows[0]).map(([key, value]) => [key, Number(value)]),
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

async function queryMetrics(prisma, count, shape) {
	const needle = Math.max(4, Math.floor(count * 0.73))
	const alternate = Math.max(4, Math.floor((count * 0.44) / 4) * 4)
	const queries = await Promise.all([
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
		explain(
			prisma,
			'related-media',
			`SELECT "targetMediaId" FROM "MediaRelation"
			 WHERE "sourceMediaId" = $1 ORDER BY "relationType" LIMIT 24`,
			[`${prefix}media-${Math.max(10, Math.floor(count / 20) * 10)}`],
		),
		explain(
			prisma,
			'trending-feed',
			`SELECT "mediaId" FROM "CatalogFeedItem"
			 WHERE kind = $1 AND feed = $2 ORDER BY rank LIMIT 18`,
			['movie', 'trending'],
		),
	])
	if (!shape.memberCount) return queries
	let memberNumber = Math.max(1, Math.floor(shape.memberCount / 2))
	if (memberNumber % 7 === 0) {
		memberNumber =
			memberNumber < shape.memberCount ? memberNumber + 1 : memberNumber - 1
	}
	const memberId = `${prefix}member-${Math.max(1, memberNumber)}`
	queries.push(
		await explain(
			prisma,
			'profile-entries',
			`SELECT entry.id FROM "Entry" AS entry
			 JOIN "Watchlist" AS watchlist ON watchlist.id = entry."watchlistId"
			 WHERE watchlist."ownerId" = $1
			 ORDER BY entry.position LIMIT 500`,
			[memberId],
		),
		await explain(
			prisma,
			'profile-activity',
			`SELECT id FROM "ActivityEvent"
			 WHERE "actorId" = $1 AND "isPublic" = true
			 ORDER BY "createdAt" DESC LIMIT 100`,
			[memberId],
		),
	)
	return queries
}

async function concurrentMetrics(
	prisma,
	count,
	searches,
	updateBatches,
	shape,
	memberReads,
	trackingWriteBatches,
) {
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
	if (shape.memberCount) {
		for (let index = 0; index < memberReads; index++) {
			const memberNumber = 1 + (index % shape.memberCount)
			jobs.push(
				prisma.$queryRawUnsafe(
					`SELECT activity.id, activity."createdAt"
					 FROM "ActivityEvent" AS activity
					 WHERE activity."actorId" = $1 AND activity."isPublic" = true
					 ORDER BY activity."createdAt" DESC LIMIT 100`,
					`${prefix}member-${memberNumber}`,
				),
			)
		}
		for (let index = 0; index < trackingWriteBatches; index++) {
			const memberNumber = 1 + (index % shape.memberCount)
			jobs.push(
				prisma.$executeRawUnsafe(
					`UPDATE "TrackingState"
					 SET "updatedAt" = CURRENT_TIMESTAMP
					 WHERE id IN (
						SELECT id FROM "TrackingState"
						WHERE "ownerId" = $1 ORDER BY id LIMIT 200
					 )`,
					`${prefix}member-${memberNumber}`,
				),
			)
		}
	}
	await Promise.all(jobs)
	return {
		searches,
		updateBatches,
		memberReads: shape.memberCount ? memberReads : 0,
		trackingWriteBatches: shape.memberCount ? trackingWriteBatches : 0,
		wallMs: Number((performance.now() - started).toFixed(3)),
	}
}

async function cleanup(prisma) {
	const started = performance.now()
	const users = await prisma.user.deleteMany({
		where: { id: { startsWith: `${prefix}member-` } },
	})
	const media = await prisma.media.deleteMany({
		where: { id: { startsWith: `${prefix}media-` } },
	})
	const listTypes = await prisma.listType.deleteMany({
		where: { id: { startsWith: `${prefix}listtype-` } },
	})
	const [remainingMedia, remainingRepresentative, remainingListTypes] =
		await Promise.all([
			syntheticCount(prisma),
			representativeCounts(prisma),
			prisma.listType.count({
				where: { id: { startsWith: `${prefix}listtype-` } },
			}),
		])
	const residue = {
		mediaRows: remainingMedia,
		...remainingRepresentative,
		listTypeRows: remainingListTypes,
	}
	const nonZeroResidue = Object.entries(residue).filter(([, value]) => value)
	if (nonZeroResidue.length) {
		throw new Error(
			`Synthetic cleanup left rows behind: ${nonZeroResidue.map(([field, value]) => `${field}=${value}`).join(', ')}`,
		)
	}
	return {
		deletedMembers: users.count,
		deletedMedia: media.count,
		deletedSyntheticListTypes: listTypes.count,
		residue,
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
	const memberCount = integer('--member-count', 0, {
		minimum: 0,
		maximum: 100_000,
	})
	const trackingPerMember = integer('--tracking-per-member', 100, {
		maximum: 10_000,
	})
	const activityPerMember = integer('--activity-per-member', 20, {
		minimum: 0,
		maximum: 1_000,
	})
	const memberReads = integer('--member-read-iterations', 20, {
		maximum: 1_000,
	})
	const trackingWriteBatches = integer('--tracking-write-batches', 5, {
		maximum: 100,
	})
	const shape = representativeLoadShape({
		mediaCount: count,
		memberCount,
		trackingPerMember,
		activityPerMember,
	})
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
		`Representative members: ${shape.memberCount}; tracking rows: ${shape.trackingRows}; activity rows: ${shape.activityRows}`,
	)
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
		await insertCatalogContext(prisma, count)
		await insertRepresentativeMembers(prisma, shape, count)
		const insertMs = performance.now() - insertStarted
		const loaded = await syntheticCount(prisma)
		if (loaded !== count) {
			throw new Error(
				`Synthetic load count mismatch: expected ${count}, found ${loaded}`,
			)
		}
		const representative = await representativeCounts(prisma)
		for (const [field, expected] of Object.entries({
			relationRows: shape.relationRows,
			feedRows: shape.feedRows,
			memberCount: shape.memberCount,
			watchlistRows: shape.watchlistRows,
			trackingRows: shape.trackingRows,
			entryRows: shape.entryRows,
			activityRows: shape.activityRows,
		})) {
			if (representative[field] !== expected) {
				throw new Error(
					`Representative load count mismatch for ${field}: expected ${expected}, found ${representative[field]}`,
				)
			}
		}
		await prisma.$executeRawUnsafe('ANALYZE "Media"')
		await prisma.$executeRawUnsafe('ANALYZE "MediaTitle"')
		await prisma.$executeRawUnsafe('ANALYZE "MediaExternalId"')
		await prisma.$executeRawUnsafe('ANALYZE "MediaRelation"')
		await prisma.$executeRawUnsafe('ANALYZE "CatalogFeedItem"')
		if (shape.memberCount) {
			await prisma.$executeRawUnsafe('ANALYZE "TrackingState"')
			await prisma.$executeRawUnsafe('ANALYZE "Entry"')
			await prisma.$executeRawUnsafe('ANALYZE "ActivityEvent"')
		}
		const queries = await queryMetrics(prisma, count, shape)
		const concurrency = await concurrentMetrics(
			prisma,
			count,
			searches,
			updateBatches,
			shape,
			memberReads,
			trackingWriteBatches,
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
			representative: {
				...representative,
				trackingPerMember: shape.trackingPerMember,
				activityPerMember: shape.activityPerMember,
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
			`Concurrent work: ${searches} searches + ${updateBatches} hydration updates + ${concurrency.memberReads} member reads + ${concurrency.trackingWriteBatches} tracking writes in ${concurrency.wallMs}ms.`,
		)
		console.log(`Report written: ${reportPath}`)
		if (cleanupAfter) {
			const cleaned = await cleanup(prisma)
			console.log(
				`Cleanup removed ${cleaned.deletedMedia} media and ${cleaned.deletedMembers} member rows in ${cleaned.wallMs}ms.`,
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
