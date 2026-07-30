/**
 * MangaUpdates chapter release ingestion.
 *
 * MangaUpdates records releases *after* they happen: `/v1/releases/search`
 * returns a dated log of chapters that have shipped, and the series endpoint
 * exposes `latest_chapter` but no forward schedule. There is therefore no
 * upcoming-chapter date to ingest from this provider, and none is invented here.
 * What this produces is a factual record of chapters that have been released.
 */

const RELEASES_ENDPOINT = 'https://api.mangaupdates.com/v1/releases/search'
const SERIES_SEARCH_ENDPOINT = 'https://api.mangaupdates.com/v1/series/search'
export const MANGAUPDATES_SOURCE = 'mangaupdates'
export const MANGAUPDATES_PROVIDER = 'mangaupdates'
/** A released chapter stays on the calendar for this long before it expires. */
const RELEASE_VISIBILITY_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1_000
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

export type MangaUpdatesRelease = {
	sourceKey: string
	releaseAt: Date
	chapter: number | null
	volume: number | null
	name: string | null
}

function optionalString(value: unknown) {
	return typeof value === 'string' && value.trim() ? value.trim() : null
}

/**
 * MangaUpdates reports chapter and volume as strings, and they are not always
 * plain integers: ranges (`"12-13"`), decimals (`"12.5"`) and prefixes (`"c.12"`)
 * all occur. Take the leading integer and ignore anything that has none, rather
 * than coercing a range into a misleading single number.
 */
export function parseReleaseNumber(value: unknown) {
	const raw = optionalString(value)
	if (!raw) return null
	const match = /^[^0-9]*(\d+)/.exec(raw)
	if (!match) return null
	const parsed = Number(match[1])
	return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 2_147_483_647
		? parsed
		: null
}

/**
 * Normalise one release record. Anything without a usable date is dropped: a
 * release with no date cannot be placed on a calendar, and guessing one would
 * put fiction in front of the reader.
 */
export function normalizeMangaUpdatesRelease(
	value: unknown,
): MangaUpdatesRelease | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null
	const record = (value as { record?: unknown }).record ?? value
	if (!record || typeof record !== 'object' || Array.isArray(record))
		return null
	const fields = record as Record<string, unknown>

	const releaseDate = optionalString(fields.release_date)
	if (!releaseDate || !DATE_ONLY.test(releaseDate)) return null
	const releaseAt = new Date(`${releaseDate}T00:00:00.000Z`)
	if (!Number.isFinite(releaseAt.getTime())) return null

	const id = fields.id
	const sourceKey =
		typeof id === 'number' && Number.isSafeInteger(id)
			? `release:${id}`
			: typeof id === 'string' && id.trim()
				? `release:${id.trim()}`
				: null
	if (!sourceKey) return null

	const chapter = parseReleaseNumber(fields.chapter)
	const volume = parseReleaseNumber(fields.volume)
	// A record that identifies neither a chapter nor a volume says nothing useful.
	if (chapter === null && volume === null) return null

	return {
		sourceKey,
		releaseAt,
		chapter,
		volume,
		name: optionalString(fields.title),
	}
}

/** Shape a normalised release into a `ReleaseOccurrence` row. */
export function releaseOccurrenceInput(
	release: MangaUpdatesRelease,
	observedAt: Date,
) {
	const expiresAt = new Date(
		release.releaseAt.getTime() + RELEASE_VISIBILITY_DAYS * DAY_MS,
	)
	return {
		source: MANGAUPDATES_SOURCE,
		sourceKey: release.sourceKey,
		// The calendar styles chapter events distinctly; a volume-only record is
		// still a chapter-shaped event for a reader.
		eventType: 'chapter' as const,
		releaseAt: release.releaseAt,
		// MangaUpdates records a date with no time of day.
		allDay: true,
		season: null,
		episode: null,
		volume: release.volume,
		chapter: release.chapter,
		name: release.name,
		status: 'scheduled' as const,
		observedAt,
		expiresAt,
	}
}

export type MangaUpdatesFetch = (
	url: string,
	init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>

function requireApproval(approvalRef: string | undefined) {
	const ref = optionalString(approvalRef)
	if (!ref) {
		throw new Error(
			'MANGAUPDATES_CATALOG_POLICY_APPROVAL_REF or --policy-approval-ref is required for committed MangaUpdates jobs',
		)
	}
	return ref
}

async function postJson(
	fetchImpl: MangaUpdatesFetch,
	url: string,
	body: unknown,
) {
	const response = await fetchImpl(url, {
		method: 'POST',
		headers: { 'content-type': 'application/json', accept: 'application/json' },
		body: JSON.stringify(body),
	})
	if (!response.ok) {
		throw new Error(
			`MangaUpdates request failed with status ${response.status}`,
		)
	}
	return response.json()
}

function resultRecords(payload: unknown) {
	if (!payload || typeof payload !== 'object') return []
	const results = (payload as { results?: unknown }).results
	return Array.isArray(results) ? results : []
}

/** Look up a series id by title. Only an exact, case-insensitive match counts. */
export async function findMangaUpdatesSeriesId(
	fetchImpl: MangaUpdatesFetch,
	title: string,
	options: { approvalRef?: string } = {},
) {
	requireApproval(options.approvalRef)
	const wanted = title.trim().toLowerCase()
	if (!wanted) return null
	const payload = await postJson(fetchImpl, SERIES_SEARCH_ENDPOINT, {
		search: title,
		perpage: 10,
	})
	for (const entry of resultRecords(payload)) {
		const record = (entry as { record?: unknown }).record
		if (!record || typeof record !== 'object') continue
		const fields = record as Record<string, unknown>
		const candidate = optionalString(fields.title)?.toLowerCase()
		const seriesId = fields.series_id
		if (
			candidate === wanted &&
			typeof seriesId === 'number' &&
			Number.isSafeInteger(seriesId)
		) {
			return seriesId
		}
	}
	// A fuzzy match would attach one series' chapters to another title, which is
	// worse than having no schedule at all.
	return null
}

/** Fetch recent releases for one series, newest first. */
export async function fetchMangaUpdatesReleases(
	fetchImpl: MangaUpdatesFetch,
	seriesId: number,
	options: { approvalRef?: string; perPage?: number } = {},
) {
	requireApproval(options.approvalRef)
	const payload = await postJson(fetchImpl, RELEASES_ENDPOINT, {
		search: '',
		series_id: seriesId,
		perpage: options.perPage ?? 25,
		orderby: 'date',
	})
	const releases: MangaUpdatesRelease[] = []
	const seen = new Set<string>()
	for (const entry of resultRecords(payload)) {
		const release = normalizeMangaUpdatesRelease(entry)
		if (!release || seen.has(release.sourceKey)) continue
		seen.add(release.sourceKey)
		releases.push(release)
	}
	return releases
}
