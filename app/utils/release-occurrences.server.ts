import { type Prisma } from '@prisma/client'

const SCHEDULE_FRESHNESS_MS = 14 * 24 * 60 * 60 * 1_000
const MAX_PRISMA_INT = 2_147_483_647
const MIN_SUPPORTED_DATE_MS = -62_135_596_800_000
const MAX_SUPPORTED_DATE_MS = 253_402_300_799_999
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const UTC_TIMESTAMP_PATTERN =
	/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/
export const releaseScheduleSources = ['anilist', 'mal', 'tmdb'] as const

export type StoredNextRelease = {
	releaseAt: Date
	allDay: boolean
	source: (typeof releaseScheduleSources)[number] | null
	observedAt: Date | null
	episode: number | null
	season: number | null
	chapter: number | null
	volume: number | null
	name: string | null
}

function validCalendarParts(year: number, month: number, day: number) {
	if (year < 1 || year > 9_999 || month < 1 || month > 12 || day < 1) {
		return false
	}
	const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
	const daysInMonth = [
		31,
		leapYear ? 29 : 28,
		31,
		30,
		31,
		30,
		31,
		31,
		30,
		31,
		30,
		31,
	]
	return day <= (daysInMonth[month - 1] ?? 0)
}

function parseCanonicalReleaseDate(value: unknown) {
	if (typeof value === 'number') {
		if (
			!Number.isSafeInteger(value) ||
			value < MIN_SUPPORTED_DATE_MS ||
			value > MAX_SUPPORTED_DATE_MS
		) {
			return null
		}
		const date = new Date(value)
		return Number.isFinite(date.getTime())
			? { date, allDay: false as const }
			: null
	}
	if (typeof value !== 'string') return null
	const dateOnly = DATE_ONLY_PATTERN.exec(value)
	if (dateOnly) {
		const [, year, month, day] = dateOnly.map(Number)
		if (!validCalendarParts(year!, month!, day!)) return null
		return { date: new Date(`${value}T00:00:00.000Z`), allDay: true as const }
	}
	const timestamp = UTC_TIMESTAMP_PATTERN.exec(value)
	if (!timestamp) return null
	const [, year, month, day, hour, minute, second] = timestamp.map(Number)
	if (
		!validCalendarParts(year!, month!, day!) ||
		hour! > 23 ||
		minute! > 59 ||
		second! > 59
	) {
		return null
	}
	const date = new Date(value)
	return Number.isFinite(date.getTime())
		? { date, allDay: false as const }
		: null
}

function parseCanonicalObservedAt(value: unknown) {
	if (typeof value !== 'string' || !UTC_TIMESTAMP_PATTERN.test(value)) {
		return null
	}
	return parseCanonicalReleaseDate(value)?.date ?? null
}

function positivePrismaInt(value: unknown) {
	return typeof value === 'number' &&
		Number.isSafeInteger(value) &&
		value > 0 &&
		value <= MAX_PRISMA_INT
		? value
		: null
}

/**
 * Parse the legacy provider payload once for every mirror, occurrence, and
 * calendar consumer. Invalid JSON, non-object JSON, invalid dates, and
 * incomplete source/observation pairs are deliberately treated as no schedule.
 */
export function parseStoredNextRelease(
	value: unknown,
): StoredNextRelease | null {
	if (typeof value !== 'string' || !value || value === 'null') return null
	try {
		const parsed = JSON.parse(value) as Record<string, unknown> | null
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			return null
		}
		const rawDate = parsed.releaseDate
		const release = parseCanonicalReleaseDate(rawDate)
		if (!release) return null

		const hasSource = Object.prototype.hasOwnProperty.call(parsed, 'source')
		const hasObservedAt = Object.prototype.hasOwnProperty.call(
			parsed,
			'observedAt',
		)
		if (hasSource !== hasObservedAt) return null

		let source: StoredNextRelease['source'] = null
		let observedAt: Date | null = null
		if (hasSource) {
			if (
				typeof parsed.source !== 'string' ||
				!releaseScheduleSources.includes(parsed.source as never) ||
				typeof parsed.observedAt !== 'string'
			) {
				return null
			}
			source = parsed.source as NonNullable<StoredNextRelease['source']>
			observedAt = parseCanonicalObservedAt(parsed.observedAt)
			if (!observedAt) return null
		}

		return {
			releaseAt: release.date,
			allDay: release.allDay,
			source,
			observedAt,
			episode: positivePrismaInt(parsed.episode),
			season: positivePrismaInt(parsed.season),
			chapter: positivePrismaInt(parsed.chapter),
			volume: positivePrismaInt(parsed.volume),
			name:
				typeof parsed.name === 'string' && parsed.name.trim()
					? parsed.name.trim()
					: null,
		}
	} catch {
		return null
	}
}

export function deriveNextReleaseAt(value: unknown) {
	return parseStoredNextRelease(value)?.releaseAt ?? null
}

export function deriveNextReleaseOccurrence(value: unknown) {
	const release = parseStoredNextRelease(value)
	if (!release?.source || !release.observedAt) return null
	const expiresAt = new Date(
		release.observedAt.getTime() + SCHEDULE_FRESHNESS_MS,
	)
	if (
		!Number.isFinite(expiresAt.getTime()) ||
		expiresAt.getUTCFullYear() > 9_999
	) {
		return null
	}

	const eventType =
		release.chapter !== null
			? 'chapter'
			: release.episode !== null
				? 'episode'
				: 'release'
	const integer = (number: number | null) =>
		number === null ? null : Math.max(1, Math.trunc(number))
	return {
		source: release.source,
		sourceKey: 'next',
		eventType,
		releaseAt: release.releaseAt,
		allDay: release.allDay,
		season: integer(release.season),
		episode: integer(release.episode),
		volume: integer(release.volume),
		chapter: integer(release.chapter),
		name: release.name,
		status: 'scheduled',
		observedAt: release.observedAt,
		expiresAt,
	} as const
}

/**
 * Mirror a provider's authoritative next-release payload into a queryable
 * occurrence. This remains inside the same catalog transaction as Media so a
 * cleared or rescheduled provider response cannot leave a stale calendar row.
 */
export async function syncNextReleaseOccurrence(
	tx: Prisma.TransactionClient,
	mediaId: string,
	value: unknown,
) {
	const occurrence = deriveNextReleaseOccurrence(value)
	const staleSources = releaseScheduleSources.filter(
		source => source !== occurrence?.source,
	)
	if (staleSources.length) {
		await tx.releaseOccurrence.deleteMany({
			where: {
				mediaId,
				sourceKey: 'next',
				source: { in: [...staleSources] },
			},
		})
	}
	if (!occurrence) return

	await tx.releaseOccurrence.upsert({
		where: {
			mediaId_source_sourceKey: {
				mediaId,
				source: occurrence.source,
				sourceKey: 'next',
			},
		},
		create: {
			mediaId,
			...occurrence,
		},
		update: {
			...occurrence,
		},
	})
}
