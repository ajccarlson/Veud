import { type Prisma, type PrismaClient } from '@prisma/client'
import {
	acquireCatalogSyncLease,
	catalogHydrationPriorities,
	CatalogSyncLeaseError,
	checkpointCatalogSyncRun,
	completeCatalogSyncRun,
	failCatalogSyncRun,
	recordCatalogFetchFailure,
	recordCatalogFetchSuccess,
	replaceCatalogTitles,
} from './catalog-sync.server.ts'
import {
	malCatalogPopularity,
	malSourceIsAdult,
	parseMalRetryAfter,
	type MalCatalogKind,
	MalRequestError,
} from './mal-catalog-inventory.server.ts'
import { syncMediaRelations } from './media-relations.server.ts'
import {
	type MediaRelationCandidate,
	mediaRelationTypes,
} from './media-relations.ts'
import { hydrateMediaCatalog } from './media.server.ts'

const DAY_MS = 24 * 60 * 60 * 1_000
const DEFAULT_REFRESH_DAYS = 180
const DEFAULT_RETRY_DELAY_MS = 5 * 60_000

const commonFields = [
	'id',
	'title',
	'main_picture',
	'alternative_titles',
	'start_date',
	'end_date',
	'synopsis',
	'mean',
	'popularity',
	'num_list_users',
	'num_scoring_users',
	'nsfw',
	'updated_at',
	'media_type',
	'status',
	'genres',
	'related_anime',
	'related_manga',
]

const kindFields: Record<MalCatalogKind, string[]> = {
	anime: [
		'num_episodes',
		'start_season',
		'average_episode_duration',
		'rating',
		'studios',
	],
	manga: [
		'num_volumes',
		'num_chapters',
		'authors{first_name,last_name}',
		'serialization{name}',
	],
}

type MalHydrationCursor = {
	version: 1
	providerRetryAfter: string | null
	lastCompletedSourceId: string | null
}

type MalHydrationCandidate = {
	id: string
	mediaId: string
	externalId: string
	failureCount: number
	sourceUpdatedAt: Date | null
}

export type NormalizedMalDetails = {
	id: number
	sourceTitle: string
	sourceUpdatedAt: Date | null
	sourcePopularity: number | null
	sourceRank: number | null
	sourceAudience: number | null
	sourceRatingCount: number | null
	sourceIsAdult: boolean | null
	catalog: Record<string, unknown>
	titles: Array<{
		language?: string | null
		titleType: string
		value: string
		isPrimary?: boolean
	}>
	relations: MediaRelationCandidate[]
}

export type MalHydrationSummary = {
	runId: string | null
	kind: MalCatalogKind
	dryRun: boolean
	recordsSeen: number
	recordsHandled: number
	recordsFailed: number
	requestsMade: number
	rateLimitEvents: number
	providerRetryAfter: Date | null
	queueBefore: number
	queueAfter: number
}

export type HydrateMalCatalogOptions = {
	prisma: PrismaClient
	kind: MalCatalogKind
	clientId?: string
	policyApprovalReference?: string
	commit?: boolean
	limit?: number
	refreshDays?: number
	requestDelayMs?: number
	leaseOwner?: string
	leaseDurationMs?: number
	fetchImpl?: typeof fetch
	now?: () => Date
	delay?: (milliseconds: number) => Promise<void>
	onCheckpoint?: (summary: MalHydrationSummary) => void | Promise<void>
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

function optionalString(value: unknown) {
	return typeof value === 'string' ? value.trim() || null : null
}

function optionalNumber(value: unknown) {
	return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function optionalPositiveInteger(value: unknown) {
	return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null
}

function optionalDate(value: unknown) {
	const raw = optionalString(value)
	if (!raw) return null
	const normalized = /^\d{4}$/.test(raw)
		? `${raw}-01-01`
		: /^\d{4}-\d{2}$/.test(raw)
			? `${raw}-01`
			: raw
	const parsed = new Date(
		/^\d{4}-\d{2}-\d{2}$/.test(normalized)
			? `${normalized}T00:00:00.000Z`
			: normalized,
	)
	return Number.isFinite(parsed.getTime()) ? parsed : null
}

function titleCase(value: string | null) {
	if (!value) return null
	return value
		.replace(/[_-]+/g, ' ')
		.replace(/\b\w/g, character => character.toUpperCase())
}

function statusConfirmsNoUpcomingRelease(value: unknown, kind: MalCatalogKind) {
	const status = optionalString(value)?.toLowerCase()
	if (!status) return false
	return kind === 'anime'
		? status === 'finished_airing'
		: status === 'finished' || status === 'discontinued'
}

function mediaType(value: unknown, kind: MalCatalogKind) {
	const raw = optionalString(value)
	if (!raw) return null
	const upper = new Set(['tv', 'ova', 'ona', 'cm', 'pv'])
	if (upper.has(raw.toLowerCase())) {
		return raw.toLowerCase() === 'tv' ? 'TV Series' : raw.toUpperCase()
	}
	const formatted = titleCase(raw)
	return kind === 'manga' && formatted === 'One Shot' ? 'One-shot' : formatted
}

function namedValues(value: unknown, label: string) {
	if (!Array.isArray(value)) return []
	return value.flatMap(item => {
		const name = optionalString(requireObject(item, label).name)
		return name ? [name] : []
	})
}

function imageUrl(value: unknown) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null
	const picture = value as Record<string, unknown>
	return optionalString(picture.large) ?? optionalString(picture.medium)
}

function alternativeTitles(payload: Record<string, unknown>) {
	if (!payload.alternative_titles) return []
	const alternatives = requireObject(
		payload.alternative_titles,
		'MAL alternative_titles',
	)
	const titles: NormalizedMalDetails['titles'] = []
	const english = optionalString(alternatives.en)
	const japanese = optionalString(alternatives.ja)
	if (english) {
		titles.push({ language: 'en', titleType: 'english', value: english })
	}
	if (japanese) {
		titles.push({ language: 'ja', titleType: 'japanese', value: japanese })
	}
	if (Array.isArray(alternatives.synonyms)) {
		for (const synonym of alternatives.synonyms) {
			const value = optionalString(synonym)
			if (value) titles.push({ titleType: 'synonym', value })
		}
	}
	return titles
}

function formattedDuration(seconds: number | null) {
	if (seconds === null || seconds < 60) return null
	const totalMinutes = Math.floor(seconds / 60)
	const hours = Math.floor(totalMinutes / 60)
	const minutes = totalMinutes % 60
	if (!hours) return `${minutes}m`
	return minutes ? `${hours}h ${minutes}m` : `${hours}h`
}

function animeLength(payload: Record<string, unknown>) {
	const episodes = optionalPositiveInteger(payload.num_episodes)
	const duration = optionalNumber(payload.average_episode_duration)
	if (episodes === 1 && duration !== null) return formattedDuration(duration)
	if (episodes !== null) return `${episodes} ${episodes === 1 ? 'ep' : 'eps'}`
	return formattedDuration(duration)
}

function contentRating(value: unknown) {
	const raw = optionalString(value)?.toLowerCase()
	if (!raw) return null
	return (
		{
			g: 'G',
			pg: 'PG',
			pg_13: 'PG-13',
			r: 'R',
			r_plus: 'R+',
			rx: 'Rx',
		}[raw] ?? raw.toUpperCase().replace('_', '-')
	)
}

function linkedNamedValues(
	value: unknown,
	label: string,
	urlFor: (item: Record<string, unknown>) => string | null,
) {
	if (!Array.isArray(value)) return []
	return value.flatMap(item => {
		const record = requireObject(item, label)
		const node =
			record.node && typeof record.node === 'object'
				? requireObject(record.node, `${label}.node`)
				: record
		const name = optionalString(node.name)
		if (!name) return []
		const url = urlFor(node)
		return [url ? `${name}|${url}` : name]
	})
}

function authorValues(value: unknown) {
	if (!Array.isArray(value)) return []
	return value.flatMap(item => {
		const record = requireObject(item, 'MAL author')
		const node = requireObject(record.node, 'MAL author.node')
		const name = [
			optionalString(node.first_name),
			optionalString(node.last_name),
		]
			.filter(Boolean)
			.join(' ')
		if (!name) return []
		const role = optionalString(record.role)
		const id = optionalPositiveInteger(node.id)
		const label = role ? `${name} (${role})` : name
		return [id ? `${label}|https://myanimelist.net/people/${id}` : label]
	})
}

function relationType(value: unknown) {
	const normalized = optionalString(value)
		?.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '')
	return normalized && mediaRelationTypes.includes(normalized as never)
		? (normalized as MediaRelationCandidate['relationType'])
		: 'other'
}

function malRelations(payload: Record<string, unknown>) {
	const relations: MediaRelationCandidate[] = []
	for (const [kind, field] of [
		['anime', 'related_anime'],
		['manga', 'related_manga'],
	] as const) {
		if (!Array.isArray(payload[field])) continue
		for (const value of payload[field]) {
			const item = requireObject(value, `MAL ${field} item`)
			const node = requireObject(item.node, `MAL ${field} node`)
			const id = optionalPositiveInteger(node.id)
			const title = optionalString(node.title)
			if (!id || !title) continue
			const picture = imageUrl(node.main_picture)
			relations.push({
				relationType: relationType(item.relation_type),
				targetIdentity: {
					provider: 'mal',
					kind,
					externalId: String(id),
				},
				targetCatalog: {
					title,
					...(picture
						? {
								thumbnail: `${picture}|https://myanimelist.net/${kind}/${id}`,
							}
						: {}),
				},
			})
		}
	}
	return relations
}

export function normalizeMalDetails(
	value: unknown,
	kind: MalCatalogKind,
): NormalizedMalDetails {
	const payload = requireObject(value, `MAL ${kind} detail response`)
	const id = optionalPositiveInteger(payload.id)
	if (!id) throw new Error('MAL detail id must be a positive safe integer')
	const title = optionalString(payload.title)
	if (!title) throw new Error('MAL detail title is required')
	const start = optionalDate(payload.start_date)
	const end = optionalDate(payload.end_date)
	const mean = optionalNumber(payload.mean)
	const popularityRank = optionalPositiveInteger(payload.popularity)
	const picture = imageUrl(payload.main_picture)
	const season = payload.start_season
		? requireObject(payload.start_season, 'MAL start_season')
		: null
	const seasonName = optionalString(season?.season)
	const seasonYear = optionalPositiveInteger(season?.year)
	const startYear = start?.getUTCFullYear() ?? seasonYear
	const catalog: Record<string, unknown> = {
		title,
		thumbnail: picture
			? `${picture}|https://myanimelist.net/${kind}/${id}`
			: null,
		type: mediaType(payload.media_type, kind),
		releaseStart: start,
		releaseEnd: end,
		startYear: startYear ? String(startYear) : null,
		genres: namedValues(payload.genres, 'MAL genre').join(', ') || null,
		description: optionalString(payload.synopsis),
		malScore: mean,
		catalogScore: mean,
		catalogPopularity: malCatalogPopularity(popularityRank),
		releaseStatus: titleCase(optionalString(payload.status)),
		...(statusConfirmsNoUpcomingRelease(payload.status, kind)
			? { nextRelease: null }
			: {}),
	}
	if (kind === 'anime') {
		const studios = linkedNamedValues(payload.studios, 'MAL studio', item => {
			const studioId = optionalPositiveInteger(item.id)
			return studioId
				? `https://myanimelist.net/anime/producer/${studioId}`
				: null
		})
		Object.assign(catalog, {
			startSeason:
				seasonName && seasonYear
					? `${titleCase(seasonName)} ${seasonYear}`
					: null,
			length: animeLength(payload),
			episodeCount: optionalPositiveInteger(payload.num_episodes),
			runtimeMinutes: (() => {
				const seconds = optionalNumber(payload.average_episode_duration)
				return seconds === null ? null : Math.max(1, Math.round(seconds / 60))
			})(),
			rating: contentRating(payload.rating),
			studios: studios.length ? JSON.stringify(studios) : null,
		})
	} else {
		const serialization = linkedNamedValues(
			payload.serialization,
			'MAL serialization',
			item => {
				const magazineId = optionalPositiveInteger(item.id)
				return magazineId
					? `https://myanimelist.net/manga/magazine/${magazineId}`
					: null
			},
		)
		const authors = authorValues(payload.authors)
		const chapters = optionalPositiveInteger(payload.num_chapters)
		const volumes = optionalPositiveInteger(payload.num_volumes)
		Object.assign(catalog, {
			chapters: chapters ? String(chapters) : null,
			volumes: volumes ? String(volumes) : null,
			chapterCount: chapters,
			volumeCount: volumes,
			serialization: serialization.length
				? JSON.stringify(serialization)
				: null,
			authors: authors.length ? JSON.stringify(authors) : null,
		})
	}
	return {
		id,
		sourceTitle: title,
		sourceUpdatedAt: optionalDate(payload.updated_at),
		sourcePopularity: malCatalogPopularity(popularityRank),
		sourceRank: popularityRank,
		sourceAudience: optionalPositiveInteger(payload.num_list_users),
		sourceRatingCount: optionalPositiveInteger(payload.num_scoring_users),
		sourceIsAdult: malSourceIsAdult(optionalString(payload.nsfw)),
		catalog,
		titles: [
			{ titleType: 'primary', value: title, isPrimary: true },
			...alternativeTitles(payload),
		],
		relations: malRelations(payload),
	}
}

export function malDetailUrl(kind: MalCatalogKind, externalId: string) {
	if (
		!/^\d+$/.test(externalId) ||
		!Number.isSafeInteger(Number(externalId)) ||
		Number(externalId) < 1
	) {
		throw new Error('MAL external id must be a positive safe integer')
	}
	const url = new URL(`https://api.myanimelist.net/v2/${kind}/${externalId}`)
	url.searchParams.set(
		'fields',
		[...commonFields, ...kindFields[kind]].join(','),
	)
	return url.toString()
}

async function fetchMalJson(input: {
	url: string
	clientId: string
	fetchImpl: typeof fetch
	now: Date
}) {
	let response: Response
	try {
		response = await input.fetchImpl(input.url, {
			headers: {
				accept: 'application/json',
				'X-MAL-CLIENT-ID': input.clientId,
			},
		})
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
			parseMalRetryAfter(response.headers.get('retry-after'), input.now),
		)
	}
	try {
		return await response.json()
	} catch {
		throw new MalRequestError(
			'MAL response was not valid JSON',
			response.status,
		)
	}
}

export function malRetryDeadline(input: {
	error: unknown
	failureCount: number
	now: Date
}) {
	const requestError =
		input.error instanceof MalRequestError ? input.error : null
	if (requestError?.retryAfter && requestError.retryAfter > input.now) {
		return requestError.retryAfter
	}
	if (requestError?.status === 404) {
		return new Date(input.now.getTime() + 30 * DAY_MS)
	}
	if (requestError?.status === 401 || requestError?.status === 403) {
		return new Date(input.now.getTime() + DAY_MS)
	}
	const baseMs = requestError?.status === 429 ? DEFAULT_RETRY_DELAY_MS : 60_000
	const delay = Math.min(DAY_MS, baseMs * 2 ** Math.min(input.failureCount, 8))
	return new Date(input.now.getTime() + delay)
}

function parseHydrationCursor(value: string | null): MalHydrationCursor {
	if (!value) {
		return {
			version: 1,
			providerRetryAfter: null,
			lastCompletedSourceId: null,
		}
	}
	let parsed: unknown
	try {
		parsed = JSON.parse(value)
	} catch {
		throw new Error('Stored MAL hydration cursor is not valid JSON')
	}
	const cursor = requireObject(parsed, 'Stored MAL hydration cursor')
	if (
		cursor.version !== 1 ||
		(cursor.providerRetryAfter !== null &&
			typeof cursor.providerRetryAfter !== 'string') ||
		(cursor.lastCompletedSourceId !== null &&
			typeof cursor.lastCompletedSourceId !== 'string') ||
		(cursor.providerRetryAfter &&
			!Number.isFinite(new Date(cursor.providerRetryAfter).getTime()))
	) {
		throw new Error('Stored MAL hydration cursor is invalid')
	}
	return cursor as unknown as MalHydrationCursor
}

function serializeHydrationCursor(cursor: MalHydrationCursor) {
	return JSON.stringify(cursor)
}

function eligibleHydrationWhere(kind: MalCatalogKind, now: Date) {
	return {
		provider: 'mal',
		kind,
		tombstonedAt: null,
		OR: [
			{ fetchStatus: 'pending' },
			{ fetchStatus: 'failed', refreshAfter: { lte: now } },
			{ fetchStatus: 'fresh', refreshAfter: { lte: now } },
		],
	} satisfies Prisma.MediaExternalIdWhereInput
}

async function findHydrationCandidates(
	prisma: PrismaClient | Prisma.TransactionClient,
	kind: MalCatalogKind,
	now: Date,
	take: number,
) {
	return prisma.mediaExternalId.findMany({
		where: eligibleHydrationWhere(kind, now),
		orderBy: [
			{ hydrationPriority: 'desc' },
			{ sourcePopularity: 'desc' },
			{ firstSeenAt: 'asc' },
		],
		take,
		select: {
			id: true,
			mediaId: true,
			externalId: true,
			failureCount: true,
			sourceUpdatedAt: true,
		},
	})
}

async function prioritizeUserDemand(
	tx: Prisma.TransactionClient,
	kind: MalCatalogKind,
	now: Date,
) {
	const sources = await tx.mediaExternalId.findMany({
		where: {
			provider: 'mal',
			kind,
			tombstonedAt: null,
			hydrationPriority: { lt: catalogHydrationPriorities.userDemand },
			media: {
				is: {
					OR: [
						{ entries: { some: {} } },
						{ favorites: { some: {} } },
						{ trackingStates: { some: {} } },
						{ collectionItems: { some: {} } },
						{ releaseReminders: { some: {} } },
					],
				},
			},
		},
		select: { id: true },
	})
	if (!sources.length) return 0
	const updated = await tx.mediaExternalId.updateMany({
		where: { id: { in: sources.map(source => source.id) } },
		data: {
			hydrationPriority: catalogHydrationPriorities.userDemand,
			hydrationReason: 'user-demand',
			hydrationRequestedAt: now,
		},
	})
	return updated.count
}

async function fetchDetails(
	candidate: MalHydrationCandidate,
	input: {
		kind: MalCatalogKind
		clientId: string
		fetchImpl: typeof fetch
		now: Date
	},
) {
	try {
		const payload = await fetchMalJson({
			url: malDetailUrl(input.kind, candidate.externalId),
			clientId: input.clientId,
			fetchImpl: input.fetchImpl,
			now: input.now,
		})
		const details = normalizeMalDetails(payload, input.kind)
		if (String(details.id) !== candidate.externalId) {
			throw new Error(
				`MAL detail id ${details.id} did not match requested id ${candidate.externalId}`,
			)
		}
		return { candidate, details, error: null }
	} catch (error) {
		return { candidate, details: null, error }
	}
}

function wait(milliseconds: number) {
	return new Promise<void>(resolve => setTimeout(resolve, milliseconds))
}

export async function hydrateMalCatalog(
	options: HydrateMalCatalogOptions,
): Promise<MalHydrationSummary> {
	const commit = options.commit ?? false
	const limit = requirePositiveInteger(options.limit ?? 100, 'limit')
	const refreshDays = requirePositiveInteger(
		options.refreshDays ?? DEFAULT_REFRESH_DAYS,
		'refreshDays',
	)
	const requestDelayMs = requireNonNegativeInteger(
		options.requestDelayMs ?? 1_000,
		'requestDelayMs',
	)
	const leaseDurationMs = requirePositiveInteger(
		options.leaseDurationMs ?? 300_000,
		'leaseDurationMs',
	)
	const clock = options.now ?? (() => new Date())
	const fetchImpl = options.fetchImpl ?? fetch
	const delay = options.delay ?? wait
	const now = clock()
	const queueBefore = await options.prisma.mediaExternalId.count({
		where: eligibleHydrationWhere(options.kind, now),
	})
	if (!commit) {
		const candidates = await findHydrationCandidates(
			options.prisma,
			options.kind,
			now,
			limit,
		)
		return {
			runId: null,
			kind: options.kind,
			dryRun: true,
			recordsSeen: candidates.length,
			recordsHandled: 0,
			recordsFailed: 0,
			requestsMade: 0,
			rateLimitEvents: 0,
			providerRetryAfter: null,
			queueBefore,
			queueAfter: queueBefore,
		}
	}

	const clientId = options.clientId?.trim()
	if (!clientId)
		throw new Error('MAL client id is required for a committed run')
	if (!options.policyApprovalReference?.trim()) {
		throw new Error(
			'MAL policy approval reference is required for a committed run',
		)
	}
	const leaseOwner = options.leaseOwner?.trim()
	if (!leaseOwner) throw new Error('leaseOwner is required for a committed run')
	const lease = await options.prisma.$transaction(tx =>
		acquireCatalogSyncLease(tx, {
			provider: 'mal',
			kind: options.kind,
			mode: 'hydrate',
			leaseOwner,
			leaseDurationMs,
			policyApprovalRef: options.policyApprovalReference,
			now,
		}),
	)
	let cursor = parseHydrationCursor(lease.run.cursor)
	let recordsSeen = 0
	let recordsHandled = 0
	let recordsFailed = 0
	let requestsMade = 0
	let rateLimitEvents = 0
	let providerRetryAfter = cursor.providerRetryAfter
		? new Date(cursor.providerRetryAfter)
		: null

	const progress = () => ({
		cursor: serializeHydrationCursor(cursor),
		recordsSeen,
		recordsHandled,
		recordsFailed,
	})
	const telemetry = () => ({
		requestsMade,
		rateLimitEvents,
		providerRetryAfter,
	})
	const currentSummary = async (): Promise<MalHydrationSummary> => ({
		runId: lease.run.id,
		kind: options.kind,
		dryRun: false,
		recordsSeen,
		recordsHandled,
		recordsFailed,
		requestsMade,
		rateLimitEvents,
		providerRetryAfter,
		queueBefore,
		queueAfter: await options.prisma.mediaExternalId.count({
			where: eligibleHydrationWhere(options.kind, clock()),
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
			return currentSummary()
		}

		providerRetryAfter = null
		cursor = { ...cursor, providerRetryAfter: null }
		await options.prisma.$transaction(tx =>
			prioritizeUserDemand(tx, options.kind, now),
		)
		const candidates = await findHydrationCandidates(
			options.prisma,
			options.kind,
			clock(),
			limit,
		)
		for (const candidate of candidates) {
			if (requestsMade > 0 && requestDelayMs > 0) await delay(requestDelayMs)
			const batchNow = clock()
			const result = await fetchDetails(candidate, {
				kind: options.kind,
				clientId,
				fetchImpl,
				now: batchNow,
			})
			requestsMade++
			recordsSeen++
			if (
				result.error instanceof MalRequestError &&
				result.error.status === 429
			) {
				rateLimitEvents++
			}
			providerRetryAfter =
				result.error instanceof MalRequestError &&
				[401, 403, 429].includes(result.error.status ?? 0)
					? malRetryDeadline({
							error: result.error,
							failureCount: candidate.failureCount,
							now: batchNow,
						})
					: null
			cursor = {
				version: 1,
				providerRetryAfter: providerRetryAfter?.toISOString() ?? null,
				lastCompletedSourceId: candidate.id,
			}
			await options.prisma.$transaction(async tx => {
				if (result.details) {
					await hydrateMediaCatalog(
						tx,
						candidate.mediaId,
						result.details.catalog,
						{
							overwrite: true,
							authoritativeFields: ['nextRelease'],
							syncLegacyFields: ['nextRelease'],
						},
					)
					await replaceCatalogTitles(tx, {
						mediaId: candidate.mediaId,
						provider: 'mal',
						titles: result.details.titles,
					})
					await syncMediaRelations(tx, {
						sourceMediaId: candidate.mediaId,
						sourceIdentity: {
							provider: 'mal',
							kind: options.kind,
							externalId: candidate.externalId,
						},
						relations: result.details.relations,
						requestTargetHydration: false,
					})
					await tx.mediaExternalId.update({
						where: { id: candidate.id },
						data: {
							sourceTitle: result.details.sourceTitle,
							...(result.details.sourceUpdatedAt &&
							(!candidate.sourceUpdatedAt ||
								result.details.sourceUpdatedAt > candidate.sourceUpdatedAt)
								? { sourceUpdatedAt: result.details.sourceUpdatedAt }
								: {}),
							...(result.details.sourcePopularity === null
								? {}
								: { sourcePopularity: result.details.sourcePopularity }),
							...(result.details.sourceRank === null
								? {}
								: { sourceRank: result.details.sourceRank }),
							...(result.details.sourceAudience === null
								? {}
								: { sourceAudience: result.details.sourceAudience }),
							...(result.details.sourceRatingCount === null
								? {}
								: {
										sourceRatingCount: result.details.sourceRatingCount,
									}),
							...(result.details.sourceIsAdult === null
								? {}
								: { sourceIsAdult: result.details.sourceIsAdult }),
							hydrationPriority: 0,
							hydrationReason: null,
							hydrationRequestedAt: null,
						},
					})
					await recordCatalogFetchSuccess(tx, {
						provider: 'mal',
						kind: options.kind,
						externalId: candidate.externalId,
						fetchedAt: batchNow,
						refreshAfter: new Date(batchNow.getTime() + refreshDays * DAY_MS),
					})
					recordsHandled++
				} else {
					await recordCatalogFetchFailure(tx, {
						provider: 'mal',
						kind: options.kind,
						externalId: candidate.externalId,
						error: result.error,
						retryAfter: malRetryDeadline({
							error: result.error,
							failureCount: candidate.failureCount,
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
			await options.onCheckpoint?.(await currentSummary())
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
		return currentSummary()
	} catch (error) {
		await failRun(error)
		throw error
	}
}

export async function getMalHydrationMetrics(
	prisma: PrismaClient,
	input: {
		kind: MalCatalogKind
		now?: Date
		freshnessDays?: number
	},
) {
	const now = input.now ?? new Date()
	const freshnessDays = requirePositiveInteger(
		input.freshnessDays ?? DEFAULT_REFRESH_DAYS,
		'freshnessDays',
	)
	const freshSince = new Date(now.getTime() - freshnessDays * DAY_MS)
	const activeWhere = {
		provider: 'mal',
		kind: input.kind,
		tombstonedAt: null,
	} satisfies Prisma.MediaExternalIdWhereInput
	const [
		total,
		active,
		hydrated,
		fresh,
		queueDepth,
		failedDeferred,
		highPriority,
		telemetry,
	] = await Promise.all([
		prisma.mediaExternalId.count({
			where: { provider: 'mal', kind: input.kind },
		}),
		prisma.mediaExternalId.count({ where: activeWhere }),
		prisma.mediaExternalId.count({
			where: { ...activeWhere, lastFetchedAt: { not: null } },
		}),
		prisma.mediaExternalId.count({
			where: {
				...activeWhere,
				fetchStatus: 'fresh',
				lastFetchedAt: { gte: freshSince },
			},
		}),
		prisma.mediaExternalId.count({
			where: eligibleHydrationWhere(input.kind, now),
		}),
		prisma.mediaExternalId.count({
			where: {
				...activeWhere,
				fetchStatus: 'failed',
				refreshAfter: { gt: now },
			},
		}),
		prisma.mediaExternalId.count({
			where: { ...activeWhere, hydrationPriority: { gt: 0 } },
		}),
		prisma.catalogSyncRun.aggregate({
			where: { provider: 'mal', kind: input.kind, mode: 'hydrate' },
			_sum: { requestsMade: true, rateLimitEvents: true },
		}),
	])
	const percent = (value: number) =>
		active ? Math.round((value / active) * 10_000) / 100 : 100
	return {
		kind: input.kind,
		freshnessTargetDays: freshnessDays,
		total,
		active,
		tombstoned: total - active,
		hydrated,
		fresh,
		overdue: hydrated - fresh,
		queueDepth,
		failedDeferred,
		highPriority,
		coveragePercent: percent(hydrated),
		freshnessPercent: percent(fresh),
		requestsMade: telemetry._sum.requestsMade ?? 0,
		rateLimitEvents: telemetry._sum.rateLimitEvents ?? 0,
	}
}
