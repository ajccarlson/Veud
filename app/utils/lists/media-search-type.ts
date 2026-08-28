/**
 * The search type that means "do not narrow".
 *
 * It maps to TMDB's `multi` endpoint, the only one that returns films and
 * series together. Narrowing to Movie or TV Series searches that endpoint
 * alone, so a film sharing a name with a series becomes unreachable until the
 * viewer widens again.
 *
 * It lives in its own module rather than beside the search component because
 * the watchlist state hook needs it, and that hook is loaded eagerly while the
 * search component is deliberately deferred — a mobile list must not pay for
 * the catalog search it never opens.
 */
export const ALL_MEDIA_TYPES = 'All types'
