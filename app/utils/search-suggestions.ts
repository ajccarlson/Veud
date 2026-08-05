/**
 * Live suggestions under the site search bar.
 *
 * The rules here are shared by the client that asks and the route that answers,
 * so the two cannot disagree about what counts as a query worth running or how
 * many results come back.
 */

/**
 * Eight is what fits under the bar without covering the page, and it is what a
 * reader will actually scan. A longer list is not a better one — anything past
 * the eighth row is reached faster by pressing Enter and using the full results
 * page, which is one keystroke away.
 */
export const SUGGESTION_LIMIT = 8

/**
 * A single letter matches most of the catalog, so the request would be paid for
 * on every keystroke and return nothing worth reading. Two is where a query
 * starts to mean something.
 */
export const MIN_SUGGESTION_QUERY = 2

/** Long enough for any real title; the input allows more for other modes. */
const MAX_SUGGESTION_QUERY = 100

export const SUGGESTION_KINDS = [
	'all',
	'movie',
	'tv',
	'anime',
	'manga',
] as const
export type SuggestionKind = (typeof SUGGESTION_KINDS)[number]

export type SearchSuggestion = {
	id: string
	title: string
	kind: string
	type: string | null
	year: string | null
	thumbnail: string | null
}

/**
 * The query to actually run, or null when there is nothing worth asking for.
 *
 * Returning null rather than an empty string keeps the caller from having to
 * decide again: a query that is too short and a query that is only whitespace
 * are the same thing here.
 */
export function normalizeSuggestionQuery(raw: unknown) {
	if (typeof raw !== 'string') return null
	const collapsed = raw.replace(/\s+/g, ' ').trim()
	if (collapsed.length < MIN_SUGGESTION_QUERY) return null
	return collapsed.slice(0, MAX_SUGGESTION_QUERY)
}

/** Keep an unknown media kind from narrowing the search to nothing. */
export function normalizeSuggestionKind(raw: unknown): SuggestionKind {
	return SUGGESTION_KINDS.includes(raw as SuggestionKind)
		? (raw as SuggestionKind)
		: 'all'
}

/**
 * Nobody but this module decides how many rows come back.
 *
 * An absent limit means the default, and absent has three spellings here: a
 * query string that omits it reads as `null`, one that leaves it blank reads as
 * `''`, and a caller that passes nothing reads as `undefined`. `Number()` turns
 * the first two into 0, which would clamp to a single row — the request would
 * still succeed and still look like a working search bar.
 */
export function clampSuggestionLimit(raw: unknown) {
	if (raw === null || raw === undefined || raw === '') return SUGGESTION_LIMIT
	const value = Number(raw)
	if (!Number.isFinite(value)) return SUGGESTION_LIMIT
	return Math.min(Math.max(Math.trunc(value), 1), SUGGESTION_LIMIT)
}

/**
 * Where the arrow keys move next.
 *
 * -1 means "no row is active, the typed text stands". Arrowing down from there
 * reaches the first row, and arrowing up from the first row returns to the
 * typed text rather than jumping to the end, so the text someone typed is never
 * more than one key away.
 */
export function moveSuggestionIndex(
	current: number,
	count: number,
	direction: 1 | -1,
) {
	if (count < 1) return -1
	const next = current + direction
	if (next < -1) return count - 1
	if (next >= count) return -1
	return next
}

/** The page a suggestion opens. */
export function suggestionHref(suggestion: { id: string }) {
	return `/media/${encodeURIComponent(suggestion.id)}`
}

/** The full results page for what was typed, which is always the last row. */
export function allResultsHref(query: string, kind: SuggestionKind) {
	const params = new URLSearchParams({ q: query })
	if (kind !== 'all') params.set('kind', kind)
	return `/discover?${params.toString()}`
}

/** A short line under the title: what it is, and when it came out. */
export function suggestionMeta(suggestion: SearchSuggestion) {
	return [suggestion.type || suggestion.kind, suggestion.year]
		.filter(Boolean)
		.join(' · ')
}
