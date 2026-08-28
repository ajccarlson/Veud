import { normalizeCatalogTitle } from './catalog-sync.server.ts'
import { prisma } from './db.server.ts'
import { normalizePersonName } from './media-credits.server.ts'
import { splitLegacyThumbnail } from './media-detail.ts'
import { resolveDisplayTitle, type TitleLanguage } from './media-title.ts'
import { prismaSearchFilter } from './prisma-search.server.ts'
import {
	clampSuggestionLimit,
	normalizeSuggestionKind,
	normalizeSuggestionQuery,
	rankSuggestions,
	SUGGESTION_LIMIT,
	type SearchSuggestion,
} from './search-suggestions.ts'

export type PersonSearchResult = {
	id: string
	name: string
	imageUrl: string | null
	knownForDepartment: string | null
	creditCount: number
}

const FULL_PERSON_RESULT_LIMIT = 12

async function findPeople(query: string, take: number) {
	const normalized = normalizePersonName(query)
	if (!normalized) return []
	return prisma.person.findMany({
		where: {
			AND: [
				{ normalized: prismaSearchFilter('contains', normalized) },
				// Credit refreshes can leave an identity behind after its final title
				// disappears. Do not offer a dead-end person page in search.
				{ credits: { some: {} } },
			],
		},
		select: {
			id: true,
			name: true,
			imageUrl: true,
			knownForDepartment: true,
			_count: { select: { credits: true } },
		},
		// Prominence for a person is how much of the catalog credits them. Name
		// matching is applied afterwards, so an exact prefix still beats an
		// interior match without letting a one-credit extra outrank a lead.
		orderBy: [{ credits: { _count: 'desc' } }, { name: 'asc' }, { id: 'asc' }],
		take,
	})
}

/** A bounded people section for the full catalog-results page. */
export async function getPeopleSearchResults(
	rawQuery: unknown,
	limit = FULL_PERSON_RESULT_LIMIT,
): Promise<PersonSearchResult[]> {
	const query = normalizeSuggestionQuery(rawQuery)
	if (!query) return []
	const take = Math.min(Math.max(Math.trunc(limit) || 1, 1), 24)
	const people = await findPeople(query, Math.min(take * 4, 48))
	return rankSuggestions(
		people.map(person => ({
			id: person.id,
			name: person.name,
			label: person.name,
			imageUrl: person.imageUrl,
			knownForDepartment: person.knownForDepartment,
			creditCount: person._count.credits,
		})),
		query,
	)
		.slice(0, take)
		.map(({ label: _label, ...person }) => person)
}

/**
 * The titles and credited people offered under the search bar as someone types.
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
	titleLanguage?: TitleLanguage
}): Promise<SearchSuggestion[]> {
	const query = normalizeSuggestionQuery(input.q)
	if (!query) return []
	const kind = normalizeSuggestionKind(input.kind)
	const take = clampSuggestionLimit(input.limit)
	const normalized = normalizeCatalogTitle(query)

	const [media, people] = await Promise.all([
		prisma.media.findMany({
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
													normalized: prismaSearchFilter(
														'contains',
														normalized,
													),
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
				englishTitle: true,
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
		}),
		kind === 'all' ? findPeople(query, Math.min(take * 4, 40)) : [],
	])

	const mediaSuggestions = rankSuggestions(
		media.map(entry => {
			const title = resolveDisplayTitle(entry, input.titleLanguage)
			return {
				resultType: 'media' as const,
				id: entry.id,
				title,
				label: title,
				kind: entry.kind,
				type: entry.type,
				year: entry.releaseStart
					? String(entry.releaseStart.getUTCFullYear())
					: (entry.startYear ?? entry.airYear ?? null),
				// Thumbnails are stored as a legacy `image|providerPage` pair, so the
				// image half is separated here rather than in the markup.
				thumbnail: splitLegacyThumbnail(entry.thumbnail).imageUrl,
			}
		}),
		query,
	)
	const personSuggestions = rankSuggestions(
		people.map(person => ({
			resultType: 'person' as const,
			id: person.id,
			name: person.name,
			label: person.name,
			thumbnail: person.imageUrl,
			knownForDepartment: person.knownForDepartment,
			creditCount: person._count.credits,
		})),
		query,
	)

	if (!personSuggestions.length) return mediaSuggestions.slice(0, take)

	// Titles remain the primary purpose of the bar, but people cannot be hidden
	// behind eight title matches. Reserve three of eight rows for people, then
	// let either group fill space the other group did not use.
	const mediaQuota = Math.ceil((take * 5) / SUGGESTION_LIMIT)
	const selectedMedia = mediaSuggestions.slice(0, mediaQuota)
	const selectedPeople = personSuggestions.slice(0, take - selectedMedia.length)
	let remaining = take - selectedMedia.length - selectedPeople.length
	if (remaining > 0) {
		selectedMedia.push(
			...mediaSuggestions.slice(
				selectedMedia.length,
				selectedMedia.length + remaining,
			),
		)
		remaining = take - selectedMedia.length - selectedPeople.length
	}
	if (remaining > 0) {
		selectedPeople.push(
			...personSuggestions.slice(
				selectedPeople.length,
				selectedPeople.length + remaining,
			),
		)
	}
	return [...selectedMedia, ...selectedPeople]
}
