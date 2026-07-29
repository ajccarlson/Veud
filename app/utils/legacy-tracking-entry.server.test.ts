import { type Prisma } from '@prisma/client'
import { afterEach, expect, test, vi } from 'vitest'
import {
	authoritativeLegacyTrackingEntry,
	LEGACY_TRACKING_AGGREGATE_CODE_UNIT_LIMIT,
	LEGACY_TRACKING_COUNTER_CODE_UNIT_LIMIT,
	LEGACY_TRACKING_ENTRY_LIMIT,
	LEGACY_TRACKING_HISTORY_CODE_UNIT_LIMIT,
	LEGACY_TRACKING_SCORE_CODE_UNIT_LIMIT,
	loadOwnerLegacyTrackingEntries,
	type LegacyTrackingEntry,
} from './legacy-tracking-entry.server.ts'

afterEach(() => {
	vi.restoreAllMocks()
})

function legacyEntry(
	id: string,
	input: {
		watchlistId?: string
		watchlistName?: string
		updatedAt?: number
	} = {},
): LegacyTrackingEntry {
	const watchlistId = input.watchlistId ?? `list-${id}`
	return {
		id,
		watchlistId,
		personal: null,
		history: JSON.stringify({ lastUpdated: input.updatedAt ?? 0 }),
		length: null,
		chapters: null,
		volumes: null,
		watchlist: {
			id: watchlistId,
			name: input.watchlistName ?? 'watching',
		},
	}
}

function databaseReturning(entries: LegacyTrackingEntry[]) {
	const queryRaw = vi.fn().mockResolvedValue(
		entries.map(entry => ({
			id: entry.id,
			watchlistId: entry.watchlistId,
			personal:
				entry.personal === null || entry.personal === undefined
					? null
					: String(entry.personal),
			history: entry.history,
			length: entry.length,
			chapters: entry.chapters,
			volumes: entry.volumes,
			watchlistName: entry.watchlist.name,
		})),
	)
	const db = {
		$queryRaw: queryRaw,
	} as unknown as Pick<Prisma.TransactionClient, '$queryRaw'>
	return { db, queryRaw }
}

test('loads only bounded text for the requested owner and media', async () => {
	const entry = legacyEntry('entry-a')
	const { db, queryRaw } = databaseReturning([entry])

	await expect(
		loadOwnerLegacyTrackingEntries(db, {
			ownerId: 'owner-a',
			mediaId: 'media-a',
		}),
	).resolves.toEqual({ entries: [entry], overflowed: false })

	expect(queryRaw).toHaveBeenCalledTimes(1)
	const query = queryRaw.mock.calls[0]?.[0] as Prisma.Sql
	expect(query.sql).toContain('substr("Entry"."history"')
	expect(query.sql).toContain('substr(CAST("Entry"."personal" AS TEXT)')
	expect(query.sql).toContain('INNER JOIN "Watchlist"')
	expect(query.sql).toContain('ORDER BY "Entry"."id" ASC')
	expect(query.sql).not.toContain('owner-a')
	expect(query.sql).not.toContain('media-a')
	expect(query.values).toEqual(
		expect.arrayContaining([
			LEGACY_TRACKING_HISTORY_CODE_UNIT_LIMIT + 1,
			'media-a',
			'owner-a',
			LEGACY_TRACKING_ENTRY_LIMIT + 1,
		]),
	)
})

test('adds an exact watchlist predicate without interpolating identifiers', async () => {
	const entry = legacyEntry('entry-a', { watchlistId: 'status-list' })
	const { db, queryRaw } = databaseReturning([entry])

	await expect(
		loadOwnerLegacyTrackingEntries(db, {
			ownerId: 'owner-a',
			mediaId: 'media-a',
			watchlistId: 'status-list',
		}),
	).resolves.toEqual({ entries: [entry], overflowed: false })

	const query = queryRaw.mock.calls[0]?.[0] as Prisma.Sql
	expect(query.sql).toContain('"Entry"."watchlistId" = ?')
	expect(query.sql).not.toContain('status-list')
	expect(query.values).toContain('status-list')
})

test('prefers the normalized status watchlist even when another snapshot is newer', () => {
	const statusEntry = legacyEntry('status-entry', {
		watchlistId: 'normalized-status-list',
		updatedAt: 10,
	})
	const newerEntry = legacyEntry('newer-entry', {
		watchlistId: 'another-list',
		updatedAt: 20,
	})

	expect(
		authoritativeLegacyTrackingEntry(
			[newerEntry, statusEntry],
			'anime',
			'normalized-status-list',
		),
	).toBe(statusEntry)
})

test('chooses the newest semantic legacy snapshot when no status entry exists', () => {
	const olderEntry = legacyEntry('older-entry', { updatedAt: 10 })
	const newerEntry = legacyEntry('newer-entry', { updatedAt: 20 })

	expect(
		authoritativeLegacyTrackingEntry(
			[olderEntry, newerEntry],
			'manga',
			'missing-list',
		),
	).toBe(newerEntry)
})

test('breaks semantic timestamp ties by entry id without mutating input order', () => {
	const entryB = legacyEntry('entry-b', { updatedAt: 20 })
	const entryA = legacyEntry('entry-a', { updatedAt: 20 })
	const entries = [entryB, entryA]

	expect(authoritativeLegacyTrackingEntry(entries, 'movie')).toBe(entryA)
	expect(entries).toEqual([entryB, entryA])
})

test('returns the exact supported limit as authoritative data', async () => {
	expect(LEGACY_TRACKING_ENTRY_LIMIT).toBe(100)
	const entries = Array.from(
		{ length: LEGACY_TRACKING_ENTRY_LIMIT },
		(_, index) => legacyEntry(`entry-${String(index).padStart(3, '0')}`),
	)
	const { db } = databaseReturning(entries)
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

	await expect(
		loadOwnerLegacyTrackingEntries(db, {
			ownerId: 'owner-at-limit',
			mediaId: 'media-at-limit',
		}),
	).resolves.toEqual({ entries, overflowed: false })
	expect(warn).not.toHaveBeenCalled()
})

test('fails closed on sentinel overflow and emits only an aggregate warning', async () => {
	const ownerId = 'private-owner-id'
	const mediaId = 'private-media-id'
	const entries = Array.from(
		{ length: LEGACY_TRACKING_ENTRY_LIMIT + 1 },
		(_, index) => legacyEntry(`private-entry-${index}`),
	)
	const { db } = databaseReturning(entries)
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

	await expect(
		loadOwnerLegacyTrackingEntries(db, { ownerId, mediaId }),
	).resolves.toEqual({ entries: [], overflowed: true })
	expect(warn).toHaveBeenCalledTimes(1)

	const serializedWarning = String(warn.mock.calls[0]?.[0])
	expect(JSON.parse(serializedWarning)).toMatchObject({
		level: 'warn',
		event: 'legacy_tracking_entry_projection_rejected',
		reason: 'row_limit',
		rowLimit: LEGACY_TRACKING_ENTRY_LIMIT,
		rowCount: LEGACY_TRACKING_ENTRY_LIMIT + 1,
	})
	expect(serializedWarning).not.toContain(ownerId)
	expect(serializedWarning).not.toContain(mediaId)
	expect(serializedWarning).not.toContain('private-entry')
})

test.each([
	{
		field: 'personal' as const,
		limit: LEGACY_TRACKING_SCORE_CODE_UNIT_LIMIT,
	},
	{
		field: 'history' as const,
		limit: LEGACY_TRACKING_HISTORY_CODE_UNIT_LIMIT,
	},
	{
		field: 'length' as const,
		limit: LEGACY_TRACKING_COUNTER_CODE_UNIT_LIMIT,
	},
	{
		field: 'chapters' as const,
		limit: LEGACY_TRACKING_COUNTER_CODE_UNIT_LIMIT,
	},
	{
		field: 'volumes' as const,
		limit: LEGACY_TRACKING_COUNTER_CODE_UNIT_LIMIT,
	},
])(
	'fails closed when $field carries the truncation sentinel',
	async ({ field, limit }) => {
		const privateContent = `private-${field}-content`
		const entry = legacyEntry('entry-a')
		entry[field] = privateContent
			.repeat(Math.ceil((limit + 1) / privateContent.length))
			.slice(0, limit + 1)
		const { db } = databaseReturning([entry])
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

		await expect(
			loadOwnerLegacyTrackingEntries(db, {
				ownerId: 'private-owner-id',
				mediaId: 'private-media-id',
			}),
		).resolves.toEqual({ entries: [], overflowed: true })

		const serializedWarning = String(warn.mock.calls[0]?.[0])
		expect(JSON.parse(serializedWarning)).toMatchObject({
			event: 'legacy_tracking_entry_projection_rejected',
			reason: 'field_limit',
		})
		expect(serializedWarning).not.toContain(privateContent)
		expect(serializedWarning).not.toContain('private-owner-id')
		expect(serializedWarning).not.toContain('private-media-id')
	},
)

test('enforces history limits in UTF-16 code units at astral boundaries', async () => {
	const exactEntry = legacyEntry('entry-exact')
	exactEntry.history = '😀'.repeat(LEGACY_TRACKING_HISTORY_CODE_UNIT_LIMIT / 2)
	const exact = databaseReturning([exactEntry])

	await expect(
		loadOwnerLegacyTrackingEntries(exact.db, {
			ownerId: 'owner-a',
			mediaId: 'media-a',
		}),
	).resolves.toEqual({ entries: [exactEntry], overflowed: false })

	const oversizedEntry = legacyEntry('entry-oversized')
	oversizedEntry.history = `${exactEntry.history}x`
	const oversized = databaseReturning([oversizedEntry])
	vi.spyOn(console, 'warn').mockImplementation(() => {})
	await expect(
		loadOwnerLegacyTrackingEntries(oversized.db, {
			ownerId: 'owner-a',
			mediaId: 'media-a',
		}),
	).resolves.toEqual({ entries: [], overflowed: true })
})

test('fails closed when individually bounded rows exceed the aggregate budget', async () => {
	const history = 'x'.repeat(LEGACY_TRACKING_HISTORY_CODE_UNIT_LIMIT)
	const rowCount =
		Math.floor(
			LEGACY_TRACKING_AGGREGATE_CODE_UNIT_LIMIT /
				LEGACY_TRACKING_HISTORY_CODE_UNIT_LIMIT,
		) + 1
	const entries = Array.from({ length: rowCount }, (_, index) => ({
		...legacyEntry(`entry-${index}`),
		history,
	}))
	const { db } = databaseReturning(entries)
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

	await expect(
		loadOwnerLegacyTrackingEntries(db, {
			ownerId: 'owner-aggregate',
			mediaId: 'media-aggregate',
		}),
	).resolves.toEqual({ entries: [], overflowed: true })

	const serializedWarning = String(warn.mock.calls[0]?.[0])
	expect(JSON.parse(serializedWarning)).toMatchObject({
		event: 'legacy_tracking_entry_projection_rejected',
		reason: 'aggregate_limit',
		rowCount,
		aggregateCodeUnitLimit: LEGACY_TRACKING_AGGREGATE_CODE_UNIT_LIMIT,
	})
	expect(serializedWarning).not.toContain('owner-aggregate')
	expect(serializedWarning).not.toContain('media-aggregate')
})
