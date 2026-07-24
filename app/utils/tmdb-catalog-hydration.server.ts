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
	requestCatalogHydration,
	upsertCatalogIdentity,
} from './catalog-sync.server.ts'
import { hydrateMediaCatalog } from './media.server.ts'
import { type TmdbCatalogKind } from './tmdb-catalog-inventory.server.ts'

const DAY_MS = 24 * 60 * 60 * 1_000
const DEFAULT_REFRESH_DAYS = 150
const MAX_CONCURRENCY = 10

export const tmdbHydrationFeeds = ['upcoming', 'trending', 'popular'] as const
export type TmdbHydrationFeed = (typeof tmdbHydrationFeeds)[number]

type TmdbHydrationCursor = {
	version: 1
	providerRetryAfter: string | null
	lastCompletedSourceId: string | null
}

type TmdbHydrationCandidate = {
	id: string
	mediaId: string
	externalId: string
	failureCount: number
}

type TmdbPrioritySignal = {
	externalId: string
	title: string | null
	popularity: number | null
	audience: number | null
	isAdult: boolean | null
	isVideo: boolean | null
	rank: number
	priority: number
	reason: TmdbHydrationFeed
}

export type NormalizedTmdbDetails = {
	id: number
	sourceTitle: string
	sourcePopularity: number | null
	sourceAudience: number | null
	sourceRatingCount: number | null
	sourceIsAdult: boolean | null
	sourceIsVideo: boolean | null
	catalog: Record<string, unknown>
	titles: Array<{
		language?: string | null
		titleType: string
		value: string
		isPrimary?: boolean
	}>
}

export type TmdbHydrationSummary = {
	runId: string | null
	kind: TmdbCatalogKind
	dryRun: boolean
	seeded: number
	recordsSeen: number
	recordsHandled: number
	recordsFailed: number
	requestsMade: number
	rateLimitEvents: number
	providerRetryAfter: Date | null
	queueBefore: number
	queueAfter: number
}

type HydrateTmdbCatalogOptions = {
	prisma: PrismaClient
	kind: TmdbCatalogKind
	apiToken?: string
	commit?: boolean
	limit?: number
	concurrency?: number
	requestDelayMs?: number
	refreshDays?: number
	seedPriorities?: boolean
	feeds?: TmdbHydrationFeed[]
	leaseOwner?: string
	leaseDurationMs?: number
	fetchImpl?: typeof fetch
	sleep?: (milliseconds: number) => Promise<void>
	now?: () => Date
	onCheckpoint?: (summary: TmdbHydrationSummary) => void | Promise<void>
}

export class TmdbRequestError extends Error {
	constructor(
		message: string,
		public readonly status: number | null,
		public readonly retryAfter: Date | null = null,
	) {
		super(message)
		this.name = 'TmdbRequestError'
	}
}

function requirePositiveInteger(value: number, label: string) {
	if (!Number.isSafeInteger(value) || value <= 0) {
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

function createRequestPacer(
	requestDelayMs: number,
	sleep: (milliseconds: number) => Promise<void>,
) {
	let nextStart = Promise.resolve()
	return async <Result>(request: () => Promise<Result>) => {
		const start = nextStart
		let releaseNextStart = () => {}
		nextStart = new Promise<void>(resolve => {
			releaseNextStart = resolve
		})
		await start
		let result: Promise<Result>
		try {
			result = request()
		} finally {
			if (requestDelayMs === 0) {
				releaseNextStart()
			} else {
				void sleep(requestDelayMs).then(releaseNextStart, releaseNextStart)
			}
		}
		return result
	}
}

function optionalString(value: unknown) {
	return typeof value === 'string' ? value.trim() || null : null
}

function optionalNumber(value: unknown) {
	return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function optionalAudience(value: unknown) {
	const audience = optionalNumber(value)
	return audience !== null && Number.isSafeInteger(audience) && audience >= 0
		? audience
		: null
}

function optionalBoolean(value: unknown) {
	return typeof value === 'boolean' ? value : null
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`${label} must be a JSON object`)
	}
	return value as Record<string, unknown>
}

function requireTmdbId(value: unknown, label = 'TMDB id') {
	if (!Number.isSafeInteger(value) || Number(value) < 1) {
		throw new Error(`${label} must be a positive safe integer`)
	}
	return Number(value)
}

function optionalDate(value: unknown) {
	const raw = optionalString(value)
	if (!raw) return null
	if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null
	const date = new Date(`${raw}T00:00:00.000Z`)
	return Number.isFinite(date.getTime()) &&
		date.toISOString().slice(0, 10) === raw
		? date
		: null
}

function commaSeparatedNames(value: unknown) {
	if (!Array.isArray(value)) return null
	const names = value
		.map(item => optionalString(requireObject(item, 'named item').name))
		.filter((name): name is string => Boolean(name))
	return names.length ? names.join(', ') : null
}

function languageName(code: string | null) {
	if (!code) return null
	try {
		return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code
	} catch {
		return code
	}
}

function formattedRuntime(minutes: number | null) {
	if (minutes === null || minutes < 1) return null
	const hours = Math.floor(minutes / 60)
	const remainder = Math.round(minutes % 60)
	if (!hours) return `${remainder}m`
	return remainder ? `${hours}h ${remainder}m` : `${hours}h`
}

function movieCertification(payload: Record<string, unknown>) {
	const releaseDates = payload.release_dates
	if (!releaseDates || typeof releaseDates !== 'object') return null
	const countries = (releaseDates as Record<string, unknown>).results
	if (!Array.isArray(countries)) return null
	const us = countries.find(country => {
		return (
			country &&
			typeof country === 'object' &&
			(country as Record<string, unknown>).iso_3166_1 === 'US'
		)
	})
	if (!us || typeof us !== 'object') return null
	const dates = (us as Record<string, unknown>).release_dates
	if (!Array.isArray(dates)) return null
	for (const release of [...dates].reverse()) {
		if (!release || typeof release !== 'object') continue
		const certification = optionalString(
			(release as Record<string, unknown>).certification,
		)
		if (certification) return certification
	}
	return null
}

function tvCertification(payload: Record<string, unknown>) {
	const contentRatings = payload.content_ratings
	if (!contentRatings || typeof contentRatings !== 'object') return null
	const ratings = (contentRatings as Record<string, unknown>).results
	if (!Array.isArray(ratings)) return null
	const us = ratings.find(rating => {
		return (
			rating &&
			typeof rating === 'object' &&
			(rating as Record<string, unknown>).iso_3166_1 === 'US'
		)
	})
	return us && typeof us === 'object'
		? optionalString((us as Record<string, unknown>).rating)
		: null
}

function alternativeTitles(
	payload: Record<string, unknown>,
	kind: TmdbCatalogKind,
) {
	const container = payload.alternative_titles
	if (!container || typeof container !== 'object') return []
	const items = (container as Record<string, unknown>)[
		kind === 'movie' ? 'titles' : 'results'
	]
	if (!Array.isArray(items)) return []
	return items.flatMap(item => {
		if (!item || typeof item !== 'object') return []
		const title = optionalString((item as Record<string, unknown>).title)
		return title ? [{ titleType: 'alternate', value: title }] : []
	})
}

function normalizedTmdbNextRelease(
	payload: Record<string, unknown>,
	kind: TmdbCatalogKind,
	observedAt: Date,
) {
	if (kind === 'movie') return null
	const value = payload.next_episode_to_air
	if (value === null || value === undefined) return null
	if (!value || typeof value !== 'object' || Array.isArray(value))
		return undefined
	const episode = value as Record<string, unknown>
	const releaseDate = optionalString(episode.air_date)
	if (!releaseDate || !optionalDate(releaseDate)) return undefined
	const episodeNumber = optionalNumber(episode.episode_number)
	const seasonNumber = optionalNumber(episode.season_number)
	const stillPath = optionalString(episode.still_path)
	return JSON.stringify({
		source: 'tmdb',
		observedAt: observedAt.toISOString(),
		id: optionalNumber(episode.id),
		name: optionalString(episode.name),
		overview: optionalString(episode.overview),
		releaseDate,
		episode: episodeNumber !== null && episodeNumber > 0 ? episodeNumber : null,
		season: seasonNumber !== null && seasonNumber > 0 ? seasonNumber : null,
		runtime: optionalNumber(episode.runtime),
		image: stillPath
			? `https://www.themoviedb.org/t/p/original${stillPath}|https://www.themoviedb.org/tv/${payload.id}/watch`
			: null,
	})
}

export function normalizeTmdbDetails(
	value: unknown,
	kind: TmdbCatalogKind,
	observedAt = new Date(),
): NormalizedTmdbDetails {
	const payload = requireObject(value, 'TMDB detail response')
	const id = requireTmdbId(payload.id)
	const title = optionalString(kind === 'movie' ? payload.title : payload.name)
	const originalTitle = optionalString(
		kind === 'movie' ? payload.original_title : payload.original_name,
	)
	if (!title && !originalTitle)
		throw new Error('TMDB detail response has no title')
	const canonicalTitle = title ?? originalTitle!
	const releaseStart = optionalDate(
		kind === 'movie' ? payload.release_date : payload.first_air_date,
	)
	const releaseEnd =
		kind === 'movie' ? releaseStart : optionalDate(payload.last_air_date)
	const posterPath = optionalString(payload.poster_path)
	const originalLanguage = optionalString(payload.original_language)
	const runtime =
		kind === 'movie'
			? formattedRuntime(optionalNumber(payload.runtime))
			: (() => {
					const episodes = optionalNumber(payload.number_of_episodes)
					return episodes && episodes > 0 ? `${episodes} eps` : null
				})()
	const runtimeMinutes =
		kind === 'movie' ? optionalNumber(payload.runtime) : null
	const episodeCount =
		kind === 'tv' ? optionalNumber(payload.number_of_episodes) : null
	const rating =
		kind === 'movie' ? movieCertification(payload) : tvCertification(payload)
	const catalog = {
		title: canonicalTitle,
		type: kind === 'movie' ? 'Movie' : 'TV Series',
		thumbnail: posterPath
			? `https://image.tmdb.org/t/p/w500${posterPath}|https://www.themoviedb.org/${kind}/${id}`
			: undefined,
		releaseStart: releaseStart ?? undefined,
		releaseEnd: releaseEnd ?? undefined,
		description: optionalString(payload.overview) ?? undefined,
		startYear: releaseStart ? String(releaseStart.getUTCFullYear()) : undefined,
		length: runtime ?? undefined,
		runtimeMinutes:
			runtimeMinutes !== null ? Math.round(runtimeMinutes) : undefined,
		episodeCount: episodeCount !== null ? Math.round(episodeCount) : undefined,
		genres: commaSeparatedNames(payload.genres) ?? undefined,
		rating: rating ?? undefined,
		language: languageName(originalLanguage) ?? undefined,
		studios: commaSeparatedNames(payload.production_companies) ?? undefined,
		tmdbScore: optionalNumber(payload.vote_average) ?? undefined,
		catalogScore: optionalNumber(payload.vote_average) ?? undefined,
		catalogPopularity: optionalNumber(payload.popularity) ?? undefined,
		releaseStatus: optionalString(payload.status) ?? undefined,
		nextRelease: normalizedTmdbNextRelease(payload, kind, observedAt),
	}
	return {
		id,
		sourceTitle: originalTitle ?? canonicalTitle,
		sourcePopularity: optionalNumber(payload.popularity),
		sourceAudience: optionalAudience(payload.vote_count),
		sourceRatingCount: optionalAudience(payload.vote_count),
		sourceIsAdult: optionalBoolean(payload.adult),
		sourceIsVideo: optionalBoolean(payload.video),
		catalog,
		titles: [
			{
				language: 'en',
				titleType: 'primary',
				value: canonicalTitle,
				isPrimary: true,
			},
			...(originalTitle && originalTitle !== canonicalTitle
				? [
						{
							language: originalLanguage,
							titleType: 'original',
							value: originalTitle,
						},
					]
				: []),
			...alternativeTitles(payload, kind),
		],
	}
}

export function parseTmdbRetryAfter(value: string | null, now = new Date()) {
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

export function tmdbDetailUrl(kind: TmdbCatalogKind, externalId: string) {
	if (
		!/^[1-9]\d*$/.test(externalId) ||
		!Number.isSafeInteger(Number(externalId))
	) {
		throw new Error('TMDB external id must be a positive safe integer')
	}
	const append =
		kind === 'movie'
			? 'alternative_titles,release_dates'
			: 'alternative_titles,content_ratings'
	const url = new URL(`https://api.themoviedb.org/3/${kind}/${externalId}`)
	url.searchParams.set('language', 'en-US')
	url.searchParams.set('append_to_response', append)
	return url.toString()
}

export function tmdbPriorityFeedUrl(
	kind: TmdbCatalogKind,
	feed: TmdbHydrationFeed,
) {
	const pathname =
		feed === 'trending'
			? `/3/trending/${kind}/week`
			: feed === 'upcoming'
				? kind === 'movie'
					? '/3/movie/upcoming'
					: '/3/tv/on_the_air'
				: `/3/${kind}/popular`
	const url = new URL(`https://api.themoviedb.org${pathname}`)
	url.searchParams.set('language', 'en-US')
	url.searchParams.set('page', '1')
	return url.toString()
}

async function fetchTmdbJson(input: {
	url: string
	apiToken: string
	fetchImpl: typeof fetch
	now: Date
}) {
	let response: Response
	try {
		response = await input.fetchImpl(input.url, {
			headers: {
				accept: 'application/json',
				Authorization: `Bearer ${input.apiToken}`,
			},
		})
	} catch (error) {
		throw new TmdbRequestError(
			`TMDB request failed: ${error instanceof Error ? error.message : String(error)}`,
			null,
		)
	}
	if (!response.ok) {
		throw new TmdbRequestError(
			`TMDB request failed with ${response.status} ${response.statusText}`,
			response.status,
			parseTmdbRetryAfter(response.headers.get('retry-after'), input.now),
		)
	}
	try {
		return await response.json()
	} catch {
		throw new TmdbRequestError(
			'TMDB response was not valid JSON',
			response.status,
		)
	}
}

function prioritySignals(
	value: unknown,
	kind: TmdbCatalogKind,
	feed: TmdbHydrationFeed,
): TmdbPrioritySignal[] {
	const payload = requireObject(value, `TMDB ${feed} response`)
	if (!Array.isArray(payload.results)) {
		throw new Error(`TMDB ${feed} response has no results array`)
	}
	return payload.results.map((item, index) => {
		const record = requireObject(item, `TMDB ${feed} result`)
		return {
			externalId: String(requireTmdbId(record.id, `TMDB ${feed} result id`)),
			title: optionalString(
				kind === 'movie' ? record.original_title : record.original_name,
			),
			popularity: optionalNumber(record.popularity),
			audience: optionalAudience(record.vote_count),
			isAdult: optionalBoolean(record.adult),
			isVideo: optionalBoolean(record.video),
			rank: index + 1,
			priority: catalogHydrationPriorities[feed] + Math.max(0, 1_000 - index),
			reason: feed,
		}
	})
}

function mergePrioritySignals(signals: TmdbPrioritySignal[]) {
	const merged = new Map<string, TmdbPrioritySignal>()
	for (const signal of signals) {
		const current = merged.get(signal.externalId)
		if (!current || signal.priority > current.priority) {
			merged.set(signal.externalId, signal)
		}
	}
	return [...merged.values()]
}

export function providerFeedRankingScores(
	signals: Array<Pick<TmdbPrioritySignal, 'rank' | 'audience'>>,
) {
	const maxRank = Math.max(1, ...signals.map(signal => signal.rank))
	const maxAudienceLog = Math.max(
		0,
		...signals.map(signal => Math.log1p(signal.audience ?? 0)),
	)
	return signals.map(signal => {
		const rankScore = maxRank === 1 ? 1 : 1 - (signal.rank - 1) / (maxRank - 1)
		const audienceScore = maxAudienceLog
			? Math.log1p(signal.audience ?? 0) / maxAudienceLog
			: 0
		return Math.max(0, Math.min(1, rankScore * 0.35 + audienceScore * 0.65))
	})
}

export function tmdbRetryDeadline(input: {
	error: unknown
	failureCount: number
	now: Date
}) {
	const requestError =
		input.error instanceof TmdbRequestError ? input.error : null
	if (requestError?.retryAfter && requestError.retryAfter > input.now) {
		return requestError.retryAfter
	}
	if (requestError?.status === 404) {
		return new Date(input.now.getTime() + 30 * DAY_MS)
	}
	if (requestError?.status === 401 || requestError?.status === 403) {
		return new Date(input.now.getTime() + DAY_MS)
	}
	const baseMs = requestError?.status === 429 ? 5 * 60_000 : 60_000
	const delay = Math.min(DAY_MS, baseMs * 2 ** Math.min(input.failureCount, 8))
	return new Date(input.now.getTime() + delay)
}

function parseHydrationCursor(value: string | null): TmdbHydrationCursor {
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
		throw new Error('Stored TMDB hydration cursor is not valid JSON')
	}
	const cursor = requireObject(parsed, 'Stored TMDB hydration cursor')
	if (
		cursor.version !== 1 ||
		(cursor.providerRetryAfter !== null &&
			typeof cursor.providerRetryAfter !== 'string') ||
		(cursor.lastCompletedSourceId !== null &&
			typeof cursor.lastCompletedSourceId !== 'string')
	) {
		throw new Error('Stored TMDB hydration cursor is invalid')
	}
	if (
		cursor.providerRetryAfter &&
		!Number.isFinite(new Date(cursor.providerRetryAfter).getTime())
	) {
		throw new Error('Stored TMDB hydration cursor is invalid')
	}
	return cursor as TmdbHydrationCursor
}

function serializeHydrationCursor(cursor: TmdbHydrationCursor) {
	return JSON.stringify(cursor)
}

function eligibleHydrationWhere(kind: TmdbCatalogKind, now: Date) {
	return {
		provider: 'tmdb',
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
	kind: TmdbCatalogKind,
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
		},
	})
}

async function prioritizeUserDemand(
	tx: Prisma.TransactionClient,
	kind: TmdbCatalogKind,
	now: Date,
) {
	const sources = await tx.mediaExternalId.findMany({
		where: {
			provider: 'tmdb',
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

async function applyPrioritySignals(
	tx: Prisma.TransactionClient,
	kind: TmdbCatalogKind,
	signals: TmdbPrioritySignal[],
	feedSnapshots: Array<{
		feed: TmdbHydrationFeed
		signals: TmdbPrioritySignal[]
	}>,
	now: Date,
) {
	const mediaIds = new Map<string, string>()
	for (const signal of signals) {
		const source = await upsertCatalogIdentity(tx, {
			provider: 'tmdb',
			kind,
			externalId: signal.externalId,
			sourceTitle: signal.title,
			sourcePopularity: signal.popularity,
			sourceAudience: signal.audience,
			sourceRatingCount: signal.audience,
			sourceIsAdult: signal.isAdult,
			sourceIsVideo: signal.isVideo,
			seenAt: now,
		})
		mediaIds.set(signal.externalId, source.mediaId)
		await requestCatalogHydration(tx, {
			provider: 'tmdb',
			kind,
			externalId: signal.externalId,
			priority: signal.priority,
			reason: signal.reason,
			requestedAt: now,
		})
	}
	for (const snapshot of feedSnapshots) {
		await tx.catalogFeedItem.deleteMany({
			where: { provider: 'tmdb', kind, feed: snapshot.feed },
		})
		const seenMediaIds = new Set<string>()
		const rankingScores = providerFeedRankingScores(snapshot.signals)
		const feedItems = snapshot.signals.flatMap((signal, index) => {
			const mediaId = mediaIds.get(signal.externalId)
			if (!mediaId || seenMediaIds.has(mediaId)) return []
			seenMediaIds.add(mediaId)
			return [
				{
					provider: 'tmdb',
					kind,
					feed: snapshot.feed,
					rank: signal.rank,
					audience: signal.audience,
					rankingScore: rankingScores[index],
					rankingVersion: 1,
					observedAt: now,
					mediaId,
				},
			]
		})
		if (feedItems.length) {
			await tx.catalogFeedItem.createMany({
				data: feedItems,
			})
		}
	}
}

async function fetchDetails(
	candidate: TmdbHydrationCandidate,
	input: {
		kind: TmdbCatalogKind
		apiToken: string
		fetchImpl: typeof fetch
		now: Date
	},
) {
	try {
		const payload = await fetchTmdbJson({
			url: tmdbDetailUrl(input.kind, candidate.externalId),
			apiToken: input.apiToken,
			fetchImpl: input.fetchImpl,
			now: input.now,
		})
		const details = normalizeTmdbDetails(payload, input.kind, input.now)
		if (String(details.id) !== candidate.externalId) {
			throw new Error(
				`TMDB detail id ${details.id} did not match requested id ${candidate.externalId}`,
			)
		}
		return { candidate, details, error: null }
	} catch (error) {
		return { candidate, details: null, error }
	}
}

function summary(input: TmdbHydrationSummary) {
	return input
}

export async function hydrateTmdbCatalog(
	options: HydrateTmdbCatalogOptions,
): Promise<TmdbHydrationSummary> {
	const commit = options.commit ?? false
	const limit = requirePositiveInteger(options.limit ?? 100, 'limit')
	const concurrency = requirePositiveInteger(
		options.concurrency ?? 4,
		'concurrency',
	)
	if (concurrency > MAX_CONCURRENCY) {
		throw new Error(`concurrency cannot exceed ${MAX_CONCURRENCY}`)
	}
	const requestDelayMs = requireNonNegativeInteger(
		options.requestDelayMs ?? 0,
		'requestDelayMs',
	)
	const refreshDays = requirePositiveInteger(
		options.refreshDays ?? DEFAULT_REFRESH_DAYS,
		'refreshDays',
	)
	const leaseDurationMs = requirePositiveInteger(
		options.leaseDurationMs ?? 300_000,
		'leaseDurationMs',
	)
	const clock = options.now ?? (() => new Date())
	const fetchImpl = options.fetchImpl ?? fetch
	const sleep =
		options.sleep ??
		((milliseconds: number) =>
			new Promise(resolve => setTimeout(resolve, milliseconds)))
	const pacedRequest = createRequestPacer(requestDelayMs, sleep)
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
		return summary({
			runId: null,
			kind: options.kind,
			dryRun: true,
			seeded: 0,
			recordsSeen: candidates.length,
			recordsHandled: 0,
			recordsFailed: 0,
			requestsMade: 0,
			rateLimitEvents: 0,
			providerRetryAfter: null,
			queueBefore,
			queueAfter: queueBefore,
		})
	}

	const apiToken = options.apiToken?.trim()
	if (!apiToken)
		throw new Error('TMDB API token is required for a committed run')
	const leaseOwner = options.leaseOwner?.trim()
	if (!leaseOwner) throw new Error('leaseOwner is required for a committed run')
	const lease = await options.prisma.$transaction(tx =>
		acquireCatalogSyncLease(tx, {
			provider: 'tmdb',
			kind: options.kind,
			mode: 'hydrate',
			leaseOwner,
			leaseDurationMs,
			now,
		}),
	)
	let cursor = parseHydrationCursor(lease.run.cursor)
	let seeded = 0
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
	const currentSummary = async (): Promise<TmdbHydrationSummary> => ({
		runId: lease.run.id,
		kind: options.kind,
		dryRun: false,
		seeded,
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

		if (options.seedPriorities) {
			const feeds = [...new Set(options.feeds ?? tmdbHydrationFeeds)]
			for (const feed of feeds) {
				if (!tmdbHydrationFeeds.includes(feed)) {
					throw new Error(`Unsupported TMDB hydration feed: ${feed}`)
				}
			}
			const settled = await Promise.allSettled(
				feeds.map(feed =>
					pacedRequest(() =>
						fetchTmdbJson({
							url: tmdbPriorityFeedUrl(options.kind, feed),
							apiToken,
							fetchImpl,
							now,
						}),
					).then(payload => prioritySignals(payload, options.kind, feed)),
				),
			)
			requestsMade += feeds.length
			const rejected = settled.filter(
				(result): result is PromiseRejectedResult =>
					result.status === 'rejected',
			)
			const rateLimited = rejected
				.map(result => result.reason)
				.filter(
					(error): error is TmdbRequestError =>
						error instanceof TmdbRequestError && error.status === 429,
				)
			if (rateLimited.length) {
				rateLimitEvents += rateLimited.length
				providerRetryAfter = rateLimited.reduce<Date>((latest, error) => {
					const deadline = tmdbRetryDeadline({
						error,
						failureCount: 0,
						now,
					})
					return deadline > latest ? deadline : latest
				}, now)
				cursor = {
					...cursor,
					providerRetryAfter: providerRetryAfter.toISOString(),
				}
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
			if (rejected.length) throw rejected[0].reason
			const feedSnapshots = feeds.map((feed, index) => ({
				feed,
				signals:
					settled[index]?.status === 'fulfilled' ? settled[index].value : [],
			}))
			const signals = mergePrioritySignals(
				feedSnapshots.flatMap(snapshot => snapshot.signals),
			)
			await options.prisma.$transaction(async tx => {
				await applyPrioritySignals(
					tx,
					options.kind,
					signals,
					feedSnapshots,
					now,
				)
				seeded = signals.length
				await checkpointCatalogSyncRun(tx, {
					runId: lease.run.id,
					leaseOwner,
					progress: progress(),
					telemetry: telemetry(),
					leaseDurationMs,
					now: clock(),
				})
			})
		}

		const candidates = await findHydrationCandidates(
			options.prisma,
			options.kind,
			clock(),
			limit,
		)
		for (let index = 0; index < candidates.length; index += concurrency) {
			const batch = candidates.slice(index, index + concurrency)
			const batchNow = clock()
			const results = await Promise.all(
				batch.map(candidate =>
					pacedRequest(() =>
						fetchDetails(candidate, {
							kind: options.kind,
							apiToken,
							fetchImpl,
							now: batchNow,
						}),
					),
				),
			)
			requestsMade += batch.length
			const rateLimited = results.filter(
				result =>
					result.error instanceof TmdbRequestError &&
					result.error.status === 429,
			)
			rateLimitEvents += rateLimited.length
			const providerBlocking = results.filter(
				result =>
					result.error instanceof TmdbRequestError &&
					[401, 403, 429].includes(result.error.status ?? 0),
			)
			providerRetryAfter = providerBlocking.reduce<Date | null>(
				(latest, result) => {
					const deadline = tmdbRetryDeadline({
						error: result.error,
						failureCount: result.candidate.failureCount,
						now: batchNow,
					})
					return !latest || deadline > latest ? deadline : latest
				},
				null,
			)
			cursor = {
				version: 1,
				providerRetryAfter: providerRetryAfter?.toISOString() ?? null,
				lastCompletedSourceId: batch.at(-1)?.id ?? null,
			}
			await options.prisma.$transaction(async tx => {
				for (const result of results) {
					recordsSeen += 1
					if (result.details) {
						await hydrateMediaCatalog(
							tx,
							result.candidate.mediaId,
							result.details.catalog,
							{
								overwrite: true,
								authoritativeFields: ['nextRelease'],
								syncLegacyFields: ['nextRelease'],
							},
						)
						await replaceCatalogTitles(tx, {
							mediaId: result.candidate.mediaId,
							provider: 'tmdb',
							titles: result.details.titles,
						})
						await tx.mediaExternalId.update({
							where: { id: result.candidate.id },
							data: {
								sourceTitle: result.details.sourceTitle,
								...(result.details.sourcePopularity === null
									? {}
									: { sourcePopularity: result.details.sourcePopularity }),
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
								...(result.details.sourceIsVideo === null
									? {}
									: { sourceIsVideo: result.details.sourceIsVideo }),
								hydrationPriority: 0,
								hydrationReason: null,
								hydrationRequestedAt: null,
							},
						})
						await recordCatalogFetchSuccess(tx, {
							provider: 'tmdb',
							kind: options.kind,
							externalId: result.candidate.externalId,
							fetchedAt: batchNow,
							refreshAfter: new Date(batchNow.getTime() + refreshDays * DAY_MS),
						})
						recordsHandled += 1
					} else {
						await recordCatalogFetchFailure(tx, {
							provider: 'tmdb',
							kind: options.kind,
							externalId: result.candidate.externalId,
							error: result.error,
							retryAfter: tmdbRetryDeadline({
								error: result.error,
								failureCount: result.candidate.failureCount,
								now: batchNow,
							}),
						})
						recordsFailed += 1
					}
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

export async function getTmdbHydrationMetrics(
	prisma: PrismaClient,
	input: {
		kind: TmdbCatalogKind
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
		provider: 'tmdb',
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
			where: { provider: 'tmdb', kind: input.kind },
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
			where: {
				...activeWhere,
				hydrationPriority: { gt: 0 },
			},
		}),
		prisma.catalogSyncRun.aggregate({
			where: { provider: 'tmdb', kind: input.kind, mode: 'hydrate' },
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
