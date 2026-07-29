import { type Prisma } from '@prisma/client'
import { prisma } from './db.server.ts'
import { publicTrackingStateWhere } from './lists/visibility.server.ts'
import { splitLegacyThumbnail } from './media-detail.ts'
import { parseStoredNextRelease } from './release-occurrences.server.ts'

export { parseStoredNextRelease }

const DAY_MS = 24 * 60 * 60 * 1_000
const timeZoneDateFormatters = new Map<string, Intl.DateTimeFormat>()
const RELEASE_CALENDAR_CANDIDATE_LIMIT = 10_000
const RELEASE_CALENDAR_OCCURRENCE_LIMIT = 10_000
const RELEASE_CALENDAR_READ_CHUNK_SIZE = 400

export const releaseCalendarKinds = [
	'all',
	'movie',
	'tv',
	'anime',
	'manga',
] as const
export const releaseCalendarScopes = ['all', 'mine'] as const
// Busy days can schedule dozens of releases; the weekly view previews this
// many per day and links to the full day page for the rest.
export const releaseCalendarDayPreviewLimit = 5

export type ReleaseCalendarCapacitySource =
	'release-start' | 'next-release' | 'occurrences' | 'candidate-union'

export class ReleaseCalendarCapacityError extends Error {
	readonly code = 'RELEASE_CALENDAR_CAPACITY'

	constructor(
		readonly source: ReleaseCalendarCapacitySource,
		readonly limit: number,
	) {
		super(`Release calendar ${source} exceeded its safe limit of ${limit}.`)
		this.name = 'ReleaseCalendarCapacityError'
	}
}

export function isReleaseCalendarCapacityError(
	error: unknown,
): error is ReleaseCalendarCapacityError {
	return error instanceof ReleaseCalendarCapacityError
}

export type ReleaseCalendarQuery = {
	start: string
	kind: (typeof releaseCalendarKinds)[number]
	scope: (typeof releaseCalendarScopes)[number]
}

export type ReleaseCalendarItem = {
	id: string
	mediaId: string
	title: string
	kind: string
	type: string | null
	imageUrl: string | null
	releaseAt: Date
	allDay: boolean
	eventType: 'premiere' | 'episode' | 'chapter' | 'release'
	eventLabel: string
	eventName: string | null
	trackerCount: number
	viewerTracking: {
		status: string
		statusLabel: string
		score: number | null
	} | null
	viewerReminder: {
		id: string
		leadMinutes: number
	} | null
}

function dateKey(date: Date) {
	return date.toISOString().slice(0, 10)
}

export function parseReleaseCalendarDateKey(value: string | null) {
	if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
	const date = new Date(`${value}T00:00:00.000Z`)
	return Number.isNaN(date.getTime()) || dateKey(date) !== value ? null : date
}

export function normalizeTimeZone(value: string | null | undefined) {
	if (!value) return 'UTC'
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: value }).format()
		return value
	} catch {
		return 'UTC'
	}
}

export function dateKeyInTimeZone(date: Date, timeZone: string) {
	const normalized = timeZoneDateFormatters.has(timeZone)
		? timeZone
		: normalizeTimeZone(timeZone)
	let formatter = timeZoneDateFormatters.get(normalized)
	if (!formatter) {
		formatter = new Intl.DateTimeFormat('en-US', {
			timeZone: normalized,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
		})
		timeZoneDateFormatters.set(normalized, formatter)
	}
	const parts = formatter.formatToParts(date)
	const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
	return `${values.year}-${values.month}-${values.day}`
}

function startOfWeek(now: Date, timeZone: string) {
	const date =
		parseReleaseCalendarDateKey(dateKeyInTimeZone(now, timeZone)) ?? new Date()
	const daysSinceMonday = (date.getUTCDay() + 6) % 7
	date.setUTCDate(date.getUTCDate() - daysSinceMonday)
	return date
}

export function parseReleaseCalendarQuery(
	searchParams: URLSearchParams,
	now = new Date(),
	timeZone = 'UTC',
): ReleaseCalendarQuery {
	const requestedKind = searchParams.get('kind')
	const requestedScope = searchParams.get('scope')
	return {
		start: dateKey(
			parseReleaseCalendarDateKey(searchParams.get('start')) ??
				startOfWeek(now, timeZone),
		),
		kind: releaseCalendarKinds.includes(
			requestedKind as ReleaseCalendarQuery['kind'],
		)
			? (requestedKind as ReleaseCalendarQuery['kind'])
			: 'all',
		scope: releaseCalendarScopes.includes(
			requestedScope as ReleaseCalendarQuery['scope'],
		)
			? (requestedScope as ReleaseCalendarQuery['scope'])
			: 'all',
	}
}

function addDays(date: Date, days: number) {
	return new Date(date.getTime() + days * DAY_MS)
}

function titleCase(value: string) {
	return value
		.replace(/([a-z])([A-Z])/g, '$1 $2')
		.replace(/[-_]+/g, ' ')
		.replace(/\b\w/g, character => character.toUpperCase())
}

type NextRelease = NonNullable<ReturnType<typeof parseStoredNextRelease>>

const MAX_UNCONFIRMED_RELEASE_GAP_MS = 366 * DAY_MS
const MAX_OBSERVED_SCHEDULE_AGE_MS = 14 * DAY_MS
const MAX_OBSERVATION_CLOCK_SKEW_MS = 5 * 60 * 1_000
const activeReleaseStatus =
	/airing|returning|releasing|ongoing|in production|planned|upcoming/i
const finishedReleaseStatus = /ended|finished|cancel|released/i

export function isPlausibleNextRelease(
	release: NextRelease,
	media: {
		kind: string
		releaseStart: Date | null
		releaseEnd: Date | null
		releaseStatus: string | null
	},
	now = new Date(),
) {
	const kind = media.kind.toLowerCase()
	if (kind === 'movie' && (release.episode || release.chapter)) return false
	if (kind === 'manga' && release.episode) return false
	if ((kind === 'anime' || kind === 'tv') && release.chapter) return false
	if (media.releaseStart && release.releaseAt < media.releaseStart) return false
	if (
		release.observedAt &&
		(release.observedAt.getTime() - now.getTime() >
			MAX_OBSERVATION_CLOCK_SKEW_MS ||
			now.getTime() - release.observedAt.getTime() >
				MAX_OBSERVED_SCHEDULE_AGE_MS)
	) {
		return false
	}

	const status = media.releaseStatus?.trim() || null
	if (status && finishedReleaseStatus.test(status)) return false
	if (
		media.releaseEnd &&
		release.releaseAt.getTime() - media.releaseEnd.getTime() >
			MAX_UNCONFIRMED_RELEASE_GAP_MS &&
		(!status || !activeReleaseStatus.test(status))
	) {
		return false
	}

	return true
}

function nextReleaseLabel(release: NextRelease) {
	if (release.chapter !== null) {
		return release.volume === null
			? `Chapter ${release.chapter}`
			: `Volume ${release.volume} · Chapter ${release.chapter}`
	}
	if (release.episode !== null) {
		return release.season === null
			? `Episode ${release.episode}`
			: `Season ${release.season} · Episode ${release.episode}`
	}
	return 'Scheduled release'
}

function eventDateKey(date: Date, allDay: boolean, timeZone: string) {
	return allDay ? dateKey(date) : dateKeyInTimeZone(date, timeZone)
}

function dateIsInRange(value: string, start: string, end: string) {
	return value >= start && value < end
}

function chunked<T>(values: T[], size: number) {
	const chunks: T[][] = []
	for (let index = 0; index < values.length; index += size) {
		chunks.push(values.slice(index, index + size))
	}
	return chunks
}

function testOnlyLimit(value: number | undefined, fallback: number) {
	if (
		process.env.NODE_ENV !== 'test' ||
		value === undefined ||
		!Number.isSafeInteger(value) ||
		value < 1
	) {
		return fallback
	}
	return Math.min(value, fallback)
}

function assertWithinCapacity<T>(
	rows: T[],
	limit: number,
	source: ReleaseCalendarCapacitySource,
) {
	if (rows.length > limit) {
		throw new ReleaseCalendarCapacityError(source, limit)
	}
	return rows
}

const calendarMediaSelect = {
	id: true,
	kind: true,
	title: true,
	type: true,
	thumbnail: true,
	releaseStart: true,
	releaseEnd: true,
	releaseStatus: true,
	nextRelease: true,
} satisfies Prisma.MediaSelect

type CalendarMedia = Prisma.MediaGetPayload<{
	select: typeof calendarMediaSelect
}>

const calendarOccurrenceSelect = {
	id: true,
	mediaId: true,
	source: true,
	releaseAt: true,
	allDay: true,
	observedAt: true,
	episode: true,
	season: true,
	chapter: true,
	volume: true,
	name: true,
	eventType: true,
} satisfies Prisma.ReleaseOccurrenceSelect

type CalendarOccurrence = Prisma.ReleaseOccurrenceGetPayload<{
	select: typeof calendarOccurrenceSelect
}>

/** Build a deterministic seven-day release schedule from the canonical catalog. */
// Choose which releases represent an overfull day: titles the viewer tracks
// or has reminders for come first, then community interest, then air time.
function dayPreviewPriority(
	left: ReleaseCalendarItem,
	right: ReleaseCalendarItem,
) {
	return (
		Number(Boolean(right.viewerTracking)) -
			Number(Boolean(left.viewerTracking)) ||
		Number(Boolean(right.viewerReminder)) -
			Number(Boolean(left.viewerReminder)) ||
		right.trackerCount - left.trackerCount ||
		left.releaseAt.getTime() - right.releaseAt.getTime() ||
		left.title.localeCompare(right.title) ||
		left.id.localeCompare(right.id)
	)
}

export async function getReleaseCalendar(
	input: ReleaseCalendarQuery,
	viewerId: string | null,
	requestedTimeZone = 'UTC',
	options: {
		days?: number
		dayPreviewLimit?: number
		/**
		 * A test-only seam. Production ignores these values, and tests can only
		 * lower the hard limits rather than bypassing them.
		 */
		testing?: {
			now?: Date
			candidateLimit?: number
			occurrenceLimit?: number
			readChunkSize?: number
		}
	} = {},
) {
	const testOptions =
		process.env.NODE_ENV === 'test' ? options.testing : undefined
	const requestedNow = testOptions?.now
	const now =
		requestedNow && Number.isFinite(requestedNow.getTime())
			? new Date(requestedNow)
			: new Date()
	const candidateLimit = testOnlyLimit(
		testOptions?.candidateLimit,
		RELEASE_CALENDAR_CANDIDATE_LIMIT,
	)
	const occurrenceLimit = testOnlyLimit(
		testOptions?.occurrenceLimit,
		RELEASE_CALENDAR_OCCURRENCE_LIMIT,
	)
	const readChunkSize = testOnlyLimit(
		testOptions?.readChunkSize,
		RELEASE_CALENDAR_READ_CHUNK_SIZE,
	)
	const spanDays = options.days ?? 7
	const timeZone = normalizeTimeZone(requestedTimeZone)
	const start =
		parseReleaseCalendarDateKey(input.start) ?? startOfWeek(now, timeZone)
	const end = addDays(start, spanDays)
	const startKey = dateKey(start)
	const endKey = dateKey(end)
	const filters = {
		...input,
		start: dateKey(start),
		scope: input.scope === 'mine' && !viewerId ? ('all' as const) : input.scope,
	}
	const envelopeStart = addDays(start, -1)
	const envelopeEnd = addDays(end, 1)
	const mediaQualification = {
		...(filters.kind === 'all' ? {} : { kind: filters.kind }),
		...(filters.scope === 'mine' && viewerId
			? { trackingStates: { some: { ownerId: viewerId } } }
			: {}),
	} satisfies Prisma.MediaWhereInput

	const [releaseStartRows, nextReleaseRows, occurrenceRowsWithSentinel] =
		await Promise.all([
			prisma.media.findMany({
				where: {
					...mediaQualification,
					releaseStart: { gte: envelopeStart, lt: envelopeEnd },
				},
				select: { id: true },
				orderBy: { id: 'asc' },
				take: candidateLimit + 1,
			}),
			prisma.media.findMany({
				where: {
					...mediaQualification,
					nextReleaseAt: { gte: envelopeStart, lt: envelopeEnd },
				},
				select: { id: true },
				orderBy: { id: 'asc' },
				take: candidateLimit + 1,
			}),
			prisma.releaseOccurrence.findMany({
				where: {
					status: 'scheduled',
					expiresAt: { gt: now },
					releaseAt: { gte: envelopeStart, lt: envelopeEnd },
					media: mediaQualification,
				},
				select: calendarOccurrenceSelect,
				orderBy: [{ releaseAt: 'asc' }, { id: 'asc' }],
				take: occurrenceLimit + 1,
			}),
		])
	assertWithinCapacity(releaseStartRows, candidateLimit, 'release-start')
	assertWithinCapacity(nextReleaseRows, candidateLimit, 'next-release')
	const occurrenceRows = assertWithinCapacity(
		occurrenceRowsWithSentinel,
		occurrenceLimit,
		'occurrences',
	)
	const candidateIdSet = new Set([
		...releaseStartRows.map(item => item.id),
		...nextReleaseRows.map(item => item.id),
		...occurrenceRows.map(item => item.mediaId),
	])
	if (candidateIdSet.size > candidateLimit) {
		throw new ReleaseCalendarCapacityError('candidate-union', candidateLimit)
	}
	const candidateIds = [...candidateIdSet].sort()
	const media: CalendarMedia[] = []
	for (const mediaIds of chunked(candidateIds, readChunkSize)) {
		media.push(
			...(await prisma.media.findMany({
				where: {
					AND: [{ id: { in: mediaIds } }, mediaQualification],
				},
				select: calendarMediaSelect,
				orderBy: [{ title: 'asc' }, { id: 'asc' }],
			})),
		)
	}
	const occurrencesByMedia = new Map<string, CalendarOccurrence[]>()
	for (const occurrence of occurrenceRows) {
		const rows = occurrencesByMedia.get(occurrence.mediaId) ?? []
		rows.push(occurrence)
		occurrencesByMedia.set(occurrence.mediaId, rows)
	}
	const trackerCounts = new Map<string, number>()
	for (const mediaIds of chunked(candidateIds, readChunkSize)) {
		const groups = await prisma.trackingState.groupBy({
			by: ['mediaId'],
			where: {
				mediaId: { in: mediaIds },
				AND: [publicTrackingStateWhere],
			},
			_count: { _all: true },
		})
		for (const group of groups) {
			trackerCounts.set(group.mediaId, group._count._all)
		}
	}
	const viewerRows: Array<{
		mediaId: string
		status: string
		score: Prisma.Decimal | null
		statusWatchlist: { header: string } | null
	}> = []
	const reminderRows: Array<{
		id: string
		mediaId: string
		leadMinutes: number
	}> = []
	if (viewerId) {
		for (const mediaIds of chunked(candidateIds, readChunkSize)) {
			const [trackingRows, reminders] = await Promise.all([
				prisma.trackingState.findMany({
					where: {
						ownerId: viewerId,
						mediaId: { in: mediaIds },
					},
					select: {
						mediaId: true,
						status: true,
						score: true,
						statusWatchlist: { select: { header: true } },
					},
				}),
				prisma.releaseReminder.findMany({
					where: {
						ownerId: viewerId,
						mediaId: { in: mediaIds },
					},
					select: { id: true, mediaId: true, leadMinutes: true },
				}),
			])
			viewerRows.push(...trackingRows)
			reminderRows.push(...reminders)
		}
	}
	const viewerTracking = new Map(
		viewerRows.map(row => [
			row.mediaId,
			{
				status: row.status,
				statusLabel:
					row.statusWatchlist?.header.trim() ||
					titleCase(row.status || 'tracked'),
				score: row.score === null ? null : Number(row.score),
			},
		]),
	)
	const viewerReminders = new Map(
		reminderRows.map(row => [
			row.mediaId,
			{ id: row.id, leadMinutes: row.leadMinutes },
		]),
	)
	const items: ReleaseCalendarItem[] = []

	for (const item of media) {
		const common = {
			mediaId: item.id,
			title: item.title?.trim() || `Untitled ${item.kind}`,
			kind: item.kind,
			type: item.type,
			imageUrl: splitLegacyThumbnail(item.thumbnail).imageUrl,
			trackerCount: trackerCounts.get(item.id) ?? 0,
			viewerTracking: viewerTracking.get(item.id) ?? null,
			viewerReminder: viewerReminders.get(item.id) ?? null,
		}
		const occurrenceDates = new Set<string>()
		const mediaOccurrences = occurrencesByMedia.get(item.id) ?? []
		for (const occurrence of mediaOccurrences) {
			const release: NextRelease = {
				releaseAt: occurrence.releaseAt,
				allDay: occurrence.allDay,
				source: occurrence.source as NextRelease['source'],
				observedAt: occurrence.observedAt,
				episode: occurrence.episode,
				season: occurrence.season,
				chapter: occurrence.chapter,
				volume: occurrence.volume,
				name: occurrence.name,
			}
			const occurrenceDate = eventDateKey(
				occurrence.releaseAt,
				occurrence.allDay,
				timeZone,
			)
			if (
				isPlausibleNextRelease(release, item, now) &&
				dateIsInRange(occurrenceDate, startKey, endKey)
			) {
				occurrenceDates.add(occurrenceDate)
				items.push({
					...common,
					id: occurrence.id,
					releaseAt: occurrence.releaseAt,
					allDay: occurrence.allDay,
					eventType: ['episode', 'chapter', 'release'].includes(
						occurrence.eventType,
					)
						? (occurrence.eventType as 'episode' | 'chapter' | 'release')
						: 'release',
					eventLabel: nextReleaseLabel(release),
					eventName: occurrence.name,
				})
			}
		}
		const parsedNext =
			mediaOccurrences.length === 0
				? parseStoredNextRelease(item.nextRelease)
				: null
		const next =
			parsedNext && isPlausibleNextRelease(parsedNext, item, now)
				? parsedNext
				: null
		const nextDate = next
			? eventDateKey(next.releaseAt, next.allDay, timeZone)
			: null
		if (next && nextDate && dateIsInRange(nextDate, startKey, endKey)) {
			const eventType =
				next.chapter !== null
					? 'chapter'
					: next.episode !== null
						? 'episode'
						: 'release'
			items.push({
				...common,
				id: `${item.id}:next:${next.releaseAt.toISOString()}`,
				releaseAt: next.releaseAt,
				allDay: next.allDay,
				eventType,
				eventLabel: nextReleaseLabel(next),
				eventName: next.name,
			})
			occurrenceDates.add(nextDate)
		}
		const premiereAllDay = Boolean(
			item.releaseStart &&
			item.releaseStart.getUTCHours() === 0 &&
			item.releaseStart.getUTCMinutes() === 0 &&
			item.releaseStart.getUTCSeconds() === 0,
		)
		const premiereDate = item.releaseStart
			? eventDateKey(item.releaseStart, premiereAllDay, timeZone)
			: null
		if (
			item.releaseStart &&
			premiereDate &&
			dateIsInRange(premiereDate, startKey, endKey) &&
			!occurrenceDates.has(premiereDate)
		) {
			items.push({
				...common,
				id: `${item.id}:premiere:${item.releaseStart.toISOString()}`,
				releaseAt: item.releaseStart,
				allDay: premiereAllDay,
				eventType: 'premiere',
				eventLabel: 'Premiere',
				eventName: null,
			})
		}
	}

	items.sort(
		(left, right) =>
			left.releaseAt.getTime() - right.releaseAt.getTime() ||
			left.title.localeCompare(right.title) ||
			left.id.localeCompare(right.id),
	)

	return {
		filters,
		timeZone,
		start: dateKey(start),
		end: dateKey(addDays(start, spanDays - 1)),
		previousStart: dateKey(addDays(start, -spanDays)),
		nextStart: dateKey(end),
		todayStart: dateKey(startOfWeek(now, timeZone)),
		today: dateKeyInTimeZone(now, timeZone),
		isSignedIn: Boolean(viewerId),
		total: items.length,
		days: Array.from({ length: spanDays }, (_, index) => {
			const date = dateKey(addDays(start, index))
			const dayItems = items.filter(
				item => eventDateKey(item.releaseAt, item.allDay, timeZone) === date,
			)
			const limit = options.dayPreviewLimit
			const preview =
				limit && dayItems.length > limit
					? [...dayItems]
							.sort(dayPreviewPriority)
							.slice(0, limit)
							.sort(
								(left, right) =>
									left.releaseAt.getTime() - right.releaseAt.getTime() ||
									left.title.localeCompare(right.title) ||
									left.id.localeCompare(right.id),
							)
					: dayItems
			return { date, items: preview, totalCount: dayItems.length }
		}),
	}
}
