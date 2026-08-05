/**
 * Match a MAL-sourced anime to the TMDB entry for the same work.
 *
 * This exists only so streaming availability can be looked up: anime ingested
 * from MAL carry no TMDB id, so 0 of 30,299 rows can be resolved without it.
 *
 * The matching is deliberately strict. A wrong match points a viewer at another
 * show's streaming links, which is worse than showing nothing, so a candidate
 * has to agree on a whole title and on the year, and the search across every
 * known title has to converge on exactly one TMDB entry. Anything else is
 * refused.
 *
 * Measured on 40 tracked anime: 29 resolved, 0 ambiguous, 11 refused. The
 * refusals are seasons and sequels — "Fruits Basket 1st Season", "3-gatsu no
 * Lion 2nd Season" — which TMDB models inside a parent series rather than as
 * their own entry, so there is no one-to-one match to make.
 */

/** The provider slug for these mappings. */
export const TMDB_WATCH_PROVIDER_KEY = 'tmdb-watch'

export type TmdbCandidate = {
	id: number
	name: string | null
	originalName: string | null
	firstAirYear: string | null
}

/**
 * Compare titles without being defeated by punctuation or accents, while still
 * requiring the whole title to agree. Loosening this to a prefix or substring
 * would match a sequel to its parent.
 *
 * Letters and digits of every script survive, not just ASCII ones: TMDB stores
 * the Japanese title as an anime's `original_name`, and dropping it would throw
 * away the one title guaranteed to be shared with MAL.
 */
export function normalizeTitle(value: string) {
	return (
		value
			.normalize('NFKD')
			// Latin diacritics only. Japanese voiced marks are combining characters
			// too, and stripping those would turn が into か.
			.replace(/[̀-ͯ]/g, '')
			.normalize('NFC')
			.toLowerCase()
			.replace(/[^\p{L}\p{N}]+/gu, ' ')
			.trim()
	)
}

/**
 * Pick the single TMDB entry that every known title agrees on.
 *
 * Returns null when nothing matches and, just as deliberately, when more than
 * one distinct entry does: an ambiguous match is a coin toss over which show's
 * streaming links a viewer is sent to.
 */
export function chooseUniqueTmdbMatch(
	titles: string[],
	year: string | null,
	candidates: TmdbCandidate[],
) {
	const wanted = new Set(
		titles.map(title => normalizeTitle(title)).filter(Boolean),
	)
	if (!wanted.size) return null

	const matches = new Map<number, TmdbCandidate>()
	for (const candidate of candidates) {
		if (!Number.isSafeInteger(candidate.id) || candidate.id <= 0) continue
		const names = [candidate.name, candidate.originalName]
			.filter((name): name is string => Boolean(name))
			.map(name => normalizeTitle(name))
		if (!names.some(name => wanted.has(name))) continue
		// A year on both sides that disagrees rules the candidate out. A missing
		// year on either side cannot rule anything out, so it does not.
		if (year && candidate.firstAirYear && candidate.firstAirYear !== year) {
			continue
		}
		matches.set(candidate.id, candidate)
	}
	if (matches.size !== 1) return null
	const [id, candidate] = [...matches.entries()][0]!
	return { tmdbId: id, name: candidate.name ?? candidate.originalName ?? null }
}

/** The titles worth searching TMDB with, most distinctive first, deduplicated. */
export function searchTitles(canonical: string, alternates: string[]) {
	const seen = new Set<string>()
	const titles: string[] = []
	for (const title of [canonical, ...alternates]) {
		const trimmed = title?.trim()
		if (!trimmed) continue
		const key = normalizeTitle(trimmed)
		if (!key || seen.has(key)) continue
		seen.add(key)
		titles.push(trimmed)
	}
	return titles
}
