import { type PrismaClient } from '@prisma/client'
import {
	acquireCatalogSyncLease,
	catalogHydrationPriorities,
	catalogSourceNeedsFetch,
	completeCatalogSyncRun,
	failCatalogSyncRun,
	normalizeCatalogTitle,
	requestCatalogHydration,
	upsertCatalogIdentity,
} from './catalog-sync.server.ts'
import {
	malCatalogPopularity,
	MalRequestError,
	parseMalRetryAfter,
	type MalCatalogKind,
} from './mal-catalog-inventory.server.ts'

const MAL_API_ORIGIN = 'https://api.myanimelist.net'
const MAL_MAX_PAGE_SIZE = 500
const SAMPLE_BUCKET_MS = 6 * 60 * 60 * 1_000
const SNAPSHOT_RETENTION_MS = 35 * 24 * 60 * 60 * 1_000
const DAY_MS = 24 * 60 * 60 * 1_000

export type MalSeason = 'winter' | 'spring' | 'summer' | 'fall'

export type MalTrendCandidate = {
	id: number
	title: string
	mediaType: string | null
	nsfw: string | null
	popularityRank: number | null
	audience: number | null
	ratingCount: number | null
	chartRank: number
	sourceUpdatedAt: Date | null
	startSeason: { year: number; season: MalSeason } | null
}

export type MalTrendSnapshot = {
	mediaId: string
	observedAt: Date
	audience: number | null
	ratingCount: number | null
	sourceRank: number | null
	chartRank: number | null
}

export type MalTrendRankingInput = MalTrendCandidate & {
	mediaId: string
}

export type MalTrendRanking = MalTrendRankingInput & {
	rankingScore: number
	audienceGrowth24h: number | null
	audienceGrowth7d: number | null
}

export type RefreshMalTrendingSummary = {
	kind: MalCatalogKind
	observedAt: Date
	candidatesSeen: number
	candidatesRanked: number
	requestsMade: number
	historyCoverage24h: number
	published: boolean
	top: Array<{
		rank: number
		title: string
		audience: number | null
		rankingScore: number
	}>
}

function requireNonNegativeInteger(value: number, label: string) {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new Error(`${label} must be a non-negative safe integer`)
	}
	return value
}

function requirePositiveInteger(value: number, label: string) {
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new Error(`${label} must be a positive safe integer`)
	}
	return value
}

function object(value: unknown, label: string) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`${label} must be a JSON object`)
	}
	return value as Record<string, unknown>
}

function optionalString(value: unknown, label: string) {
	if (value === null || value === undefined) return null
	if (typeof value !== 'string') throw new Error(`${label} must be a string`)
	return value.trim() || null
}

function optionalPositiveInteger(value: unknown, label: string) {
	if (value === null || value === undefined) return null
	if (!Number.isSafeInteger(value) || Number(value) < 1) {
		throw new Error(`${label} must be a positive safe integer`)
	}
	return Number(value)
}

function optionalDate(value: unknown, label: string) {
	const raw = optionalString(value, label)
	if (!raw) return null
	const date = new Date(raw)
	if (!Number.isFinite(date.getTime())) throw new Error(`${label} is invalid`)
	return date
}

export function currentMalSeason(now = new Date()): {
	year: number
	season: MalSeason
} {
	const month = now.getUTCMonth()
	return {
		year: now.getUTCFullYear(),
		season:
			month < 3
				? 'winter'
				: month < 6
					? 'spring'
					: month < 9
						? 'summer'
						: 'fall',
	}
}

export function malTrendingUrl(
	kind: MalCatalogKind,
	now: Date,
	offset = 0,
	limit = MAL_MAX_PAGE_SIZE,
) {
	requireNonNegativeInteger(offset, 'offset')
	requirePositiveInteger(limit, 'limit')
	if (limit > MAL_MAX_PAGE_SIZE) {
		throw new Error(`limit cannot exceed ${MAL_MAX_PAGE_SIZE}`)
	}
	const season = currentMalSeason(now)
	const path =
		kind === 'anime'
			? `/v2/anime/season/${season.year}/${season.season}`
			: '/v2/manga/ranking'
	const url = new URL(path, MAL_API_ORIGIN)
	if (kind === 'anime') {
		url.searchParams.set('sort', 'anime_num_list_users')
	} else {
		url.searchParams.set('ranking_type', 'bypopularity')
	}
	url.searchParams.set('offset', String(offset))
	url.searchParams.set('limit', String(limit))
	url.searchParams.set(
		'fields',
		'media_type,nsfw,popularity,num_list_users,num_scoring_users,updated_at,start_season',
	)
	return url.toString()
}

export function parseMalTrendPage(
	value: unknown,
	kind: MalCatalogKind,
	offset: number,
) {
	const payload = object(value, `MAL ${kind} trend response`)
	if (!Array.isArray(payload.data)) {
		throw new Error(`MAL ${kind} trend response has no data array`)
	}
	return payload.data.map((value, index): MalTrendCandidate => {
		const item = object(value, `MAL trend result ${index + 1}`)
		const node = object(item.node, `MAL trend result ${index + 1}.node`)
		const ranking =
			item.ranking === null || item.ranking === undefined
				? null
				: object(item.ranking, `MAL trend result ${index + 1}.ranking`)
		const id = optionalPositiveInteger(node.id, 'MAL node id')
		const title = optionalString(node.title, 'MAL node title')
		if (!id || !title) throw new Error('MAL trend result requires id and title')
		const rawStartSeason =
			node.start_season === null || node.start_season === undefined
				? null
				: object(node.start_season, 'MAL node start_season')
		const seasonName = optionalString(
			rawStartSeason?.season,
			'MAL node start_season.season',
		)
		const seasonYear = optionalPositiveInteger(
			rawStartSeason?.year,
			'MAL node start_season.year',
		)
		const startSeason =
			seasonName &&
			seasonYear &&
			(['winter', 'spring', 'summer', 'fall'] as const).includes(
				seasonName as MalSeason,
			)
				? { year: seasonYear, season: seasonName as MalSeason }
				: null
		return {
			id,
			title,
			mediaType: optionalString(node.media_type, 'MAL node media_type'),
			nsfw: optionalString(node.nsfw, 'MAL node nsfw'),
			popularityRank: optionalPositiveInteger(
				node.popularity,
				'MAL node popularity',
			),
			audience: optionalPositiveInteger(
				node.num_list_users,
				'MAL node num_list_users',
			),
			ratingCount: optionalPositiveInteger(
				node.num_scoring_users,
				'MAL node num_scoring_users',
			),
			chartRank:
				optionalPositiveInteger(ranking?.rank, 'MAL chart rank') ??
				offset + index + 1,
			sourceUpdatedAt: optionalDate(node.updated_at, 'MAL node updated_at'),
			startSeason,
		}
	})
}

export async function fetchMalTrendCandidates(input: {
	kind: MalCatalogKind
	clientId: string
	now?: Date
	limit?: number
	pageSize?: number
	requestDelayMs?: number
	fetchImpl?: typeof fetch
	delay?: (milliseconds: number) => Promise<void>
}) {
	const clientId = input.clientId.trim()
	if (!clientId) throw new Error('MAL client id is required')
	const now = input.now ?? new Date()
	const limit = requirePositiveInteger(
		input.limit ?? (input.kind === 'anime' ? 500 : 1_000),
		'limit',
	)
	const pageSize = Math.min(
		MAL_MAX_PAGE_SIZE,
		requirePositiveInteger(input.pageSize ?? MAL_MAX_PAGE_SIZE, 'pageSize'),
	)
	const requestDelayMs = requireNonNegativeInteger(
		input.requestDelayMs ?? 1_000,
		'requestDelayMs',
	)
	const fetchImpl = input.fetchImpl ?? fetch
	const delay =
		input.delay ??
		((milliseconds: number) =>
			new Promise<void>(resolve => setTimeout(resolve, milliseconds)))
	const records: MalTrendCandidate[] = []
	let requestsMade = 0

	while (records.length < limit) {
		if (requestsMade && requestDelayMs) await delay(requestDelayMs)
		const requested = Math.min(pageSize, limit - records.length)
		let response: Response
		try {
			response = await fetchImpl(
				malTrendingUrl(input.kind, now, records.length, requested),
				{
					headers: {
						accept: 'application/json',
						'X-MAL-CLIENT-ID': clientId,
					},
				},
			)
		} catch (error) {
			throw new MalRequestError(
				`MAL trend request failed: ${error instanceof Error ? error.message : String(error)}`,
				null,
			)
		}
		requestsMade++
		if (!response.ok) {
			throw new MalRequestError(
				`MAL trend request failed with ${response.status} ${response.statusText}`,
				response.status,
				parseMalRetryAfter(response.headers.get('retry-after'), now),
			)
		}
		let payload: unknown
		try {
			payload = await response.json()
		} catch {
			throw new MalRequestError('MAL trend response was not valid JSON', 200)
		}
		const page = parseMalTrendPage(payload, input.kind, records.length)
		records.push(...page)
		if (page.length < requested) break
	}

	return {
		records: [
			...new Map(
				records
					.filter(record => record.nsfw !== 'black')
					.filter(record => {
						if (input.kind !== 'anime') return true
						const current = currentMalSeason(now)
						return (
							record.startSeason?.year === current.year &&
							record.startSeason.season === current.season
						)
					})
					.map(record => [record.id, record]),
			).values(),
		],
		requestsMade,
	}
}

function percentileScores(values: Array<[string, number]>) {
	const sorted = [...values].sort((left, right) => left[1] - right[1])
	const result = new Map<string, number>()
	if (sorted.length === 1) {
		result.set(sorted[0]![0], 1)
		return result
	}
	for (const [key, value] of sorted) {
		const first = sorted.findIndex(item => item[1] === value)
		let last = first
		while (last + 1 < sorted.length && sorted[last + 1]![1] === value) last++
		result.set(key, (first + last) / 2 / (sorted.length - 1))
	}
	return result
}

function comparisonAt(
	history: MalTrendSnapshot[],
	target: Date,
	maxAgeMs: number,
) {
	const targetMs = target.getTime()
	return history.find(snapshot => {
		const observedMs = snapshot.observedAt.getTime()
		return observedMs <= targetMs && observedMs >= targetMs - maxAgeMs
	})
}

export function rankMalTrendCandidates(
	kind: MalCatalogKind,
	current: MalTrendRankingInput[],
	history: MalTrendSnapshot[],
	now: Date,
) {
	const historyByMedia = new Map<string, MalTrendSnapshot[]>()
	for (const snapshot of history) {
		const values = historyByMedia.get(snapshot.mediaId) ?? []
		values.push(snapshot)
		historyByMedia.set(snapshot.mediaId, values)
	}
	for (const values of historyByMedia.values()) {
		values.sort(
			(left, right) => right.observedAt.getTime() - left.observedAt.getTime(),
		)
	}

	const measurements = current.map(candidate => {
		const candidateHistory = historyByMedia.get(candidate.mediaId) ?? []
		const day = comparisonAt(
			candidateHistory,
			new Date(now.getTime() - DAY_MS),
			18 * 60 * 60 * 1_000,
		)
		const week = comparisonAt(
			candidateHistory,
			new Date(now.getTime() - 7 * DAY_MS),
			2 * DAY_MS,
		)
		const growth = (previous: MalTrendSnapshot | undefined) =>
			candidate.audience === null || previous?.audience === null || !previous
				? null
				: Math.max(0, candidate.audience - previous.audience)
		const growth24h = growth(day)
		const growth7d = growth(week)
		return {
			...candidate,
			audienceGrowth24h: growth24h,
			audienceGrowth7d: growth7d,
			relativeGrowth24h:
				growth24h === null
					? null
					: growth24h / Math.sqrt(Math.max(1_000, day?.audience ?? 1_000)),
		}
	})
	const chart = percentileScores(
		measurements.map(item => [item.mediaId, -item.chartRank]),
	)
	const daily = percentileScores(
		measurements
			.filter(item => item.audienceGrowth24h !== null)
			.map(item => [item.mediaId, item.audienceGrowth24h!]),
	)
	const weekly = percentileScores(
		measurements
			.filter(item => item.audienceGrowth7d !== null)
			.map(item => [item.mediaId, item.audienceGrowth7d!]),
	)
	const relative = percentileScores(
		measurements
			.filter(item => item.relativeGrowth24h !== null)
			.map(item => [item.mediaId, item.relativeGrowth24h!]),
	)
	const hasDailyHistory = daily.size >= Math.max(2, current.length * 0.35)
	const hasWeeklyHistory = weekly.size >= Math.max(2, current.length * 0.35)

	const ranked: MalTrendRanking[] = measurements.map(item => {
		let score = chart.get(item.mediaId) ?? 0
		if (hasDailyHistory) {
			if (kind === 'anime') {
				score =
					(daily.get(item.mediaId) ?? 0) * 0.65 +
					(weekly.get(item.mediaId) ?? 0) * (hasWeeklyHistory ? 0.2 : 0) +
					(chart.get(item.mediaId) ?? 0) * (hasWeeklyHistory ? 0.15 : 0.35)
			} else {
				score =
					(daily.get(item.mediaId) ?? 0) * 0.5 +
					(relative.get(item.mediaId) ?? 0) * 0.2 +
					(weekly.get(item.mediaId) ?? 0) * (hasWeeklyHistory ? 0.2 : 0) +
					(chart.get(item.mediaId) ?? 0) * (hasWeeklyHistory ? 0.1 : 0.3)
			}
		}
		return {
			...item,
			rankingScore: Math.max(0, Math.min(1, score)),
		}
	})

	return ranked.sort(
		(left, right) =>
			right.rankingScore - left.rankingScore ||
			(right.audienceGrowth24h ?? -1) - (left.audienceGrowth24h ?? -1) ||
			left.chartRank - right.chartRank ||
			left.mediaId.localeCompare(right.mediaId),
	)
}

export function malTrendSampleBucket(now = new Date()) {
	return new Date(
		Math.floor(now.getTime() / SAMPLE_BUCKET_MS) * SAMPLE_BUCKET_MS,
	)
}

export async function refreshMalTrending(input: {
	prisma: PrismaClient
	kind: MalCatalogKind
	clientId: string
	policyApprovalReference: string
	now?: Date
	limit?: number
	pageSize?: number
	requestDelayMs?: number
	leaseOwner?: string
	leaseDurationMs?: number
	fetchImpl?: typeof fetch
	delay?: (milliseconds: number) => Promise<void>
}) {
	const now = input.now ?? new Date()
	const observedAt = malTrendSampleBucket(now)
	const leaseOwner = input.leaseOwner?.trim() || `mal-trending:${process.pid}`
	const leaseDurationMs = input.leaseDurationMs ?? 30 * 60_000
	const policyApprovalReference = input.policyApprovalReference.trim()
	if (!policyApprovalReference) {
		throw new Error('MAL policy approval reference is required')
	}
	const lease = await input.prisma.$transaction(tx =>
		acquireCatalogSyncLease(tx, {
			provider: 'mal',
			kind: input.kind,
			mode: 'refresh',
			leaseOwner,
			leaseDurationMs,
			policyApprovalRef: policyApprovalReference,
			now,
		}),
	)
	let requestsMade = 0
	let recordsSeen = 0
	try {
		const fetched = await fetchMalTrendCandidates({
			kind: input.kind,
			clientId: input.clientId,
			now,
			limit: input.limit,
			pageSize: input.pageSize,
			requestDelayMs: input.requestDelayMs,
			fetchImpl: input.fetchImpl,
			delay: input.delay,
		})
		requestsMade = fetched.requestsMade
		recordsSeen = fetched.records.length
		const expectedMinimum = Math.min(
			input.limit ?? (input.kind === 'anime' ? 500 : 1_000),
			10,
		)
		if (recordsSeen < expectedMinimum) {
			throw new Error(
				`Refusing to replace MAL ${input.kind} trending: received ${recordsSeen} candidates, expected at least ${expectedMinimum}`,
			)
		}
		const current = await input.prisma.$transaction(async tx => {
			const resolved: MalTrendRankingInput[] = []
			for (const candidate of fetched.records) {
				const source = await upsertCatalogIdentity(tx, {
					provider: 'mal',
					kind: input.kind,
					externalId: String(candidate.id),
					sourceUpdatedAt: candidate.sourceUpdatedAt,
					sourceTitle: candidate.title,
					sourcePopularity: malCatalogPopularity(candidate.popularityRank),
					sourceRank: candidate.popularityRank,
					sourceAudience: candidate.audience,
					sourceRatingCount: candidate.ratingCount,
					sourceIsAdult: candidate.nsfw === 'black',
					seenAt: now,
				})
				if (catalogSourceNeedsFetch(source, now)) {
					await requestCatalogHydration(tx, {
						provider: 'mal',
						kind: input.kind,
						externalId: String(candidate.id),
						priority: catalogHydrationPriorities.trending,
						reason: 'mal-trending',
						requestedAt: now,
					})
				}
				await tx.mediaTitle.deleteMany({
					where: {
						mediaId: source.mediaId,
						provider: 'mal',
						titleType: 'trend-primary',
						value: { not: candidate.title },
					},
				})
				await tx.mediaTitle.upsert({
					where: {
						mediaId_provider_language_titleType_value: {
							mediaId: source.mediaId,
							provider: 'mal',
							language: '',
							titleType: 'trend-primary',
							value: candidate.title,
						},
					},
					create: {
						mediaId: source.mediaId,
						provider: 'mal',
						language: '',
						titleType: 'trend-primary',
						value: candidate.title,
						normalized: normalizeCatalogTitle(candidate.title),
						isPrimary: true,
					},
					update: {
						normalized: normalizeCatalogTitle(candidate.title),
						isPrimary: true,
					},
				})
				if (candidate.mediaType && source.media.type !== candidate.mediaType) {
					await tx.media.update({
						where: { id: source.mediaId },
						data: {
							type: candidate.mediaType,
							...(candidate.startSeason
								? {
										startSeason: `${candidate.startSeason.season[0]!.toUpperCase()}${candidate.startSeason.season.slice(1)} ${candidate.startSeason.year}`,
										startYear: String(candidate.startSeason.year),
									}
								: {}),
						},
					})
				} else if (candidate.startSeason) {
					await tx.media.update({
						where: { id: source.mediaId },
						data: {
							startSeason: `${candidate.startSeason.season[0]!.toUpperCase()}${candidate.startSeason.season.slice(1)} ${candidate.startSeason.year}`,
							startYear: String(candidate.startSeason.year),
						},
					})
				}
				resolved.push({ ...candidate, mediaId: source.mediaId })
			}
			return resolved
		})
		const history = await input.prisma.catalogMetricSnapshot.findMany({
			where: {
				provider: 'mal',
				kind: input.kind,
				mediaId: { in: current.map(item => item.mediaId) },
				observedAt: {
					gte: new Date(observedAt.getTime() - 9 * DAY_MS),
					lt: observedAt,
				},
			},
			orderBy: { observedAt: 'desc' },
			select: {
				mediaId: true,
				observedAt: true,
				audience: true,
				ratingCount: true,
				sourceRank: true,
				chartRank: true,
			},
		})
		const ranked = rankMalTrendCandidates(
			input.kind,
			current,
			history,
			observedAt,
		)
		const coverage =
			ranked.length === 0
				? 0
				: ranked.filter(item => item.audienceGrowth24h !== null).length /
					ranked.length
		const published = input.kind === 'anime' || coverage >= 0.35
		await input.prisma.$transaction(async tx => {
			for (const candidate of ranked) {
				await tx.catalogMetricSnapshot.upsert({
					where: {
						provider_kind_mediaId_observedAt: {
							provider: 'mal',
							kind: input.kind,
							mediaId: candidate.mediaId,
							observedAt,
						},
					},
					create: {
						provider: 'mal',
						kind: input.kind,
						mediaId: candidate.mediaId,
						observedAt,
						audience: candidate.audience,
						ratingCount: candidate.ratingCount,
						sourceRank: candidate.popularityRank,
						chartRank: candidate.chartRank,
					},
					update: {
						audience: candidate.audience,
						ratingCount: candidate.ratingCount,
						sourceRank: candidate.popularityRank,
						chartRank: candidate.chartRank,
					},
				})
			}
			if (published) {
				for (const [index, candidate] of ranked.entries()) {
					await tx.catalogFeedItem.upsert({
						where: {
							provider_kind_feed_mediaId: {
								provider: 'mal',
								kind: input.kind,
								feed: 'trending',
								mediaId: candidate.mediaId,
							},
						},
						create: {
							provider: 'mal',
							kind: input.kind,
							feed: 'trending',
							mediaId: candidate.mediaId,
							rank: index + 1,
							audience: candidate.audience,
							rankingScore: candidate.rankingScore,
							rankingVersion: 3,
							observedAt,
						},
						update: {
							rank: index + 1,
							audience: candidate.audience,
							rankingScore: candidate.rankingScore,
							rankingVersion: 3,
							observedAt,
						},
					})
				}
			}
			await tx.catalogFeedItem.deleteMany({
				where: {
					provider: 'mal',
					kind: input.kind,
					feed: 'trending',
					...(published ? { observedAt: { lt: observedAt } } : {}),
				},
			})
			await tx.catalogMetricSnapshot.deleteMany({
				where: {
					provider: 'mal',
					kind: input.kind,
					observedAt: {
						lt: new Date(observedAt.getTime() - SNAPSHOT_RETENTION_MS),
					},
				},
			})
			await completeCatalogSyncRun(tx, {
				runId: lease.run.id,
				leaseOwner,
				progress: {
					cursor: observedAt.toISOString(),
					recordsSeen,
					recordsHandled: ranked.length,
					recordsFailed: recordsSeen - ranked.length,
				},
				telemetry: {
					requestsMade,
					rateLimitEvents: 0,
					providerRetryAfter: null,
				},
				now: new Date(now.getTime() + 1),
			})
		})
		return {
			kind: input.kind,
			observedAt,
			candidatesSeen: recordsSeen,
			candidatesRanked: ranked.length,
			requestsMade,
			historyCoverage24h: coverage,
			published,
			top: ranked.slice(0, 10).map((item, index) => ({
				rank: index + 1,
				title: item.title,
				audience: item.audience,
				rankingScore: item.rankingScore,
			})),
		} satisfies RefreshMalTrendingSummary
	} catch (error) {
		await input.prisma.$transaction(tx =>
			failCatalogSyncRun(tx, {
				runId: lease.run.id,
				leaseOwner,
				error,
				progress: {
					cursor: observedAt.toISOString(),
					recordsSeen,
					recordsHandled: 0,
					recordsFailed: recordsSeen,
				},
				telemetry: {
					requestsMade,
					rateLimitEvents:
						error instanceof MalRequestError && error.status === 429 ? 1 : 0,
					providerRetryAfter:
						error instanceof MalRequestError ? error.retryAfter : null,
				},
				now: new Date(now.getTime() + 1),
			}),
		)
		throw error
	}
}
