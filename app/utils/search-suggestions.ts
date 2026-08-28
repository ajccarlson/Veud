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
 * One or two characters match too much of the catalog, and PostgreSQL's
 * trigram indexes cannot serve a two-character contains search. Three keeps
 * live, unauthenticated suggestions on an index-capable path. The form still
 * submits shorter title searches to the full results page.
 */
export const MIN_SUGGESTION_QUERY = 3

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

type SearchSuggestionBase = {
	id: string
	label: string
	thumbnail: string | null
}

export type MediaSearchSuggestion = SearchSuggestionBase & {
	resultType: 'media'
	title: string
	kind: string
	type: string | null
	year: string | null
}

export type PersonSearchSuggestion = SearchSuggestionBase & {
	resultType: 'person'
	name: string
	knownForDepartment: string | null
	creditCount: number
}

export type SearchSuggestion = MediaSearchSuggestion | PersonSearchSuggestion

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

/**
 * Put visible labels that actually begin with what was typed at the top.
 *
 * Popularity alone is not enough. Matching is substring-based, so a well-known
 * title that merely *contains* the query inside a longer word outranks the one
 * someone is typing: searching "frieren" offers the 1998 film *Savior*, because
 * it carries the alternate title "Befrieren".
 *
 * Three tiers, each ordered by whatever order the caller supplied — popularity:
 * titles that start with the query, then titles where it starts a word, then
 * everything else, which is interior matches and titles found only through an
 * alternate. Nothing is dropped; it is only moved down.
 */
export function rankSuggestions<Item extends { label: string }>(
	items: Item[],
	query: string,
) {
	const needle = query.trim().toLowerCase()
	if (!needle) return [...items]
	const tierOf = (item: Item) => {
		const label = item.label.toLowerCase()
		if (label.startsWith(needle)) return 0
		const at = label.indexOf(needle)
		if (at < 0) return 2
		// A word boundary is what makes "piece" find "One Piece" without putting
		// it level with a match buried inside a longer word.
		return /[^\p{L}\p{N}]/u.test(label[at - 1] ?? '') ? 1 : 2
	}
	return items
		.map((item, index) => ({ item, index, tier: tierOf(item) }))
		.sort(
			(first, second) => first.tier - second.tier || first.index - second.index,
		)
		.map(entry => entry.item)
}

/** The page a suggestion opens. */
export function suggestionHref(
	suggestion: Pick<SearchSuggestion, 'id' | 'resultType'>,
) {
	const path = suggestion.resultType === 'person' ? 'people' : 'media'
	return `/${path}/${encodeURIComponent(suggestion.id)}`
}

/** The full results page for what was typed, which is always the last row. */
export function allResultsHref(query: string, kind: SuggestionKind) {
	const params = new URLSearchParams({ q: query })
	if (kind !== 'all') params.set('kind', kind)
	return `/discover?${params.toString()}`
}

/** A short line under the title: what it is, and when it came out. */
export function suggestionMeta(suggestion: SearchSuggestion) {
	if (suggestion.resultType === 'person') {
		const credits = `${suggestion.creditCount} ${suggestion.creditCount === 1 ? 'credit' : 'credits'}`
		return [suggestion.knownForDepartment, credits].filter(Boolean).join(' · ')
	}
	return [suggestion.type || suggestion.kind, suggestion.year]
		.filter(Boolean)
		.join(' · ')
}
