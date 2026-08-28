import { type Prisma, type PrismaClient } from '@prisma/client'
import { catalogRefreshDays } from './catalog-refresh-policy.ts'
import {
	acquireCatalogSyncLease,
	CatalogSyncLeaseError,
	checkpointCatalogSyncRun,
	completeCatalogSyncRun,
	failCatalogSyncRun,
} from './catalog-sync.server.ts'
import {
	boundCast,
	type CatalogCreditInput,
	cleanName,
	replaceCatalogCredits,
} from './media-credits.server.ts'

const DAY_MS = 24 * 60 * 60 * 1_000
const DEFAULT_REFRESH_DAYS = 180
const DEFAULT_RETRY_DELAY_MS = 5 * 60_000
const JIKAN_PROVIDER = 'jikan'
const JIKAN_SCOPE = 'anime-cast'

type JikanCursor = {
	version: 1
	providerRetryAfter: string | null
}

type JikanCandidate = {
	id: string
	mediaId: string
	externalId: string
	media: {
		releaseStatus: string | null
		releaseEnd: Date | null
		nextRelease: string | null
		_count: { entries: number }
		creditSyncStates: Array<{ failureCount: number }>
	}
}

export type JikanAnimeCastSummary = {
	runId: string | null
	dryRun: boolean
	recordsSeen: number
	recordsHandled: number
	recordsFailed: number
	creditsWritten: number
	requestsMade: number
	rateLimitEvents: number
	providerRetryAfter: Date | null
	queueBefore: number
	queueAfter: number
}

export type HydrateJikanAnimeCastOptions = {
	prisma: PrismaClient
	commit?: boolean
	policyApprovalReference?: string
	limit?: number
	refreshDays?: number
	requestDelayMs?: number
	leaseOwner?: string
	leaseDurationMs?: number
	fetchImpl?: typeof fetch
	now?: () => Date
	delay?: (milliseconds: number) => Promise<void>
	onCheckpoint?: (summary: JikanAnimeCastSummary) => void | Promise<void>
}

export class JikanRequestError extends Error {
	constructor(
		message: string,
		public readonly status: number | null,
		public readonly retryAfter: Date | null = null,
	) {
		super(message)
		this.name = 'JikanRequestError'
	}
}

function requirePositiveInteger(value: number, label: string) {
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new Error(`${label} must be a positive safe integer`)
	}
	return value
}

function requireRequestDelay(value: number) {
	if (!Number.isSafeInteger(value) || value < 1_000) {
		throw new Error('requestDelayMs must be at least 1000')
	}
	return value
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`${label} must be a JSON object`)
	}
	return value as Record<string, unknown>
}

function asRecords(value: unknown) {
	return Array.isArray(value)
		? value.filter(
				(item): item is Record<string, unknown> =>
					Boolean(item) && typeof item === 'object' && !Array.isArray(item),
			)
		: []
}

function asRecord(value: unknown) {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null
}

function positiveProviderId(value: unknown) {
	return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
		? String(value)
		: null
}

function jikanPersonImage(person: Record<string, unknown>) {
	const images = person.images
	if (!images || typeof images !== 'object' || Array.isArray(images))
		return null
	const jpg = (images as Record<string, unknown>).jpg
	if (!jpg || typeof jpg !== 'object' || Array.isArray(jpg)) return null
	const value = (jpg as Record<string, unknown>).image_url
	if (typeof value !== 'string') return null
	try {
		const url = new URL(value)
		return url.protocol === 'https:' && url.hostname === 'cdn.myanimelist.net'
			? url.toString()
			: null
	} catch {
		return null
	}
}

/**
 * Turn Jikan's character list into one original-language voice credit per
 * character. MAL pages lead with Japanese voices; when a title has none, the
 * first valid language is still more useful than an empty cast section.
 */
export function normalizeJikanAnimeCast(value: unknown): CatalogCreditInput[] {
	const payload = requireObject(value, 'Jikan anime characters response')
	if (!Array.isArray(payload.data)) {
		throw new Error('Jikan anime characters response data must be an array')
	}
	const credits: CatalogCreditInput[] = []
	for (const [billingOrder, item] of asRecords(payload.data).entries()) {
		const character = asRecord(item.character)
		if (!character) continue
		const role = cleanName(character.name)
		if (!role) continue

		const actors = asRecords(item.voice_actors).flatMap(actor => {
			const person = asRecord(actor.person)
			if (!person) return []
			const externalId = positiveProviderId(person.mal_id)
			const name = cleanName(person.name)
			return externalId && name
				? [
						{
							externalId,
							name,
							imageUrl: jikanPersonImage(person),
							language: cleanName(actor.language).toLowerCase(),
						},
					]
				: []
		})
		const actor =
			actors.find(candidate => candidate.language === 'japanese') ?? actors[0]
		if (!actor) continue
		credits.push({
			externalId: actor.externalId,
			name: actor.name,
			imageUrl: actor.imageUrl,
			knownForDepartment: 'Acting',
			creditType: 'cast',
			role,
			department: '',
			billingOrder,
			episodeCount: null,
		})
	}
	return boundCast(credits)
}

export function jikanAnimeCharactersUrl(externalId: string) {
	if (
		!/^\d+$/.test(externalId) ||
		!Number.isSafeInteger(Number(externalId)) ||
		Number(externalId) < 1
	) {
		throw new Error('MAL anime id must be a positive safe integer')
	}
	return `https://api.jikan.moe/v4/anime/${externalId}/characters`
}

export function parseJikanRetryAfter(value: string | null, now: Date) {
	if (!value) return null
	const seconds = Number(value)
	if (Number.isFinite(seconds) && seconds >= 0) {
		return new Date(now.getTime() + seconds * 1_000)
	}
	const date = new Date(value)
	return Number.isFinite(date.getTime()) && date > now ? date : null
}

async function fetchJikanJson(input: {
	url: string
	fetchImpl: typeof fetch
	now: Date
}) {
	let response: Response
	try {
		response = await input.fetchImpl(input.url, {
			redirect: 'error',
			headers: {
				accept: 'application/json',
				'user-agent': 'Veud/0.1 (+https://www.veud.net/)',
			},
			signal: AbortSignal.timeout(15_000),
		})
	} catch (error) {
		throw new JikanRequestError(
			`Jikan request failed: ${error instanceof Error ? error.message : String(error)}`,
			null,
		)
	}
	if (!response.ok) {
		throw new JikanRequestError(
			`Jikan request failed with ${response.status} ${response.statusText}`,
			response.status,
			parseJikanRetryAfter(response.headers.get('retry-after'), input.now),
		)
	}
	try {
		return await response.json()
	} catch {
		throw new JikanRequestError(
			'Jikan response was not valid JSON',
			response.status,
		)
	}
}

export function jikanRetryDeadline(input: {
	error: unknown
	failureCount: number
	now: Date
}) {
	const requestError =
		input.error instanceof JikanRequestError ? input.error : null
	if (requestError?.retryAfter && requestError.retryAfter > input.now) {
		return requestError.retryAfter
	}
	if (requestError?.status === 404) {
		return new Date(input.now.getTime() + 30 * DAY_MS)
	}
	const baseMs =
		requestError?.status === 503
			? 15 * 60_000
			: requestError?.status === 429
				? DEFAULT_RETRY_DELAY_MS
				: 60_000
	return new Date(
		input.now.getTime() +
			Math.min(DAY_MS, baseMs * 2 ** Math.min(input.failureCount, 8)),
	)
}

function parseCursor(value: string | null): JikanCursor {
	if (!value) return { version: 1, providerRetryAfter: null }
	let parsed: unknown
	try {
		parsed = JSON.parse(value)
	} catch {
		throw new Error('Stored Jikan cast cursor is not valid JSON')
	}
	const cursor = requireObject(parsed, 'Stored Jikan cast cursor')
	if (
		cursor.version !== 1 ||
		(cursor.providerRetryAfter !== null &&
			typeof cursor.providerRetryAfter !== 'string') ||
		(cursor.providerRetryAfter &&
			!Number.isFinite(new Date(cursor.providerRetryAfter).getTime()))
	) {
		throw new Error('Stored Jikan cast cursor is invalid')
	}
	return cursor as unknown as JikanCursor
}

function eligibleStateWhere(now: Date): Prisma.MediaExternalIdWhereInput {
	const state = { provider: JIKAN_PROVIDER, scope: JIKAN_SCOPE }
	return {
		provider: 'mal',
		kind: 'anime',
		tombstonedAt: null,
		fetchStatus: 'fresh',
		OR: [
			{ media: { is: { creditSyncStates: { none: state } } } },
			{
				media: {
					is: {
						creditSyncStates: {
							some: {
								...state,
								OR: [{ refreshAfter: null }, { refreshAfter: { lte: now } }],
							},
						},
					},
				},
			},
		],
	}
}

const memberDemand = {
	OR: [
		{ entries: { some: {} } },
		{ favorites: { some: {} } },
		{ trackingStates: { some: {} } },
		{ collectionItems: { some: {} } },
		{ releaseReminders: { some: {} } },
	],
} satisfies Prisma.MediaWhereInput

const candidateSelect = {
	id: true,
	mediaId: true,
	externalId: true,
	media: {
		select: {
			releaseStatus: true,
			releaseEnd: true,
			nextRelease: true,
			_count: { select: { entries: true } },
			creditSyncStates: {
				where: { provider: JIKAN_PROVIDER, scope: JIKAN_SCOPE },
				select: { failureCount: true },
			},
		},
	},
} satisfies Prisma.MediaExternalIdSelect

async function findCandidates(prisma: PrismaClient, now: Date, take: number) {
	const eligible = eligibleStateWhere(now)
	const demanded = await prisma.mediaExternalId.findMany({
		where: { AND: [eligible, { media: { is: memberDemand } }] },
		orderBy: [{ sourcePopularity: 'desc' }, { externalId: 'asc' }],
		take,
		select: candidateSelect,
	})
	if (demanded.length >= take) return demanded
	const remaining = await prisma.mediaExternalId.findMany({
		where: {
			// The first query returned every eligible demanded row when it returned
			// fewer than `take`. Select the other partition structurally instead of
			// sending a caller-sized `notIn` array back through Prisma's bind limit.
			AND: [eligible, { media: { is: { NOT: memberDemand } } }],
		},
		orderBy: [{ sourcePopularity: 'desc' }, { externalId: 'asc' }],
		take: take - demanded.length,
		select: candidateSelect,
	})
	return [...demanded, ...remaining]
}

function shouldDeferJikanProvider(error: unknown) {
	if (!(error instanceof JikanRequestError)) return false
	// A connection failure or an edge/proxy outage affects the provider, not one
	// anime. Continuing would pay the same timeout for every remaining row.
	return (
		error.status === null || [429, 502, 503, 504].includes(error.status ?? 0)
	)
}

function boundedError(error: unknown) {
	return (error instanceof Error ? error.message : String(error)).slice(
		0,
		2_000,
	)
}

function wait(milliseconds: number) {
	return new Promise<void>(resolve => setTimeout(resolve, milliseconds))
}

async function upsertSuccess(
	tx: Prisma.TransactionClient,
	input: { mediaId: string; fetchedAt: Date; refreshAfter: Date },
) {
	return tx.mediaCreditSyncState.upsert({
		where: {
			mediaId_provider_scope: {
				mediaId: input.mediaId,
				provider: JIKAN_PROVIDER,
				scope: JIKAN_SCOPE,
			},
		},
		update: {
			status: 'fresh',
			lastFetchedAt: input.fetchedAt,
			refreshAfter: input.refreshAfter,
			failureCount: 0,
			lastError: null,
		},
		create: {
			mediaId: input.mediaId,
			provider: JIKAN_PROVIDER,
			scope: JIKAN_SCOPE,
			status: 'fresh',
			lastFetchedAt: input.fetchedAt,
			refreshAfter: input.refreshAfter,
		},
	})
}

async function upsertFailure(
	tx: Prisma.TransactionClient,
	input: { mediaId: string; error: unknown; retryAfter: Date },
) {
	return tx.mediaCreditSyncState.upsert({
		where: {
			mediaId_provider_scope: {
				mediaId: input.mediaId,
				provider: JIKAN_PROVIDER,
				scope: JIKAN_SCOPE,
			},
		},
		update: {
			status: 'failed',
			refreshAfter: input.retryAfter,
			failureCount: { increment: 1 },
			lastError: boundedError(input.error),
		},
		create: {
			mediaId: input.mediaId,
			provider: JIKAN_PROVIDER,
			scope: JIKAN_SCOPE,
			status: 'failed',
			refreshAfter: input.retryAfter,
			failureCount: 1,
			lastError: boundedError(input.error),
		},
	})
}

export async function hydrateJikanAnimeCast(
	options: HydrateJikanAnimeCastOptions,
): Promise<JikanAnimeCastSummary> {
	const commit = options.commit ?? false
	const limit = requirePositiveInteger(options.limit ?? 100, 'limit')
	const refreshDays = requirePositiveInteger(
		options.refreshDays ?? DEFAULT_REFRESH_DAYS,
		'refreshDays',
	)
	const requestDelayMs = requireRequestDelay(options.requestDelayMs ?? 1_000)
	const leaseDurationMs = requirePositiveInteger(
		options.leaseDurationMs ?? 300_000,
		'leaseDurationMs',
	)
	const clock = options.now ?? (() => new Date())
	const fetchImpl = options.fetchImpl ?? fetch
	const delay = options.delay ?? wait
	const now = clock()
	const queueBefore = await options.prisma.mediaExternalId.count({
		where: eligibleStateWhere(now),
	})
	if (!commit) {
		const candidates = await findCandidates(options.prisma, now, limit)
		return {
			runId: null,
			dryRun: true,
			recordsSeen: candidates.length,
			recordsHandled: 0,
			recordsFailed: 0,
			creditsWritten: 0,
			requestsMade: 0,
			rateLimitEvents: 0,
			providerRetryAfter: null,
			queueBefore,
			queueAfter: queueBefore,
		}
	}
	if (!options.policyApprovalReference?.trim()) {
		throw new Error(
			'MAL policy approval reference is required for a committed run',
		)
	}
	const leaseOwner = options.leaseOwner?.trim()
	if (!leaseOwner) throw new Error('leaseOwner is required for a committed run')
	const lease = await options.prisma.$transaction(tx =>
		acquireCatalogSyncLease(tx, {
			provider: JIKAN_PROVIDER,
			kind: 'anime',
			mode: 'hydrate',
			leaseOwner,
			leaseDurationMs,
			policyApprovalRef: options.policyApprovalReference,
			now,
		}),
	)
	let cursor = parseCursor(lease.run.cursor)
	let recordsSeen = 0
	let recordsHandled = 0
	let recordsFailed = 0
	let creditsWritten = 0
	let requestsMade = 0
	let rateLimitEvents = 0
	let providerRetryAfter = cursor.providerRetryAfter
		? new Date(cursor.providerRetryAfter)
		: null
	const progress = () => ({
		cursor: JSON.stringify(cursor),
		recordsSeen,
		recordsHandled,
		recordsFailed,
	})
	const telemetry = () => ({
		requestsMade,
		rateLimitEvents,
		providerRetryAfter,
	})
	const summary = async (): Promise<JikanAnimeCastSummary> => ({
		runId: lease.run.id,
		dryRun: false,
		recordsSeen,
		recordsHandled,
		recordsFailed,
		creditsWritten,
		requestsMade,
		rateLimitEvents,
		providerRetryAfter,
		queueBefore,
		queueAfter: await options.prisma.mediaExternalId.count({
			where: eligibleStateWhere(clock()),
		}),
	})
	const failRun = async (error: unknown) => {
		try {
			await options.prisma.$transaction(tx =>
				failCatalogSyncRun(tx, {
					runId: lease.run.id,
					leaseOwner,
					error,
					progress: progress(),
					telemetry: telemetry(),
					now: clock(),
				}),
			)
		} catch (failureError) {
			if (!(failureError instanceof CatalogSyncLeaseError)) throw failureError
		}
	}

	try {
		if (providerRetryAfter && providerRetryAfter > now) {
			await options.prisma.$transaction(tx =>
				completeCatalogSyncRun(tx, {
					runId: lease.run.id,
					leaseOwner,
					progress: progress(),
					telemetry: telemetry(),
					now,
				}),
			)
			return summary()
		}
		providerRetryAfter = null
		cursor = { version: 1, providerRetryAfter: null }
		const candidates = await findCandidates(options.prisma, clock(), limit)
		for (const candidate of candidates as JikanCandidate[]) {
			if (requestsMade > 0) await delay(requestDelayMs)
			const batchNow = clock()
			let credits: CatalogCreditInput[] | null = null
			let error: unknown = null
			try {
				const payload = await fetchJikanJson({
					url: jikanAnimeCharactersUrl(candidate.externalId),
					fetchImpl,
					now: batchNow,
				})
				credits = normalizeJikanAnimeCast(payload)
			} catch (caught) {
				error = caught
			}
			requestsMade++
			recordsSeen++
			if (error instanceof JikanRequestError && error.status === 429) {
				rateLimitEvents++
			}
			const failureCount =
				candidate.media.creditSyncStates[0]?.failureCount ?? 0
			providerRetryAfter = shouldDeferJikanProvider(error)
				? jikanRetryDeadline({ error, failureCount, now: batchNow })
				: null
			cursor = {
				version: 1,
				providerRetryAfter: providerRetryAfter?.toISOString() ?? null,
			}
			await options.prisma.$transaction(async tx => {
				if (credits) {
					const written = await replaceCatalogCredits(tx, {
						mediaId: candidate.mediaId,
						provider: JIKAN_PROVIDER,
						personProvider: 'mal',
						credits,
					})
					creditsWritten += written.credits
					await upsertSuccess(tx, {
						mediaId: candidate.mediaId,
						fetchedAt: batchNow,
						refreshAfter: new Date(
							batchNow.getTime() +
								catalogRefreshDays({
									defaultDays: refreshDays,
									entryCount: candidate.media._count.entries,
									releaseStatus: candidate.media.releaseStatus,
									releaseEnd: candidate.media.releaseEnd,
									nextRelease: candidate.media.nextRelease,
									now: batchNow,
								}) *
									DAY_MS,
						),
					})
					recordsHandled++
				} else {
					await upsertFailure(tx, {
						mediaId: candidate.mediaId,
						error,
						retryAfter: jikanRetryDeadline({
							error,
							failureCount,
							now: batchNow,
						}),
					})
					recordsFailed++
				}
				await checkpointCatalogSyncRun(tx, {
					runId: lease.run.id,
					leaseOwner,
					progress: progress(),
					telemetry: telemetry(),
					leaseDurationMs,
					now: clock(),
				})
			})
			await options.onCheckpoint?.(await summary())
			if (providerRetryAfter) break
		}
		await options.prisma.$transaction(tx =>
			completeCatalogSyncRun(tx, {
				runId: lease.run.id,
				leaseOwner,
				progress: progress(),
				telemetry: telemetry(),
				now: clock(),
			}),
		)
		return summary()
	} catch (error) {
		await failRun(error)
		throw error
	}
}

export async function getJikanAnimeCastMetrics(
	prisma: PrismaClient,
	now = new Date(),
) {
	const activeWhere = {
		provider: 'mal',
		kind: 'anime',
		tombstonedAt: null,
		fetchStatus: 'fresh',
	} satisfies Prisma.MediaExternalIdWhereInput
	const stateWhere = {
		provider: JIKAN_PROVIDER,
		scope: JIKAN_SCOPE,
		media: { externalIds: { some: activeWhere } },
	} satisfies Prisma.MediaCreditSyncStateWhereInput
	const [active, synced, fresh, queueDepth, failedDeferred, credits] =
		await Promise.all([
			prisma.mediaExternalId.count({ where: activeWhere }),
			prisma.mediaCreditSyncState.count({
				where: { ...stateWhere, lastFetchedAt: { not: null } },
			}),
			prisma.mediaCreditSyncState.count({
				where: {
					...stateWhere,
					status: 'fresh',
					OR: [{ refreshAfter: null }, { refreshAfter: { gt: now } }],
				},
			}),
			prisma.mediaExternalId.count({ where: eligibleStateWhere(now) }),
			prisma.mediaCreditSyncState.count({
				where: {
					...stateWhere,
					status: 'failed',
					refreshAfter: { gt: now },
				},
			}),
			prisma.mediaCredit.count({ where: { provider: JIKAN_PROVIDER } }),
		])
	return {
		provider: JIKAN_PROVIDER,
		scope: JIKAN_SCOPE,
		label: 'Jikan anime cast',
		active,
		synced,
		fresh,
		queueDepth,
		failedDeferred,
		credits,
		coveragePercent: active
			? Math.round((synced / active) * 10_000) / 100
			: 100,
		freshnessPercent: active
			? Math.round((fresh / active) * 10_000) / 100
			: 100,
	}
}
