import { normalizeCatalogTitle } from './catalog-sync.server.ts'
import { prisma } from './db.server.ts'
import { splitLegacyThumbnail } from './media-detail.ts'
import { prismaSearchFilter } from './prisma-search.server.ts'
import {
	clampSuggestionLimit,
	normalizeSuggestionKind,
	normalizeSuggestionQuery,
	rankSuggestions,
	type SearchSuggestion,
} from './search-suggestions.ts'

/**
 * The titles offered under the search bar as someone types.
 *
 * Deliberately narrower than `/discover`: this matches titles only, never
 * descriptions. A row whose title has nothing to do with what was typed reads
 * as a bug in a list of titles, even when the description genuinely matched —
 * the full results page is where a description match belongs.
 */
export async function getSearchSuggestions(input: {
	q: unknown
	kind?: unknown
	limit?: unknown
}): Promise<SearchSuggestion[]> {
	const query = normalizeSuggestionQuery(input.q)
	if (!query) return []
	const kind = normalizeSuggestionKind(input.kind)
	const take = clampSuggestionLimit(input.limit)
	const normalized = normalizeCatalogTitle(query)

	const media = await prisma.media.findMany({
		where: {
			AND: [
				{
					OR: [
						{ title: prismaSearchFilter('contains', query) },
						// Alternate titles are how someone finds a show by the name they
						// know it under rather than the one it is filed under.
						...(normalized
							? [
									{
										titles: {
											some: {
												normalized: prismaSearchFilter('contains', normalized),
											},
										},
									},
								]
							: []),
					],
				},
				...(kind === 'all' ? [] : [{ kind }]),
			],
		},
		select: {
			id: true,
			kind: true,
			title: true,
			type: true,
			thumbnail: true,
			releaseStart: true,
			startYear: true,
			airYear: true,
		},
		// Best-known first. With only eight rows the ordering is most of the value:
		// an obscure title that happens to sort earlier alphabetically would push
		// out the one nearly everyone means.
		orderBy: [
			{ catalogPopularity: { sort: 'desc', nulls: 'last' } },
			{ title: 'asc' },
			{ id: 'asc' },
		],
		// More than will be shown, so ranking has something to choose between: the
		// best prefix match is worth nothing if popularity kept it off the page.
		take: Math.min(take * 4, 40),
	})

	const suggestions = media.map(entry => ({
		id: entry.id,
		title: entry.title ?? '',
		kind: entry.kind,
		type: entry.type,
		year: entry.releaseStart
			? String(entry.releaseStart.getUTCFullYear())
			: (entry.startYear ?? entry.airYear ?? null),
		// Thumbnails are stored as a legacy `image|providerPage` pair, so the
		// image half is separated here rather than in the markup.
		thumbnail: splitLegacyThumbnail(entry.thumbnail).imageUrl,
	}))
	return rankSuggestions(suggestions, query).slice(0, take)
}
