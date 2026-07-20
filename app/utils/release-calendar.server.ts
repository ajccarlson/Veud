import { type Prisma } from '@prisma/client'
import { prisma } from './db.server.ts'
import { splitLegacyThumbnail } from './media-detail.ts'

const DAY_MS = 24 * 60 * 60 * 1_000
const timeZoneDateFormatters = new Map<string, Intl.DateTimeFormat>()

export const releaseCalendarKinds = [
	'all',
	'movie',
	'tv',
	'anime',
	'manga',
] as const
export const releaseCalendarScopes = ['all', 'mine'] as const

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
}

function dateKey(date: Date) {
	return date.toISOString().slice(0, 10)
}

function parseDateKey(value: string | null) {
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
	const date = parseDateKey(dateKeyInTimeZone(now, timeZone)) ?? new Date()
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
			parseDateKey(searchParams.get('start')) ?? startOfWeek(now, timeZone),
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

type NextRelease = {
	releaseAt: Date
	allDay: boolean
	episode: number | null
	season: number | null
	chapter: number | null
	volume: number | null
	name: string | null
}

function finitePositiveNumber(value: unknown) {
	const number = Number(value)
	return Number.isFinite(number) && number > 0 ? number : null
}

export function parseStoredNextRelease(
	value: string | null,
): NextRelease | null {
	if (!value || value === 'null') return null
	try {
		const parsed = JSON.parse(value) as Record<string, unknown> | null
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
			return null
		const rawDate = parsed.releaseDate
		if (typeof rawDate !== 'string' && typeof rawDate !== 'number') {
			return null
		}
		const releaseAt = new Date(rawDate)
		if (Number.isNaN(releaseAt.getTime())) return null
		return {
			releaseAt,
			allDay:
				(typeof rawDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rawDate)) ||
				(releaseAt.getUTCHours() === 0 &&
					releaseAt.getUTCMinutes() === 0 &&
					releaseAt.getUTCSeconds() === 0),
			episode: finitePositiveNumber(parsed.episode),
			season: finitePositiveNumber(parsed.season),
			chapter: finitePositiveNumber(parsed.chapter),
			volume: finitePositiveNumber(parsed.volume),
			name:
				typeof parsed.name === 'string' && parsed.name.trim()
					? parsed.name.trim()
					: null,
		}
	} catch {
		return null
	}
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

/** Build a deterministic seven-day release schedule from the canonical catalog. */
export async function getReleaseCalendar(
	input: ReleaseCalendarQuery,
	viewerId: string | null,
	requestedTimeZone = 'UTC',
) {
	const timeZone = normalizeTimeZone(requestedTimeZone)
	const start = parseDateKey(input.start) ?? startOfWeek(new Date(), timeZone)
	const end = addDays(start, 7)
	const startKey = dateKey(start)
	const endKey = dateKey(end)
	const filters = {
		...input,
		start: dateKey(start),
		scope: input.scope === 'mine' && !viewerId ? ('all' as const) : input.scope,
	}
	const where = {
		AND: [
			...(filters.kind === 'all' ? [] : [{ kind: filters.kind }]),
			...(filters.scope === 'mine' && viewerId
				? [{ trackingStates: { some: { ownerId: viewerId } } }]
				: []),
			{
				OR: [
					{
						releaseStart: {
							gte: addDays(start, -1),
							lt: addDays(end, 1),
						},
					},
					{ nextRelease: { not: null } },
				],
			},
		],
	} satisfies Prisma.MediaWhereInput
	const media = await prisma.media.findMany({
		where,
		select: {
			id: true,
			kind: true,
			title: true,
			type: true,
			thumbnail: true,
			releaseStart: true,
			nextRelease: true,
			_count: { select: { trackingStates: true } },
		},
		orderBy: [{ title: 'asc' }, { id: 'asc' }],
	})
	const viewerRows =
		viewerId && media.length
			? await prisma.trackingState.findMany({
					where: {
						ownerId: viewerId,
						mediaId: { in: media.map(item => item.id) },
					},
					select: {
						mediaId: true,
						status: true,
						score: true,
						statusWatchlist: { select: { header: true } },
					},
				})
			: []
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
	const items: ReleaseCalendarItem[] = []

	for (const item of media) {
		const common = {
			mediaId: item.id,
			title: item.title?.trim() || `Untitled ${item.kind}`,
			kind: item.kind,
			type: item.type,
			imageUrl: splitLegacyThumbnail(item.thumbnail).imageUrl,
			trackerCount: item._count.trackingStates,
			viewerTracking: viewerTracking.get(item.id) ?? null,
		}
		const next = parseStoredNextRelease(item.nextRelease)
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
			(!nextDate || nextDate !== premiereDate)
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
		end: dateKey(addDays(start, 6)),
		previousStart: dateKey(addDays(start, -7)),
		nextStart: dateKey(end),
		todayStart: dateKey(startOfWeek(new Date(), timeZone)),
		today: dateKeyInTimeZone(new Date(), timeZone),
		isSignedIn: Boolean(viewerId),
		total: items.length,
		days: Array.from({ length: 7 }, (_, index) => {
			const date = dateKey(addDays(start, index))
			return {
				date,
				items: items.filter(
					item => eventDateKey(item.releaseAt, item.allDay, timeZone) === date,
				),
			}
		}),
	}
}
