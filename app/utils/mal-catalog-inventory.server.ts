import { type Prisma, type PrismaClient } from '@prisma/client'
import {
	acquireCatalogSyncLease,
	catalogHydrationPriorities,
	catalogSourceNeedsFetch,
	CatalogSyncLeaseError,
	checkpointCatalogSyncRun,
	completeCatalogSyncRun,
	failCatalogSyncRun,
	normalizeCatalogTitle,
	tombstoneCatalogSourcesNotSeenSince,
	upsertCatalogIdentity,
} from './catalog-sync.server.ts'

const MAL_API_ORIGIN = 'https://api.myanimelist.net'
const MAL_MAX_PAGE_SIZE = 500
const DEFAULT_RETRY_DELAY_MS = 5 * 60_000

export const malCatalogKinds = ['anime', 'manga'] as const
export type MalCatalogKind = (typeof malCatalogKinds)[number]

export const malMinimumInventoryRecords: Record<MalCatalogKind, number> = {
	anime: 25_000,
	manga: 70_000,
}

export type MalInventoryTitle = {
	language: string
	titleType: string
	value: string
	isPrimary: boolean
}

export type MalInventoryRecord = {
	id: number
	title: string
	mediaType: string | null
	nsfw: string | null
	popularityRank: number | null
	rankingRank: number | null
	sourceUpdatedAt: Date | null
	catalogPopularity: number | null
	titles: MalInventoryTitle[]
}

export type MalInventoryPage = {
	records: MalInventoryRecord[]
	nextOffset: number | null
}

type MalInventoryCursor = {
	version: 1
	inventoryDate: string
	nextOffset: number
	recordsCommitted: number
	scanStartedAt: string
	providerRetryAfter: string | null
	complete: boolean
	reconciled: boolean
}

export type MalInventorySummary = {
	runId: string | null
	kind: MalCatalogKind
	inventoryDate: string
	resumedFromOffset: number
	nextOffset: number
	recordsSeen: number
	recordsHandled: number
	recordsFailed: number
	recordsCommittedForScan: number
	requestsMade: number
	rateLimitEvents: number
	providerRetryAfter: Date | null
	tombstoned: number
	complete: boolean
	reconciled: boolean
	alreadyComplete: boolean
	dryRun: boolean
}

export type ImportMalInventoryOptions = {
	prisma?: PrismaClient
	kind: MalCatalogKind
	inventoryDate: string
	clientId: string
	policyApprovalReference?: string
	commit?: boolean
	limit?: number
	pageSize?: number
	requestDelayMs?: number
	leaseOwner?: string
	leaseDurationMs?: number
	reconcile?: boolean
	minimumRecords?: number
	fetchImpl?: typeof fetch
	now?: () => Date
	delay?: (milliseconds: number) => Promise<void>
	onCheckpoint?: (summary: MalInventorySummary) => void | Promise<void>
}

export class MalRequestError extends Error {
	constructor(
		message: string,
		public readonly status: number | null,
		public readonly retryAfter: Date | null = null,
	) {
		super(message)
		this.name = 'MalRequestError'
	}
}

function requirePositiveInteger(value: number, label: string) {
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new Error(`${label} must be a positive safe integer`)
	}
	return value
}

function requireNonNegativeInteger(value: number, label: string) {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new Error(`${label} must be a non-negative safe integer`)
	}
	return value
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`${label} must be a JSON object`)
	}
	return value as Record<string, unknown>
}

function optionalString(value: unknown, label: string) {
	if (value === undefined || value === null) return null
	if (typeof value !== 'string') {
		throw new Error(`${label} must be a string when present`)
	}
	return value.trim() || null
}

function optionalPositiveInteger(value: unknown, label: string) {
	if (value === undefined || value === null) return null
	if (!Number.isSafeInteger(value) || Number(value) < 1) {
		throw new Error(`${label} must be a positive safe integer when present`)
	}
	return Number(value)
}

function optionalDate(value: unknown, label: string) {
	const raw = optionalString(value, label)
	if (!raw) return null
	const parsed = new Date(raw)
	if (!Number.isFinite(parsed.getTime())) {
		throw new Error(`${label} must be an ISO date when present`)
	}
	return parsed
}

export function requireMalInventoryDate(value: string) {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		throw new Error('MAL inventory date must use YYYY-MM-DD')
	}
	const parsed = new Date(`${value}T00:00:00.000Z`)
	if (
		!Number.isFinite(parsed.getTime()) ||
		parsed.toISOString().slice(0, 10) !== value
	) {
		throw new Error('MAL inventory date is not a real calendar date')
	}
	return value
}

export function defaultMalInventoryDate(now = new Date()) {
	return now.toISOString().slice(0, 10)
}

export function malRankingUrl(
	kind: MalCatalogKind,
	offset: number,
	limit = MAL_MAX_PAGE_SIZE,
) {
	requireNonNegativeInteger(offset, 'offset')
	requirePositiveInteger(limit, 'limit')
	if (limit > MAL_MAX_PAGE_SIZE) {
		throw new Error(`limit cannot exceed ${MAL_MAX_PAGE_SIZE}`)
	}
	const url = new URL(`/v2/${kind}/ranking`, MAL_API_ORIGIN)
	url.searchParams.set('ranking_type', 'all')
	url.searchParams.set('offset', String(offset))
	url.searchParams.set('limit', String(limit))
	url.searchParams.set(
		'fields',
		'alternative_titles,media_type,nsfw,popularity,updated_at',
	)
	return url.toString()
}

export function parseMalRetryAfter(value: string | null, now = new Date()) {
	if (!value) return null
	if (/^\d+$/.test(value.trim())) {
		const seconds = Number(value.trim())
		const deadline = new Date(now.getTime() + seconds * 1_000)
		return Number.isSafeInteger(seconds) && Number.isFinite(deadline.getTime())
			? deadline
			: null
	}
	const parsed = new Date(value)
	return Number.isFinite(parsed.getTime()) && parsed > now ? parsed : null
}

/** MAL exposes popularity as a rank where 1 is best; catalog popularity sorts
 * in the opposite direction. The reciprocal preserves the ordering without
 * pretending the provider's rank is directly comparable to TMDB's score. */
export function malCatalogPopularity(popularityRank: number | null) {
	return popularityRank === null ? null : 1 / popularityRank
}

function inventoryTitles(node: Record<string, unknown>, title: string) {
	const titles: MalInventoryTitle[] = [
		{
			language: '',
			titleType: 'inventory-primary',
			value: title,
			isPrimary: true,
		},
	]
	if (
		node.alternative_titles === undefined ||
		node.alternative_titles === null
	) {
		return titles
	}
	const alternatives = requireObject(
		node.alternative_titles,
		'MAL alternative_titles',
	)
	const english = optionalString(alternatives.en, 'MAL alternative_titles.en')
	const japanese = optionalString(alternatives.ja, 'MAL alternative_titles.ja')
	if (english) {
		titles.push({
			language: 'en',
			titleType: 'inventory-english',
			value: english,
			isPrimary: false,
		})
	}
	if (japanese) {
		titles.push({
			language: 'ja',
			titleType: 'inventory-japanese',
			value: japanese,
			isPrimary: false,
		})
	}
	if (alternatives.synonyms !== undefined) {
		if (!Array.isArray(alternatives.synonyms)) {
			throw new Error('MAL alternative_titles.synonyms must be an array')
		}
		for (const synonym of alternatives.synonyms) {
			const value = optionalString(synonym, 'MAL alternative_titles synonym')
			if (value) {
				titles.push({
					language: '',
					titleType: 'inventory-synonym',
					value,
					isPrimary: false,
				})
			}
		}
	}
	return titles
}

function nextOffsetFromPaging(
	value: unknown,
	kind: MalCatalogKind,
	currentOffset: number,
) {
	if (value === undefined || value === null) return null
	const paging = requireObject(value, 'MAL paging')
	if (paging.next === undefined || paging.next === null) return null
	const next = optionalString(paging.next, 'MAL paging.next')
	if (!next) return null
	let url: URL
	try {
		url = new URL(next)
	} catch {
		throw new Error('MAL paging.next must be a valid URL')
	}
	if (url.origin !== MAL_API_ORIGIN || url.pathname !== `/v2/${kind}/ranking`) {
		throw new Error(
			'MAL paging.next must remain on the selected ranking endpoint',
		)
	}
	const rawOffset = url.searchParams.get('offset')
	if (!rawOffset || !/^\d+$/.test(rawOffset)) {
		throw new Error('MAL paging.next must contain a non-negative offset')
	}
	const offset = Number(rawOffset)
	requireNonNegativeInteger(offset, 'MAL paging.next offset')
	if (offset <= currentOffset) {
		throw new Error('MAL paging.next offset must advance')
	}
	return offset
}

export function parseMalInventoryPage(
	value: unknown,
	kind: MalCatalogKind,
	currentOffset: number,
): MalInventoryPage {
	const payload = requireObject(value, `MAL ${kind} ranking response`)
	if (!Array.isArray(payload.data)) {
		throw new Error(`MAL ${kind} ranking response has no data array`)
	}
	const records = payload.data.map((item, index): MalInventoryRecord => {
		const result = requireObject(
			item,
			`MAL ${kind} ranking result ${index + 1}`,
		)
		const node = requireObject(
			result.node,
			`MAL ${kind} ranking result ${index + 1}.node`,
		)
		if (!Number.isSafeInteger(node.id) || Number(node.id) < 1) {
			throw new Error('MAL node id must be a positive safe integer')
		}
		const title = optionalString(node.title, 'MAL node title')
		if (!title) throw new Error('MAL node title is required')
		const popularityRank = optionalPositiveInteger(
			node.popularity,
			'MAL node popularity',
		)
		const ranking =
			result.ranking === undefined || result.ranking === null
				? null
				: requireObject(result.ranking, 'MAL ranking')
		const rankingRank = optionalPositiveInteger(
			ranking?.rank,
			'MAL ranking rank',
		)
		return {
			id: Number(node.id),
			title,
			mediaType: optionalString(node.media_type, 'MAL node media_type'),
			nsfw: optionalString(node.nsfw, 'MAL node nsfw'),
			popularityRank,
			rankingRank,
			sourceUpdatedAt: optionalDate(node.updated_at, 'MAL node updated_at'),
			catalogPopularity: malCatalogPopularity(popularityRank),
			titles: inventoryTitles(node, title),
		}
	})
	const ids = new Set(records.map(record => record.id))
	if (ids.size !== records.length) {
		throw new Error(`MAL ${kind} ranking page contains duplicate ids`)
	}
	const nextOffset = nextOffsetFromPaging(payload.paging, kind, currentOffset)
	if (nextOffset !== null && records.length === 0) {
		throw new Error('MAL ranking returned an empty page with a next cursor')
	}
	return { records, nextOffset }
}

export async function fetchMalInventoryPage(input: {
	kind: MalCatalogKind
	offset: number
	limit?: number
	clientId: string
	fetchImpl?: typeof fetch
	now?: Date
}) {
	const clientId = input.clientId.trim()
	if (!clientId) throw new Error('MAL client id is required')
	const fetchImpl = input.fetchImpl ?? fetch
	const now = input.now ?? new Date()
	let response: Response
	try {
		response = await fetchImpl(
			malRankingUrl(input.kind, input.offset, input.limit),
			{
				headers: {
					accept: 'application/json',
					'X-MAL-CLIENT-ID': clientId,
				},
			},
		)
	} catch (error) {
		throw new MalRequestError(
			`MAL request failed: ${error instanceof Error ? error.message : String(error)}`,
			null,
		)
	}
	if (!response.ok) {
		throw new MalRequestError(
			`MAL request failed with ${response.status} ${response.statusText}`,
			response.status,
			parseMalRetryAfter(response.headers.get('retry-after'), now),
		)
	}
	let payload: unknown
	try {
		payload = await response.json()
	} catch {
		throw new MalRequestError(
			'MAL response was not valid JSON',
			response.status,
		)
	}
	return parseMalInventoryPage(payload, input.kind, input.offset)
}

function serializeMalInventoryCursor(cursor: MalInventoryCursor) {
	return JSON.stringify(cursor)
}

function parseMalInventoryCursor(raw: string | null) {
	if (!raw) return null
	let parsed: unknown
	try {
		parsed = JSON.parse(raw)
	} catch {
		throw new Error('Stored MAL inventory cursor is not valid JSON')
	}
	const cursor = requireObject(parsed, 'Stored MAL inventory cursor')
	if (
		cursor.version !== 1 ||
		typeof cursor.inventoryDate !== 'string' ||
		!/^\d{4}-\d{2}-\d{2}$/.test(cursor.inventoryDate) ||
		!Number.isSafeInteger(cursor.nextOffset) ||
		Number(cursor.nextOffset) < 0 ||
		!Number.isSafeInteger(cursor.recordsCommitted) ||
		Number(cursor.recordsCommitted) < 0 ||
		typeof cursor.scanStartedAt !== 'string' ||
		!Number.isFinite(new Date(cursor.scanStartedAt).getTime()) ||
		(cursor.providerRetryAfter !== null &&
			typeof cursor.providerRetryAfter !== 'string') ||
		(cursor.providerRetryAfter &&
			!Number.isFinite(new Date(cursor.providerRetryAfter).getTime())) ||
		typeof cursor.complete !== 'boolean' ||
		typeof cursor.reconciled !== 'boolean'
	) {
		throw new Error('Stored MAL inventory cursor is invalid')
	}
	return cursor as unknown as MalInventoryCursor
}

function summaryFrom(
	input: Omit<MalInventorySummary, 'alreadyComplete' | 'tombstoned'> & {
		alreadyComplete?: boolean
		tombstoned?: number
	},
): MalInventorySummary {
	return {
		...input,
		tombstoned: input.tombstoned ?? 0,
		alreadyComplete: input.alreadyComplete ?? false,
	}
}

export function malSourceIsAdult(nsfw: string | null) {
	if (!nsfw) return null
	return nsfw.toLowerCase() === 'white' ? false : true
}

function hydrationPriority(record: MalInventoryRecord) {
	const rank = record.popularityRank ?? record.rankingRank
	return (
		catalogHydrationPriorities.popular +
		Math.max(0, 9_999 - Math.min(rank ?? 9_999, 9_999))
	)
}

const inventoryTitleTypes = [
	'inventory-primary',
	'inventory-english',
	'inventory-japanese',
	'inventory-synonym',
]

async function replaceMalInventoryTitles(
	tx: Prisma.TransactionClient,
	mediaId: string,
	titles: MalInventoryTitle[],
) {
	const unique = new Map<string, Prisma.MediaTitleCreateManyInput>()
	for (const title of titles) {
		const key = JSON.stringify([title.language, title.titleType, title.value])
		unique.set(key, {
			mediaId,
			provider: 'mal',
			language: title.language,
			titleType: title.titleType,
			value: title.value,
			normalized: normalizeCatalogTitle(title.value),
			isPrimary: title.isPrimary,
		})
	}
	await tx.mediaTitle.deleteMany({
		where: {
			mediaId,
			provider: 'mal',
			titleType: { in: inventoryTitleTypes },
		},
	})
	if (unique.size)
		await tx.mediaTitle.createMany({ data: [...unique.values()] })
}

function wait(milliseconds: number) {
	return new Promise<void>(resolve => setTimeout(resolve, milliseconds))
}

export async function importMalInventory(
	options: ImportMalInventoryOptions,
): Promise<MalInventorySummary> {
	const inventoryDate = requireMalInventoryDate(options.inventoryDate)
	const clientId = options.clientId.trim()
	if (!clientId) throw new Error('MAL client id is required')
	const commit = options.commit ?? false
	if (commit && !options.policyApprovalReference?.trim()) {
		throw new Error('MAL policy approval reference is required in commit mode')
	}
	const limit = options.limit ?? Infinity
	if (limit !== Infinity) requirePositiveInteger(limit, 'limit')
	const pageSize = requirePositiveInteger(
		options.pageSize ?? MAL_MAX_PAGE_SIZE,
		'pageSize',
	)
	if (pageSize > MAL_MAX_PAGE_SIZE) {
		throw new Error(`pageSize cannot exceed ${MAL_MAX_PAGE_SIZE}`)
	}
	const requestDelayMs = requireNonNegativeInteger(
		options.requestDelayMs ?? 1_000,
		'requestDelayMs',
	)
	const leaseDurationMs = requirePositiveInteger(
		options.leaseDurationMs ?? 300_000,
		'leaseDurationMs',
	)
	const reconcile = options.reconcile ?? false
	const minimumRecords = requireNonNegativeInteger(
		options.minimumRecords ?? malMinimumInventoryRecords[options.kind],
		'minimumRecords',
	)
	const fetchImpl = options.fetchImpl ?? fetch
	const clock = options.now ?? (() => new Date())
	const delay = options.delay ?? wait

	if (!commit) {
		let nextOffset = 0
		let recordsSeen = 0
		let requestsMade = 0
		let rateLimitEvents = 0
		let providerRetryAfter: Date | null = null
		let complete = false
		while (recordsSeen < limit) {
			if (requestsMade > 0 && requestDelayMs > 0) await delay(requestDelayMs)
			const remaining = limit === Infinity ? pageSize : limit - recordsSeen
			const requested = Math.min(pageSize, remaining)
			let page: MalInventoryPage
			requestsMade++
			try {
				page = await fetchMalInventoryPage({
					kind: options.kind,
					offset: nextOffset,
					limit: requested,
					clientId,
					fetchImpl,
					now: clock(),
				})
			} catch (error) {
				if (error instanceof MalRequestError && error.status === 429) {
					rateLimitEvents++
					providerRetryAfter =
						error.retryAfter ??
						new Date(clock().getTime() + DEFAULT_RETRY_DELAY_MS)
					break
				}
				throw error
			}
			recordsSeen += page.records.length
			nextOffset = page.nextOffset ?? nextOffset + page.records.length
			complete = page.nextOffset === null
			await options.onCheckpoint?.(
				summaryFrom({
					runId: null,
					kind: options.kind,
					inventoryDate,
					resumedFromOffset: 0,
					nextOffset,
					recordsSeen,
					recordsHandled: recordsSeen,
					recordsFailed: 0,
					recordsCommittedForScan: 0,
					requestsMade,
					rateLimitEvents,
					providerRetryAfter,
					complete,
					reconciled: false,
					dryRun: true,
				}),
			)
			if (complete) break
		}
		return summaryFrom({
			runId: null,
			kind: options.kind,
			inventoryDate,
			resumedFromOffset: 0,
			nextOffset,
			recordsSeen,
			recordsHandled: recordsSeen,
			recordsFailed: 0,
			recordsCommittedForScan: 0,
			requestsMade,
			rateLimitEvents,
			providerRetryAfter,
			complete,
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
			provider: 'mal',
			kind: options.kind,
			mode: 'inventory',
			leaseOwner,
			leaseDurationMs,
			now: acquiredAt,
		}),
	)
	let scanStartedAt = acquiredAt
	let resumedFromOffset = 0
	let currentCursor: MalInventoryCursor = {
		version: 1,
		inventoryDate,
		nextOffset: 0,
		recordsCommitted: 0,
		scanStartedAt: scanStartedAt.toISOString(),
		providerRetryAfter: null,
		complete: false,
		reconciled: false,
	}
	let recordsSeen = 0
	let recordsHandled = 0
	let recordsFailed = 0
	let requestsMade = 0
	let rateLimitEvents = 0
	let providerRetryAfter: Date | null = null
	let tombstoned = 0

	const progress = () => ({
		cursor: serializeMalInventoryCursor(currentCursor),
		recordsSeen,
		recordsHandled,
		recordsFailed,
	})
	const telemetry = () => ({
		requestsMade,
		rateLimitEvents,
		providerRetryAfter,
	})
	const failRun = async (error: unknown, includeProgress: boolean) => {
		try {
			await prisma.$transaction(tx =>
				failCatalogSyncRun(tx, {
					runId: lease.run.id,
					leaseOwner,
					error,
					...(includeProgress ? { progress: progress() } : {}),
					telemetry: telemetry(),
					now: clock(),
				}),
			)
		} catch (failureError) {
			if (!(failureError instanceof CatalogSyncLeaseError)) throw failureError
		}
	}

	try {
		const storedCursor = parseMalInventoryCursor(lease.run.cursor)
		if (storedCursor && storedCursor.inventoryDate > inventoryDate) {
			throw new Error(
				`Refusing MAL ${options.kind} inventory ${inventoryDate}: cursor is already at newer inventory ${storedCursor.inventoryDate}`,
			)
		}
		if (storedCursor?.inventoryDate === inventoryDate) {
			currentCursor = storedCursor
			scanStartedAt = new Date(storedCursor.scanStartedAt)
			resumedFromOffset = storedCursor.nextOffset
			providerRetryAfter = storedCursor.providerRetryAfter
				? new Date(storedCursor.providerRetryAfter)
				: null
		}
	} catch (error) {
		await failRun(error, false)
		throw error
	}

	const makeSummary = (input: {
		complete: boolean
		alreadyComplete?: boolean
	}): MalInventorySummary =>
		summaryFrom({
			runId: lease.run.id,
			kind: options.kind,
			inventoryDate,
			resumedFromOffset,
			nextOffset: currentCursor.nextOffset,
			recordsSeen,
			recordsHandled,
			recordsFailed,
			recordsCommittedForScan: currentCursor.recordsCommitted,
			requestsMade,
			rateLimitEvents,
			providerRetryAfter,
			tombstoned,
			complete: input.complete,
			reconciled: currentCursor.reconciled,
			alreadyComplete: input.alreadyComplete,
			dryRun: false,
		})

	const finalize = async () => {
		const shouldReconcile = reconcile && !currentCursor.reconciled
		const finalCursor: MalInventoryCursor = {
			...currentCursor,
			providerRetryAfter: null,
			complete: true,
			reconciled: currentCursor.reconciled || shouldReconcile,
		}
		await prisma.$transaction(async tx => {
			if (shouldReconcile) {
				const [observedCount, activeCount] = await Promise.all([
					tx.mediaExternalId.count({
						where: {
							provider: 'mal',
							kind: options.kind,
							lastSeenAt: { gte: scanStartedAt },
							tombstonedAt: null,
						},
					}),
					tx.mediaExternalId.count({
						where: {
							provider: 'mal',
							kind: options.kind,
							tombstonedAt: null,
						},
					}),
				])
				if (observedCount < minimumRecords) {
					throw new Error(
						`Refusing MAL ${options.kind} reconciliation: observed ${observedCount} unique records, below minimum ${minimumRecords}`,
					)
				}
				if (activeCount > 0 && observedCount / activeCount < 0.9) {
					throw new Error(
						`Refusing MAL ${options.kind} reconciliation: observed ${observedCount} of ${activeCount} active records`,
					)
				}
				const result = await tombstoneCatalogSourcesNotSeenSince(tx, {
					provider: 'mal',
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
					...progress(),
					cursor: serializeMalInventoryCursor(finalCursor),
				},
				telemetry: telemetry(),
				now: clock(),
			})
		})
		currentCursor = finalCursor
		providerRetryAfter = null
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

	try {
		const startedAt = clock()
		if (providerRetryAfter && providerRetryAfter > startedAt) {
			await prisma.$transaction(tx =>
				completeCatalogSyncRun(tx, {
					runId: lease.run.id,
					leaseOwner,
					progress: progress(),
					telemetry: telemetry(),
					now: startedAt,
				}),
			)
			return makeSummary({ complete: false })
		}
		if (providerRetryAfter) {
			providerRetryAfter = null
			currentCursor = { ...currentCursor, providerRetryAfter: null }
		}

		while (recordsSeen < limit) {
			if (requestsMade > 0 && requestDelayMs > 0) await delay(requestDelayMs)
			const remaining = limit === Infinity ? pageSize : limit - recordsSeen
			const requested = Math.min(pageSize, remaining)
			let page: MalInventoryPage
			requestsMade++
			try {
				page = await fetchMalInventoryPage({
					kind: options.kind,
					offset: currentCursor.nextOffset,
					limit: requested,
					clientId,
					fetchImpl,
					now: clock(),
				})
			} catch (error) {
				if (error instanceof MalRequestError && error.status === 429) {
					rateLimitEvents++
					providerRetryAfter =
						error.retryAfter ??
						new Date(clock().getTime() + DEFAULT_RETRY_DELAY_MS)
					currentCursor = {
						...currentCursor,
						providerRetryAfter: providerRetryAfter.toISOString(),
					}
					await prisma.$transaction(tx =>
						completeCatalogSyncRun(tx, {
							runId: lease.run.id,
							leaseOwner,
							progress: progress(),
							telemetry: telemetry(),
							now: clock(),
						}),
					)
					return makeSummary({ complete: false })
				}
				throw error
			}

			const pageOffset = currentCursor.nextOffset
			recordsSeen += page.records.length
			const nextCursor: MalInventoryCursor = {
				...currentCursor,
				nextOffset: page.nextOffset ?? pageOffset + page.records.length,
				recordsCommitted: currentCursor.recordsCommitted + page.records.length,
				providerRetryAfter: null,
				complete: false,
			}
			await prisma.$transaction(async tx => {
				for (const record of page.records) {
					const source = await upsertCatalogIdentity(tx, {
						provider: 'mal',
						kind: options.kind,
						externalId: String(record.id),
						sourceUpdatedAt: record.sourceUpdatedAt,
						sourceTitle: record.title,
						sourcePopularity: record.catalogPopularity,
						sourceIsAdult: malSourceIsAdult(record.nsfw),
						seenAt: scanStartedAt,
					})
					await replaceMalInventoryTitles(tx, source.mediaId, record.titles)
					if (record.mediaType && source.media.type !== record.mediaType) {
						await tx.media.update({
							where: { id: source.mediaId },
							data: { type: record.mediaType },
						})
					}
					const priority = hydrationPriority(record)
					const needsHydration = catalogSourceNeedsFetch(source, scanStartedAt)
					if (needsHydration) {
						const changedSinceFetch = Boolean(
							source.sourceUpdatedAt &&
							(!source.lastFetchedAt ||
								source.sourceUpdatedAt > source.lastFetchedAt),
						)
						const shouldRaisePriority = source.hydrationPriority <= priority
						await tx.mediaExternalId.update({
							where: { id: source.id },
							data: {
								...(shouldRaisePriority
									? {
											hydrationPriority: priority,
											hydrationReason: 'mal-inventory',
											hydrationRequestedAt: scanStartedAt,
										}
									: {}),
								...(source.fetchStatus === 'fresh' && changedSinceFetch
									? { fetchStatus: 'pending', refreshAfter: null }
									: {}),
							},
						})
					}
				}
				await checkpointCatalogSyncRun(tx, {
					runId: lease.run.id,
					leaseOwner,
					progress: {
						cursor: serializeMalInventoryCursor(nextCursor),
						recordsSeen,
						recordsHandled: recordsHandled + page.records.length,
						recordsFailed,
					},
					telemetry: telemetry(),
					leaseDurationMs,
					now: clock(),
				})
			})
			recordsHandled += page.records.length
			currentCursor = nextCursor
			await options.onCheckpoint?.(makeSummary({ complete: false }))

			if (page.nextOffset === null) {
				await finalize()
				return makeSummary({ complete: true })
			}
		}

		await prisma.$transaction(tx =>
			completeCatalogSyncRun(tx, {
				runId: lease.run.id,
				leaseOwner,
				progress: progress(),
				telemetry: telemetry(),
				now: clock(),
			}),
		)
		return makeSummary({ complete: false })
	} catch (error) {
		await failRun(error, true)
		throw error
	}
}
