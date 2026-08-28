#!/usr/bin/env node
import 'dotenv/config'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { PrismaClient } from '@prisma/client'
import { assertCatalogWriterRuntimeProof } from './catalog-writer-runtime-guard.mjs'
import {
	assertMediaDetailLoadEvidence,
	assertPublicSurfaceLoadBudgets,
	assertRequiredQueryIndexes,
	assertRequiredQueryRows,
	assertSafeLoadDatabaseUrl,
	bytesLabel,
	calendarLoadWindow,
	representativeProfileEntryShape,
	representativeLoadShape,
	summarizeDatabasePressure,
	summarizeExplain,
	validateLoadCheckpoint,
} from './postgres-load-utils.mjs'

assertCatalogWriterRuntimeProof(process.env)

const args = process.argv.slice(2)
const prefix = 'load-catalog-'
const syntheticBroadDescriptionNeedle = 'Shared synthetic load description'
const syntheticDescriptionLead = `${syntheticBroadDescriptionNeedle} for indexed discovery.`
const syntheticRareDescriptionRow = 73_003
const syntheticRareDescriptionNeedle = `rare-nebula-token-${syntheticRareDescriptionRow}`
const requiredTrigramIndexesByQuery = {
	'canonical-title': 'Media_title_trgm_idx',
	'person-name': 'Person_normalized_trgm_idx',
	'tracking-exact-title': 'Media_title_trgm_idx',
	'alternate-title': 'MediaTitle_normalized_trgm_idx',
	'rare-description': 'Media_description_trgm_idx',
	// Batched Tip of My Tongue branches must each stay index-visible; a
	// LOWER(...) wrapper or an OR-ed predicate would regress to a scan.
	'tip-of-tongue-canonical-title': 'Media_title_trgm_idx',
	'tip-of-tongue-description': 'Media_description_trgm_idx',
	'tip-of-tongue-alternate-title': 'MediaTitle_normalized_trgm_idx',
	// The union is what the application actually issues, so it must stay
	// index-visible too, not only its individual branches.
	'tip-of-tongue-batched-union': 'Media_title_trgm_idx',
}
const requiredCalendarIndexesByQuery = {
	'calendar-media-range': 'Media_nextReleaseAt_idx',
	'calendar-occurrence-range': 'ReleaseOccurrence_releaseAt_status_idx',
	'calendar-public-tracker-counts': 'TrackingState_mediaId_idx',
}
const requiredProfileIndexesByQuery = {
	'profile-entry-page': 'Entry_watchlistId_id_idx',
	'profile-activity-owner': 'ActivityEvent_actorId_createdAt_id_idx',
	'profile-activity-public':
		'ActivityEvent_actorId_isPublic_publicEligible_createdAt_id_idx',
	'profile-review-page': 'Review_authorId_moderationStatus_createdAt_id_idx',
	'profile-diary-activity': 'DiaryEntry_ownerId_createdAt_id_idx',
	'profile-diary-page': 'DiaryEntry_ownerId_loggedOn_createdAt_id_idx',
}
const requiredProfileRowsByQuery = {
	'profile-entry-page': 500,
	'profile-activity-owner': 100,
	'profile-activity-public': 100,
	'profile-review-page': 100,
	'profile-diary-activity': 100,
	'profile-diary-page': 100,
}
// The exact-match needle returns one person; the broad needle must keep
// matching a real slice, or the ORDER BY stops being exercised; the
// two-character needle is what a member triggers first and matches everything.
const requiredPersonRowsByQuery = {
	'person-name': 1,
	'person-name-broad': 48,
	'person-name-min-length': 48,
}
const profileActivityPublicRelationsSql = `LEFT JOIN "Watchlist" AS status_watchlist
   ON status_watchlist.id = activity."statusWatchlistId"
 LEFT JOIN "Watchlist" AS previous_status_watchlist
   ON previous_status_watchlist.id = activity."previousStatusWatchlistId"`
const profileActivityPublicPredicateSql = `activity."isPublic" = true
 AND activity."publicEligible" = true
 AND (
   (
     activity."statusWatchlistId" IS NULL
     AND activity."statusLabel" IS NULL
   )
   OR (
     status_watchlist."ownerId" = $1
     AND status_watchlist."isPublic" = true
   )
 )
 AND (
   (
     activity."previousStatusWatchlistId" IS NULL
     AND activity."previousStatusLabel" IS NULL
   )
   OR (
     previous_status_watchlist."ownerId" = $1
     AND previous_status_watchlist."isPublic" = true
   )
 )`
const profileFixtureTargets = {
	reviewRowsPerMember: 10,
	diaryRowsPerMember: 10,
	activityRows: 120,
	reviewRows: 120,
	hiddenReviewRows: 600,
	diaryRows: 2_000,
	unsafePublicActivityRows: 1,
}
const communityCandidateLimit = 1_000
const communityCandidateChunkSize = 400
const requiredCommunityIndex = 'TrackingState_mediaId_idx'
const communityAggregateGroupsSql = `SELECT
	tracking."mediaId",
	COUNT(*)::int AS "trackerCount",
	COUNT(tracking.score)::int AS "ratingCount",
	AVG(tracking.score)::double precision AS "communityScore"
 FROM "TrackingState" AS tracking
 LEFT JOIN "Watchlist" AS watchlist
   ON watchlist.id = tracking."statusWatchlistId"
 WHERE tracking."mediaId" = ANY($1::text[])
   AND (
     tracking."statusWatchlistId" IS NULL
     OR watchlist."isPublic" = true
   )
 GROUP BY tracking."mediaId"`
const communityAggregateReferenceSql = `SELECT
	COUNT(DISTINCT tracking."mediaId")::int AS "groupCount",
	COUNT(*)::int AS "trackerCount",
	COUNT(tracking.score)::int AS "ratingCount",
	AVG(tracking.score)::double precision AS "communityScore"
 FROM "TrackingState" AS tracking
 LEFT JOIN "Watchlist" AS watchlist
   ON watchlist.id = tracking."statusWatchlistId"
 WHERE tracking."mediaId" = ANY($1::text[])
   AND (
     tracking."statusWatchlistId" IS NULL
     OR watchlist."isPublic" = true
   )`
const usage = `Usage: npm run db:loadtest:postgres -- [options]

Options:
  --count N                 Synthetic media identities (default: 100000)
  --batch-size N            Rows per generate_series batch (default: 10000)
  --search-iterations N     Concurrent search reads (default: 20)
  --update-batches N        Concurrent hydration-style updates (default: 5)
  --member-count N          Synthetic members (default: 0)
  --tracking-per-member N   Titles tracked by each member (default: 100)
  --activity-per-member N   Activity events per member (default: 20)
  --member-read-iterations N Concurrent profile/activity reads (default: 20)
  --tracking-write-batches N Concurrent member tracking updates (default: 5)
  --report PATH             JSON report path (default: test-results/...)
  --checkpoint PATH         Atomic resume checkpoint (required with --resume)
  --interrupt-after-batches N Deliberately stop after N completed media batches
  --commit                  Generate data and run measurements (default: dry-run)
  --resume                  Continue a deterministic interrupted load
  --cleanup-after           Delete only load-catalog-* records after reporting
  --require-trigram-indexes Fail if measured text searches avoid trigram indexes
  --require-calendar-indexes Fail if bounded calendar queries avoid their indexes
  --require-community-indexes Fail if chunked community aggregates avoid their index
  --require-profile-indexes Fail if bounded profile queries avoid their indexes
  --help                    Show this help

DATABASE_URL must use PostgreSQL and its database name must contain a clearly
delimited load, bench, perf, or test marker. Synthetic
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
		'--checkpoint',
		'--interrupt-after-batches',
	])
	const booleans = new Set([
		'--commit',
		'--resume',
		'--cleanup-after',
		'--require-trigram-indexes',
		'--require-calendar-indexes',
		'--require-community-indexes',
		'--require-profile-indexes',
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

function writePrivateJson(filename, value) {
	fs.mkdirSync(path.dirname(filename), { recursive: true })
	const partial = `${filename}.partial`
	fs.writeFileSync(partial, `${JSON.stringify(value, null, 2)}\n`, {
		mode: 0o600,
	})
	fs.renameSync(partial, filename)
	fs.chmodSync(filename, 0o600)
}

function readJson(filename, label) {
	try {
		return JSON.parse(fs.readFileSync(filename, 'utf8'))
	} catch (error) {
		throw new Error(
			`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
		)
	}
}

function sha256File(filename) {
	return createHash('sha256').update(fs.readFileSync(filename)).digest('hex')
}

function kindSql(series = 'n') {
	// The small block offset keeps the overall distribution balanced while
	// ensuring every twentieth (scheduled) row rotates through all four kinds.
	return `CASE (${series} + (${series} / 20)) % 4
		WHEN 0 THEN 'movie'
		WHEN 1 THEN 'tv'
		WHEN 2 THEN 'anime'
		ELSE 'manga' END`
}

function profileFixtureMemberNumber(memberCount) {
	if (!memberCount) return null
	let memberNumber = Math.max(1, Math.floor(memberCount / 2))
	if (memberNumber % 7 === 0) {
		memberNumber =
			memberNumber < memberCount ? memberNumber + 1 : memberNumber - 1
	}
	return Math.max(1, memberNumber)
}

function representativeProfileFixture(shape, mediaCount) {
	const memberNumber = profileFixtureMemberNumber(shape.memberCount)
	const reviewRowsPerMember = Math.min(
		profileFixtureTargets.reviewRowsPerMember,
		mediaCount,
	)
	const diaryRowsPerMember = profileFixtureTargets.diaryRowsPerMember
	const reviewRows = Math.min(
		profileFixtureTargets.reviewRows,
		Math.max(0, mediaCount - reviewRowsPerMember),
	)
	const hiddenReviewRows = Math.min(
		profileFixtureTargets.hiddenReviewRows,
		Math.max(0, mediaCount - reviewRowsPerMember - reviewRows),
	)
	if (memberNumber === null) {
		return {
			memberNumber: null,
			memberId: null,
			watchlistId: null,
			reviewRowsPerMember,
			diaryRowsPerMember,
			expectedEntries: 0,
			entryRows: 0,
			activityRows: 0,
			reviewRows: 0,
			hiddenReviewRows: 0,
			diaryRows: 0,
			unsafePublicActivityRows: 0,
		}
	}
	const entryShape = representativeProfileEntryShape({
		mediaCount,
		trackedEntries: shape.trackingPerMember,
	})

	return {
		memberNumber,
		memberId: `${prefix}member-${memberNumber}`,
		watchlistId: `${prefix}watchlist-${memberNumber}-liveaction`,
		reviewRowsPerMember,
		diaryRowsPerMember,
		expectedEntries: entryShape.expectedEntries,
		entryRows: entryShape.fixtureEntryRows,
		activityRows: profileFixtureTargets.activityRows,
		reviewRows,
		hiddenReviewRows,
		diaryRows: profileFixtureTargets.diaryRows,
		unsafePublicActivityRows: profileFixtureTargets.unsafePublicActivityRows,
	}
}

async function databaseMetrics(prisma) {
	const rows = await prisma.$queryRaw`
		SELECT
			pg_database_size(current_database())::bigint AS "databaseBytes",
			pg_total_relation_size('"Media"')::bigint AS "mediaBytes",
			pg_total_relation_size('"MediaTitle"')::bigint AS "titleBytes",
			pg_total_relation_size('"MediaExternalId"')::bigint AS "identityBytes",
			pg_total_relation_size('"MediaRelation"')::bigint AS "relationBytes",
			pg_total_relation_size('"Person"')::bigint AS "personBytes",
			pg_total_relation_size('"MediaCredit"')::bigint AS "mediaCreditBytes",
			pg_total_relation_size('"ReleaseOccurrence"')::bigint AS "releaseOccurrenceBytes",
			pg_total_relation_size('"TrackingState"')::bigint AS "trackingBytes",
			pg_total_relation_size('"Entry"')::bigint AS "entryBytes",
			pg_total_relation_size('"ActivityEvent"')::bigint AS "activityBytes",
			pg_total_relation_size('"Review"')::bigint AS "reviewBytes",
			pg_total_relation_size('"DiaryEntry"')::bigint AS "diaryBytes"
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

async function insertBatch(prisma, start, end, scheduleAnchor) {
	const kind = kindSql()
	await prisma.$executeRawUnsafe(
		`INSERT INTO "Media" (
			"id", "kind", "thumbnail", "title", "type", "releaseStart",
			"releaseEnd", "nextRelease", "nextReleaseAt", "description", "genres",
			"language", "studios", "serialization", "authors", "catalogScore",
			"catalogPopularity", "releaseStatus", "catalogProvenanceVersion",
			"createdAt", "updatedAt"
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
			CASE WHEN n % 20 = 0 THEN json_build_object(
				'releaseDate',
				to_char(
					(
						date_trunc('hour', $4::timestamptz)
						+ make_interval(days => mod(n, 180))
					) AT TIME ZONE 'UTC',
					'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
				),
				'source',
				CASE WHEN ${kind} IN ('movie', 'tv') THEN 'tmdb' ELSE 'anilist' END,
				'observedAt',
				to_char(
					$4::timestamptz AT TIME ZONE 'UTC',
					'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
				),
				'episode',
				CASE WHEN ${kind} IN ('tv', 'anime') THEN mod(n, 24) + 1 ELSE NULL END,
				'chapter',
				CASE WHEN ${kind} = 'manga' THEN mod(n, 200) + 1 ELSE NULL END
			)::text ELSE NULL END,
			CASE WHEN n % 20 = 0
				THEN date_trunc('hour', $4::timestamptz) + make_interval(days => mod(n, 180))
				ELSE NULL END,
			$3::text || ' Record ' || n || '. ' ||
				repeat('Cast, setting, themes, and release metadata vary across this representative catalog record. ', (n % 4) + 1) ||
				CASE WHEN n = $5::int THEN $6::text ELSE '' END,
			CASE n % 5 WHEN 0 THEN 'Drama, Mystery' WHEN 1 THEN 'Action, Fantasy'
				WHEN 2 THEN 'Comedy' WHEN 3 THEN 'Science Fiction' ELSE 'Romance' END,
			CASE WHEN ${kind} IN ('movie', 'tv') THEN 'en' ELSE 'ja' END,
			CASE WHEN ${kind} = 'anime' THEN 'Synthetic Studio ' || (n % 30) ELSE NULL END,
			CASE WHEN ${kind} = 'manga' THEN 'Synthetic Magazine ' || (n % 20) ELSE NULL END,
			CASE WHEN ${kind} = 'manga' THEN 'Synthetic Author ' || (n % 100) ELSE NULL END,
			((n % 100)::double precision / 10.0),
			(1.0 / n::double precision),
			CASE n % 3 WHEN 0 THEN 'Released' WHEN 1 THEN 'Returning Series' ELSE 'Planned' END,
			1,
			CURRENT_TIMESTAMP,
			CURRENT_TIMESTAMP
		FROM generate_series($1::int, $2::int) AS n
		ON CONFLICT ("id") DO UPDATE SET
			"nextRelease" = EXCLUDED."nextRelease",
			"nextReleaseAt" = EXCLUDED."nextReleaseAt",
			"catalogProvenanceVersion" = EXCLUDED."catalogProvenanceVersion"
		WHERE "Media"."nextRelease" IS DISTINCT FROM EXCLUDED."nextRelease"
			OR "Media"."nextReleaseAt" IS DISTINCT FROM EXCLUDED."nextReleaseAt"
			OR "Media"."catalogProvenanceVersion" IS DISTINCT FROM 1`,
		start,
		end,
		syntheticDescriptionLead,
		scheduleAnchor,
		syntheticRareDescriptionRow,
		syntheticRareDescriptionNeedle,
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
	await prisma.$executeRawUnsafe(
		`INSERT INTO "Person" (
			"id", "name", "normalized", "knownForDepartment", "createdAt", "updatedAt"
		)
		SELECT
			'${prefix}person-' || n,
			'Synthetic Performer ' || n,
			'synthetic performer ' || n,
			'Acting',
			CURRENT_TIMESTAMP,
			CURRENT_TIMESTAMP
		FROM generate_series($1::int, $2::int) AS n
		ON CONFLICT ("id") DO NOTHING`,
		start,
		end,
	)
	await prisma.$executeRawUnsafe(
		`INSERT INTO "MediaCredit" (
			"id", "creditType", "role", "department", "billingOrder",
			"provider", "catalogProvenanceVersion", "createdAt", "updatedAt",
			"mediaId", "personId"
		)
		SELECT
			'${prefix}credit-' || n,
			'cast',
			'Synthetic role ' || n,
			'',
			0,
			CASE WHEN ${kindSql()} IN ('movie', 'tv') THEN 'tmdb' ELSE 'mal' END,
			1,
			CURRENT_TIMESTAMP,
			CURRENT_TIMESTAMP,
			'${prefix}media-' || n,
			'${prefix}person-' || n
		FROM generate_series($1::int, $2::int) AS n
		ON CONFLICT ("id") DO NOTHING`,
		start,
		end,
	)
}

async function insertCatalogContext(prisma, count, scheduleAnchor) {
	await prisma.$executeRawUnsafe(
		`INSERT INTO "MediaRelation" (
			"id", "relationType", "provider", "createdAt", "updatedAt",
			"sourceMediaId", "targetMediaId", "catalogProvenanceVersion"
		)
		SELECT
			'${prefix}relation-' || n,
			CASE n % 30 WHEN 0 THEN 'prequel' ELSE 'sequel' END,
			CASE WHEN ${kindSql()} IN ('movie', 'tv') THEN 'tmdb' ELSE 'mal' END,
			CURRENT_TIMESTAMP,
			CURRENT_TIMESTAMP,
			'${prefix}media-' || n,
			'${prefix}media-' || (n + 1),
			1
		FROM generate_series(10, $1::int, 10) AS n
		WHERE n < $1::int
		ON CONFLICT ("sourceMediaId", "targetMediaId", "relationType")
		DO UPDATE SET
			"catalogProvenanceVersion" = EXCLUDED."catalogProvenanceVersion"`,
		count,
	)
	await prisma.$executeRawUnsafe(
		`INSERT INTO "CatalogFeedItem" (
			"id", "provider", "kind", "feed", "rank", "audience",
			"rankingScore", "rankingVersion", "observedAt", "mediaId"
		)
		SELECT
			'${prefix}feed-' || n,
			CASE WHEN ${kindSql()} IN ('movie', 'tv') THEN 'tmdb' ELSE 'mal' END,
			${kindSql()},
			CASE n % 300 WHEN 0 THEN 'popular' ELSE 'trending' END,
			(n / 100)::int,
			(($1::int - n) + 1) * 10,
			(1.0 / n::double precision),
			3,
			CURRENT_TIMESTAMP,
			'${prefix}media-' || n
		FROM generate_series(100, $1::int, 100) AS n
		ON CONFLICT ("id") DO UPDATE SET
			"feed" = EXCLUDED."feed",
			"rank" = EXCLUDED."rank",
			"audience" = EXCLUDED."audience",
			"rankingScore" = EXCLUDED."rankingScore",
			"rankingVersion" = EXCLUDED."rankingVersion",
			"observedAt" = EXCLUDED."observedAt"`,
		count,
	)
	await prisma.$executeRawUnsafe(
		`INSERT INTO "ReleaseOccurrence" (
			"id", "source", "sourceKey", "eventType", "releaseAt", "allDay",
			"season", "episode", "volume", "chapter", "name", "status",
			"observedAt", "expiresAt", "createdAt", "updatedAt", "mediaId"
		)
		SELECT
			'${prefix}occurrence-' || n,
			CASE WHEN ${kindSql()} IN ('movie', 'tv') THEN 'tmdb' ELSE 'anilist' END,
			'calendar-' || n,
			CASE WHEN ${kindSql()} = 'manga' THEN 'chapter'
				WHEN ${kindSql()} IN ('tv', 'anime') THEN 'episode'
				ELSE 'release' END,
			date_trunc('hour', $2::timestamptz) + make_interval(days => mod(n, 180)),
			false,
			CASE WHEN ${kindSql()} IN ('tv', 'anime') THEN mod(n, 8) + 1 ELSE NULL END,
			CASE WHEN ${kindSql()} IN ('tv', 'anime') THEN mod(n, 24) + 1 ELSE NULL END,
			CASE WHEN ${kindSql()} = 'manga' THEN mod(n, 30) + 1 ELSE NULL END,
			CASE WHEN ${kindSql()} = 'manga' THEN mod(n, 200) + 1 ELSE NULL END,
			'Synthetic scheduled release ' || n,
			'scheduled',
			$2::timestamptz,
			$2::timestamptz + INTERVAL '365 days',
			$2::timestamptz,
			$2::timestamptz,
			'${prefix}media-' || n
		FROM generate_series(25, $1::int, 25) AS n
		ON CONFLICT DO NOTHING`,
		count,
		scheduleAnchor,
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
	const profileFixture = representativeProfileFixture(shape, mediaCount)
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
		`INSERT INTO "MediaCollection" (
			"id", "title", "description", "isPublic", "createdAt", "updatedAt",
			"moderationStatus", "ownerId"
		)
		SELECT
			'${prefix}collection-' || member_number || '-' || visibility.label,
			'Representative ' || visibility.label || ' collection ' || member_number,
			'Representative PostgreSQL public-surface collection fixture.',
			visibility.is_public,
			CURRENT_TIMESTAMP - ((member_number % 45) || ' days')::interval,
			CURRENT_TIMESTAMP,
			'visible',
			'${prefix}member-' || member_number
		FROM generate_series($1::int, $2::int) AS member_number
		CROSS JOIN (VALUES
			('public', true),
			('private', false)
		) AS visibility(label, is_public)
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
			CASE WHEN slot % 11 = 0 THEN NULL ELSE
				'${prefix}watchlist-' || member_number || '-' ||
					CASE WHEN media.kind IN ('movie', 'tv') THEN 'liveaction' ELSE media.kind END
			END
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
				"publicEligible", "createdAt", "actorId", "mediaId", "trackingStateId",
				"statusWatchlistId"
			)
			SELECT
				'${prefix}activity-' || member_number || '-' || slot,
				CASE WHEN slot % 4 = 0 THEN 'completed' ELSE 'status' END,
				tracking.status,
				CASE WHEN tracking."statusWatchlistId" IS NULL THEN NULL
					WHEN media.kind = 'manga' THEN 'Reading' ELSE 'Watching' END,
				tracking.score,
				COALESCE(watchlist."isPublic", true),
				COALESCE(watchlist."isPublic", true),
				CURRENT_TIMESTAMP - ((slot % 365) || ' days')::interval,
				tracking."ownerId",
				tracking."mediaId",
				tracking.id,
				tracking."statusWatchlistId"
			FROM activity_rows
			JOIN "TrackingState" AS tracking
				ON tracking.id = '${prefix}tracking-' || member_number || '-' || slot
			JOIN "Media" AS media ON media.id = tracking."mediaId"
			LEFT JOIN "Watchlist" AS watchlist ON watchlist.id = tracking."statusWatchlistId"
			ON CONFLICT DO NOTHING`,
			start,
			end,
			shape.activityPerMember,
		)
	}
	await prisma.$executeRawUnsafe(
		`INSERT INTO "Review" (
			"id", "body", "containsSpoilers", "rating", "createdAt", "updatedAt",
			"moderationStatus", "authorId", "mediaId"
		)
		SELECT
			'${prefix}review-' || member_number || '-' || review_slot,
			'Representative profile review ' || member_number || '-' || review_slot,
			(review_slot % 9) = 0,
			((review_slot % 10) + 1)::numeric,
			CURRENT_TIMESTAMP - (
				((member_number + review_slot) % 90) || ' days'
			)::interval,
			CURRENT_TIMESTAMP,
			'visible',
			'${prefix}member-' || member_number,
			'${prefix}media-' || (
				1 + mod(
					((member_number - 1)::bigint * $3::bigint) + review_slot - 1,
					$4::bigint
				)
			)
		FROM generate_series($1::int, $2::int) AS member_number
		CROSS JOIN generate_series(1, $5::int) AS review_slot
		ON CONFLICT DO NOTHING`,
		start,
		end,
		shape.trackingPerMember,
		mediaCount,
		profileFixture.reviewRowsPerMember,
	)
	await prisma.$executeRawUnsafe(
		`INSERT INTO "DiaryEntry" (
			"id", "loggedOn", "isRepeat", "rating", "createdAt", "updatedAt",
			"ownerId", "mediaId"
		)
		SELECT
			'${prefix}diary-' || member_number || '-' || diary_slot,
			CURRENT_TIMESTAMP - (
				((member_number + diary_slot) % 120) || ' days'
			)::interval,
			(diary_slot % 5) = 0,
			((diary_slot % 10) + 1)::numeric,
			CURRENT_TIMESTAMP - (
				((member_number + diary_slot) % 90) || ' days'
			)::interval,
			CURRENT_TIMESTAMP,
			'${prefix}member-' || member_number,
			'${prefix}media-' || (
				1 + mod(
					((member_number - 1)::bigint * $3::bigint) + diary_slot - 1,
					$4::bigint
				)
			)
		FROM generate_series($1::int, $2::int) AS member_number
		CROSS JOIN generate_series(1, $5::int) AS diary_slot
		ON CONFLICT DO NOTHING`,
		start,
		end,
		shape.trackingPerMember,
		mediaCount,
		profileFixture.diaryRowsPerMember,
	)
}

async function insertRepresentativeProfileFixture(prisma, shape, mediaCount) {
	const fixture = representativeProfileFixture(shape, mediaCount)
	if (fixture.memberNumber === null) return

	await prisma.$executeRawUnsafe(
		`WITH live_action_media AS (
			SELECT
				media.id,
				media.thumbnail,
				media.title,
				media.type,
				media."releaseStart",
				media.genres,
				ROW_NUMBER() OVER (ORDER BY media_number)::int AS media_slot,
				COUNT(*) OVER()::int AS media_count
			FROM generate_series(1, $3::int) AS media_number
			JOIN "Media" AS media
				ON media.id = '${prefix}media-' || media_number
			WHERE media.kind IN ('movie', 'tv')
		), assignments AS (
			SELECT
				slot,
				1 + mod(
					slot - 1,
					(SELECT MAX(media_count) FROM live_action_media)
				) AS media_slot
			FROM generate_series(1, $2::int) AS slot
		)
		INSERT INTO "Entry" (
			"id", "watchlistId", "mediaId", "position", "thumbnail", "title",
			"type", "releaseStart", "history", "genres", "story", "character",
			"presentation", "sound", "performance", "enjoyment", "averaged",
			"personal", "airYear", "length", "tmdbScore"
		)
		SELECT
			'${prefix}entry-heavy-' || $1::int || '-' || assignments.slot,
			'${prefix}watchlist-' || $1::int || '-liveaction',
			media.id,
			10000 + assignments.slot,
			media.thumbnail,
			media.title,
			media.type,
			media."releaseStart",
			json_build_object(
				'Added',
				to_char(
					(CURRENT_TIMESTAMP - (assignments.slot || ' minutes')::interval)
						AT TIME ZONE 'UTC',
					'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
				)
			)::text,
			media.genres,
			8,
			8,
			8,
			8,
			8,
			8,
			8,
			8,
			EXTRACT(YEAR FROM media."releaseStart")::int::text,
			'120 min',
			7.5
		FROM assignments
		JOIN live_action_media AS media USING (media_slot)
		ON CONFLICT DO NOTHING`,
		fixture.memberNumber,
		fixture.entryRows,
		mediaCount,
	)

	await prisma.$executeRawUnsafe(
		`WITH activity_rows AS (
			SELECT
				slot,
				1 + mod(slot - 1, $3::int) AS tracking_slot
			FROM generate_series(1, $2::int) AS slot
		)
		INSERT INTO "ActivityEvent" (
			"id", "type", "status", "statusLabel", "previousStatus",
			"previousStatusLabel", "score", "previousScore", "progressUnit",
			"progressCurrent", "progressPrevious", "progressTotal", "isPublic",
			"publicEligible",
			"createdAt", "actorId", "mediaId", "trackingStateId",
			"statusWatchlistId", "previousStatusWatchlistId"
		)
		SELECT
			'${prefix}activity-heavy-' || $1::int || '-' || activity_rows.slot,
			CASE WHEN activity_rows.slot % 4 = 0 THEN 'completed' ELSE 'progress' END,
			tracking.status,
			CASE WHEN tracking."statusWatchlistId" IS NULL THEN NULL
				WHEN media.kind = 'manga' THEN 'Reading' ELSE 'Watching' END,
			CASE WHEN tracking."statusWatchlistId" IS NULL
				THEN NULL ELSE 'planning' END,
			CASE WHEN tracking."statusWatchlistId" IS NULL
				THEN NULL ELSE 'Planning' END,
			tracking.score,
			NULL,
			CASE WHEN media.kind = 'manga' THEN 'chapter' ELSE 'episode' END,
			activity_rows.slot,
			activity_rows.slot - 1,
			CASE WHEN media.kind = 'manga' THEN 200 ELSE 24 END,
			COALESCE(watchlist."isPublic", true),
			COALESCE(watchlist."isPublic", true),
			CURRENT_TIMESTAMP - (activity_rows.slot || ' minutes')::interval,
			tracking."ownerId",
			tracking."mediaId",
			tracking.id,
			tracking."statusWatchlistId",
			tracking."statusWatchlistId"
		FROM activity_rows
		JOIN "TrackingState" AS tracking
			ON tracking.id = '${prefix}tracking-' || $1::int || '-' ||
				activity_rows.tracking_slot
		JOIN "Media" AS media ON media.id = tracking."mediaId"
		LEFT JOIN "Watchlist" AS watchlist
			ON watchlist.id = tracking."statusWatchlistId"
		ON CONFLICT DO NOTHING`,
		fixture.memberNumber,
		fixture.activityRows,
		shape.trackingPerMember,
	)

	await prisma.$executeRawUnsafe(
		`INSERT INTO "ActivityEvent" (
			"id", "type", "statusLabel", "isPublic", "publicEligible",
			"createdAt", "actorId", "mediaId"
		)
		SELECT
			'${prefix}activity-unsafe-' || $1::int,
			'status',
			'Legacy list without immutable provenance',
			true,
			false,
			CURRENT_TIMESTAMP + INTERVAL '1 minute',
			'${prefix}member-' || $1::int,
			'${prefix}media-1'
		WHERE $2::int > 0
		ON CONFLICT DO NOTHING`,
		fixture.memberNumber,
		fixture.unsafePublicActivityRows,
	)

	await prisma.$executeRawUnsafe(
		`WITH review_rows AS (
			SELECT
				slot,
				1 + mod(
					(($1::int - 1)::bigint * $3::bigint) +
						$5::bigint + slot - 1,
					$4::bigint
				)::int AS media_number
			FROM generate_series(1, $2::int) AS slot
		)
		INSERT INTO "Review" (
			"id", "body", "containsSpoilers", "rating", "createdAt", "updatedAt",
			"moderationStatus", "authorId", "mediaId"
		)
		SELECT
			'${prefix}review-heavy-' || $1::int || '-' || review_rows.slot,
			'Representative profile review ' || $1::int || '-' || review_rows.slot,
			(review_rows.slot % 9) = 0,
			((review_rows.slot % 10) + 1)::numeric,
			CURRENT_TIMESTAMP - (review_rows.slot || ' hours')::interval,
			CURRENT_TIMESTAMP,
			CASE WHEN review_rows.slot <= $6::int THEN 'visible' ELSE 'hidden' END,
			'${prefix}member-' || $1::int,
			'${prefix}media-' || review_rows.media_number
		FROM review_rows
		ON CONFLICT DO NOTHING`,
		fixture.memberNumber,
		fixture.reviewRows + fixture.hiddenReviewRows,
		shape.trackingPerMember,
		mediaCount,
		fixture.reviewRowsPerMember,
		fixture.reviewRows,
	)

	await prisma.$executeRawUnsafe(
		`WITH diary_rows AS (
			SELECT
				slot,
				1 + mod(slot - 1, $3::int) AS media_number
			FROM generate_series(1, $2::int) AS slot
		)
		INSERT INTO "DiaryEntry" (
			"id", "loggedOn", "isRepeat", "rating", "createdAt", "updatedAt",
			"ownerId", "mediaId"
		)
		SELECT
			'${prefix}diary-heavy-' || $1::int || '-' || diary_rows.slot,
			CURRENT_TIMESTAMP - (
				(1 + mod(diary_rows.slot * 37, 5000)) || ' days'
			)::interval,
			(diary_rows.slot % 5) = 0,
			((diary_rows.slot % 10) + 1)::numeric,
			CURRENT_TIMESTAMP - (diary_rows.slot || ' minutes')::interval,
			CURRENT_TIMESTAMP,
			'${prefix}member-' || $1::int,
			'${prefix}media-' || diary_rows.media_number
		FROM diary_rows
		ON CONFLICT DO NOTHING`,
		fixture.memberNumber,
		fixture.diaryRows,
		mediaCount,
	)
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
	await insertRepresentativeProfileFixture(prisma, shape, mediaCount)
}

async function representativeCounts(prisma) {
	const rows = await prisma.$queryRawUnsafe(
		`SELECT
			(SELECT COUNT(*)::int FROM "MediaRelation" WHERE id LIKE '${prefix}relation-%') AS "relationRows",
			(SELECT COUNT(*)::int FROM "CatalogFeedItem" WHERE id LIKE '${prefix}feed-%') AS "feedRows",
			(SELECT COUNT(*)::int FROM "Media"
			 WHERE id LIKE '${prefix}media-%' AND "nextReleaseAt" IS NOT NULL) AS "nextReleaseRows",
			(SELECT COUNT(*)::int FROM "ReleaseOccurrence"
			 WHERE id LIKE '${prefix}occurrence-%') AS "releaseOccurrenceRows",
			(SELECT COUNT(*)::int FROM "Person"
			 WHERE id LIKE '${prefix}person-%') AS "personRows",
			(SELECT COUNT(*)::int FROM "MediaCredit"
			 WHERE id LIKE '${prefix}credit-%') AS "mediaCreditRows",
			(SELECT COUNT(*)::int FROM "User" WHERE id LIKE '${prefix}member-%') AS "memberCount",
			(SELECT COUNT(*)::int FROM "Watchlist" WHERE id LIKE '${prefix}watchlist-%') AS "watchlistRows",
			(SELECT COUNT(*)::int FROM "MediaCollection"
			 WHERE id LIKE '${prefix}collection-%') AS "collectionRows",
			(SELECT COUNT(*)::int FROM "MediaCollection"
			 WHERE id LIKE '${prefix}collection-%' AND "isPublic" = true
			   AND "moderationStatus" = 'visible') AS "publicCollectionRows",
			(SELECT COUNT(*)::int FROM "TrackingState" WHERE id LIKE '${prefix}tracking-%') AS "trackingRows",
			(SELECT COUNT(*)::int FROM "TrackingState" AS tracking
			 JOIN "Watchlist" AS watchlist ON watchlist.id = tracking."statusWatchlistId"
			 WHERE tracking.id LIKE '${prefix}tracking-%' AND watchlist."isPublic" = true) AS "publicListTrackingRows",
			(SELECT COUNT(*)::int FROM "TrackingState" AS tracking
			 JOIN "Watchlist" AS watchlist ON watchlist.id = tracking."statusWatchlistId"
			 WHERE tracking.id LIKE '${prefix}tracking-%' AND watchlist."isPublic" = false) AS "privateListTrackingRows",
			(SELECT COUNT(*)::int FROM "TrackingState"
			 WHERE id LIKE '${prefix}tracking-%' AND "statusWatchlistId" IS NULL) AS "nullListTrackingRows",
			(SELECT COUNT(*)::int FROM "Entry" WHERE id LIKE '${prefix}entry-%') AS "entryRows",
			(SELECT COUNT(*)::int FROM "ActivityEvent" WHERE id LIKE '${prefix}activity-%') AS "activityRows",
			(SELECT COUNT(*)::int FROM "Review" WHERE id LIKE '${prefix}review-%') AS "reviewRows",
			(SELECT COUNT(*)::int FROM "DiaryEntry" WHERE id LIKE '${prefix}diary-%') AS "diaryRows",
			(SELECT COUNT(*)::int FROM "Entry"
			 WHERE id LIKE '${prefix}entry-heavy-%') AS "heavyEntryRows",
			(SELECT COUNT(*)::int FROM "ActivityEvent"
			 WHERE id LIKE '${prefix}activity-heavy-%') AS "heavyActivityRows",
			(SELECT COUNT(*)::int FROM "Review"
			 WHERE id LIKE '${prefix}review-heavy-%') AS "heavyReviewRows",
			(SELECT COUNT(*)::int FROM "DiaryEntry"
			 WHERE id LIKE '${prefix}diary-heavy-%') AS "heavyDiaryRows"`,
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

function communityAggregateChunks(count) {
	const candidateIds = Array.from(
		{ length: Math.min(communityCandidateLimit, count) },
		(_, index) => `${prefix}media-${index + 1}`,
	)
	const chunks = []
	for (
		let offset = 0;
		offset < candidateIds.length;
		offset += communityCandidateChunkSize
	) {
		chunks.push({
			name: `community-aggregate-chunk-${offset / communityCandidateChunkSize + 1}`,
			candidateIds: candidateIds.slice(
				offset,
				offset + communityCandidateChunkSize,
			),
		})
	}
	return { candidateIds, chunks }
}

function summarizeCommunityAggregateRows(rows) {
	let trackerCount = 0
	let ratingCount = 0
	let scoreTotal = 0
	for (const row of rows) {
		const rowTrackerCount = Number(row.trackerCount)
		const rowRatingCount = Number(row.ratingCount)
		const rowCommunityScore =
			row.communityScore === null ? null : Number(row.communityScore)
		if (
			!Number.isSafeInteger(rowTrackerCount) ||
			rowTrackerCount < 1 ||
			!Number.isSafeInteger(rowRatingCount) ||
			rowRatingCount < 0 ||
			rowRatingCount > rowTrackerCount ||
			(rowRatingCount === 0
				? rowCommunityScore !== null
				: !Number.isFinite(rowCommunityScore))
		) {
			throw new Error('Community aggregate query returned invalid values')
		}
		trackerCount += rowTrackerCount
		ratingCount += rowRatingCount
		scoreTotal += (rowCommunityScore ?? 0) * rowRatingCount
	}
	return {
		groups: rows.length,
		trackers: trackerCount,
		ratings: ratingCount,
		weightedMean: ratingCount ? scoreTotal / ratingCount : null,
	}
}

function matchingCommunitySummaries(left, right) {
	const scoresMatch =
		left.weightedMean === null || right.weightedMean === null
			? left.weightedMean === right.weightedMean
			: Math.abs(left.weightedMean - right.weightedMean) <=
				1e-10 *
					Math.max(1, Math.abs(left.weightedMean), Math.abs(right.weightedMean))
	return (
		left.groups === right.groups &&
		left.trackers === right.trackers &&
		left.ratings === right.ratings &&
		scoresMatch
	)
}

async function communityAggregateMetrics(prisma, count) {
	const { candidateIds, chunks } = communityAggregateChunks(count)
	const chunkMetrics = []
	for (const chunk of chunks) {
		const rows = await prisma.$queryRawUnsafe(
			communityAggregateGroupsSql,
			chunk.candidateIds,
		)
		chunkMetrics.push({
			name: chunk.name,
			candidateCount: chunk.candidateIds.length,
			...summarizeCommunityAggregateRows(rows),
		})
	}
	const totalRatingCount = chunkMetrics.reduce(
		(total, chunk) => total + chunk.ratings,
		0,
	)
	const total = {
		groups: chunkMetrics.reduce((total, chunk) => total + chunk.groups, 0),
		trackers: chunkMetrics.reduce((total, chunk) => total + chunk.trackers, 0),
		ratings: totalRatingCount,
		weightedMean: totalRatingCount
			? chunkMetrics.reduce(
					(total, chunk) => total + (chunk.weightedMean ?? 0) * chunk.ratings,
					0,
				) / totalRatingCount
			: null,
	}
	const referenceRows = await prisma.$queryRawUnsafe(
		communityAggregateReferenceSql,
		candidateIds,
	)
	if (referenceRows.length !== 1) {
		throw new Error('Community aggregate reference query returned no result')
	}
	const reference = {
		groups: Number(referenceRows[0].groupCount),
		trackers: Number(referenceRows[0].trackerCount),
		ratings: Number(referenceRows[0].ratingCount),
		weightedMean:
			referenceRows[0].communityScore === null
				? null
				: Number(referenceRows[0].communityScore),
	}
	return {
		candidateCount: candidateIds.length,
		chunks: chunkMetrics,
		total,
		reference,
		matchesReference: matchingCommunitySummaries(total, reference),
	}
}

/**
 * The people-search statement, shared by every needle it is measured with.
 *
 * Kept beside findPeople in shape - same filter, same order, same select list,
 * same limit. `search-suggestions.server.test.ts` fails if that query starts
 * aggregating again, which is the regression this gate cannot see on its own:
 * the harness measures its own SQL, so it would keep passing.
 */
const personSearchSql = `SELECT person.id, person.name, person."imageUrl",
        person."knownForDepartment", person."creditCount"
	 FROM "Person" AS person
	 WHERE person.normalized ILIKE $1
	   AND person."creditCount" > 0
	 ORDER BY person."creditCount" DESC, person.name ASC, person.id ASC
	 LIMIT 48`

async function queryMetrics(prisma, count, shape, scheduleAnchor) {
	const needle = Math.max(4, Math.floor(count * 0.73))
	const alternate = Math.max(4, Math.floor((count * 0.44) / 4) * 4)
	const calendarWindow = calendarLoadWindow(scheduleAnchor)
	const definitions = [
		[
			'canonical-title',
			'SELECT id FROM "Media" WHERE title ILIKE $1 LIMIT 24',
			[`%Catalog Work ${needle}%`],
		],
		// Three shapes of the same search, because one needle cannot represent
		// it. The select list matches what findPeople actually asks for: a
		// narrower one would let PostgreSQL choose an index-only scan the
		// application never gets.
		['person-name', personSearchSql, [`%synthetic performer ${needle}%`]],
		[
			// The exact-match needle above returns a single row, so it sorts
			// nothing and would stay fast however the ordering degraded. This one
			// matches a large slice, which is what makes the ORDER BY real work.
			'person-name-broad',
			personSearchSql,
			['%synthetic performer 1%'],
		],
		[
			// What a member triggers first: MIN_SUGGESTION_QUERY is 2.
			//
			// A pg_trgm index cannot serve a LIKE pattern with fewer than three
			// consecutive literal characters, so this scans by construction, not
			// through bad luck with selectivity. Measured on 200,010 rows with a
			// trigram index present, holding match count roughly equal:
			//
			//   ILIKE '%zqx%'  ->  5 rows, Bitmap Index Scan,   0.046 ms
			//   ILIKE '%zq%'   -> 10 rows, Seq Scan,           46.18  ms
			//
			// Deliberately absent from requiredTrigramIndexesByQuery: requiring an
			// index here would demand something PostgreSQL cannot do. It is
			// measured so the cost of the shortest query the application accepts
			// is visible, rather than assumed away by only testing longer
			// needles that happen to reach the index.
			'person-name-min-length',
			personSearchSql,
			['%rf%'],
		],
		[
			'tracking-exact-title',
			`SELECT id FROM "Media" WHERE title ILIKE $1 ESCAPE '!' LIMIT 4`,
			[`Catalog Work ${needle}`],
		],
		[
			'alternate-title',
			'SELECT "mediaId" FROM "MediaTitle" WHERE normalized ILIKE $1 LIMIT 24',
			[`%alternate load alias ${alternate}%`],
		],
		[
			'rare-description',
			'SELECT id FROM "Media" WHERE description ILIKE $1 LIMIT 24',
			[`%${syntheticRareDescriptionNeedle}%`],
		],
		[
			'broad-description',
			'SELECT id FROM "Media" WHERE description ILIKE $1 LIMIT 24',
			[`%${syntheticBroadDescriptionNeedle}%`],
		],
		[
			'no-match',
			'SELECT id FROM "MediaTitle" WHERE normalized ILIKE $1 LIMIT 24',
			['%term-that-does-not-exist-7f01%'],
		],
		[
			'popular-page',
			`SELECT id FROM "Media"
			 ORDER BY "catalogPopularity" DESC NULLS LAST, id
			 LIMIT 24 OFFSET $1`,
			[Math.min(10_000, Math.max(0, count - 24))],
		],
		[
			'related-media',
			`SELECT "targetMediaId" FROM "MediaRelation"
			 WHERE "sourceMediaId" = $1 ORDER BY "relationType" LIMIT 24`,
			[`${prefix}media-${Math.max(10, Math.floor(count / 20) * 10)}`],
		],
		[
			'trending-feed',
			`SELECT "mediaId" FROM "CatalogFeedItem"
			 WHERE provider = $1
			   AND kind = $2
			   AND feed = $3
			   AND "rankingScore" IS NOT NULL
			   AND "rankingVersion" >= $4
			   AND "observedAt" >= $5
			 ORDER BY "observedAt" DESC, "rankingScore" DESC, rank ASC
			 LIMIT 18`,
			[
				'tmdb',
				'movie',
				'trending',
				3,
				new Date(new Date(scheduleAnchor).getTime() - 8 * 24 * 60 * 60 * 1_000),
			],
		],
		[
			'popular-feed-fallback',
			`SELECT "mediaId" FROM "CatalogFeedItem"
			 WHERE provider = $1
			   AND kind = $2
			   AND feed = $3
			   AND "rankingScore" IS NOT NULL
			   AND "rankingVersion" >= $4
			 ORDER BY "rankingScore" DESC, rank ASC, "mediaId" ASC
			 LIMIT 18`,
			['tmdb', 'movie', 'popular', 3],
		],
		[
			'catalog-popularity-fallback',
			`SELECT id FROM "Media"
			 WHERE kind = $1
			   AND title IS NOT NULL
			   AND "catalogPopularity" IS NOT NULL
			 ORDER BY "catalogPopularity" DESC, "releaseStart" DESC, title ASC
			 LIMIT 18`,
			['movie'],
		],
		[
			'discovery-genre-facets',
			`SELECT DISTINCT genres AS value
			 FROM "Media"
			 WHERE genres IS NOT NULL
			   AND length(genres) BETWEEN 1 AND $1
			 ORDER BY genres ASC
			 LIMIT $2`,
			[512, 4_097],
		],
		[
			'discovery-status-facets',
			`SELECT DISTINCT "releaseStatus" AS value
			 FROM "Media"
			 WHERE "releaseStatus" IS NOT NULL
			   AND length("releaseStatus") BETWEEN 1 AND $1
			 ORDER BY "releaseStatus" ASC
			 LIMIT $2`,
			[60, 257],
		],
		[
			'calendar-media-range',
			`SELECT id FROM "Media"
			 WHERE "nextReleaseAt" >= $1 AND "nextReleaseAt" < $2
			 ORDER BY id LIMIT 10001`,
			[calendarWindow.start, calendarWindow.end],
		],
		[
			'calendar-occurrence-range',
			`SELECT "mediaId", "releaseAt" FROM "ReleaseOccurrence"
			 WHERE "releaseAt" >= $1 AND "releaseAt" < $2
			   AND status = 'scheduled' AND "expiresAt" > $3
			 ORDER BY "releaseAt", id LIMIT 10001`,
			[calendarWindow.start, calendarWindow.end, calendarWindow.reference],
		],
		// Tip of My Tongue candidate branches. Each is measured on its own so a
		// branch that stops using its trigram index is caught rather than hidden
		// inside a union. ILIKE is what keeps the GIN indexes plan-visible; a
		// LOWER(...) wrapper would silently force a sequential scan.
		[
			'tip-of-tongue-canonical-title',
			`SELECT id FROM "Media"
			 WHERE "title" IS NOT NULL AND "kind" = $1
			   AND "title" ILIKE $2 ESCAPE '!'
			 LIMIT 72`,
			['movie', `%Catalog Work ${needle}%`],
		],
		[
			'tip-of-tongue-description',
			`SELECT id FROM "Media"
			 WHERE "title" IS NOT NULL AND "kind" = $1
			   AND "description" ILIKE $2 ESCAPE '!'
			 LIMIT 72`,
			['movie', `%${syntheticRareDescriptionNeedle}%`],
		],
		[
			'tip-of-tongue-alternate-title',
			`SELECT "Media".id FROM "Media"
			 JOIN "MediaTitle" ON "MediaTitle"."mediaId" = "Media".id
			 WHERE "Media"."title" IS NOT NULL AND "Media"."kind" = $1
			   AND "MediaTitle"."normalized" ILIKE $2 ESCAPE '!'
			 LIMIT 72`,
			['movie', `%alternate load alias ${alternate}%`],
		],
		[
			'tip-of-tongue-batched-union',
			`WITH matched AS (
				SELECT id AS id, 0 AS source_rank,
					COALESCE("catalogPopularity", 0) AS popularity
				FROM "Media"
				WHERE "title" IS NOT NULL AND "kind" = $1
				  AND "title" ILIKE $2 ESCAPE '!'
				UNION ALL
				SELECT "Media".id AS id, 1 AS source_rank,
					COALESCE("Media"."catalogPopularity", 0) AS popularity
				FROM "Media"
				JOIN "MediaTitle" ON "MediaTitle"."mediaId" = "Media".id
				WHERE "Media"."title" IS NOT NULL AND "Media"."kind" = $1
				  AND "MediaTitle"."normalized" ILIKE $2 ESCAPE '!'
				UNION ALL
				SELECT id AS id, 2 AS source_rank,
					COALESCE("catalogPopularity", 0) AS popularity
				FROM "Media"
				WHERE "title" IS NOT NULL AND "kind" = $1
				  AND "description" ILIKE $2 ESCAPE '!'
			 )
			 SELECT matched.id AS id,
				MIN(matched.source_rank) AS source_rank,
				MAX(matched.popularity) AS popularity
			 FROM matched
			 GROUP BY matched.id
			 ORDER BY source_rank ASC, popularity DESC, id ASC
			 LIMIT 72`,
			['movie', `%Catalog Work ${needle}%`],
		],
	]
	const queries = []
	for (const definition of definitions) {
		queries.push(await explain(prisma, ...definition))
	}
	if (!shape.memberCount) return queries
	const profileFixture = representativeProfileFixture(shape, count)
	const memberId = profileFixture.memberId
	const publicWatchlistId = profileFixture.watchlistId
	const publicTrackerCandidateIds = [
		...Array.from(
			{ length: Math.min(200, count) },
			(_, index) => `${prefix}media-${index + 1}`,
		),
		...Array.from(
			{ length: Math.min(200, Math.max(0, count - 600)) },
			(_, index) => `${prefix}media-${index + 601}`,
		),
	]
	queries.push(
		await explain(
			prisma,
			'profile-entry-page',
			`SELECT
				id, "watchlistId", "mediaId", "trackingStateId", type,
				"releaseStart", history, genres, story, character, presentation,
				sound, performance, enjoyment, averaged, personal, "airYear",
				"startSeason", "startYear", length, chapters, volumes,
				"tmdbScore", "malScore"
			 FROM "Entry"
			 WHERE "watchlistId" = $1 AND id > $2
			 ORDER BY id LIMIT 500`,
			[publicWatchlistId, ''],
		),
		await explain(
			prisma,
			'profile-activity-owner',
			`SELECT
				id, type, status, "statusLabel", "previousStatus",
				"previousStatusLabel", score, "previousScore", "progressUnit",
				"progressCurrent", "progressPrevious", "progressTotal",
				"createdAt", "mediaId"
			 FROM "ActivityEvent"
			 WHERE "actorId" = $1
			 ORDER BY "createdAt" DESC, id DESC LIMIT 100`,
			[memberId],
		),
		await explain(
			prisma,
			'profile-activity-public',
			`SELECT
				activity.id, activity.type, activity.status,
				activity."statusLabel", activity."previousStatus",
				activity."previousStatusLabel", activity.score,
				activity."previousScore", activity."progressUnit",
				activity."progressCurrent", activity."progressPrevious",
				activity."progressTotal", activity."createdAt", activity."mediaId"
			 FROM "ActivityEvent" AS activity
			 ${profileActivityPublicRelationsSql}
			 WHERE activity."actorId" = $1
			   AND ${profileActivityPublicPredicateSql}
			 ORDER BY activity."createdAt" DESC, activity.id DESC LIMIT 100`,
			[memberId],
		),
		await explain(
			prisma,
			'profile-review-page',
			`SELECT
				id, body, "containsSpoilers", rating, "createdAt", "updatedAt",
				"mediaId"
			 FROM "Review"
			 WHERE "authorId" = $1 AND "moderationStatus" = 'visible'
			 ORDER BY "createdAt" DESC, id DESC LIMIT 100`,
			[memberId],
		),
		await explain(
			prisma,
			'anonymous-public-collection-count',
			`SELECT COUNT(*)::int
			 FROM "MediaCollection" AS collection
			 WHERE collection."isPublic" = true
			   AND collection."moderationStatus" = 'visible'
			   AND EXISTS (
			     SELECT 1
			     FROM "User" AS owner
			     WHERE owner.id = collection."ownerId"
			       AND owner."accountStatus" = 'active'
			   )`,
		),
		await explain(
			prisma,
			'profile-diary-activity',
			`SELECT id, "isRepeat", "createdAt", "mediaId"
			 FROM "DiaryEntry"
			 WHERE "ownerId" = $1
			 ORDER BY "createdAt" DESC, id DESC LIMIT 100`,
			[memberId],
		),
		await explain(
			prisma,
			'profile-diary-page',
			`SELECT id, "loggedOn", "isRepeat", rating, "createdAt", "mediaId"
			 FROM "DiaryEntry"
			 WHERE "ownerId" = $1
			 ORDER BY "loggedOn" DESC, "createdAt" DESC, id DESC LIMIT 100`,
			[memberId],
		),
		await explain(
			prisma,
			'calendar-public-tracker-counts',
			`SELECT tracking."mediaId", COUNT(*)::int AS "trackerCount"
			 FROM "TrackingState" AS tracking
			 LEFT JOIN "Watchlist" AS watchlist
			   ON watchlist.id = tracking."statusWatchlistId"
			 WHERE tracking."mediaId" = ANY($1::text[])
			   AND (
			     tracking."statusWatchlistId" IS NULL
			     OR watchlist."isPublic" = true
			   )
			 GROUP BY tracking."mediaId"`,
			[publicTrackerCandidateIds],
		),
	)
	const { chunks: communityChunks } = communityAggregateChunks(count)
	for (const chunk of communityChunks) {
		queries.push(
			await explain(prisma, chunk.name, communityAggregateGroupsSql, [
				chunk.candidateIds,
			]),
		)
	}
	return queries
}

function requiredCommunityIndexesByQuery(count) {
	return Object.fromEntries(
		communityAggregateChunks(count).chunks.map(chunk => [
			chunk.name,
			requiredCommunityIndex,
		]),
	)
}

async function databasePressureSnapshot(prisma) {
	const rows = await prisma.$queryRawUnsafe(
		`SELECT
			current_setting('max_connections')::int AS "maxConnections",
			(SELECT COUNT(*)::int FROM pg_stat_activity
			 WHERE datname = current_database()) AS "totalConnections",
			(SELECT COUNT(*)::int FROM pg_stat_activity
			 WHERE datname = current_database() AND state = 'active') AS "activeConnections",
			(SELECT COUNT(*)::int FROM pg_locks AS locks
			 JOIN pg_stat_activity AS activity ON activity.pid = locks.pid
			 WHERE activity.datname = current_database() AND NOT locks.granted) AS "waitingLocks"`,
	)
	return rows[0]
}

function wait(milliseconds) {
	return new Promise(resolve => setTimeout(resolve, milliseconds))
}

async function runProfileLoaderSmoke({
	username,
	expectedEntries,
	expectedActivity,
	unsafeActivityId,
	reportPath,
}) {
	const smokeReportPath = `${reportPath}.profile-loaders.json`
	if (fs.existsSync(smokeReportPath)) fs.unlinkSync(smokeReportPath)
	const smokeScript = path.resolve('scripts/smoke-profile-loaders-postgres.ts')
	const childArgs = [
		'--import',
		'tsx',
		smokeScript,
		'--username',
		username,
		'--expected-entries',
		String(expectedEntries),
		'--expected-activity',
		String(expectedActivity),
		'--unsafe-activity-id',
		unsafeActivityId,
		'--report',
		smokeReportPath,
	]
	await new Promise((resolve, reject) => {
		const child = spawn(process.execPath, childArgs, {
			cwd: process.cwd(),
			env: {
				...process.env,
				NODE_ENV: 'test',
				SESSION_SECRET:
					process.env.SESSION_SECRET ?? 'postgres-profile-smoke-only',
			},
			stdio: 'inherit',
		})
		child.once('error', reject)
		child.once('exit', (code, signal) => {
			if (code === 0) {
				resolve()
				return
			}
			reject(
				new Error(
					`Profile loader smoke failed (${signal ? `signal ${signal}` : `exit ${code}`})`,
				),
			)
		})
	})
	if (!fs.existsSync(smokeReportPath)) {
		throw new Error('Profile loader smoke did not write its report')
	}
	const report = readJson(smokeReportPath, 'Profile loader smoke report')
	if (!report || typeof report !== 'object' || report.version !== 1) {
		throw new Error('Profile loader smoke report must use version 1')
	}
	assertMediaDetailLoadEvidence(report.mediaDetail)
	fs.unlinkSync(smokeReportPath)
	return report
}

async function runPublicSurfaceSmoke({ username, reportPath }) {
	const smokeReportPath = `${reportPath}.public-surfaces.json`
	if (fs.existsSync(smokeReportPath)) fs.unlinkSync(smokeReportPath)
	const smokeScript = path.resolve('scripts/smoke-public-surfaces-postgres.ts')
	const childArgs = [
		'--import',
		'tsx',
		smokeScript,
		'--username',
		username,
		'--report',
		smokeReportPath,
	]
	await new Promise((resolve, reject) => {
		const child = spawn(process.execPath, childArgs, {
			cwd: process.cwd(),
			env: {
				...process.env,
				NODE_ENV: 'test',
				CACHE_DATABASE_PATH: ':memory:',
				SESSION_SECRET:
					process.env.SESSION_SECRET ?? 'postgres-public-surface-smoke-only',
			},
			stdio: 'inherit',
		})
		child.once('error', reject)
		child.once('exit', (code, signal) => {
			if (code === 0) {
				resolve()
				return
			}
			reject(
				new Error(
					`Public-surface smoke failed (${signal ? `signal ${signal}` : `exit ${code}`})`,
				),
			)
		})
	})
	if (!fs.existsSync(smokeReportPath)) {
		throw new Error('Public-surface smoke did not write its report')
	}
	const report = readJson(smokeReportPath, 'Public-surface smoke report')
	fs.unlinkSync(smokeReportPath)
	assertPublicSurfaceLoadBudgets(report)
	return report
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
				'SELECT id FROM "Media" WHERE title ILIKE $1 LIMIT 24',
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
					 ${profileActivityPublicRelationsSql}
					 WHERE activity."actorId" = $1
					   AND ${profileActivityPublicPredicateSql}
					 ORDER BY activity."createdAt" DESC, activity.id DESC LIMIT 100`,
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
	let workFinished = false
	const work = Promise.all(jobs).finally(() => {
		workFinished = true
	})
	const pressureSamples = []
	do {
		pressureSamples.push(await databasePressureSnapshot(prisma))
		if (!workFinished) await Promise.race([work, wait(10)])
	} while (!workFinished && pressureSamples.length < 1_000)
	await work
	return {
		searches,
		updateBatches,
		memberReads: shape.memberCount ? memberReads : 0,
		trackingWriteBatches: shape.memberCount ? trackingWriteBatches : 0,
		databasePressure: summarizeDatabasePressure(pressureSamples),
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
	const people = await prisma.person.deleteMany({
		where: { id: { startsWith: `${prefix}person-` } },
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
		deletedPeople: people.count,
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
	const interruptAfterBatches = integer('--interrupt-after-batches', 0, {
		minimum: 0,
		maximum: 100_000,
	})
	const totalBatches = Math.ceil(count / batchSize)
	if (
		valueFor('--interrupt-after-batches') !== undefined &&
		(interruptAfterBatches < 1 || interruptAfterBatches > totalBatches)
	) {
		throw new Error(
			`--interrupt-after-batches must be from 1 through ${totalBatches}`,
		)
	}
	const shape = representativeLoadShape({
		mediaCount: count,
		memberCount,
		trackingPerMember,
		activityPerMember,
	})
	const profileFixture = representativeProfileFixture(shape, count)
	const commit = args.includes('--commit')
	const resume = args.includes('--resume')
	const cleanupAfter = args.includes('--cleanup-after')
	const requireTrigramIndexes = args.includes('--require-trigram-indexes')
	const requireCalendarIndexes = args.includes('--require-calendar-indexes')
	const requireCommunityIndexes = args.includes('--require-community-indexes')
	const requireProfileIndexes = args.includes('--require-profile-indexes')
	if (requireCalendarIndexes && !shape.memberCount) {
		throw new Error(
			'--require-calendar-indexes requires --member-count so the bounded tracker aggregation is measured',
		)
	}
	if (requireCommunityIndexes && !shape.memberCount) {
		throw new Error(
			'--require-community-indexes requires --member-count so community aggregates are measured',
		)
	}
	if (requireProfileIndexes && !shape.memberCount) {
		throw new Error(
			'--require-profile-indexes requires --member-count so profile queries are measured',
		)
	}
	if (
		requireProfileIndexes &&
		(profileFixture.entryRows <= 500 ||
			profileFixture.activityRows + shape.activityPerMember <= 100 ||
			profileFixture.reviewRows + profileFixture.reviewRowsPerMember <= 100 ||
			profileFixture.hiddenReviewRows <
				profileFixtureTargets.hiddenReviewRows ||
			profileFixture.diaryRows + profileFixture.diaryRowsPerMember <= 100)
	) {
		throw new Error(
			'--require-profile-indexes requires enough media for the representative profile fixture to exceed every bounded page',
		)
	}
	const target = assertSafeLoadDatabaseUrl(process.env.DATABASE_URL)
	const reportPath = path.resolve(
		valueFor('--report') ??
			`test-results/postgres-load-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
	)
	const checkpointArgument = valueFor('--checkpoint')
	if (resume && !checkpointArgument) {
		throw new Error('--resume requires the original --checkpoint path')
	}
	if (resume && interruptAfterBatches) {
		throw new Error(
			'--interrupt-after-batches cannot be combined with --resume',
		)
	}
	const checkpointPath = path.resolve(
		checkpointArgument ?? `${reportPath}.checkpoint.json`,
	)
	console.log(`Target: ${target.identity}`)
	console.log(`Synthetic identities: ${count}`)
	console.log(
		`Representative members: ${shape.memberCount}; tracking rows: ${shape.trackingRows}; activity rows: ${shape.activityRows}`,
	)
	if (profileFixture.memberId) {
		console.log(
			`Profile fixture: ${profileFixture.memberId}; +${profileFixture.entryRows} list entries, +${profileFixture.activityRows} valid activity events, +${profileFixture.unsafePublicActivityRows} provenance-negative event, +${profileFixture.reviewRows} visible reviews, +${profileFixture.hiddenReviewRows} hidden review fixtures, +${profileFixture.diaryRows} diary rows`,
		)
	}
	console.log(
		`Mode: ${commit ? (resume ? 'COMMIT/RESUME' : 'COMMIT') : 'DRY-RUN'}`,
	)
	console.log(`Report: ${reportPath}`)
	console.log(`Checkpoint: ${checkpointPath}`)
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
		const expectedCheckpoint = {
			target: target.identity,
			requestedRows: count,
			memberCount: shape.memberCount,
			trackingPerMember: shape.trackingPerMember,
			activityPerMember: shape.activityPerMember,
		}
		let checkpoint
		let observedRowsAtResume = 0
		if (resume) {
			if (!fs.existsSync(checkpointPath)) {
				throw new Error(`Load checkpoint not found: ${checkpointPath}`)
			}
			checkpoint = validateLoadCheckpoint(
				readJson(checkpointPath, 'Load checkpoint'),
				expectedCheckpoint,
			)
			observedRowsAtResume = existing
			if (existing < checkpoint.loadedRows) {
				throw new Error(
					`Target lost synthetic rows after the checkpoint: expected at least ${checkpoint.loadedRows}, found ${existing}`,
				)
			}
			checkpoint.status = 'loading'
			checkpoint.resumedAt ??= new Date().toISOString()
			checkpoint.updatedAt = new Date().toISOString()
			writePrivateJson(checkpointPath, checkpoint)
		} else {
			if (fs.existsSync(checkpointPath)) {
				throw new Error(
					`Checkpoint already exists: ${checkpointPath}; use a new path or resume the original run`,
				)
			}
			const startedAt = new Date().toISOString()
			checkpoint = {
				version: 1,
				status: 'loading',
				...expectedCheckpoint,
				initialRows: existing,
				loadedRows: existing,
				batchesCompleted: 0,
				insertWallMs: 0,
				storageBefore: await databaseMetrics(prisma),
				startedAt,
				updatedAt: startedAt,
			}
			writePrivateJson(checkpointPath, checkpoint)
		}
		const storageBefore = checkpoint.storageBefore
		let invocationBatches = 0
		for (let start = 1; start <= count; start += batchSize) {
			const end = Math.min(count, start + batchSize - 1)
			const batchStarted = performance.now()
			await insertBatch(prisma, start, end, checkpoint.startedAt)
			checkpoint.insertWallMs += performance.now() - batchStarted
			checkpoint.loadedRows = Math.max(checkpoint.loadedRows, end)
			checkpoint.batchesCompleted += 1
			checkpoint.updatedAt = new Date().toISOString()
			writePrivateJson(checkpointPath, checkpoint)
			invocationBatches += 1
			console.log(`Loaded ${end}/${count} synthetic identities`)
			if (interruptAfterBatches === invocationBatches) {
				checkpoint.status = 'interrupted'
				checkpoint.interruptedAt = new Date().toISOString()
				checkpoint.updatedAt = checkpoint.interruptedAt
				writePrivateJson(checkpointPath, checkpoint)
				throw new Error(
					`Deliberate interruption after ${invocationBatches} batches; resume with --resume --checkpoint ${checkpointPath}`,
				)
			}
		}
		const relatedStarted = performance.now()
		await insertCatalogContext(prisma, count, checkpoint.startedAt)
		await insertRepresentativeMembers(prisma, shape, count)
		checkpoint.insertWallMs += performance.now() - relatedStarted
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
			nextReleaseRows: shape.nextReleaseRows,
			releaseOccurrenceRows: shape.releaseOccurrenceRows,
			personRows: count,
			mediaCreditRows: count,
			memberCount: shape.memberCount,
			watchlistRows: shape.watchlistRows,
			collectionRows: shape.collectionRows,
			publicCollectionRows: shape.publicCollectionRows,
			trackingRows: shape.trackingRows,
			publicListTrackingRows: shape.publicListTrackingRows,
			privateListTrackingRows: shape.privateListTrackingRows,
			nullListTrackingRows: shape.nullListTrackingRows,
			entryRows: shape.entryRows + profileFixture.entryRows,
			activityRows:
				shape.activityRows +
				profileFixture.activityRows +
				profileFixture.unsafePublicActivityRows,
			reviewRows:
				shape.memberCount * profileFixture.reviewRowsPerMember +
				profileFixture.reviewRows +
				profileFixture.hiddenReviewRows,
			diaryRows:
				shape.memberCount * profileFixture.diaryRowsPerMember +
				profileFixture.diaryRows,
			heavyEntryRows: profileFixture.entryRows,
			heavyActivityRows: profileFixture.activityRows,
			heavyReviewRows:
				profileFixture.reviewRows + profileFixture.hiddenReviewRows,
			heavyDiaryRows: profileFixture.diaryRows,
		})) {
			if (representative[field] !== expected) {
				throw new Error(
					`Representative load count mismatch for ${field}: expected ${expected}, found ${representative[field]}`,
				)
			}
		}
		checkpoint.status = 'completed'
		checkpoint.loadedRows = loaded
		checkpoint.completedAt = new Date().toISOString()
		checkpoint.updatedAt = checkpoint.completedAt
		writePrivateJson(checkpointPath, checkpoint)
		const checkpointSha256 = sha256File(checkpointPath)
		await prisma.$executeRawUnsafe('ANALYZE "Media"')
		await prisma.$executeRawUnsafe('ANALYZE "MediaTitle"')
		await prisma.$executeRawUnsafe('ANALYZE "MediaExternalId"')
		await prisma.$executeRawUnsafe('ANALYZE "MediaRelation"')
		await prisma.$executeRawUnsafe('ANALYZE "CatalogFeedItem"')
		await prisma.$executeRawUnsafe('ANALYZE "Person"')
		await prisma.$executeRawUnsafe('ANALYZE "MediaCredit"')
		await prisma.$executeRawUnsafe('ANALYZE "ReleaseOccurrence"')
		if (shape.memberCount) {
			await prisma.$executeRawUnsafe('ANALYZE "Watchlist"')
			await prisma.$executeRawUnsafe('ANALYZE "TrackingState"')
			await prisma.$executeRawUnsafe('ANALYZE "Entry"')
			await prisma.$executeRawUnsafe('ANALYZE "ActivityEvent"')
			await prisma.$executeRawUnsafe('ANALYZE "Review"')
			await prisma.$executeRawUnsafe('ANALYZE "MediaCollection"')
			await prisma.$executeRawUnsafe('ANALYZE "DiaryEntry"')
		}
		const communityAggregates = shape.memberCount
			? await communityAggregateMetrics(prisma, count)
			: null
		const communityAggregateAssertionError =
			communityAggregates && !communityAggregates.matchesReference
				? new Error(
						`Chunked community aggregates differ from the scalar reference: chunks=${JSON.stringify(communityAggregates.total)} reference=${JSON.stringify(communityAggregates.reference)}`,
					)
				: undefined
		const queries = await queryMetrics(
			prisma,
			count,
			shape,
			checkpoint.startedAt,
		)
		const profileLoaderSmoke = profileFixture.memberNumber
			? await runProfileLoaderSmoke({
					username: `load_catalog_member_${profileFixture.memberNumber}`,
					expectedEntries: profileFixture.expectedEntries,
					expectedActivity: 100,
					unsafeActivityId: `${prefix}activity-unsafe-${profileFixture.memberNumber}`,
					reportPath,
				})
			: null
		const publicSurfaceSmoke = profileFixture.memberNumber
			? await runPublicSurfaceSmoke({
					username: 'load_catalog_member_1',
					reportPath,
				})
			: null
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
		let personRowAssertionError
		try {
			// A search that matches nothing sorts nothing. Measuring one and
			// reporting the number as evidence that search is fast is how a gate
			// stops meaning anything.
			assertRequiredQueryRows(queries, requiredPersonRowsByQuery)
		} catch (error) {
			personRowAssertionError = error
		}
		let queryIndexAssertionError
		try {
			assertRequiredQueryIndexes(queries, requiredTrigramIndexesByQuery)
		} catch (error) {
			queryIndexAssertionError = error
		}
		let calendarQueryIndexAssertionError
		try {
			assertRequiredQueryIndexes(queries, requiredCalendarIndexesByQuery)
		} catch (error) {
			calendarQueryIndexAssertionError = error
		}
		let communityQueryIndexAssertionError
		if (shape.memberCount) {
			try {
				assertRequiredQueryIndexes(
					queries,
					requiredCommunityIndexesByQuery(count),
				)
			} catch (error) {
				communityQueryIndexAssertionError = error
			}
		}
		let profileQueryIndexAssertionError
		let profileQueryRowAssertionError
		if (shape.memberCount) {
			try {
				assertRequiredQueryIndexes(queries, requiredProfileIndexesByQuery)
			} catch (error) {
				profileQueryIndexAssertionError = error
			}
			try {
				assertRequiredQueryRows(queries, requiredProfileRowsByQuery)
			} catch (error) {
				profileQueryRowAssertionError = error
			}
		}
		const missingQueryIndexes =
			queryIndexAssertionError?.missingRequirements ?? []
		const missingIndexes = [
			...new Set(missingQueryIndexes.map(({ requiredIndex }) => requiredIndex)),
		]
		const missingCalendarQueryIndexes =
			calendarQueryIndexAssertionError?.missingRequirements ?? []
		const missingCalendarIndexes = [
			...new Set(
				missingCalendarQueryIndexes.map(({ requiredIndex }) => requiredIndex),
			),
		]
		const missingCommunityQueryIndexes =
			communityQueryIndexAssertionError?.missingRequirements ?? []
		const missingCommunityIndexes = [
			...new Set(
				missingCommunityQueryIndexes.map(({ requiredIndex }) => requiredIndex),
			),
		]
		const missingProfileQueryIndexes =
			profileQueryIndexAssertionError?.missingRequirements ?? []
		const missingProfileIndexes = [
			...new Set(
				missingProfileQueryIndexes.map(({ requiredIndex }) => requiredIndex),
			),
		]
		const insertedRows = loaded - checkpoint.initialRows
		const insertMs = checkpoint.insertWallMs
		const report = {
			version: 1,
			measuredAt: new Date().toISOString(),
			target: target.identity,
			requestedRows: count,
			loadedRows: loaded,
			existingRows: checkpoint.initialRows,
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
				profileFixture,
			},
			communityAggregates,
			profileLoaderSmoke,
			publicSurfaceSmoke,
			recovery: {
				checkpointSha256,
				interruptedAt: checkpoint.interruptedAt ?? null,
				resumedAt: checkpoint.resumedAt ?? null,
				observedRowsAtResume,
				completedAt: checkpoint.completedAt,
			},
			storageBefore,
			storageAfter,
			storageGrowthBytes:
				storageAfter.databaseBytes - storageBefore.databaseBytes,
			queries,
			concurrency,
			missingTrigramIndexes: missingIndexes,
			missingQueryIndexes,
			missingCalendarIndexes,
			missingCalendarQueryIndexes,
			missingCommunityIndexes,
			missingCommunityQueryIndexes,
			missingProfileIndexes,
			missingProfileQueryIndexes,
			profileQueryRowFailures: profileQueryRowAssertionError?.rowFailures ?? [],
		}
		writePrivateJson(reportPath, report)
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
		if (communityAggregates) {
			console.log(
				`Community aggregates: ${communityAggregates.candidateCount} candidates in ${communityAggregates.chunks.length} chunks; groups=${communityAggregates.total.groups}; trackers=${communityAggregates.total.trackers}; ratings=${communityAggregates.total.ratings}; weighted mean=${communityAggregates.total.weightedMean ?? 'none'}.`,
			)
		}
		if (profileLoaderSmoke) {
			console.log(
				`Real profile loaders: overview=${profileLoaderSmoke.overview.wallMs}ms/${profileLoaderSmoke.overview.bytes}B, stats=${profileLoaderSmoke.stats.wallMs}ms/${profileLoaderSmoke.stats.bytes}B, activity=${profileLoaderSmoke.activity.wallMs}ms/${profileLoaderSmoke.activity.bytes}B.`,
			)
			console.log(
				`Real media loaders: anonymous=${profileLoaderSmoke.mediaDetail.anonymous.logicalQueries}/${profileLoaderSmoke.mediaDetail.anonymous.sqlQueries}, normalized signed=${profileLoaderSmoke.mediaDetail.normalizedSigned.logicalQueries}/${profileLoaderSmoke.mediaDetail.normalizedSigned.sqlQueries}, bounded legacy=${profileLoaderSmoke.mediaDetail.boundedLegacy.logicalQueries}/${profileLoaderSmoke.mediaDetail.boundedLegacy.sqlQueries} logical/SQL queries; Entry SQL reads=0/0/1; signed state SQL reads=0/1/1; legacy plan rows=${profileLoaderSmoke.mediaDetail.legacyEntryPlan.actualRows}, indexes=${profileLoaderSmoke.mediaDetail.legacyEntryPlan.indexes.join(', ') || 'none'}.`,
			)
		}
		if (publicSurfaceSmoke) {
			console.log(
				`Public surfaces: anonymous=${publicSurfaceSmoke.anonymousHome.coldQueries}/${publicSurfaceSmoke.anonymousHome.warmQueries}, signed trending=${publicSurfaceSmoke.signedTrending.coldQueries}/${publicSurfaceSmoke.signedTrending.warmQueries}, facets=${publicSurfaceSmoke.discoveryFacets.coldQueries}/${publicSurfaceSmoke.discoveryFacets.warmQueries}, search=${publicSurfaceSmoke.searchSuggestions.coldQueries}/${publicSurfaceSmoke.searchSuggestions.warmQueries} cold/warm queries.`,
			)
		}
		console.log(`Report written: ${reportPath}`)
		if (cleanupAfter) {
			const cleaned = await cleanup(prisma)
			report.cleanup = cleaned
			writePrivateJson(reportPath, report)
			console.log(
				`Cleanup removed ${cleaned.deletedMedia} media, ${cleaned.deletedPeople} people, and ${cleaned.deletedMembers} member rows in ${cleaned.wallMs}ms.`,
			)
		}
		const validationErrors = [
			...(personRowAssertionError ? [personRowAssertionError] : []),
			...(communityAggregateAssertionError
				? [communityAggregateAssertionError]
				: []),
			...(requireTrigramIndexes && queryIndexAssertionError
				? [queryIndexAssertionError]
				: []),
			...(requireCalendarIndexes && calendarQueryIndexAssertionError
				? [calendarQueryIndexAssertionError]
				: []),
			...(requireCommunityIndexes && communityQueryIndexAssertionError
				? [communityQueryIndexAssertionError]
				: []),
			...(requireProfileIndexes && profileQueryIndexAssertionError
				? [profileQueryIndexAssertionError]
				: []),
			...(profileQueryRowAssertionError ? [profileQueryRowAssertionError] : []),
		]
		if (validationErrors.length === 1) {
			throw validationErrors[0]
		}
		if (validationErrors.length > 1) {
			throw new AggregateError(
				validationErrors,
				'PostgreSQL aggregate and query-index validations failed',
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
