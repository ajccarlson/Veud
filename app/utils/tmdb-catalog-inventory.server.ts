import { createReadStream } from 'node:fs'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { Readable } from 'node:stream'
import { createGunzip } from 'node:zlib'
import { type PrismaClient } from '@prisma/client'
import {
	acquireCatalogSyncLease,
	CatalogSyncLeaseError,
	checkpointCatalogSyncRun,
	completeCatalogSyncRun,
	failCatalogSyncRun,
	normalizeCatalogTitle,
	tombstoneCatalogSourcesNotSeenSince,
	upsertCatalogIdentity,
} from './catalog-sync.server.ts'

export const tmdbCatalogKinds = ['movie', 'tv'] as const
export type TmdbCatalogKind = (typeof tmdbCatalogKinds)[number]

export const tmdbMinimumInventoryRecords: Record<TmdbCatalogKind, number> = {
	movie: 1_000_000,
	tv: 150_000,
}

export type TmdbInventoryRecord = {
	id: number
	originalTitle: string | null
	popularity: number | null
	isAdult: boolean | null
	isVideo: boolean | null
}

type TmdbInventoryCursor = {
	version: 1
	exportDate: string
	line: number
	recordsCommitted: number
	scanStartedAt: string
	complete: boolean
	reconciled: boolean
}

export type TmdbInventorySummary = {
	runId: string | null
	kind: TmdbCatalogKind
	exportDate: string
	resumedFromLine: number
	lastCommittedLine: number
	recordsSeen: number
	recordsHandled: number
	recordsFailed: number
	recordsCommittedForExport: number
	tombstoned: number
	complete: boolean
	reconciled: boolean
	alreadyComplete: boolean
	dryRun: boolean
}

type ImportTmdbInventoryOptions = {
	prisma?: PrismaClient
	kind: TmdbCatalogKind
	exportDate: string
	lines: AsyncIterable<string>
	commit?: boolean
	limit?: number
	batchSize?: number
	leaseOwner?: string
	leaseDurationMs?: number
	reconcile?: boolean
	minimumRecords?: number
	now?: () => Date
	onCheckpoint?: (summary: TmdbInventorySummary) => void | Promise<void>
}

function requirePositiveInteger(value: number, label: string) {
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new Error(`${label} must be a positive safe integer`)
	}
	return value
}

export function requireTmdbExportDate(value: string) {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		throw new Error('TMDB export date must use YYYY-MM-DD')
	}
	const parsed = new Date(`${value}T00:00:00.000Z`)
	if (
		!Number.isFinite(parsed.getTime()) ||
		parsed.toISOString().slice(0, 10) !== value
	) {
		throw new Error('TMDB export date is not a real calendar date')
	}
	return value
}

export function defaultTmdbExportDate(now = new Date()) {
	return new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10)
}

export function tmdbDailyExportUrl(kind: TmdbCatalogKind, exportDate: string) {
	const [year, month, day] = requireTmdbExportDate(exportDate).split('-')
	const prefix = kind === 'movie' ? 'movie_ids' : 'tv_series_ids'
	return `https://files.tmdb.org/p/exports/${prefix}_${month}_${day}_${year}.json.gz`
}

function optionalFiniteNumber(value: unknown, label: string) {
	if (value === undefined || value === null) return null
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new Error(`${label} must be a finite number when present`)
	}
	return value
}

function optionalBoolean(value: unknown, label: string) {
	if (value === undefined || value === null) return null
	if (typeof value !== 'boolean') {
		throw new Error(`${label} must be a boolean when present`)
	}
	return value
}

export function parseTmdbInventoryLine(
	line: string,
	kind: TmdbCatalogKind,
): TmdbInventoryRecord {
	let parsed: unknown
	try {
		parsed = JSON.parse(line)
	} catch {
		throw new Error('record is not valid JSON')
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new Error('record must be a JSON object')
	}
	const record = parsed as Record<string, unknown>
	if (!Number.isSafeInteger(record.id) || Number(record.id) < 1) {
		throw new Error('id must be a positive safe integer')
	}
	const rawTitle =
		kind === 'movie' ? record.original_title : record.original_name
	if (
		rawTitle !== undefined &&
		rawTitle !== null &&
		typeof rawTitle !== 'string'
	) {
		throw new Error(
			`${kind === 'movie' ? 'original_title' : 'original_name'} must be a string when present`,
		)
	}
	const originalTitle =
		typeof rawTitle === 'string' ? rawTitle.trim() || null : null
	return {
		id: Number(record.id),
		originalTitle,
		popularity: optionalFiniteNumber(record.popularity, 'popularity'),
		isAdult: optionalBoolean(record.adult, 'adult'),
		isVideo: optionalBoolean(record.video, 'video'),
	}
}

type NodeWebReadable = Parameters<typeof Readable.fromWeb>[0]

async function openCompressedExport(source: string, fetchImpl: typeof fetch) {
	if (
		/^[a-z][a-z\d+.-]*:\/\//i.test(source) &&
		!source.startsWith('https://')
	) {
		throw new Error('TMDB export source must be a local path or HTTPS URL')
	}
	if (!source.startsWith('https://')) {
		return createReadStream(path.resolve(source))
	}
	const response = await fetchImpl(source, {
		headers: { 'user-agent': 'Veud catalog inventory importer' },
	})
	if (!response.ok) {
		throw new Error(
			`TMDB export download failed with ${response.status} ${response.statusText}`,
		)
	}
	if (!response.body) throw new Error('TMDB export response had no body')
	return Readable.fromWeb(response.body as unknown as NodeWebReadable)
}

export async function* readTmdbExportLines(
	source: string,
	options: { fetchImpl?: typeof fetch } = {},
) {
	const compressed = await openCompressedExport(
		source,
		options.fetchImpl ?? fetch,
	)
	const gunzip = createGunzip()
	compressed.on('error', (error: Error) => gunzip.destroy(error))
	compressed.pipe(gunzip)
	const reader = createInterface({ input: gunzip, crlfDelay: Infinity })
	try {
		for await (const line of reader) yield line
	} finally {
		reader.close()
		compressed.destroy()
		gunzip.destroy()
	}
}

function serializeTmdbInventoryCursor(cursor: TmdbInventoryCursor) {
	return JSON.stringify(cursor)
}

function parseTmdbInventoryCursor(raw: string | null) {
	if (!raw) return null
	let parsed: unknown
	try {
		parsed = JSON.parse(raw)
	} catch {
		throw new Error('Stored TMDB inventory cursor is not valid JSON')
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new Error('Stored TMDB inventory cursor is invalid')
	}
	const cursor = parsed as Partial<TmdbInventoryCursor>
	if (
		cursor.version !== 1 ||
		typeof cursor.exportDate !== 'string' ||
		!/^\d{4}-\d{2}-\d{2}$/.test(cursor.exportDate) ||
		!Number.isSafeInteger(cursor.line) ||
		Number(cursor.line) < 0 ||
		!Number.isSafeInteger(cursor.recordsCommitted) ||
		Number(cursor.recordsCommitted) < 0 ||
		typeof cursor.scanStartedAt !== 'string' ||
		!Number.isFinite(new Date(cursor.scanStartedAt).getTime()) ||
		typeof cursor.complete !== 'boolean' ||
		typeof cursor.reconciled !== 'boolean'
	) {
		throw new Error('Stored TMDB inventory cursor is invalid')
	}
	return cursor as TmdbInventoryCursor
}

function summaryFrom(input: {
	runId: string | null
	kind: TmdbCatalogKind
	exportDate: string
	resumedFromLine: number
	lastCommittedLine: number
	recordsSeen: number
	recordsHandled: number
	recordsFailed: number
	recordsCommittedForExport: number
	tombstoned?: number
	complete: boolean
	reconciled: boolean
	alreadyComplete?: boolean
	dryRun: boolean
}): TmdbInventorySummary {
	return {
		...input,
		tombstoned: input.tombstoned ?? 0,
		alreadyComplete: input.alreadyComplete ?? false,
	}
}

export async function importTmdbInventory(
	options: ImportTmdbInventoryOptions,
): Promise<TmdbInventorySummary> {
	const exportDate = requireTmdbExportDate(options.exportDate)
	const commit = options.commit ?? false
	const limit = options.limit ?? Infinity
	if (limit !== Infinity) requirePositiveInteger(limit, 'limit')
	const batchSize = requirePositiveInteger(
		options.batchSize ?? 250,
		'batchSize',
	)
	const leaseDurationMs = requirePositiveInteger(
		options.leaseDurationMs ?? 300_000,
		'leaseDurationMs',
	)
	const reconcile = options.reconcile ?? true
	const minimumRecords =
		options.minimumRecords ?? tmdbMinimumInventoryRecords[options.kind]
	if (!Number.isSafeInteger(minimumRecords) || minimumRecords < 0) {
		throw new Error('minimumRecords must be a non-negative safe integer')
	}
	const clock = options.now ?? (() => new Date())

	if (!commit) {
		let physicalLine = 0
		let lastLine = 0
		let recordsSeen = 0
		let limited = false
		for await (const line of options.lines) {
			physicalLine++
			if (!line.trim()) continue
			if (recordsSeen >= limit) {
				limited = true
				break
			}
			try {
				parseTmdbInventoryLine(line, options.kind)
			} catch (error) {
				throw new Error(
					`Invalid TMDB ${options.kind} export line ${physicalLine}: ${error instanceof Error ? error.message : String(error)}`,
				)
			}
			recordsSeen++
			lastLine = physicalLine
		}
		return summaryFrom({
			runId: null,
			kind: options.kind,
			exportDate,
			resumedFromLine: 0,
			lastCommittedLine: lastLine,
			recordsSeen,
			recordsHandled: recordsSeen,
			recordsFailed: 0,
			recordsCommittedForExport: 0,
			complete: !limited,
			reconciled: false,
			dryRun: true,
		})
	}

	const prisma = options.prisma
	if (!prisma) throw new Error('prisma is required in commit mode')
	const leaseOwner = options.leaseOwner?.trim()
	if (!leaseOwner) throw new Error('leaseOwner is required in commit mode')
	const acquiredAt = clock()
	const lease = await prisma.$transaction(tx =>
		acquireCatalogSyncLease(tx, {
			provider: 'tmdb',
			kind: options.kind,
			mode: 'inventory',
			leaseOwner,
			leaseDurationMs,
			now: acquiredAt,
		}),
	)
	let scanStartedAt = acquiredAt
	let resumedFromLine = 0
	let currentCursor: TmdbInventoryCursor = {
		version: 1,
		exportDate,
		line: 0,
		recordsCommitted: 0,
		scanStartedAt: scanStartedAt.toISOString(),
		complete: false,
		reconciled: false,
	}
	let recordsSeen = 0
	let recordsHandled = 0
	let recordsFailed = 0
	let tombstoned = 0

	const failRun = async (error: unknown, includeProgress: boolean) => {
		try {
			await prisma.$transaction(tx =>
				failCatalogSyncRun(tx, {
					runId: lease.run.id,
					leaseOwner,
					error,
					...(includeProgress
						? {
								progress: {
									cursor: serializeTmdbInventoryCursor(currentCursor),
									recordsSeen,
									recordsHandled,
									recordsFailed,
								},
							}
						: {}),
					now: clock(),
				}),
			)
		} catch (failureError) {
			if (!(failureError instanceof CatalogSyncLeaseError)) throw failureError
		}
	}

	try {
		const storedCursor = parseTmdbInventoryCursor(lease.run.cursor)
		if (storedCursor && storedCursor.exportDate > exportDate) {
			throw new Error(
				`Refusing TMDB ${options.kind} export ${exportDate}: cursor is already at newer export ${storedCursor.exportDate}`,
			)
		}
		if (storedCursor?.exportDate === exportDate) {
			currentCursor = storedCursor
			scanStartedAt = new Date(storedCursor.scanStartedAt)
			resumedFromLine = storedCursor.line
		}
	} catch (error) {
		await failRun(error, false)
		throw error
	}

	const makeSummary = (input: {
		complete: boolean
		alreadyComplete?: boolean
	}): TmdbInventorySummary =>
		summaryFrom({
			runId: lease.run.id,
			kind: options.kind,
			exportDate,
			resumedFromLine,
			lastCommittedLine: currentCursor.line,
			recordsSeen,
			recordsHandled,
			recordsFailed,
			recordsCommittedForExport: currentCursor.recordsCommitted,
			tombstoned,
			complete: input.complete,
			reconciled: currentCursor.reconciled,
			alreadyComplete: input.alreadyComplete,
			dryRun: false,
		})

	const finalize = async () => {
		const shouldReconcile = reconcile && !currentCursor.reconciled
		const finalCursor: TmdbInventoryCursor = {
			...currentCursor,
			complete: true,
			reconciled: currentCursor.reconciled || shouldReconcile,
		}
		await prisma.$transaction(async tx => {
			if (shouldReconcile) {
				const [observedCount, activeCount] = await Promise.all([
					tx.mediaExternalId.count({
						where: {
							provider: 'tmdb',
							kind: options.kind,
							lastSeenAt: { gte: scanStartedAt },
							tombstonedAt: null,
						},
					}),
					tx.mediaExternalId.count({
						where: {
							provider: 'tmdb',
							kind: options.kind,
							tombstonedAt: null,
						},
					}),
				])
				if (observedCount < minimumRecords) {
					throw new Error(
						`Refusing TMDB ${options.kind} reconciliation: observed ${observedCount} unique records, below minimum ${minimumRecords}`,
					)
				}
				if (activeCount > 0 && observedCount / activeCount < 0.9) {
					throw new Error(
						`Refusing TMDB ${options.kind} reconciliation: observed ${observedCount} of ${activeCount} active records`,
					)
				}
				const result = await tombstoneCatalogSourcesNotSeenSince(tx, {
					provider: 'tmdb',
					kind: options.kind,
					missingBefore: scanStartedAt,
					now: clock(),
				})
				tombstoned = result.count
			}
			await completeCatalogSyncRun(tx, {
				runId: lease.run.id,
				leaseOwner,
				progress: {
					cursor: serializeTmdbInventoryCursor(finalCursor),
					recordsSeen,
					recordsHandled,
					recordsFailed,
				},
				now: clock(),
			})
		})
		currentCursor = finalCursor
	}

	if (currentCursor.complete) {
		try {
			await finalize()
			return makeSummary({ complete: true, alreadyComplete: true })
		} catch (error) {
			await failRun(error, false)
			throw error
		}
	}

	type PendingRecord = {
		line: number
		record: TmdbInventoryRecord
	}
	let physicalLine = 0
	let pending: PendingRecord[] = []
	let limited = false

	const checkpoint = async () => {
		if (!pending.length) return
		const batch = pending
		pending = []
		const nextCursor: TmdbInventoryCursor = {
			...currentCursor,
			line: batch.at(-1)?.line ?? currentCursor.line,
			recordsCommitted: currentCursor.recordsCommitted + batch.length,
			complete: false,
		}
		await prisma.$transaction(async tx => {
			for (const item of batch) {
				const source = await upsertCatalogIdentity(tx, {
					provider: 'tmdb',
					kind: options.kind,
					externalId: String(item.record.id),
					sourceTitle: item.record.originalTitle,
					sourcePopularity: item.record.popularity,
					sourceIsAdult: item.record.isAdult,
					sourceIsVideo: item.record.isVideo,
					seenAt: scanStartedAt,
				})
				if (item.record.originalTitle) {
					await tx.mediaTitle.upsert({
						where: {
							mediaId_provider_language_titleType_value: {
								mediaId: source.mediaId,
								provider: 'tmdb',
								language: '',
								titleType: 'inventory-original',
								value: item.record.originalTitle,
							},
						},
						update: {
							normalized: normalizeCatalogTitle(item.record.originalTitle),
						},
						create: {
							mediaId: source.mediaId,
							provider: 'tmdb',
							language: '',
							titleType: 'inventory-original',
							value: item.record.originalTitle,
							normalized: normalizeCatalogTitle(item.record.originalTitle),
						},
					})
				}
			}
			await checkpointCatalogSyncRun(tx, {
				runId: lease.run.id,
				leaseOwner,
				progress: {
					cursor: serializeTmdbInventoryCursor(nextCursor),
					recordsSeen,
					recordsHandled: recordsHandled + batch.length,
					recordsFailed,
				},
				leaseDurationMs,
				now: clock(),
			})
		})
		recordsHandled += batch.length
		currentCursor = nextCursor
		await options.onCheckpoint?.(makeSummary({ complete: false }))
	}

	try {
		for await (const line of options.lines) {
			physicalLine++
			if (physicalLine <= resumedFromLine || !line.trim()) continue
			if (recordsSeen >= limit) {
				limited = true
				break
			}
			let record: TmdbInventoryRecord
			try {
				record = parseTmdbInventoryLine(line, options.kind)
			} catch (error) {
				recordsSeen++
				recordsFailed++
				throw new Error(
					`Invalid TMDB ${options.kind} export line ${physicalLine}: ${error instanceof Error ? error.message : String(error)}`,
				)
			}
			recordsSeen++
			pending.push({ line: physicalLine, record })
			if (pending.length >= batchSize) await checkpoint()
		}
		if (physicalLine < resumedFromLine) {
			throw new Error(
				`TMDB export ended at line ${physicalLine} before stored cursor line ${resumedFromLine}`,
			)
		}
		await checkpoint()

		if (limited) {
			await prisma.$transaction(tx =>
				completeCatalogSyncRun(tx, {
					runId: lease.run.id,
					leaseOwner,
					progress: {
						cursor: serializeTmdbInventoryCursor(currentCursor),
						recordsSeen,
						recordsHandled,
						recordsFailed,
					},
					now: clock(),
				}),
			)
			return makeSummary({ complete: false })
		}

		await finalize()
		return makeSummary({ complete: true })
	} catch (error) {
		await failRun(error, true)
		throw error
	}
}
