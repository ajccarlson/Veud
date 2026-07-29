import { invariantResponse } from '@epic-web/invariant'
import { Prisma } from '@prisma/client'
import {
	activityEventLabel,
	activityListTypeName,
	diaryActivityLabel,
} from '#app/utils/activity.ts'
import { getUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { preferredScore } from '#app/utils/lists/watchlist-entry-scores.server.ts'
import {
	createProfileActivityCollector,
	PROFILE_ACTIVITY_MAX_CAPACITY,
} from '#app/utils/profile-activity.ts'
import {
	createProfileAnalyticsAccumulator,
	createProfileAnalyticsCategoryAccumulator,
	finalizeProfileAnalytics,
	PROFILE_ANALYTICS_ENTRY_LIMIT,
	type ProfileAnalyticsEntry,
} from '#app/utils/profile-analytics.ts'
import { buildCompletionHistoryFromDays } from '#app/utils/profile-completion-history.ts'
import { buildProfileHistory } from '#app/utils/profile-history.ts'
import {
	createProfileTrackingAccumulator,
	type ProfileTrackingEntry,
} from '#app/utils/profile-tracking.ts'
import { type Timings, time } from '#app/utils/timing.server.ts'
import { getUserSafetyState } from '#app/utils/user-safety.server.ts'
import { PROFILE_WATCHLIST_LIMIT } from '#app/utils/watchlist-limits.ts'

const PROFILE_ENTRY_BATCH_SIZE = 500
const PROFILE_HISTORY_ENTRY_BATCH_SIZE = PROFILE_ENTRY_BATCH_SIZE
const PROFILE_SNAPSHOT_TIMEOUT_MS = 20_000
const PROFILE_ACTIVITY_DEDUPLICATION_WINDOW_MS = 60_000
const PROFILE_HISTORY_DB_CODE_UNIT_LIMIT = 128 * 1024
const PROFILE_HISTORY_REQUEST_CODE_UNIT_LIMIT = 16 * 1024 * 1024
// DB substr counts characters, so one projected character can occupy two JS
// UTF-16 code units. This is the independent hard transfer/materialization cap,
// including one fixed sentinel per possible scanned Entry.
const PROFILE_HISTORY_RAW_REQUEST_CODE_UNIT_LIMIT =
	2 * PROFILE_HISTORY_REQUEST_CODE_UNIT_LIMIT + PROFILE_ANALYTICS_ENTRY_LIMIT
export const PROFILE_CATEGORY_REQUEST_CODE_UNIT_LIMIT = 48 * 1024 * 1024
export const PROFILE_CATEGORY_CANDIDATE_CODE_UNIT_LIMIT =
	PROFILE_CATEGORY_REQUEST_CODE_UNIT_LIMIT / 2
export const PROFILE_CATEGORY_EXACT_CODE_UNIT_LIMIT =
	PROFILE_CATEGORY_REQUEST_CODE_UNIT_LIMIT / 2
export const PROFILE_CATEGORY_TYPE_CODE_UNIT_LIMIT = 64
export const PROFILE_CATEGORY_GENRES_CODE_UNIT_LIMIT =
	Math.floor(
		PROFILE_CATEGORY_CANDIDATE_CODE_UNIT_LIMIT / PROFILE_ANALYTICS_ENTRY_LIMIT,
	) - PROFILE_CATEGORY_TYPE_CODE_UNIT_LIMIT
// SQL substr counts characters, while the request budget counts JS UTF-16
// code units. Each projected field includes one database-character sentinel,
// and every such character can occupy two UTF-16 code units.
export const PROFILE_CATEGORY_CANDIDATE_RAW_CODE_UNIT_LIMIT =
	PROFILE_ANALYTICS_ENTRY_LIMIT *
	2 *
	(PROFILE_CATEGORY_TYPE_CODE_UNIT_LIMIT +
		1 +
		PROFILE_CATEGORY_GENRES_CODE_UNIT_LIMIT +
		1)
export const PROFILE_CATEGORY_EXACT_RAW_CODE_UNIT_LIMIT =
	PROFILE_CATEGORY_CANDIDATE_RAW_CODE_UNIT_LIMIT
export const PROFILE_CATEGORY_RAW_REQUEST_CODE_UNIT_LIMIT =
	PROFILE_CATEGORY_CANDIDATE_RAW_CODE_UNIT_LIMIT +
	PROFILE_CATEGORY_EXACT_RAW_CODE_UNIT_LIMIT
const PROFILE_YEAR_TEXT_CODE_UNIT_LIMIT = 64
const PROFILE_PROGRESS_TEXT_CODE_UNIT_LIMIT = 128
const PROFILE_ACTIVITY_TITLE_CODE_UNIT_LIMIT = 240
const PROFILE_ACTIVITY_THUMBNAIL_CODE_UNIT_LIMIT = 2_048
const PROFILE_ACTIVITY_LABEL_CODE_UNIT_LIMIT = 160
const PROFILE_ACTIVITY_PROGRESS_UNIT_CODE_UNIT_LIMIT = 64
const PROFILE_FAVORITE_LIMIT = 300
const PROFILE_FAVORITE_META_CODE_UNIT_LIMIT = 120
const PROFILE_SUPPORTED_PROGRESS_UNITS = ['episode', 'chapter', 'volume']
const PROFILE_ACTIVITY_LIST_TYPE_NAMES = [
	'liveaction',
	'anime',
	'manga',
] as const

const listTypeSelect = {
	id: true,
	name: true,
	header: true,
	columns: true,
	mediaType: true,
	completionType: true,
} satisfies Prisma.ListTypeSelect

const watchlistSelect = {
	id: true,
	name: true,
	header: true,
	typeId: true,
	position: true,
	isPublic: true,
	mutationVersion: true,
	updatedAt: true,
} satisfies Prisma.WatchlistSelect

const analyticsEntrySelect = {
	id: true,
	watchlistId: true,
	mediaId: true,
	releaseStart: true,
	story: true,
	character: true,
	presentation: true,
	sound: true,
	performance: true,
	enjoyment: true,
	averaged: true,
	personal: true,
	tmdbScore: true,
	malScore: true,
	media: { select: { kind: true, tmdbScore: true, malScore: true } },
	trackingState: {
		select: {
			id: true,
			ownerId: true,
			mediaId: true,
			statusWatchlistId: true,
			score: true,
			repeatCount: true,
			progress: {
				where: { unit: { in: PROFILE_SUPPORTED_PROGRESS_UNITS } },
				orderBy: { unit: 'asc' },
				take: PROFILE_SUPPORTED_PROGRESS_UNITS.length,
				select: { unit: true, current: true },
			},
		},
	},
} satisfies Prisma.EntrySelect

const overviewEntrySelect = {
	id: true,
	watchlistId: true,
	mediaId: true,
	personal: true,
	media: { select: { kind: true } },
	trackingState: analyticsEntrySelect.trackingState,
} satisfies Prisma.EntrySelect

const analyticsCategoryEntrySelect = {
	id: true,
	watchlistId: true,
} satisfies Prisma.EntrySelect

const activityEventSelect = {
	id: true,
	score: true,
	previousScore: true,
	progressCurrent: true,
	progressPrevious: true,
	progressTotal: true,
	createdAt: true,
	media: {
		select: { id: true, kind: true },
	},
} satisfies Prisma.ActivityEventSelect

type AnalyticsEntryRow = Prisma.EntryGetPayload<{
	select: typeof analyticsEntrySelect
}>

type OverviewEntryRow = Prisma.EntryGetPayload<{
	select: typeof overviewEntrySelect
}>

type AnalyticsCategoryEntryRow = Prisma.EntryGetPayload<{
	select: typeof analyticsCategoryEntrySelect
}>

type ProfileDbClient = Prisma.TransactionClient | typeof prisma
type AnalyticsEntryWithText = AnalyticsEntryRow & BoundedAnalyticsEntryText
type OverviewEntryWithText = OverviewEntryRow & BoundedOverviewEntryText

type ProfileHistoryProjectionBudget = {
	remaining: number
	rawRemaining: number
	truncated: boolean
}

type ProfileCategoryProjectionBudget = {
	remaining: number
	rawRemaining: number
	truncated: boolean
}

type ProfileCategoryRequestBudget = {
	candidate: ProfileCategoryProjectionBudget
	exact: ProfileCategoryProjectionBudget
}

type ProfileHistoryProjection = {
	id: string
	history: string | null
}

type ProfileOverviewTextProjection = ProfileHistoryProjection & {
	length: string | null
	chapters: string | null
	volumes: string | null
}

type ProfileAnalyticsTextProjection = ProfileOverviewTextProjection & {
	type: string | null
	genres: string | null
	airYear: string | null
	startSeason: string | null
	startYear: string | null
}

type ProfileCategoryTextProjection = {
	id: string
	type: string | null
	genres: string | null
}

type ProfileActivityEntryTextProjection = ProfileHistoryProjection & {
	title: string
	thumbnail: string | null
}

type BoundedOverviewEntryText = Omit<ProfileOverviewTextProjection, 'id'>

type BoundedAnalyticsEntryText = Omit<ProfileAnalyticsTextProjection, 'id'> & {
	categorySourceTruncated: boolean
}

type BoundedCategoryEntryText = Omit<ProfileCategoryTextProjection, 'id'> & {
	categorySourceTruncated: boolean
}

type BoundedActivityEntryText = Omit<ProfileActivityEntryTextProjection, 'id'>

type ProfileMediaTextProjection = {
	id: string
	title: string | null
	thumbnail: string | null
}

type BoundedProfileMediaText = Omit<ProfileMediaTextProjection, 'id'> & {
	truncated: boolean
}

type ProfileActivityEventTextProjection = {
	id: string
	type: string
	status: string | null
	statusLabel: string | null
	previousStatus: string | null
	previousStatusLabel: string | null
	progressUnit: string | null
}

type BoundedProfileActivityEventText = Omit<
	ProfileActivityEventTextProjection,
	'id'
> & {
	truncated: boolean
}

type ProfileFavoriteTextProjection = {
	id: string
	title: string
	thumbnail: string | null
	mediaType: string | null
	startYear: string | null
}

type BoundedProfileFavoriteText = {
	title: string
	thumbnail: string | null
	mediaType: string
	startYear: string
	truncated: boolean
}

function boundedProjectedText(
	value: string | null,
	limit: number,
): { value: string | null; truncated: boolean } {
	if (value === null) return { value: null, truncated: false }
	if (value.length <= limit) return { value, truncated: false }
	let end = limit
	const last = value.charCodeAt(end - 1)
	const next = value.charCodeAt(end)
	if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
		end--
	}
	return { value: value.slice(0, end), truncated: true }
}

/**
 * SQLite/PostgreSQL substr count Unicode characters while JS budgets UTF-16
 * code units. Fetch one extra database character as a truncation sentinel, then
 * enforce the exact semantic limit in JS. Raw transfer has a separate ceiling
 * of at most twice this character count, preserving BMP/ASCII behavior while
 * keeping astral-heavy source memory explicitly bounded.
 */
function sqlProjectionCharacterLimit(codeUnitLimit: number) {
	return codeUnitLimit + 1
}

function createProfileHistoryProjectionBudget(): ProfileHistoryProjectionBudget {
	return {
		remaining: PROFILE_HISTORY_REQUEST_CODE_UNIT_LIMIT,
		rawRemaining: PROFILE_HISTORY_RAW_REQUEST_CODE_UNIT_LIMIT,
		truncated: false,
	}
}

function createProfileCategoryRequestBudget(): ProfileCategoryRequestBudget {
	return {
		candidate: {
			remaining: PROFILE_CATEGORY_CANDIDATE_CODE_UNIT_LIMIT,
			rawRemaining: PROFILE_CATEGORY_CANDIDATE_RAW_CODE_UNIT_LIMIT,
			truncated: false,
		},
		exact: {
			remaining: PROFILE_CATEGORY_EXACT_CODE_UNIT_LIMIT,
			rawRemaining: PROFILE_CATEGORY_EXACT_RAW_CODE_UNIT_LIMIT,
			truncated: false,
		},
	}
}

function consumeProjectedCategoryText(
	value: string | null,
	limit: number,
	budget: ProfileCategoryProjectionBudget,
) {
	if (value === null) return { value: null, truncated: false }

	const rawLimit = 2 * sqlProjectionCharacterLimit(limit)
	const rawLength = value.length
	if (rawLength > rawLimit || rawLength > budget.rawRemaining) {
		budget.rawRemaining = Math.max(0, budget.rawRemaining - rawLength)
		budget.truncated = true
		return { value: null, truncated: true }
	}
	budget.rawRemaining -= rawLength

	const projected = boundedProjectedText(value, limit)
	const semanticLength = projected.value?.length ?? 0
	if (semanticLength > budget.remaining) {
		budget.remaining = 0
		budget.truncated = true
		return { value: null, truncated: true }
	}
	budget.remaining -= semanticLength
	budget.truncated ||= projected.truncated
	return projected
}

function consumeProjectedCategoryRow(
	row: ProfileCategoryTextProjection,
	budget: ProfileCategoryProjectionBudget,
): BoundedCategoryEntryText {
	const type = consumeProjectedCategoryText(
		row.type,
		PROFILE_CATEGORY_TYPE_CODE_UNIT_LIMIT,
		budget,
	)
	const genres = consumeProjectedCategoryText(
		row.genres,
		PROFILE_CATEGORY_GENRES_CODE_UNIT_LIMIT,
		budget,
	)
	return {
		type: type.value,
		genres: genres.value,
		categorySourceTruncated: type.truncated || genres.truncated,
	}
}

function historyProjection(
	budget: ProfileHistoryProjectionBudget,
	rowCount: number,
) {
	const perRowLimit = Math.min(
		PROFILE_HISTORY_DB_CODE_UNIT_LIMIT,
		Math.max(0, Math.floor(budget.remaining / Math.max(rowCount, 1)) - 1),
		Math.max(
			0,
			Math.floor(budget.rawRemaining / (2 * Math.max(rowCount, 1))) - 1,
		),
	)
	const projectedCharacterLimit =
		perRowLimit > 0 ? sqlProjectionCharacterLimit(perRowLimit) : 0
	return {
		perRowLimit,
		projectedCharacterLimit,
		sql:
			projectedCharacterLimit > 0
				? Prisma.sql`substr("history", 1, CAST(${projectedCharacterLimit} AS INTEGER))`
				: Prisma.sql`CASE
						WHEN "history" IS NULL OR "history" = '' OR "history" = 'null'
						THEN NULL
						ELSE '{'
					END`,
	}
}

function consumeProjectedHistory(
	value: string | null,
	perRowLimit: number,
	projectedCharacterLimit: number,
	budget: ProfileHistoryProjectionBudget,
) {
	if (value === null) return null
	budget.rawRemaining = Math.max(0, budget.rawRemaining - value.length)
	if (
		perRowLimit <= 0 ||
		projectedCharacterLimit <= 0 ||
		value.length > perRowLimit
	) {
		budget.truncated = true
		if (perRowLimit > 0) {
			budget.remaining = Math.max(0, budget.remaining - perRowLimit)
		}
		// A clipped JSON prefix must never be interpreted as complete.
		return '{'
	}
	budget.remaining = Math.max(0, budget.remaining - value.length)
	return value
}

async function loadBoundedProfileOverviewText(
	db: Prisma.TransactionClient,
	entryIds: readonly string[],
	historyBudget: ProfileHistoryProjectionBudget,
) {
	if (!entryIds.length) return new Map<string, BoundedOverviewEntryText>()
	const history = historyProjection(historyBudget, entryIds.length)
	const rows = await db.$queryRaw<ProfileOverviewTextProjection[]>(Prisma.sql`
		SELECT
			"id",
			${history.sql} AS "history",
			substr("length", 1, CAST(${sqlProjectionCharacterLimit(PROFILE_PROGRESS_TEXT_CODE_UNIT_LIMIT)} AS INTEGER)) AS "length",
			substr("chapters", 1, CAST(${sqlProjectionCharacterLimit(PROFILE_PROGRESS_TEXT_CODE_UNIT_LIMIT)} AS INTEGER)) AS "chapters",
			substr("volumes", 1, CAST(${sqlProjectionCharacterLimit(PROFILE_PROGRESS_TEXT_CODE_UNIT_LIMIT)} AS INTEGER)) AS "volumes"
		FROM "Entry"
		WHERE "id" IN (${Prisma.join(entryIds)})
	`)

	return new Map(
		rows.map(row => {
			const length = boundedProjectedText(
				row.length,
				PROFILE_PROGRESS_TEXT_CODE_UNIT_LIMIT,
			)
			const chapters = boundedProjectedText(
				row.chapters,
				PROFILE_PROGRESS_TEXT_CODE_UNIT_LIMIT,
			)
			const volumes = boundedProjectedText(
				row.volumes,
				PROFILE_PROGRESS_TEXT_CODE_UNIT_LIMIT,
			)
			return [
				row.id,
				{
					history: consumeProjectedHistory(
						row.history,
						history.perRowLimit,
						history.projectedCharacterLimit,
						historyBudget,
					),
					length: length.truncated ? null : length.value,
					chapters: chapters.truncated ? null : chapters.value,
					volumes: volumes.truncated ? null : volumes.value,
				},
			]
		}),
	)
}

async function loadBoundedProfileAnalyticsText(
	db: Prisma.TransactionClient,
	entryIds: readonly string[],
	historyBudget: ProfileHistoryProjectionBudget,
	categoryBudget: ProfileCategoryProjectionBudget,
) {
	if (!entryIds.length) return new Map<string, BoundedAnalyticsEntryText>()
	const history = historyProjection(historyBudget, entryIds.length)
	const rows = await db.$queryRaw<ProfileAnalyticsTextProjection[]>(Prisma.sql`
		SELECT
			"id",
			${history.sql} AS "history",
			substr("type", 1, CAST(${sqlProjectionCharacterLimit(PROFILE_CATEGORY_TYPE_CODE_UNIT_LIMIT)} AS INTEGER)) AS "type",
			substr("genres", 1, CAST(${sqlProjectionCharacterLimit(PROFILE_CATEGORY_GENRES_CODE_UNIT_LIMIT)} AS INTEGER)) AS "genres",
			substr("airYear", 1, CAST(${sqlProjectionCharacterLimit(PROFILE_YEAR_TEXT_CODE_UNIT_LIMIT)} AS INTEGER)) AS "airYear",
			substr("startSeason", 1, CAST(${sqlProjectionCharacterLimit(PROFILE_YEAR_TEXT_CODE_UNIT_LIMIT)} AS INTEGER)) AS "startSeason",
			substr("startYear", 1, CAST(${sqlProjectionCharacterLimit(PROFILE_YEAR_TEXT_CODE_UNIT_LIMIT)} AS INTEGER)) AS "startYear",
			substr("length", 1, CAST(${sqlProjectionCharacterLimit(PROFILE_PROGRESS_TEXT_CODE_UNIT_LIMIT)} AS INTEGER)) AS "length",
			substr("chapters", 1, CAST(${sqlProjectionCharacterLimit(PROFILE_PROGRESS_TEXT_CODE_UNIT_LIMIT)} AS INTEGER)) AS "chapters",
			substr("volumes", 1, CAST(${sqlProjectionCharacterLimit(PROFILE_PROGRESS_TEXT_CODE_UNIT_LIMIT)} AS INTEGER)) AS "volumes"
		FROM "Entry"
		WHERE "id" IN (${Prisma.join(entryIds)})
	`)

	return new Map(
		rows.map(row => {
			const category = consumeProjectedCategoryRow(row, categoryBudget)
			const airYear = boundedProjectedText(
				row.airYear,
				PROFILE_YEAR_TEXT_CODE_UNIT_LIMIT,
			)
			const startSeason = boundedProjectedText(
				row.startSeason,
				PROFILE_YEAR_TEXT_CODE_UNIT_LIMIT,
			)
			const startYear = boundedProjectedText(
				row.startYear,
				PROFILE_YEAR_TEXT_CODE_UNIT_LIMIT,
			)
			const length = boundedProjectedText(
				row.length,
				PROFILE_PROGRESS_TEXT_CODE_UNIT_LIMIT,
			)
			const chapters = boundedProjectedText(
				row.chapters,
				PROFILE_PROGRESS_TEXT_CODE_UNIT_LIMIT,
			)
			const volumes = boundedProjectedText(
				row.volumes,
				PROFILE_PROGRESS_TEXT_CODE_UNIT_LIMIT,
			)
			return [
				row.id,
				{
					history: consumeProjectedHistory(
						row.history,
						history.perRowLimit,
						history.projectedCharacterLimit,
						historyBudget,
					),
					type: category.type,
					genres: category.genres,
					airYear: airYear.truncated ? null : airYear.value,
					startSeason: startSeason.truncated ? null : startSeason.value,
					startYear: startYear.truncated ? null : startYear.value,
					length: length.truncated ? null : length.value,
					chapters: chapters.truncated ? null : chapters.value,
					volumes: volumes.truncated ? null : volumes.value,
					categorySourceTruncated:
						category.categorySourceTruncated ||
						airYear.truncated ||
						startSeason.truncated ||
						startYear.truncated ||
						length.truncated ||
						chapters.truncated ||
						volumes.truncated,
				},
			]
		}),
	)
}

async function loadBoundedProfileCategoryText(
	db: Prisma.TransactionClient,
	entryIds: readonly string[],
	categoryBudget: ProfileCategoryProjectionBudget,
) {
	if (!entryIds.length) return new Map<string, BoundedCategoryEntryText>()
	const rows = await db.$queryRaw<ProfileCategoryTextProjection[]>(Prisma.sql`
		SELECT
			"id",
			substr("type", 1, CAST(${sqlProjectionCharacterLimit(PROFILE_CATEGORY_TYPE_CODE_UNIT_LIMIT)} AS INTEGER)) AS "type",
			substr("genres", 1, CAST(${sqlProjectionCharacterLimit(PROFILE_CATEGORY_GENRES_CODE_UNIT_LIMIT)} AS INTEGER)) AS "genres"
		FROM "Entry"
		WHERE "id" IN (${Prisma.join(entryIds)})
	`)
	return new Map(
		rows.map(row => [row.id, consumeProjectedCategoryRow(row, categoryBudget)]),
	)
}

async function loadBoundedProfileActivityEntryText(
	db: Prisma.TransactionClient,
	entryIds: readonly string[],
	historyBudget: ProfileHistoryProjectionBudget,
) {
	if (!entryIds.length) return new Map<string, BoundedActivityEntryText>()
	const history = historyProjection(historyBudget, entryIds.length)
	const rows = await db.$queryRaw<ProfileActivityEntryTextProjection[]>(
		Prisma.sql`
			SELECT
				"id",
				${history.sql} AS "history",
				substr("title", 1, CAST(${sqlProjectionCharacterLimit(PROFILE_ACTIVITY_TITLE_CODE_UNIT_LIMIT)} AS INTEGER)) AS "title",
				substr("thumbnail", 1, CAST(${sqlProjectionCharacterLimit(PROFILE_ACTIVITY_THUMBNAIL_CODE_UNIT_LIMIT)} AS INTEGER)) AS "thumbnail"
			FROM "Entry"
			WHERE "id" IN (${Prisma.join(entryIds)})
		`,
	)
	return new Map(
		rows.map(row => {
			const title = boundedProjectedText(
				row.title,
				PROFILE_ACTIVITY_TITLE_CODE_UNIT_LIMIT,
			)
			const thumbnail = boundedProjectedText(
				row.thumbnail,
				PROFILE_ACTIVITY_THUMBNAIL_CODE_UNIT_LIMIT,
			)
			return [
				row.id,
				{
					history: consumeProjectedHistory(
						row.history,
						history.perRowLimit,
						history.projectedCharacterLimit,
						historyBudget,
					),
					title: title.truncated ? `${title.value}…` : (title.value ?? ''),
					thumbnail: thumbnail.truncated ? null : thumbnail.value,
				},
			]
		}),
	)
}

async function loadBoundedProfileMediaText(
	db: Prisma.TransactionClient,
	mediaIds: readonly string[],
) {
	if (!mediaIds.length) return new Map<string, BoundedProfileMediaText>()
	const rows = await db.$queryRaw<ProfileMediaTextProjection[]>(Prisma.sql`
		SELECT
			"id",
			substr("title", 1, CAST(${sqlProjectionCharacterLimit(PROFILE_ACTIVITY_TITLE_CODE_UNIT_LIMIT)} AS INTEGER)) AS "title",
			substr("thumbnail", 1, CAST(${sqlProjectionCharacterLimit(PROFILE_ACTIVITY_THUMBNAIL_CODE_UNIT_LIMIT)} AS INTEGER)) AS "thumbnail"
		FROM "Media"
		WHERE "id" IN (${Prisma.join(mediaIds)})
	`)
	return new Map(
		rows.map(row => {
			const title = boundedProjectedText(
				row.title,
				PROFILE_ACTIVITY_TITLE_CODE_UNIT_LIMIT,
			)
			const thumbnail = boundedProjectedText(
				row.thumbnail,
				PROFILE_ACTIVITY_THUMBNAIL_CODE_UNIT_LIMIT,
			)
			return [
				row.id,
				{
					title: title.truncated ? `${title.value}…` : title.value,
					thumbnail: thumbnail.truncated ? null : thumbnail.value,
					truncated: title.truncated || thumbnail.truncated,
				},
			]
		}),
	)
}

async function loadBoundedProfileActivityEventText(
	db: Prisma.TransactionClient,
	eventIds: readonly string[],
) {
	if (!eventIds.length)
		return new Map<string, BoundedProfileActivityEventText>()
	const rows = await db.$queryRaw<ProfileActivityEventTextProjection[]>(
		Prisma.sql`
			SELECT
				"id",
				substr("type", 1, CAST(${sqlProjectionCharacterLimit(PROFILE_ACTIVITY_LABEL_CODE_UNIT_LIMIT)} AS INTEGER)) AS "type",
				substr("status", 1, CAST(${sqlProjectionCharacterLimit(PROFILE_ACTIVITY_LABEL_CODE_UNIT_LIMIT)} AS INTEGER)) AS "status",
				substr("statusLabel", 1, CAST(${sqlProjectionCharacterLimit(PROFILE_ACTIVITY_LABEL_CODE_UNIT_LIMIT)} AS INTEGER)) AS "statusLabel",
				substr("previousStatus", 1, CAST(${sqlProjectionCharacterLimit(PROFILE_ACTIVITY_LABEL_CODE_UNIT_LIMIT)} AS INTEGER)) AS "previousStatus",
				substr("previousStatusLabel", 1, CAST(${sqlProjectionCharacterLimit(PROFILE_ACTIVITY_LABEL_CODE_UNIT_LIMIT)} AS INTEGER)) AS "previousStatusLabel",
				substr("progressUnit", 1, CAST(${sqlProjectionCharacterLimit(PROFILE_ACTIVITY_PROGRESS_UNIT_CODE_UNIT_LIMIT)} AS INTEGER)) AS "progressUnit"
			FROM "ActivityEvent"
			WHERE "id" IN (${Prisma.join(eventIds)})
		`,
	)
	return new Map(
		rows.map(row => {
			const type = boundedProjectedText(
				row.type,
				PROFILE_ACTIVITY_LABEL_CODE_UNIT_LIMIT,
			)
			const status = boundedProjectedText(
				row.status,
				PROFILE_ACTIVITY_LABEL_CODE_UNIT_LIMIT,
			)
			const statusLabel = boundedProjectedText(
				row.statusLabel,
				PROFILE_ACTIVITY_LABEL_CODE_UNIT_LIMIT,
			)
			const previousStatus = boundedProjectedText(
				row.previousStatus,
				PROFILE_ACTIVITY_LABEL_CODE_UNIT_LIMIT,
			)
			const previousStatusLabel = boundedProjectedText(
				row.previousStatusLabel,
				PROFILE_ACTIVITY_LABEL_CODE_UNIT_LIMIT,
			)
			const progressUnit = boundedProjectedText(
				row.progressUnit,
				PROFILE_ACTIVITY_PROGRESS_UNIT_CODE_UNIT_LIMIT,
			)
			return [
				row.id,
				{
					type: type.value ?? 'tracking',
					status: status.value,
					statusLabel: statusLabel.value,
					previousStatus: previousStatus.value,
					previousStatusLabel: previousStatusLabel.value,
					progressUnit: progressUnit.value,
					truncated: [
						type,
						status,
						statusLabel,
						previousStatus,
						previousStatusLabel,
						progressUnit,
					].some(value => value.truncated),
				},
			]
		}),
	)
}

async function loadBoundedProfileFavoriteText(
	db: ProfileDbClient,
	favoriteIds: readonly string[],
) {
	if (!favoriteIds.length) return new Map<string, BoundedProfileFavoriteText>()
	const rows = await db.$queryRaw<ProfileFavoriteTextProjection[]>(Prisma.sql`
		SELECT
			"id",
			substr("title", 1, CAST(${sqlProjectionCharacterLimit(PROFILE_ACTIVITY_TITLE_CODE_UNIT_LIMIT)} AS INTEGER)) AS "title",
			substr("thumbnail", 1, CAST(${sqlProjectionCharacterLimit(PROFILE_ACTIVITY_THUMBNAIL_CODE_UNIT_LIMIT)} AS INTEGER)) AS "thumbnail",
			substr("mediaType", 1, CAST(${sqlProjectionCharacterLimit(PROFILE_FAVORITE_META_CODE_UNIT_LIMIT)} AS INTEGER)) AS "mediaType",
			substr("startYear", 1, CAST(${sqlProjectionCharacterLimit(PROFILE_YEAR_TEXT_CODE_UNIT_LIMIT)} AS INTEGER)) AS "startYear"
		FROM "UserFavorite"
		WHERE "id" IN (${Prisma.join(favoriteIds)})
	`)
	return new Map(
		rows.map(row => {
			const title = boundedProjectedText(
				row.title,
				PROFILE_ACTIVITY_TITLE_CODE_UNIT_LIMIT,
			)
			const thumbnail = boundedProjectedText(
				row.thumbnail,
				PROFILE_ACTIVITY_THUMBNAIL_CODE_UNIT_LIMIT,
			)
			const mediaType = boundedProjectedText(
				row.mediaType,
				PROFILE_FAVORITE_META_CODE_UNIT_LIMIT,
			)
			const startYear = boundedProjectedText(
				row.startYear,
				PROFILE_YEAR_TEXT_CODE_UNIT_LIMIT,
			)
			return [
				row.id,
				{
					title: title.truncated ? `${title.value}…` : (title.value ?? ''),
					thumbnail: thumbnail.truncated ? null : thumbnail.value,
					mediaType: mediaType.value ?? '',
					startYear: startYear.value ?? '',
					truncated: [title, thumbnail, mediaType, startYear].some(
						value => value.truncated,
					),
				},
			]
		}),
	)
}

function isRetryableProfileSnapshotError(error: unknown) {
	return (
		error !== null &&
		typeof error === 'object' &&
		'code' in error &&
		error.code === 'P2034'
	)
}

async function withProfileSnapshot<Result>(
	callback: (tx: Prisma.TransactionClient) => Promise<Result>,
) {
	const isolationLevel = process.env.DATABASE_URL?.startsWith('postgres')
		? ('RepeatableRead' as Prisma.TransactionIsolationLevel)
		: ('Serializable' as Prisma.TransactionIsolationLevel)

	for (let attempt = 0; attempt < 2; attempt += 1) {
		try {
			return await prisma.$transaction(callback, {
				isolationLevel,
				maxWait: 5_000,
				timeout: PROFILE_SNAPSHOT_TIMEOUT_MS,
			})
		} catch (error) {
			if (attempt === 0 && isRetryableProfileSnapshotError(error)) continue
			throw error
		}
	}

	throw new Error('Unable to read a consistent profile snapshot')
}

async function requireProfileUser(
	username: string | undefined,
	db: ProfileDbClient = prisma,
) {
	const user = await db.user.findUnique({
		where: { username },
		select: { id: true },
	})
	invariantResponse(user, 'User not found', { status: 404 })
	return user
}

function mediaItem(media: {
	id: string
	kind: string
	title: string | null
	thumbnail: string | null
}) {
	return {
		id: media.id,
		kind: media.kind,
		title: media.title?.trim() || `Untitled ${media.kind}`,
		thumbnail: media.thumbnail,
	}
}

function typeIdForKind(
	kind: string,
	listTypeIdByName: ReadonlyMap<string, string>,
) {
	const listTypeName = activityListTypeName(kind)
	return listTypeName ? (listTypeIdByName.get(listTypeName) ?? null) : null
}

export async function scanProfileEntryPages<Row extends { id: string }>({
	watchlistIds,
	fetchPage,
	onPage,
	limit = PROFILE_ANALYTICS_ENTRY_LIMIT,
	batchSize = PROFILE_ENTRY_BATCH_SIZE,
}: {
	watchlistIds: readonly string[]
	fetchPage: (
		watchlistId: string,
		cursor: string | undefined,
		take: number,
	) => Promise<Row[]>
	onPage: (rows: readonly Row[]) => void | Promise<void>
	limit?: number
	batchSize?: number
}) {
	if (
		!Number.isSafeInteger(batchSize) ||
		batchSize < 1 ||
		batchSize > PROFILE_ENTRY_BATCH_SIZE
	) {
		throw new RangeError(
			`Profile entry batch size must be between 1 and ${PROFILE_ENTRY_BATCH_SIZE}`,
		)
	}
	let processed = 0

	for (
		let watchlistIndex = 0;
		watchlistIndex < watchlistIds.length;
		watchlistIndex += 1
	) {
		const watchlistId = watchlistIds[watchlistIndex]
		if (!watchlistId) continue
		let cursor: string | undefined
		while (processed < limit) {
			const remaining = limit - processed
			const take = remaining <= batchSize ? remaining + 1 : batchSize
			const rows = await fetchPage(watchlistId, cursor, take)
			const page = rows.slice(0, remaining)
			if (!page.length) break

			await onPage(page)
			processed += page.length
			cursor = page.at(-1)?.id

			if (rows.length > page.length) {
				return { processed, truncated: true }
			}
			if (rows.length < take) break
		}

		if (processed >= limit) {
			for (
				let remainingIndex = watchlistIndex + 1;
				remainingIndex < watchlistIds.length;
				remainingIndex += 1
			) {
				const remainingWatchlistId = watchlistIds[remainingIndex]
				if (
					remainingWatchlistId &&
					(await fetchPage(remainingWatchlistId, undefined, 1)).length
				) {
					return { processed, truncated: true }
				}
			}
			return { processed, truncated: false }
		}
	}

	return { processed, truncated: false }
}

function visibleProfileTrackingState(
	entry: Pick<AnalyticsEntryRow, 'mediaId' | 'trackingState'>,
	visibleWatchlistIds: ReadonlySet<string>,
	isOwner: boolean,
	profileOwnerId: string,
): {
	trackingState: AnalyticsEntryRow['trackingState']
	redactLegacyTracking: boolean
} {
	const trackingState =
		entry.trackingState &&
		entry.trackingState.ownerId === profileOwnerId &&
		entry.trackingState.mediaId === entry.mediaId &&
		(isOwner ||
			entry.trackingState.statusWatchlistId === null ||
			visibleWatchlistIds.has(entry.trackingState.statusWatchlistId))
			? entry.trackingState
			: null
	return {
		trackingState,
		redactLegacyTracking:
			!isOwner && entry.trackingState !== null && trackingState === null,
	}
}

function normalizeAnalyticsEntry(
	entry: AnalyticsEntryWithText,
	visibleWatchlistIds: ReadonlySet<string>,
	isOwner: boolean,
	profileOwnerId: string,
): ProfileAnalyticsEntry & ProfileTrackingEntry {
	const { trackingState, redactLegacyTracking } = visibleProfileTrackingState(
		entry,
		visibleWatchlistIds,
		isOwner,
		profileOwnerId,
	)
	const entryPersonal = redactLegacyTracking ? null : entry.personal
	const personal = preferredScore(trackingState?.score, entryPersonal)
	const tmdbScore = preferredScore(entry.media?.tmdbScore, entry.tmdbScore)
	const malScore = preferredScore(entry.media?.malScore, entry.malScore)

	return {
		...entry,
		history: redactLegacyTracking ? null : entry.history,
		length: redactLegacyTracking ? null : entry.length,
		chapters: redactLegacyTracking ? null : entry.chapters,
		volumes: redactLegacyTracking ? null : entry.volumes,
		averaged: entry.averaged === null ? null : Number(entry.averaged),
		personal: personal === null ? null : Number(personal),
		tmdbScore: tmdbScore === null ? null : Number(tmdbScore),
		malScore: malScore === null ? null : Number(malScore),
		trackingState: trackingState
			? {
					...trackingState,
					score:
						trackingState.score === null ? null : Number(trackingState.score),
				}
			: null,
	}
}

function normalizeOverviewEntry(
	entry: OverviewEntryWithText,
	visibleWatchlistIds: ReadonlySet<string>,
	isOwner: boolean,
	profileOwnerId: string,
): ProfileAnalyticsEntry & ProfileTrackingEntry {
	const { trackingState, redactLegacyTracking } = visibleProfileTrackingState(
		entry,
		visibleWatchlistIds,
		isOwner,
		profileOwnerId,
	)
	const entryPersonal = redactLegacyTracking ? null : entry.personal
	const personal = preferredScore(trackingState?.score, entryPersonal)

	return {
		...entry,
		history: redactLegacyTracking ? null : entry.history,
		length: redactLegacyTracking ? null : entry.length,
		chapters: redactLegacyTracking ? null : entry.chapters,
		volumes: redactLegacyTracking ? null : entry.volumes,
		personal: personal === null ? null : Number(personal),
		trackingState: trackingState
			? {
					...trackingState,
					score:
						trackingState.score === null ? null : Number(trackingState.score),
				}
			: null,
	}
}

async function loadProfileAnalyticsFirstPass(
	{
		db,
		viewerId,
		user,
		mode,
		categoryBudget,
	}: {
		db: Prisma.TransactionClient
		viewerId: string | null
		user: { id: string }
		mode: 'overview' | 'stats'
		categoryBudget?: ProfileCategoryProjectionBudget
	},
	timings?: Timings,
) {
	if (mode === 'stats' && !categoryBudget) {
		throw new Error('Stats analytics requires a category projection budget')
	}
	const isOwner = viewerId === user.id
	const watchlistWhere = {
		ownerId: user.id,
		...(isOwner ? {} : { isPublic: true }),
	} satisfies Prisma.WatchlistWhereInput
	const { listTypes, watchlistRows } = await time(
		async () => {
			const watchlistRows = await db.watchlist.findMany({
				where: watchlistWhere,
				orderBy: [{ typeId: 'asc' }, { position: 'asc' }, { id: 'asc' }],
				take: PROFILE_WATCHLIST_LIMIT + 1,
				select: watchlistSelect,
			})
			const typeIds = [
				...new Set(
					watchlistRows
						.slice(0, PROFILE_WATCHLIST_LIMIT)
						.map(watchlist => watchlist.typeId),
				),
			]
			const listTypes = typeIds.length
				? await db.listType.findMany({
						where: { id: { in: typeIds } },
						select: listTypeSelect,
					})
				: []
			return { listTypes, watchlistRows }
		},
		{ type: 'profile_db', desc: 'visible analytics scope', timings },
	)
	const watchlists = watchlistRows.slice(0, PROFILE_WATCHLIST_LIMIT)
	const watchlistsTruncated = watchlistRows.length > watchlists.length
	const watchlistIds = watchlists.map(watchlist => watchlist.id)
	const visibleWatchlistIds = new Set(watchlistIds)
	const analyticsAccumulator = createProfileAnalyticsAccumulator({
		listTypes,
		watchlists,
		mode,
	})
	const trackingAccumulator = createProfileTrackingAccumulator({
		listTypes,
		watchlists,
	})
	const historyBudget = createProfileHistoryProjectionBudget()

	const scan = await time(
		mode === 'overview'
			? scanProfileEntryPages<OverviewEntryRow>({
					watchlistIds,
					batchSize: PROFILE_HISTORY_ENTRY_BATCH_SIZE,
					fetchPage: (watchlistId, cursor, take) =>
						db.entry.findMany({
							where: {
								watchlistId,
								...(cursor ? { id: { gt: cursor } } : {}),
								watchlist: watchlistWhere,
							},
							orderBy: { id: 'asc' },
							take,
							select: overviewEntrySelect,
						}),
					onPage: async rows => {
						const textByEntry = await loadBoundedProfileOverviewText(
							db,
							rows.map(entry => entry.id),
							historyBudget,
						)
						const normalizedRows = rows.map(entry =>
							normalizeOverviewEntry(
								{
									...entry,
									...(textByEntry.get(entry.id) ??
										({
											history: null,
											length: null,
											chapters: null,
											volumes: null,
										} satisfies BoundedOverviewEntryText)),
								},
								visibleWatchlistIds,
								isOwner,
								user.id,
							),
						)
						analyticsAccumulator.addMany(normalizedRows)
						trackingAccumulator.addMany(normalizedRows)
					},
				})
			: scanProfileEntryPages<AnalyticsEntryRow>({
					watchlistIds,
					batchSize: PROFILE_HISTORY_ENTRY_BATCH_SIZE,
					fetchPage: (watchlistId, cursor, take) =>
						db.entry.findMany({
							where: {
								watchlistId,
								...(cursor ? { id: { gt: cursor } } : {}),
								watchlist: watchlistWhere,
							},
							orderBy: { id: 'asc' },
							take,
							select: analyticsEntrySelect,
						}),
					onPage: async rows => {
						const textByEntry = await loadBoundedProfileAnalyticsText(
							db,
							rows.map(entry => entry.id),
							historyBudget,
							categoryBudget!,
						)
						const normalizedRows = rows.map(entry =>
							normalizeAnalyticsEntry(
								{
									...entry,
									...(textByEntry.get(entry.id) ??
										({
											history: null,
											type: null,
											genres: null,
											airYear: null,
											startSeason: null,
											startYear: null,
											length: null,
											chapters: null,
											volumes: null,
											categorySourceTruncated: true,
										} satisfies BoundedAnalyticsEntryText)),
								},
								visibleWatchlistIds,
								isOwner,
								user.id,
							),
						)
						analyticsAccumulator.addMany(normalizedRows)
						trackingAccumulator.addMany(normalizedRows)
					},
				}),
		{ type: 'profile_db', desc: 'bounded analytics entry pages', timings },
	)
	if (scan.truncated) analyticsAccumulator.markTruncated()

	return {
		listTypes,
		watchlists,
		watchlistIds,
		watchlistsTruncated,
		firstPass: analyticsAccumulator.finish(),
		trackingSummaries: trackingAccumulator.finish(),
	}
}

export async function loadProfileShell(
	request: Request,
	username: string | undefined,
	timings?: Timings,
) {
	const [viewerId, user] = await time(
		Promise.all([
			getUserId(request),
			prisma.user.findUnique({
				where: { username },
				select: {
					id: true,
					username: true,
					bio: true,
					createdAt: true,
					lastActiveAt: true,
					image: { select: { id: true } },
					banner: { select: { id: true } },
					_count: { select: { followers: true, following: true } },
				},
			}),
		]),
		{ type: 'profile_db', desc: 'viewer and profile identity', timings },
	)

	invariantResponse(user, 'User not found', { status: 404 })

	const [isFollowing, safetyState, listTypes] = await time(
		Promise.all([
			viewerId && viewerId !== user.id
				? prisma.follow
						.findUnique({
							where: {
								followerId_followingId: {
									followerId: viewerId,
									followingId: user.id,
								},
							},
							select: { followerId: true },
						})
						.then(Boolean)
				: false,
			viewerId && viewerId !== user.id
				? getUserSafetyState(prisma, viewerId, user.id)
				: {
						isMuted: false,
						isBlocked: false,
						isBlockedByTarget: false,
					},
			prisma.listType.findMany({ select: listTypeSelect }),
		]),
		{ type: 'profile_db', desc: 'profile shell relations', timings },
	)

	return {
		user: {
			id: user.id,
			username: user.username,
			bio: user.bio,
			createdAt: user.createdAt,
			image: user.image,
			banner: user.banner,
		},
		userJoinedDisplay: user.createdAt.toLocaleDateString('en-US', {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
		}),
		lastActiveAt: user.lastActiveAt,
		listTypes,
		followerCount: user._count.followers,
		followingCount: user._count.following,
		isFollowing,
		safetyState,
	}
}

export async function loadProfileOverview(
	request: Request,
	username: string | undefined,
	timings?: Timings,
) {
	const viewerId = await time(getUserId(request), {
		type: 'profile_db',
		desc: 'overview viewer scope',
		timings,
	})
	return withProfileSnapshot(async db => {
		const user = await requireProfileUser(username, db)
		const { firstPass, trackingSummaries, watchlists, watchlistsTruncated } =
			await loadProfileAnalyticsFirstPass(
				{ db, viewerId, user, mode: 'overview' },
				timings,
			)
		return time(
			() => ({
				trackingSummaries,
				completionHistory: buildCompletionHistoryFromDays(
					firstPass.completionDays,
				),
				diagnostic: {
					...firstPass.diagnostic,
					watchlistsProcessed: watchlists.length,
					watchlistsTruncated,
					watchlistLimit: PROFILE_WATCHLIST_LIMIT,
				},
			}),
			{ type: 'profile_compute', desc: 'overview analytics DTO', timings },
		)
	})
}

export async function loadProfileStats(
	request: Request,
	username: string | undefined,
	timings?: Timings,
) {
	const viewerId = await time(getUserId(request), {
		type: 'profile_db',
		desc: 'stats viewer scope',
		timings,
	})
	return withProfileSnapshot(async db => {
		const user = await requireProfileUser(username, db)
		const categoryBudget = createProfileCategoryRequestBudget()
		const {
			listTypes,
			watchlists,
			watchlistIds,
			watchlistsTruncated,
			firstPass,
			trackingSummaries,
		} = await loadProfileAnalyticsFirstPass(
			{
				db,
				viewerId,
				user,
				mode: 'stats',
				categoryBudget: categoryBudget.candidate,
			},
			timings,
		)
		const watchlistWhere = {
			ownerId: user.id,
			...(viewerId === user.id ? {} : { isPublic: true }),
		} satisfies Prisma.WatchlistWhereInput
		const categoryAccumulator = createProfileAnalyticsCategoryAccumulator({
			listTypes,
			watchlists,
			plan: firstPass.categoryPlan,
		})
		const categoryScan = await time(
			scanProfileEntryPages<AnalyticsCategoryEntryRow>({
				watchlistIds,
				fetchPage: (watchlistId, cursor, take) =>
					db.entry.findMany({
						where: {
							watchlistId,
							...(cursor ? { id: { gt: cursor } } : {}),
							watchlist: watchlistWhere,
						},
						orderBy: { id: 'asc' },
						take,
						select: analyticsCategoryEntrySelect,
					}),
				onPage: async rows => {
					const textByEntry = await loadBoundedProfileCategoryText(
						db,
						rows.map(entry => entry.id),
						categoryBudget.exact,
					)
					categoryAccumulator.addMany(
						rows.map(entry => {
							const text = textByEntry.get(entry.id)
							return {
								...entry,
								type: text?.type ?? null,
								genres: text?.genres ?? null,
								categorySourceTruncated: text?.categorySourceTruncated ?? true,
							}
						}),
					)
				},
			}),
			{ type: 'profile_db', desc: 'bounded analytics category pages', timings },
		)
		if (categoryScan.truncated) categoryAccumulator.markTruncated()

		return time(
			() => {
				const analytics = finalizeProfileAnalytics(
					firstPass,
					categoryAccumulator.finish(),
				)
				const { completionDays: _completionDays, ...statsAnalytics } = analytics
				return {
					trackingSummaries,
					...statsAnalytics,
					diagnostic: {
						...statsAnalytics.diagnostic,
						categoryCandidatesTruncated:
							statsAnalytics.diagnostic.categoryCandidatesTruncated ||
							categoryBudget.candidate.truncated ||
							categoryBudget.exact.truncated,
						watchlistsProcessed: watchlists.length,
						watchlistsTruncated,
						watchlistLimit: PROFILE_WATCHLIST_LIMIT,
					},
				}
			},
			{ type: 'profile_compute', desc: 'stats analytics DTO', timings },
		)
	})
}

async function loadProfileActivitySnapshot(
	db: Prisma.TransactionClient,
	viewerId: string | null,
	user: { id: string },
	timings?: Timings,
) {
	const isOwner = viewerId === user.id
	const activityWhere = {
		actorId: user.id,
		...(isOwner
			? {}
			: {
					isPublic: true,
					publicEligible: true,
					AND: [
						{
							OR: [
								{ statusWatchlistId: null, statusLabel: null },
								{
									statusWatchlist: {
										ownerId: user.id,
										isPublic: true,
									},
								},
							],
						},
						{
							OR: [
								{
									previousStatusWatchlistId: null,
									previousStatusLabel: null,
								},
								{
									previousStatusWatchlist: {
										ownerId: user.id,
										isPublic: true,
									},
								},
							],
						},
					],
				}),
	} satisfies Prisma.ActivityEventWhereInput
	const watchlistWhere = {
		ownerId: user.id,
		...(isOwner ? {} : { isPublic: true }),
	} satisfies Prisma.WatchlistWhereInput

	const [watchlistRows, activityRows, reviewRows, diaryRows] = await time(
		Promise.all([
			db.watchlist.findMany({
				where: watchlistWhere,
				orderBy: [{ typeId: 'asc' }, { position: 'asc' }, { id: 'asc' }],
				take: PROFILE_WATCHLIST_LIMIT + 1,
				select: watchlistSelect,
			}),
			db.activityEvent.findMany({
				where: activityWhere,
				orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
				take: PROFILE_ACTIVITY_MAX_CAPACITY + 1,
				select: activityEventSelect,
			}),
			db.review.findMany({
				where: { authorId: user.id, moderationStatus: 'visible' },
				orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
				take: PROFILE_ACTIVITY_MAX_CAPACITY + 1,
				select: {
					id: true,
					createdAt: true,
					media: {
						select: { id: true, kind: true },
					},
				},
			}),
			db.diaryEntry.findMany({
				where: { ownerId: user.id },
				orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
				take: PROFILE_ACTIVITY_MAX_CAPACITY + 1,
				select: {
					id: true,
					isRepeat: true,
					createdAt: true,
					media: {
						select: { id: true, kind: true },
					},
				},
			}),
		]),
		{ type: 'profile_db', desc: 'bounded normalized activity rows', timings },
	)
	const watchLists = watchlistRows.slice(0, PROFILE_WATCHLIST_LIMIT)
	const watchlistsTruncated = watchlistRows.length > watchLists.length
	const visibleWatchlistIds = new Set(watchLists.map(watchlist => watchlist.id))
	const visibleListTypeIds = [
		...new Set(watchLists.map(watchlist => watchlist.typeId)),
	]
	const normalizedMediaIds = [
		...new Set(
			[...activityRows, ...reviewRows, ...diaryRows].map(row => row.media.id),
		),
	]
	const [unorderedListTypes, mediaTextById, activityTextById] = await time(
		Promise.all([
			db.listType.findMany({
				where: {
					OR: [
						{ name: { in: [...PROFILE_ACTIVITY_LIST_TYPE_NAMES] } },
						{ id: { in: visibleListTypeIds } },
					],
				},
				select: listTypeSelect,
			}),
			loadBoundedProfileMediaText(db, normalizedMediaIds),
			loadBoundedProfileActivityEventText(
				db,
				activityRows.map(event => event.id),
			),
		]),
		{ type: 'profile_db', desc: 'bounded normalized activity text', timings },
	)
	const listTypeOrder = new Map<string, number>(
		PROFILE_ACTIVITY_LIST_TYPE_NAMES.map((name, index) => [name, index]),
	)
	const listTypes = [...unorderedListTypes].sort(
		(left, right) =>
			(listTypeOrder.get(left.name) ?? Number.MAX_SAFE_INTEGER) -
				(listTypeOrder.get(right.name) ?? Number.MAX_SAFE_INTEGER) ||
			left.name.localeCompare(right.name) ||
			left.id.localeCompare(right.id),
	)

	return time(
		async () => {
			let normalizedSourceLimited =
				mediaTextById.size !== normalizedMediaIds.length ||
				activityTextById.size !== activityRows.length ||
				[...mediaTextById.values()].some(text => text.truncated) ||
				[...activityTextById.values()].some(text => text.truncated)
			const boundedMediaItem = (media: { id: string; kind: string }) => {
				const text = mediaTextById.get(media.id)
				if (!text) normalizedSourceLimited = true
				return mediaItem({
					...media,
					title: text?.title ?? null,
					thumbnail: text?.thumbnail ?? null,
				})
			}
			const listTypeIdByName = new Map(
				listTypes.map(listType => [listType.name, listType.id]),
			)
			const trackingActivity = activityRows.map(event => {
				const text = activityTextById.get(event.id)
				if (!text) normalizedSourceLimited = true
				return {
					id: `tracking:${event.id}`,
					action: activityEventLabel({
						...event,
						type: text?.type ?? 'tracking',
						status: text?.status ?? null,
						statusLabel: text?.statusLabel ?? null,
						previousStatus: text?.previousStatus ?? null,
						previousStatusLabel: text?.previousStatusLabel ?? null,
						progressUnit: text?.progressUnit ?? null,
					}),
					time: event.createdAt,
					typeId: typeIdForKind(event.media.kind, listTypeIdByName),
					media: boundedMediaItem(event.media),
				}
			})
			const normalizedTrackingTimes = new Map<string, number[]>()
			for (const event of trackingActivity) {
				const key = `${event.media.id}\u0000${event.action.toLowerCase()}`
				const times = normalizedTrackingTimes.get(key) ?? []
				times.push(event.time.getTime())
				normalizedTrackingTimes.set(key, times)
			}
			const collector = createProfileActivityCollector()
			collector.addBatch([
				...trackingActivity,
				...reviewRows.map(review => ({
					id: `review:${review.id}`,
					action: 'Published a review',
					time: review.createdAt,
					typeId: typeIdForKind(review.media.kind, listTypeIdByName),
					media: boundedMediaItem(review.media),
				})),
				...diaryRows.map(entry => ({
					id: `diary:${entry.id}`,
					action: diaryActivityLabel(entry.media.kind, entry.isRepeat),
					time: entry.createdAt,
					typeId: typeIdForKind(entry.media.kind, listTypeIdByName),
					media: boundedMediaItem(entry.media),
				})),
			])
			// Legacy Entry.history has no immutable public-at-creation provenance.
			// Keep compatibility history owner-only; visitors receive normalized
			// public-eligible activity, reviews, and diary rows.
			const watchlistIds = isOwner
				? watchLists.map(watchlist => watchlist.id)
				: []
			const listTypeById = new Map(
				listTypes.map(listType => [listType.id, listType]),
			)
			const watchlistById = new Map(
				watchLists.map(watchlist => [watchlist.id, watchlist]),
			)
			let legacyHistoryLimited = false
			const historyBudget = createProfileHistoryProjectionBudget()
			const activityScan = await scanProfileEntryPages({
				watchlistIds,
				batchSize: PROFILE_HISTORY_ENTRY_BATCH_SIZE,
				fetchPage: (watchlistId, cursor, take) =>
					db.entry.findMany({
						where: {
							watchlistId,
							...(cursor ? { id: { gt: cursor } } : {}),
							watchlist: watchlistWhere,
						},
						orderBy: { id: 'asc' },
						take,
						select: {
							id: true,
							watchlistId: true,
							mediaId: true,
							trackingState: {
								select: {
									ownerId: true,
									mediaId: true,
									statusWatchlistId: true,
								},
							},
						},
					}),
				onPage: async page => {
					const textByEntry = await loadBoundedProfileActivityEntryText(
						db,
						page.map(entry => entry.id),
						historyBudget,
					)
					for (const sourceEntry of page) {
						const text = textByEntry.get(sourceEntry.id)
						const state = sourceEntry.trackingState
						const stateVisible =
							state !== null &&
							state.ownerId === user.id &&
							state.mediaId === sourceEntry.mediaId &&
							(isOwner ||
								state.statusWatchlistId === null ||
								visibleWatchlistIds.has(state.statusWatchlistId))
						const redactLegacyTracking =
							!isOwner && state !== null && !stateVisible
						const sourceWatchlist = watchlistById.get(sourceEntry.watchlistId)
						const sourceListType = sourceWatchlist
							? listTypeById.get(sourceWatchlist.typeId)
							: null
						if (!sourceWatchlist || !sourceListType) {
							legacyHistoryLimited = true
							continue
						}
						const { typedEntries, typedHistory, diagnostic } =
							buildProfileHistory({
								listTypes: [sourceListType],
								watchlists: [sourceWatchlist],
								entries: [
									{
										id: sourceEntry.id,
										watchlistId: sourceEntry.watchlistId,
										mediaId: sourceEntry.mediaId,
										title: text?.title ?? '',
										thumbnail: text?.thumbnail ?? null,
										history: redactLegacyTracking
											? null
											: (text?.history ?? null),
									},
								],
							})
						if (diagnostic) legacyHistoryLimited = true
						for (const [typeId, items] of Object.entries(typedHistory)) {
							const entry = typedEntries[typeId]?.[0]
							if (!entry) continue
							collector.addBatch(
								items.flatMap((item, legacyIndex) => {
									const semanticKey = `${entry.mediaId ?? ''}\u0000${item.type.toLowerCase()}`
									if (
										normalizedTrackingTimes
											.get(semanticKey)
											?.some(
												time =>
													Math.abs(time - item.time.getTime()) <=
													PROFILE_ACTIVITY_DEDUPLICATION_WINDOW_MS,
											)
									) {
										return []
									}
									return {
										id: `legacy:${typeId}:${entry.id}:${legacyIndex}`,
										action: item.type,
										time: item.time,
										typeId,
										media: {
											id: entry.mediaId ?? '',
											title: entry.title.trim() || 'Untitled',
											thumbnail: entry.thumbnail,
										},
									}
								}),
							)
						}
					}
				},
			})

			return {
				activityEvents: collector.values(),
				activityLimited:
					activityScan.truncated ||
					watchlistsTruncated ||
					normalizedSourceLimited ||
					historyBudget.truncated ||
					legacyHistoryLimited ||
					collector.truncated,
			}
		},
		{
			type: 'profile_compute',
			desc: 'bounded activity aggregation',
			timings,
		},
	)
}

export async function loadProfileActivity(
	request: Request,
	username: string | undefined,
	timings?: Timings,
) {
	const viewerId = await time(getUserId(request), {
		type: 'profile_db',
		desc: 'activity viewer scope',
		timings,
	})
	return withProfileSnapshot(async db => {
		const user = await requireProfileUser(username, db)
		return loadProfileActivitySnapshot(db, viewerId, user, timings)
	})
}

export async function loadProfileReviews(
	username: string | undefined,
	timings?: Timings,
) {
	const user = await time(requireProfileUser(username), {
		type: 'profile_db',
		desc: 'review profile identity',
		timings,
	})
	const [listTypes, reviewRows] = await time(
		Promise.all([
			prisma.listType.findMany({ select: { id: true, name: true } }),
			prisma.review.findMany({
				where: { authorId: user.id, moderationStatus: 'visible' },
				orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
				take: 100,
				select: {
					id: true,
					body: true,
					containsSpoilers: true,
					rating: true,
					createdAt: true,
					updatedAt: true,
					media: {
						select: { id: true, kind: true, title: true, thumbnail: true },
					},
				},
			}),
		]),
		{ type: 'profile_db', desc: 'bounded profile reviews', timings },
	)
	const listTypeIdByName = new Map(
		listTypes.map(listType => [listType.name, listType.id]),
	)
	return {
		reviews: reviewRows.map(review => ({
			...review,
			rating: review.rating === null ? null : Number(review.rating),
			typeId: typeIdForKind(review.media.kind, listTypeIdByName),
			media: mediaItem(review.media),
		})),
	}
}

export async function loadProfileDiary(
	username: string | undefined,
	timings?: Timings,
) {
	const user = await time(requireProfileUser(username), {
		type: 'profile_db',
		desc: 'diary profile identity',
		timings,
	})
	const [listTypes, diaryRows] = await time(
		Promise.all([
			prisma.listType.findMany({ select: { id: true, name: true } }),
			prisma.diaryEntry.findMany({
				where: { ownerId: user.id },
				orderBy: [{ loggedOn: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
				take: 100,
				select: {
					id: true,
					loggedOn: true,
					isRepeat: true,
					rating: true,
					createdAt: true,
					media: {
						select: { id: true, kind: true, title: true, thumbnail: true },
					},
				},
			}),
		]),
		{ type: 'profile_db', desc: 'bounded profile diary', timings },
	)
	const listTypeIdByName = new Map(
		listTypes.map(listType => [listType.name, listType.id]),
	)
	return {
		diaryEntries: diaryRows.map(entry => ({
			...entry,
			rating: entry.rating === null ? null : Number(entry.rating),
			typeId: typeIdForKind(entry.media.kind, listTypeIdByName),
			media: mediaItem(entry.media),
		})),
	}
}

export async function loadProfileFavorites(
	username: string | undefined,
	timings?: Timings,
) {
	const user = await time(requireProfileUser(username), {
		type: 'profile_db',
		desc: 'favorites profile identity',
		timings,
	})
	const favoriteRows = await time(
		prisma.userFavorite.findMany({
			where: { ownerId: user.id },
			orderBy: [{ typeId: 'asc' }, { position: 'asc' }, { id: 'asc' }],
			take: PROFILE_FAVORITE_LIMIT + 1,
			select: {
				id: true,
				position: true,
				typeId: true,
				mediaId: true,
			},
		}),
		{ type: 'profile_db', desc: 'profile favorites', timings },
	)
	const visibleRows = favoriteRows.slice(0, PROFILE_FAVORITE_LIMIT)
	const textByFavorite = await time(
		loadBoundedProfileFavoriteText(
			prisma,
			visibleRows.map(favorite => favorite.id),
		),
		{ type: 'profile_db', desc: 'bounded favorite text', timings },
	)
	let favoritesLimited = favoriteRows.length > visibleRows.length
	const favorites = visibleRows.flatMap(favorite => {
		const text = textByFavorite.get(favorite.id)
		if (!text) {
			favoritesLimited = true
			return []
		}
		const { truncated, ...publicText } = text
		if (truncated) favoritesLimited = true
		return [{ ...favorite, ...publicText }]
	})
	return { favorites, favoritesLimited }
}
