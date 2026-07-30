import { Prisma } from '@prisma/client'
import { normalizeCatalogTitle } from './catalog-sync.server.ts'
import { prisma } from './db.server.ts'
import {
	escapeSqlLikeLiteral,
	isPostgresDatasource,
} from './prisma-search.server.ts'

/**
 * Relation-free catalog candidate repository.
 *
 * Tip of My Tongue used to fan out one query per search term and per AI
 * hypothesis, so its database work grew with prompt length rather than staying
 * fixed. Every lookup here is bounded by an explicit budget and issues one
 * candidate-identifier query plus one logical hydration read, whatever the
 * caller supplies. The hydration read is two SQL statements because candidates
 * include their alternate titles relation. SQL construction and those budgets
 * stay in this module so the ranking and presentation code has no reason to
 * build predicates.
 */

/** Hydrated candidate ceiling shared by local and AI resolution. */
export const MAX_CATALOG_CANDIDATES = 72
/** Distinct lexical terms accepted from member text (matches prior ranking). */
export const MAX_LEXICAL_TERMS = 16
/** Normalized exact titles accepted from a whole AI response. */
export const MAX_SUGGESTION_EXACT_TITLES = 10
/** Lexical title terms accepted from a whole AI response. */
export const MAX_SUGGESTION_TITLE_TERMS = 40
/** AI hypotheses resolved by one batched lookup. */
const MAX_SUGGESTION_HYPOTHESES = 5
/** Popularity rows folded into the local candidate union. */
const POPULAR_CANDIDATE_LIMIT = 24
/** Shortest term allowed to widen a search. */
const MIN_TERM_LENGTH = 3

const STOP_WORDS = new Set([
	'about',
	'and',
	'after',
	'again',
	'also',
	'any',
	'because',
	'before',
	'but',
	'could',
	'didn',
	'does',
	'for',
	'from',
	'had',
	'has',
	'have',
	'her',
	'him',
	'his',
	'into',
	'just',
	'like',
	'movie',
	'not',
	'our',
	'out',
	'remember',
	'scene',
	'show',
	'some',
	'something',
	'than',
	'that',
	'the',
	'there',
	'they',
	'this',
	'was',
	'were',
	'what',
	'where',
	'which',
	'who',
	'why',
	'with',
	'woman',
	'would',
	'you',
	'your',
])

export const catalogCandidateSelect = {
	id: true,
	title: true,
	kind: true,
	type: true,
	genres: true,
	description: true,
	releaseStart: true,
	startYear: true,
	airYear: true,
	catalogPopularity: true,
	titles: {
		select: {
			value: true,
			normalized: true,
		},
	},
} satisfies Prisma.MediaSelect

export type CatalogCandidate = Prisma.MediaGetPayload<{
	select: typeof catalogCandidateSelect
}>

/**
 * Rank lexical terms from free text, keeping repetition and prompt length from
 * widening the query. Terms are normalized once, deduplicated, and capped.
 */
export function lexicalTerms(text: string, limit = MAX_LEXICAL_TERMS) {
	const counts = new Map<string, number>()
	for (const word of normalizeCatalogTitle(text).match(/[a-z0-9]+/g) ?? []) {
		if (word.length < MIN_TERM_LENGTH || STOP_WORDS.has(word)) continue
		counts.set(word, (counts.get(word) ?? 0) + 1)
	}
	return [...counts.entries()]
		.sort(
			(left, right) => right[1] - left[1] || right[0].length - left[0].length,
		)
		.slice(0, Math.max(0, limit))
		.map(([word]) => word)
}

/**
 * Combine a primary prompt with expansion text under one shared budget, so an
 * AI response cannot multiply the term count.
 */
export function combinedLexicalTerms(
	text: string,
	expansions: string[] = [],
	limit = MAX_LEXICAL_TERMS,
) {
	const primary = lexicalTerms(text, limit)
	if (primary.length >= limit) return primary
	const seen = new Set(primary)
	const expanded = lexicalTerms(expansions.join(' '), limit)
	for (const term of expanded) {
		if (primary.length >= limit) break
		if (seen.has(term)) continue
		seen.add(term)
		primary.push(term)
	}
	return primary
}

/**
 * Build a contains pattern whose wildcards stay literal search text. The
 * predicate must declare `ESCAPE '!'` to match.
 */
export function containsPattern(term: string) {
	return `%${escapeSqlLikeLiteral(term)}%`
}

/**
 * Case-insensitive contains predicate that stays visible to the trigram
 * indexes.
 *
 * The PostgreSQL GIN indexes are declared on the raw `title`, `description`,
 * and `MediaTitle.normalized` columns, so wrapping a column in `LOWER(...)`
 * hides them from the planner and forces a sequential scan. PostgreSQL's
 * `ILIKE` works directly against `gin_trgm_ops`; SQLite's `LIKE` is already
 * case-insensitive for ASCII, so the same shape is correct on both engines.
 */
function likeCondition(
	column: Prisma.Sql,
	literal: string,
	databaseUrl = process.env.DATABASE_URL,
) {
	return isPostgresDatasource(databaseUrl)
		? Prisma.sql`${column} ILIKE ${literal} ESCAPE '!'`
		: Prisma.sql`${column} LIKE ${literal} ESCAPE '!'`
}

/** Case-insensitive contains match against an already-built pattern. */
function containsCondition(
	column: Prisma.Sql,
	pattern: string,
	databaseUrl = process.env.DATABASE_URL,
) {
	return likeCondition(column, pattern, databaseUrl)
}

/**
 * Case-insensitive equality against a raw value. Escaping happens here so a
 * caller cannot accidentally turn an equality into a contains scan; a
 * wildcard-free LIKE/ILIKE literal is still an equality, and expressing it this
 * way is what keeps it visible to the trigram indexes.
 */
function equalsCondition(
	column: Prisma.Sql,
	value: string,
	databaseUrl = process.env.DATABASE_URL,
) {
	return likeCondition(column, escapeSqlLikeLiteral(value), databaseUrl)
}

function kindCondition(kind: string) {
	return kind === 'all'
		? Prisma.empty
		: Prisma.sql`AND "Media"."kind" = ${kind}`
}

type CandidateIdRow = { id: string; source_rank: number; popularity: number }
type SuggestionCandidateIdRow = CandidateIdRow & { slot: number }

/**
 * One query returning the ordered candidate identifiers for member text.
 *
 * Branches are unioned rather than OR-ed so each stays independently
 * plan-visible, and a popularity branch keeps the result non-empty without a
 * second round trip. Serialized genres are deliberately excluded: that column
 * has no suitable index and must never lead candidate generation. Genre text
 * remains a ranking signal after hydration.
 */
export async function findCatalogCandidateIds({
	kind,
	terms,
	limit = MAX_CATALOG_CANDIDATES,
	popularLimit = POPULAR_CANDIDATE_LIMIT,
	databaseUrl = process.env.DATABASE_URL,
}: {
	kind: string
	terms: string[]
	limit?: number
	popularLimit?: number
	databaseUrl?: string
}) {
	const boundedTerms = terms.slice(0, MAX_LEXICAL_TERMS)
	const boundedLimit = Math.max(0, Math.min(limit, MAX_CATALOG_CANDIDATES))
	if (!boundedLimit) return []
	const filter = kindCondition(kind)
	const branches: Prisma.Sql[] = []
	for (const term of boundedTerms) {
		const pattern = containsPattern(term)
		branches.push(Prisma.sql`
			SELECT "Media"."id" AS id, 0 AS source_rank,
				COALESCE("Media"."catalogPopularity", 0) AS popularity
			FROM "Media"
			WHERE "Media"."title" IS NOT NULL
			${filter}
			AND ${containsCondition(Prisma.sql`"Media"."title"`, pattern, databaseUrl)}
		`)
		branches.push(Prisma.sql`
			SELECT "Media"."id" AS id, 1 AS source_rank,
				COALESCE("Media"."catalogPopularity", 0) AS popularity
			FROM "Media"
			JOIN "MediaTitle" ON "MediaTitle"."mediaId" = "Media"."id"
			WHERE "Media"."title" IS NOT NULL
			${filter}
			AND ${containsCondition(
				Prisma.sql`"MediaTitle"."normalized"`,
				pattern,
				databaseUrl,
			)}
		`)
		branches.push(Prisma.sql`
			SELECT "Media"."id" AS id, 2 AS source_rank,
				COALESCE("Media"."catalogPopularity", 0) AS popularity
			FROM "Media"
			WHERE "Media"."title" IS NOT NULL
			${filter}
			AND ${containsCondition(
				Prisma.sql`"Media"."description"`,
				pattern,
				databaseUrl,
			)}
		`)
	}
	if (popularLimit > 0) {
		// ORDER BY/LIMIT cannot appear directly in a UNION ALL member, so the
		// popularity branch is bounded inside its own subquery.
		branches.push(Prisma.sql`
			SELECT popular.id AS id, 3 AS source_rank, popular.popularity AS popularity
			FROM (
				SELECT "Media"."id" AS id,
					COALESCE("Media"."catalogPopularity", 0) AS popularity
				FROM "Media"
				WHERE "Media"."title" IS NOT NULL
				${filter}
				ORDER BY COALESCE("Media"."catalogPopularity", 0) DESC,
					"Media"."title" ASC
				LIMIT ${popularLimit}
			) AS popular
		`)
	}
	if (!branches.length) return []
	const rows = await prisma.$queryRaw<CandidateIdRow[]>(Prisma.sql`
		WITH matched AS (
			${Prisma.join(branches, ' UNION ALL ')}
		)
		SELECT matched.id AS id,
			MIN(matched.source_rank) AS source_rank,
			MAX(matched.popularity) AS popularity
		FROM matched
		GROUP BY matched.id
		ORDER BY source_rank ASC, popularity DESC, id ASC
		LIMIT ${boundedLimit}
	`)
	return rows.map(row => row.id)
}

/**
 * One query returning ordered candidate identifiers for every AI hypothesis at
 * once, replacing a per-suggestion lookup.
 */
/**
 * A single AI hypothesis reduced to the exact lookup keys it needs.
 */
export type SuggestionCandidateSpec = {
	kind: string
	exactTitles: string[]
	titleTerms: string[]
}

/**
 * One query returning ordered candidate identifiers for every AI hypothesis.
 *
 * Each hypothesis gets its own guaranteed slice of the candidate budget. A
 * shared pool would let one popular hypothesis consume every slot and starve
 * the other four, so branches are tagged with their hypothesis and ranked
 * within it before the union is capped.
 */
export async function findSuggestionCandidateIds({
	suggestions,
	limit = MAX_CATALOG_CANDIDATES,
	databaseUrl = process.env.DATABASE_URL,
}: {
	suggestions: SuggestionCandidateSpec[]
	limit?: number
	databaseUrl?: string
}) {
	const boundedSuggestions = suggestions.slice(0, MAX_SUGGESTION_HYPOTHESES)
	const boundedLimit = Math.max(0, Math.min(limit, MAX_CATALOG_CANDIDATES))
	if (!boundedLimit || !boundedSuggestions.length) return []
	// Allocate the shared title and term budgets from actual demand: give every
	// hypothesis an equal floor, then hand the genuinely unused remainder to the
	// hypotheses that want more. First-come consumption let a verbose first
	// hypothesis leave the others with no fuzzy matching at all.
	const uniqueTitlesBySuggestion = boundedSuggestions.map(suggestion =>
		[...new Set(suggestion.exactTitles)].filter(Boolean),
	)
	const uniqueTermsBySuggestion = boundedSuggestions.map(suggestion =>
		[...new Set(suggestion.titleTerms)].filter(Boolean),
	)
	const allocate = (demands: number[], total: number) => {
		const share = Math.max(1, Math.floor(total / demands.length))
		const granted = demands.map(demand => Math.min(demand, share))
		let spare = total - granted.reduce((sum, value) => sum + value, 0)
		// Hand the remainder to whoever still wants it, one pass, in order.
		for (let index = 0; index < demands.length && spare > 0; index += 1) {
			const extra = Math.min(demands[index]! - granted[index]!, spare)
			if (extra <= 0) continue
			granted[index]! += extra
			spare -= extra
		}
		return granted
	}
	const titleAllocation = allocate(
		uniqueTitlesBySuggestion.map(titles => titles.length),
		MAX_SUGGESTION_EXACT_TITLES,
	)
	const termAllocation = allocate(
		uniqueTermsBySuggestion.map(terms => terms.length),
		MAX_SUGGESTION_TITLE_TERMS,
	)
	const branches: Prisma.Sql[] = []
	boundedSuggestions.forEach((suggestion, index) => {
		const titles = uniqueTitlesBySuggestion[index]!.slice(
			0,
			titleAllocation[index],
		)
		const terms = uniqueTermsBySuggestion[index]!.slice(
			0,
			termAllocation[index],
		)
		const filter = Prisma.sql`AND "Media"."kind" = ${suggestion.kind}`
		for (const title of titles) {
			// Canonical-title equality must stay a candidate source: a media row
			// with no MediaTitle rows would otherwise be unreachable, and short
			// titles ("Up", "It") produce no lexical terms to fall back on.
			branches.push(Prisma.sql`
				SELECT "Media"."id" AS id, ${index} AS suggestion_index, 0 AS source_rank,
					COALESCE("Media"."catalogPopularity", 0) AS popularity
				FROM "Media"
				WHERE "Media"."title" IS NOT NULL
				${filter}
				AND ${equalsCondition(Prisma.sql`"Media"."title"`, title, databaseUrl)}
			`)
			branches.push(Prisma.sql`
				SELECT "Media"."id" AS id, ${index} AS suggestion_index, 0 AS source_rank,
					COALESCE("Media"."catalogPopularity", 0) AS popularity
				FROM "Media"
				JOIN "MediaTitle" ON "MediaTitle"."mediaId" = "Media"."id"
				WHERE "Media"."title" IS NOT NULL
				${filter}
				AND "MediaTitle"."normalized" = ${title}
			`)
		}
		for (const term of terms) {
			const pattern = containsPattern(term)
			branches.push(Prisma.sql`
				SELECT "Media"."id" AS id, ${index} AS suggestion_index, 1 AS source_rank,
					COALESCE("Media"."catalogPopularity", 0) AS popularity
				FROM "Media"
				WHERE "Media"."title" IS NOT NULL
				${filter}
				AND ${containsCondition(Prisma.sql`"Media"."title"`, pattern, databaseUrl)}
			`)
			branches.push(Prisma.sql`
				SELECT "Media"."id" AS id, ${index} AS suggestion_index, 2 AS source_rank,
					COALESCE("Media"."catalogPopularity", 0) AS popularity
				FROM "Media"
				JOIN "MediaTitle" ON "MediaTitle"."mediaId" = "Media"."id"
				WHERE "Media"."title" IS NOT NULL
				${filter}
				AND ${containsCondition(
					Prisma.sql`"MediaTitle"."normalized"`,
					pattern,
					databaseUrl,
				)}
			`)
		}
	})
	if (!branches.length) return []
	// Interleave by rank-within-hypothesis rather than truncating each
	// hypothesis: every hypothesis's Nth-best candidate precedes anyone's
	// (N+1)th-best, so a crowded hypothesis still cannot starve the others while
	// the full budget stays usable. A hard per-hypothesis cut would idle most of
	// the budget and drop legitimate candidates.
	const rows = await prisma.$queryRaw<SuggestionCandidateIdRow[]>(Prisma.sql`
		WITH matched AS (
			${Prisma.join(branches, ' UNION ALL ')}
		), deduped AS (
			SELECT matched.suggestion_index AS suggestion_index,
				matched.id AS id,
				MIN(matched.source_rank) AS source_rank,
				MAX(matched.popularity) AS popularity
			FROM matched
			GROUP BY matched.suggestion_index, matched.id
		), allocated AS (
			SELECT deduped.id AS id,
				deduped.source_rank AS source_rank,
				deduped.popularity AS popularity,
				ROW_NUMBER() OVER (
					PARTITION BY deduped.suggestion_index
					ORDER BY deduped.source_rank ASC,
						deduped.popularity DESC,
						deduped.id ASC
				) AS slot
			FROM deduped
		)
		SELECT allocated.id AS id,
			MIN(allocated.slot) AS slot,
			MIN(allocated.source_rank) AS source_rank,
			MAX(allocated.popularity) AS popularity
		FROM allocated
		GROUP BY allocated.id
		ORDER BY slot ASC, source_rank ASC, popularity DESC, id ASC
		LIMIT ${boundedLimit}
	`)
	return rows.map(row => row.id)
}

/**
 * One bounded, logical hydration read that preserves the candidate order
 * established by the identifier query. It is two SQL statements: the media rows
 * and their alternate titles relation.
 */
export async function hydrateCatalogCandidates(ids: string[]) {
	const bounded = ids.slice(0, MAX_CATALOG_CANDIDATES)
	if (!bounded.length) return []
	const rows = await prisma.media.findMany({
		where: { id: { in: bounded } },
		select: catalogCandidateSelect,
	})
	const byId = new Map(rows.map(row => [row.id, row]))
	return bounded.flatMap(id => {
		const row = byId.get(id)
		return row ? [row] : []
	})
}
