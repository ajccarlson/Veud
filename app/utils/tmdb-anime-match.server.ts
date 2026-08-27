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

/**
 * The provider slug for anime that were searched and could not be resolved.
 *
 * Without this the worker stalls. Candidates are "tracked anime with no
 * mapping", so a refusal leaves the anime in that set permanently and every run
 * searches it again. Refusals are the common case — roughly two in three, since
 * TMDB has no entry for a season or a recap — so the refused pile grows until it
 * fills the per-run limit and the worker never reaches an anime it could have
 * resolved. Recording the refusal keeps the queue moving.
 */
export const TMDB_WATCH_UNRESOLVED_PROVIDER_KEY = 'tmdb-watch-unresolved'

/**
 * How long a refusal stands before the anime is searched again.
 *
 * TMDB is edited continuously, so a refusal is a statement about today, not
 * forever — but re-searching sooner spends requests on titles that mostly still
 * will not resolve.
 */
export const UNRESOLVED_RETRY_DAYS = 30

/** When a refusal recorded now should be reconsidered. */
export function unresolvedRetryAfter(now: Date) {
	return new Date(now.getTime() + UNRESOLVED_RETRY_DAYS * 24 * 60 * 60 * 1_000)
}

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

/**
 * Which anime this resolver considers.
 *
 * `tracked` is the original scope: anime somebody has on a list. It is the
 * right default for a daily worker because a mapping only earns its keep when
 * someone is looking at the title.
 *
 * `all` widens to the whole anime catalog. That is what overlap detection needs
 * — an anime nobody tracks can still be a duplicate of a live-action row — but
 * it is a much larger queue, so the ordering below matters more than the scope
 * does.
 */
export const ANIME_MATCH_SCOPES = ['tracked', 'all'] as const
export type AnimeMatchScope = (typeof ANIME_MATCH_SCOPES)[number]

export function normalizeAnimeMatchScope(value: unknown): AnimeMatchScope {
	return ANIME_MATCH_SCOPES.includes(value as AnimeMatchScope)
		? (value as AnimeMatchScope)
		: 'tracked'
}

/**
 * The rows still worth searching for.
 *
 * A mapping does not go stale — it identifies a work, not a fact about it — but
 * a refusal does, so a refusal is reconsidered once it expires.
 */
export function animeMatchCandidateWhere(input: {
	now: Date
	trackedProviderKey: string
	unresolvedProviderKey: string
	scope: AnimeMatchScope
}) {
	return {
		kind: 'anime',
		// Widening drops this clause and nothing else, so the two scopes cannot
		// disagree about what "already mapped" means.
		...(input.scope === 'tracked' ? { trackingStates: { some: {} } } : {}),
		externalIds: {
			none: {
				OR: [
					{ provider: input.trackedProviderKey, tombstonedAt: null },
					{
						provider: input.unresolvedProviderKey,
						tombstonedAt: null,
						refreshAfter: { gt: input.now },
					},
				],
			},
		},
	}
}
