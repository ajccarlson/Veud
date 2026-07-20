import { gzipSync } from 'node:zlib'
import { expect, test, vi } from 'vitest'
import { upsertCatalogIdentity } from './catalog-sync.server.ts'
import { prisma } from './db.server.ts'
import {
	defaultTmdbExportDate,
	importTmdbInventory,
	parseTmdbInventoryLine,
	readTmdbExportLines,
	requireTmdbExportDate,
	tmdbDailyExportUrl,
} from './tmdb-catalog-inventory.server.ts'

function movieLine(id: number, title = `Movie ${id}`, popularity = id / 10) {
	return JSON.stringify({
		adult: false,
		id,
		original_title: title,
		popularity,
		video: false,
	})
}

function tvLine(id: number, title = `Series ${id}`) {
	return JSON.stringify({ id, original_name: title, popularity: id / 10 })
}

async function* exportLines(lines: string[]) {
	for (const line of lines) yield line
}

test('builds dated export URLs and validates provider records', () => {
	expect(defaultTmdbExportDate(new Date('2026-07-20T04:00:00.000Z'))).toBe(
		'2026-07-19',
	)
	expect(tmdbDailyExportUrl('movie', '2026-07-19')).toBe(
		'https://files.tmdb.org/p/exports/movie_ids_07_19_2026.json.gz',
	)
	expect(tmdbDailyExportUrl('tv', '2026-07-19')).toBe(
		'https://files.tmdb.org/p/exports/tv_series_ids_07_19_2026.json.gz',
	)
	expect(parseTmdbInventoryLine(movieLine(3924, ' Blondie '), 'movie')).toEqual(
		{
			id: 3924,
			originalTitle: 'Blondie',
			popularity: 392.4,
			isAdult: false,
			isVideo: false,
		},
	)
	expect(parseTmdbInventoryLine(tvLine(1, 'プライド'), 'tv')).toEqual({
		id: 1,
		originalTitle: 'プライド',
		popularity: 0.1,
		isAdult: null,
		isVideo: null,
	})
	expect(() => requireTmdbExportDate('2026-02-30')).toThrow(
		'not a real calendar date',
	)
	expect(() => parseTmdbInventoryLine('{bad', 'movie')).toThrow(
		'not valid JSON',
	)
	expect(() => parseTmdbInventoryLine('{"id":0}', 'movie')).toThrow(
		'positive safe integer',
	)
})

test('streams and decompresses an HTTPS export response', async () => {
	const compressed = gzipSync(`${movieLine(1)}\n${movieLine(2)}\n`)
	const fetchImpl = vi.fn(async () => new Response(compressed))
	const lines: string[] = []
	for await (const line of readTmdbExportLines(
		'https://example.test/export.gz',
		{
			fetchImpl: fetchImpl as unknown as typeof fetch,
		},
	)) {
		lines.push(line)
	}

	expect(lines).toEqual([movieLine(1), movieLine(2)])
	expect(fetchImpl).toHaveBeenCalledWith(
		'https://example.test/export.gz',
		expect.objectContaining({
			headers: { 'user-agent': 'Veud catalog inventory importer' },
		}),
	)
})

test('rejects non-HTTPS export URLs', async () => {
	await expect(
		readTmdbExportLines('http://example.test/export.gz').next(),
	).rejects.toThrow('must be a local path or HTTPS URL')
})

test('dry-run validates a bounded export without writing sync or media rows', async () => {
	const summary = await importTmdbInventory({
		kind: 'movie',
		exportDate: '2026-07-19',
		lines: exportLines([movieLine(1), movieLine(2), movieLine(3)]),
		limit: 2,
	})

	expect(summary).toEqual(
		expect.objectContaining({
			dryRun: true,
			complete: false,
			recordsSeen: 2,
			recordsHandled: 2,
			lastCommittedLine: 2,
		}),
	)
	expect(await prisma.media.count()).toBe(0)
	expect(await prisma.mediaExternalId.count()).toBe(0)
	expect(await prisma.catalogSyncRun.count()).toBe(0)
})

test('a limited commit resumes the same export and an idempotent rerun is skipped', async () => {
	const lines = [movieLine(1), movieLine(2), movieLine(3), movieLine(4)]
	const first = await importTmdbInventory({
		prisma,
		kind: 'movie',
		exportDate: '2026-07-19',
		lines: exportLines(lines),
		commit: true,
		limit: 2,
		batchSize: 1,
		leaseOwner: 'partial-worker',
		minimumRecords: 1,
		now: () => new Date('2026-07-20T00:00:00.000Z'),
	})

	expect(first).toEqual(
		expect.objectContaining({
			complete: false,
			resumedFromLine: 0,
			lastCommittedLine: 2,
			recordsHandled: 2,
			recordsCommittedForExport: 2,
		}),
	)
	expect(await prisma.mediaExternalId.count()).toBe(2)

	const second = await importTmdbInventory({
		prisma,
		kind: 'movie',
		exportDate: '2026-07-19',
		lines: exportLines(lines),
		commit: true,
		batchSize: 2,
		leaseOwner: 'resume-worker',
		minimumRecords: 1,
		now: () => new Date('2026-07-20T01:00:00.000Z'),
	})

	expect(second).toEqual(
		expect.objectContaining({
			complete: true,
			resumedFromLine: 2,
			lastCommittedLine: 4,
			recordsHandled: 2,
			recordsCommittedForExport: 4,
		}),
	)
	expect(await prisma.media.count()).toBe(4)
	expect(await prisma.mediaExternalId.count()).toBe(4)
	expect(await prisma.mediaTitle.count()).toBe(4)
	expect(
		await prisma.mediaExternalId.findUniqueOrThrow({
			where: {
				provider_kind_externalId: {
					provider: 'tmdb',
					kind: 'movie',
					externalId: '1',
				},
			},
			include: { media: true },
		}),
	).toEqual(
		expect.objectContaining({
			sourceTitle: 'Movie 1',
			sourcePopularity: 0.1,
			sourceIsAdult: false,
			sourceIsVideo: false,
			media: expect.objectContaining({
				title: 'Movie 1',
				catalogPopularity: 0.1,
			}),
		}),
	)

	let iterated = false
	async function* shouldNotRead() {
		iterated = true
		yield movieLine(999)
	}
	const third = await importTmdbInventory({
		prisma,
		kind: 'movie',
		exportDate: '2026-07-19',
		lines: shouldNotRead(),
		commit: true,
		leaseOwner: 'repeat-worker',
		minimumRecords: 1,
		now: () => new Date('2026-07-20T02:00:00.000Z'),
	})
	expect(third.alreadyComplete).toBe(true)
	expect(iterated).toBe(false)
	expect(await prisma.mediaExternalId.count()).toBe(4)
})

test('rejects export-date rollback and releases the acquired lease', async () => {
	await importTmdbInventory({
		prisma,
		kind: 'movie',
		exportDate: '2026-07-19',
		lines: exportLines([movieLine(1)]),
		commit: true,
		leaseOwner: 'current-export-worker',
		minimumRecords: 1,
		now: () => new Date('2026-07-20T00:00:00.000Z'),
	})

	await expect(
		importTmdbInventory({
			prisma,
			kind: 'movie',
			exportDate: '2026-07-18',
			lines: exportLines([movieLine(1)]),
			commit: true,
			leaseOwner: 'old-export-worker',
			minimumRecords: 1,
			now: () => new Date('2026-07-20T01:00:00.000Z'),
		}),
	).rejects.toThrow('cursor is already at newer export 2026-07-19')

	expect(
		await prisma.catalogSyncCursor.findUniqueOrThrow({
			where: {
				provider_kind_mode: {
					provider: 'tmdb',
					kind: 'movie',
					mode: 'inventory',
				},
			},
		}),
	).toEqual(expect.objectContaining({ leaseOwner: null, leaseExpiresAt: null }))
	expect(
		await prisma.catalogSyncRun.findFirstOrThrow({
			where: { leaseOwner: 'old-export-worker' },
		}),
	).toEqual(expect.objectContaining({ status: 'failed' }))
})

test('full reconciliation spans partial runs and tombstones only missing identities', async () => {
	const oldSeenAt = new Date('2026-07-01T00:00:00.000Z')
	const old = await prisma.$transaction(tx =>
		upsertCatalogIdentity(tx, {
			provider: 'tmdb',
			kind: 'movie',
			externalId: '999',
			seenAt: oldSeenAt,
		}),
	)
	const otherKind = await prisma.$transaction(tx =>
		upsertCatalogIdentity(tx, {
			provider: 'tmdb',
			kind: 'tv',
			externalId: '999',
			seenAt: oldSeenAt,
		}),
	)
	const lines = Array.from({ length: 10 }, (_, index) => movieLine(index + 1))

	await importTmdbInventory({
		prisma,
		kind: 'movie',
		exportDate: '2026-07-19',
		lines: exportLines(lines),
		commit: true,
		limit: 5,
		batchSize: 5,
		leaseOwner: 'reconcile-partial',
		minimumRecords: 1,
		now: () => new Date('2026-07-20T00:00:00.000Z'),
	})
	expect(
		await prisma.mediaExternalId.findUniqueOrThrow({ where: { id: old.id } }),
	).toEqual(expect.objectContaining({ tombstonedAt: null }))

	const completed = await importTmdbInventory({
		prisma,
		kind: 'movie',
		exportDate: '2026-07-19',
		lines: exportLines(lines),
		commit: true,
		batchSize: 5,
		leaseOwner: 'reconcile-complete',
		minimumRecords: 1,
		now: () => new Date('2026-07-20T01:00:00.000Z'),
	})
	expect(completed.tombstoned).toBe(1)
	expect(
		await prisma.mediaExternalId.findUniqueOrThrow({ where: { id: old.id } }),
	).toEqual(
		expect.objectContaining({
			tombstonedAt: new Date('2026-07-20T01:00:00.000Z'),
			fetchStatus: 'tombstoned',
		}),
	)
	expect(
		await prisma.mediaExternalId.findUniqueOrThrow({
			where: { id: otherKind.id },
		}),
	).toEqual(expect.objectContaining({ tombstonedAt: null }))
	expect(await prisma.media.count()).toBe(12)
})

test('a completed no-reconcile import can reconcile later without rereading', async () => {
	const old = await prisma.$transaction(tx =>
		upsertCatalogIdentity(tx, {
			provider: 'tmdb',
			kind: 'movie',
			externalId: '999',
			seenAt: new Date('2026-07-01T00:00:00.000Z'),
		}),
	)
	const lines = Array.from({ length: 10 }, (_, index) => movieLine(index + 1))
	const imported = await importTmdbInventory({
		prisma,
		kind: 'movie',
		exportDate: '2026-07-19',
		lines: exportLines(lines),
		commit: true,
		leaseOwner: 'no-reconcile-worker',
		reconcile: false,
		minimumRecords: 1,
		now: () => new Date('2026-07-20T00:00:00.000Z'),
	})
	expect(imported).toEqual(
		expect.objectContaining({ complete: true, reconciled: false }),
	)
	expect(
		await prisma.mediaExternalId.findUniqueOrThrow({ where: { id: old.id } }),
	).toEqual(expect.objectContaining({ tombstonedAt: null }))

	let iterated = false
	async function* shouldNotRead() {
		iterated = true
		yield movieLine(1000)
	}
	const reconciled = await importTmdbInventory({
		prisma,
		kind: 'movie',
		exportDate: '2026-07-19',
		lines: shouldNotRead(),
		commit: true,
		leaseOwner: 'deferred-reconcile-worker',
		minimumRecords: 1,
		now: () => new Date('2026-07-20T01:00:00.000Z'),
	})
	expect(iterated).toBe(false)
	expect(reconciled).toEqual(
		expect.objectContaining({
			complete: true,
			reconciled: true,
			alreadyComplete: true,
			tombstoned: 1,
		}),
	)
})

test('a suspiciously truncated full export fails without tombstoning', async () => {
	for (let id = 1; id <= 10; id++) {
		await prisma.$transaction(tx =>
			upsertCatalogIdentity(tx, {
				provider: 'tmdb',
				kind: 'movie',
				externalId: String(id),
				seenAt: new Date('2026-07-01T00:00:00.000Z'),
			}),
		)
	}

	await expect(
		importTmdbInventory({
			prisma,
			kind: 'movie',
			exportDate: '2026-07-19',
			lines: exportLines([movieLine(1)]),
			commit: true,
			batchSize: 1,
			leaseOwner: 'truncated-worker',
			minimumRecords: 1,
			now: () => new Date('2026-07-20T00:00:00.000Z'),
		}),
	).rejects.toThrow('observed 1 of 10 active records')

	expect(
		await prisma.mediaExternalId.count({
			where: { tombstonedAt: { not: null } },
		}),
	).toBe(0)
	expect(
		await prisma.catalogSyncRun.findFirstOrThrow({
			where: { provider: 'tmdb', kind: 'movie' },
		}),
	).toEqual(
		expect.objectContaining({
			status: 'failed',
			recordsHandled: 1,
		}),
	)
})

test('a malformed line fails after the last durable checkpoint and can resume', async () => {
	await expect(
		importTmdbInventory({
			prisma,
			kind: 'tv',
			exportDate: '2026-07-19',
			lines: exportLines([tvLine(1), '{bad json', tvLine(3)]),
			commit: true,
			batchSize: 1,
			leaseOwner: 'malformed-worker',
			minimumRecords: 1,
			now: () => new Date('2026-07-20T00:00:00.000Z'),
		}),
	).rejects.toThrow('Invalid TMDB tv export line 2')

	expect(await prisma.mediaExternalId.count()).toBe(1)
	const failedRun = await prisma.catalogSyncRun.findFirstOrThrow({
		where: { provider: 'tmdb', kind: 'tv' },
	})
	expect(failedRun).toEqual(
		expect.objectContaining({
			status: 'failed',
			recordsSeen: 2,
			recordsHandled: 1,
			recordsFailed: 1,
		}),
	)
	expect(JSON.parse(failedRun.cursor ?? '{}')).toEqual(
		expect.objectContaining({ line: 1, complete: false }),
	)

	const resumed = await importTmdbInventory({
		prisma,
		kind: 'tv',
		exportDate: '2026-07-19',
		lines: exportLines([tvLine(1), tvLine(2), tvLine(3)]),
		commit: true,
		batchSize: 2,
		leaseOwner: 'repair-worker',
		minimumRecords: 1,
		now: () => new Date('2026-07-20T01:00:00.000Z'),
	})
	expect(resumed).toEqual(
		expect.objectContaining({
			resumedFromLine: 1,
			recordsHandled: 2,
			recordsCommittedForExport: 3,
			complete: true,
		}),
	)
	expect(await prisma.mediaExternalId.count()).toBe(3)
})
