import { Prisma } from '@prisma/client'
import { writeStructuredLog } from './operations-observability.server.ts'
import { trackingStateFromEntry } from './tracking-state.ts'
import { MAX_WATCHLISTS_PER_USER } from './watchlist-limits.ts'

export const LEGACY_TRACKING_ENTRY_LIMIT = MAX_WATCHLISTS_PER_USER
export const LEGACY_TRACKING_ID_CODE_UNIT_LIMIT = 128
export const LEGACY_TRACKING_STATUS_CODE_UNIT_LIMIT = 160
export const LEGACY_TRACKING_HISTORY_CODE_UNIT_LIMIT = 16 * 1024
export const LEGACY_TRACKING_COUNTER_CODE_UNIT_LIMIT = 256
export const LEGACY_TRACKING_SCORE_CODE_UNIT_LIMIT = 64
export const LEGACY_TRACKING_AGGREGATE_CODE_UNIT_LIMIT = 256 * 1024

export type LegacyTrackingEntry = {
	id: string
	watchlistId: string
	personal: unknown
	history: string | null
	length: string | null
	chapters: string | null
	volumes: string | null
	watchlist: {
		id: string
		name: string
	}
}

type LegacyTrackingEntryDb = Pick<Prisma.TransactionClient, '$queryRaw'>

type LegacyTrackingEntryProjection = Omit<LegacyTrackingEntry, 'watchlist'> & {
	personal: string | null
	watchlistName: string
}

type ProjectionRejectionReason =
	'aggregate_limit' | 'ambiguous_projection' | 'field_limit' | 'row_limit'

function projectionCharacterLimit(codeUnitLimit: number) {
	// SQLite and PostgreSQL substr count Unicode characters. One extra database
	// character is a truncation sentinel; the exact UTF-16 limit is enforced
	// after Prisma materializes the bounded prefix.
	return codeUnitLimit + 1
}

function rejectProjection(
	reason: ProjectionRejectionReason,
	input: {
		rowCount: number
		observedCodeUnits?: number
	},
): { entries: LegacyTrackingEntry[]; overflowed: true } {
	writeStructuredLog('warn', 'legacy_tracking_entry_projection_rejected', {
		reason,
		rowLimit: LEGACY_TRACKING_ENTRY_LIMIT,
		rowCount: input.rowCount,
		aggregateCodeUnitLimit: LEGACY_TRACKING_AGGREGATE_CODE_UNIT_LIMIT,
		...(input.observedCodeUnits === undefined
			? {}
			: { observedCodeUnits: input.observedCodeUnits }),
	})
	return { entries: [], overflowed: true }
}

function boundedText(
	value: unknown,
	limit: number,
	nullable: true,
): { value: string | null; codeUnits: number } | null
function boundedText(
	value: unknown,
	limit: number,
	nullable: false,
): { value: string; codeUnits: number } | null
function boundedText(
	value: unknown,
	limit: number,
	nullable: boolean,
): { value: string | null; codeUnits: number } | null {
	if (value === null && nullable) return { value: null, codeUnits: 0 }
	if (typeof value !== 'string') return null
	if (value.length > limit) return null
	return { value, codeUnits: value.length }
}

export async function loadOwnerLegacyTrackingEntries(
	db: LegacyTrackingEntryDb,
	input: { ownerId: string; mediaId: string; watchlistId?: string },
): Promise<{ entries: LegacyTrackingEntry[]; overflowed: boolean }> {
	const rows = await db.$queryRaw<LegacyTrackingEntryProjection[]>(Prisma.sql`
		SELECT
			substr("Entry"."id", 1, CAST(${projectionCharacterLimit(LEGACY_TRACKING_ID_CODE_UNIT_LIMIT)} AS INTEGER)) AS "id",
			substr("Entry"."watchlistId", 1, CAST(${projectionCharacterLimit(LEGACY_TRACKING_ID_CODE_UNIT_LIMIT)} AS INTEGER)) AS "watchlistId",
			substr(CAST("Entry"."personal" AS TEXT), 1, CAST(${projectionCharacterLimit(LEGACY_TRACKING_SCORE_CODE_UNIT_LIMIT)} AS INTEGER)) AS "personal",
			substr("Entry"."history", 1, CAST(${projectionCharacterLimit(LEGACY_TRACKING_HISTORY_CODE_UNIT_LIMIT)} AS INTEGER)) AS "history",
			substr("Entry"."length", 1, CAST(${projectionCharacterLimit(LEGACY_TRACKING_COUNTER_CODE_UNIT_LIMIT)} AS INTEGER)) AS "length",
			substr("Entry"."chapters", 1, CAST(${projectionCharacterLimit(LEGACY_TRACKING_COUNTER_CODE_UNIT_LIMIT)} AS INTEGER)) AS "chapters",
			substr("Entry"."volumes", 1, CAST(${projectionCharacterLimit(LEGACY_TRACKING_COUNTER_CODE_UNIT_LIMIT)} AS INTEGER)) AS "volumes",
			substr("Watchlist"."name", 1, CAST(${projectionCharacterLimit(LEGACY_TRACKING_STATUS_CODE_UNIT_LIMIT)} AS INTEGER)) AS "watchlistName"
		FROM "Entry"
		INNER JOIN "Watchlist"
			ON "Watchlist"."id" = "Entry"."watchlistId"
		WHERE "Entry"."mediaId" = ${input.mediaId}
			AND "Watchlist"."ownerId" = ${input.ownerId}
			${
				input.watchlistId !== undefined
					? Prisma.sql`AND "Entry"."watchlistId" = ${input.watchlistId}`
					: Prisma.empty
			}
		ORDER BY "Entry"."id" ASC
		LIMIT ${LEGACY_TRACKING_ENTRY_LIMIT + 1}
	`)

	if (rows.length > LEGACY_TRACKING_ENTRY_LIMIT) {
		return rejectProjection('row_limit', { rowCount: rows.length })
	}

	let observedCodeUnits = 0
	const seenIds = new Set<string>()
	const entries: LegacyTrackingEntry[] = []
	for (const row of rows) {
		const id = boundedText(row.id, LEGACY_TRACKING_ID_CODE_UNIT_LIMIT, false)
		const watchlistId = boundedText(
			row.watchlistId,
			LEGACY_TRACKING_ID_CODE_UNIT_LIMIT,
			false,
		)
		const watchlistName = boundedText(
			row.watchlistName,
			LEGACY_TRACKING_STATUS_CODE_UNIT_LIMIT,
			false,
		)
		const history = boundedText(
			row.history,
			LEGACY_TRACKING_HISTORY_CODE_UNIT_LIMIT,
			true,
		)
		const personal = boundedText(
			row.personal,
			LEGACY_TRACKING_SCORE_CODE_UNIT_LIMIT,
			true,
		)
		const length = boundedText(
			row.length,
			LEGACY_TRACKING_COUNTER_CODE_UNIT_LIMIT,
			true,
		)
		const chapters = boundedText(
			row.chapters,
			LEGACY_TRACKING_COUNTER_CODE_UNIT_LIMIT,
			true,
		)
		const volumes = boundedText(
			row.volumes,
			LEGACY_TRACKING_COUNTER_CODE_UNIT_LIMIT,
			true,
		)
		if (
			!id ||
			!watchlistId ||
			!watchlistName ||
			!id.value ||
			!watchlistId.value ||
			!personal ||
			!history ||
			!length ||
			!chapters ||
			!volumes
		) {
			return rejectProjection('field_limit', { rowCount: rows.length })
		}
		if (
			seenIds.has(id.value) ||
			(input.watchlistId !== undefined &&
				watchlistId.value !== input.watchlistId)
		) {
			return rejectProjection('ambiguous_projection', {
				rowCount: rows.length,
			})
		}
		seenIds.add(id.value)
		observedCodeUnits +=
			id.codeUnits +
			watchlistId.codeUnits +
			watchlistName.codeUnits +
			personal.codeUnits +
			history.codeUnits +
			length.codeUnits +
			chapters.codeUnits +
			volumes.codeUnits
		if (observedCodeUnits > LEGACY_TRACKING_AGGREGATE_CODE_UNIT_LIMIT) {
			return rejectProjection('aggregate_limit', {
				rowCount: rows.length,
				observedCodeUnits,
			})
		}
		entries.push({
			id: id.value,
			watchlistId: watchlistId.value,
			personal: personal.value,
			history: history.value,
			length: length.value,
			chapters: chapters.value,
			volumes: volumes.value,
			watchlist: {
				id: watchlistId.value,
				name: watchlistName.value,
			},
		})
	}

	return { entries, overflowed: false }
}

function semanticSourceUpdatedAt(
	entry: LegacyTrackingEntry,
	mediaKind: string,
) {
	return trackingStateFromEntry(entry, {
		status: entry.watchlist.name,
		statusWatchlistId: entry.watchlist.id,
		mediaKind,
	}).sourceUpdatedAt
}

function newestSemanticLegacyEntry(
	entries: LegacyTrackingEntry[],
	mediaKind: string,
) {
	let newest: LegacyTrackingEntry | undefined
	let newestUpdatedAt = 0
	for (const entry of entries) {
		const updatedAt = semanticSourceUpdatedAt(entry, mediaKind)
		if (
			!newest ||
			updatedAt > newestUpdatedAt ||
			(updatedAt === newestUpdatedAt && entry.id < newest.id)
		) {
			newest = entry
			newestUpdatedAt = updatedAt
		}
	}
	return newest
}

export function authoritativeLegacyTrackingEntry(
	entries: LegacyTrackingEntry[],
	mediaKind: string,
	statusWatchlistId?: string | null,
) {
	if (statusWatchlistId) {
		const statusEntries = entries.filter(
			entry => entry.watchlistId === statusWatchlistId,
		)
		if (statusEntries.length) {
			return newestSemanticLegacyEntry(statusEntries, mediaKind)
		}
	}
	return newestSemanticLegacyEntry(entries, mediaKind)
}
