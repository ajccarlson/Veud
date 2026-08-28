import { Prisma, type PrismaClient } from '@prisma/client'
import { canonicalizeLinkedWatchlistEntry } from './lists/public-watchlist.server.ts'
import { type TitleLanguage } from './media-title.ts'

export const LIST_LANDING_PREVIEW_LIMIT = 5

const listLandingPreviewSelect = {
	id: true,
	watchlistId: true,
	position: true,
	thumbnail: true,
	title: true,
	type: true,
	airYear: true,
	startSeason: true,
	startYear: true,
	media: {
		select: {
			kind: true,
			thumbnail: true,
			title: true,
			englishTitle: true,
			type: true,
			airYear: true,
			startSeason: true,
			startYear: true,
		},
	},
} satisfies Prisma.EntrySelect

type ListLandingPreviewRecord = Prisma.EntryGetPayload<{
	select: typeof listLandingPreviewSelect
}>

export type ListLandingPreviewEntry = Omit<ListLandingPreviewRecord, 'media'>

export type ListLandingPreview = {
	entryCount: number
	listEntries: ListLandingPreviewEntry[]
}

type RankedPreviewRow = {
	id: string
	watchlistId: string
	entryCount: bigint | number
	previewRank: bigint | number
}

type ListLandingDb = Pick<PrismaClient, '$queryRaw' | 'entry'>

function safeEntryCount(value: bigint | number) {
	const count = Number(value)
	if (!Number.isSafeInteger(count) || count < 0) {
		throw new Error('Watchlist entry count exceeds the supported range')
	}
	return count
}

/**
 * Return exact totals and a fixed five-row preview for each requested list.
 *
 * The ranked query transfers only identifiers/counts across the database
 * boundary. Canonical media data is then hydrated for at most five entries per
 * list, keeping both SQL round trips and the browser payload independent of a
 * member's total library size.
 */
export async function loadListLandingPreviews(
	db: ListLandingDb,
	watchlistIds: string[],
	titleLanguage: TitleLanguage = 'default',
) {
	const uniqueWatchlistIds = [...new Set(watchlistIds)]
	const previews = new Map<string, ListLandingPreview>(
		uniqueWatchlistIds.map(id => [id, { entryCount: 0, listEntries: [] }]),
	)
	if (!uniqueWatchlistIds.length) return previews

	const rankedRows = await db.$queryRaw<RankedPreviewRow[]>(Prisma.sql`
		WITH ranked_entries AS (
			SELECT entry."id" AS "id",
				entry."watchlistId" AS "watchlistId",
				COUNT(*) OVER (
					PARTITION BY entry."watchlistId"
				) AS "entryCount",
				ROW_NUMBER() OVER (
					PARTITION BY entry."watchlistId"
					ORDER BY entry."position" ASC, entry."id" ASC
				) AS "previewRank"
			FROM "Entry" AS entry
			WHERE entry."watchlistId" IN (${Prisma.join(uniqueWatchlistIds)})
		)
		SELECT ranked_entries."id" AS "id",
			ranked_entries."watchlistId" AS "watchlistId",
			ranked_entries."entryCount" AS "entryCount",
			ranked_entries."previewRank" AS "previewRank"
		FROM ranked_entries
		WHERE ranked_entries."previewRank" <= ${LIST_LANDING_PREVIEW_LIMIT}
		ORDER BY ranked_entries."watchlistId" ASC,
			ranked_entries."previewRank" ASC
	`)

	const previewIds = rankedRows.map(row => row.id)
	const hydratedEntries = previewIds.length
		? await db.entry.findMany({
				where: { id: { in: previewIds } },
				select: listLandingPreviewSelect,
			})
		: []
	const entriesById = new Map(hydratedEntries.map(entry => [entry.id, entry]))

	for (const row of rankedRows) {
		const preview = previews.get(row.watchlistId)
		if (!preview) continue
		preview.entryCount = safeEntryCount(row.entryCount)
		const rawEntry = entriesById.get(row.id)
		if (!rawEntry) continue
		const { media: _media, ...entry } = canonicalizeLinkedWatchlistEntry(
			rawEntry,
			titleLanguage,
		)
		preview.listEntries.push(entry)
	}

	return previews
}
