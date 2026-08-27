import { type Prisma } from '@prisma/client'

/** Provider-derived fields shared by every user tracking the same work. */
export const mediaCatalogSelect = {
	thumbnail: true,
	title: true,
	englishTitle: true,
	type: true,
	releaseStart: true,
	releaseEnd: true,
	nextRelease: true,
	genres: true,
	description: true,
	airYear: true,
	startSeason: true,
	startYear: true,
	length: true,
	chapters: true,
	volumes: true,
	runtimeMinutes: true,
	episodeCount: true,
	chapterCount: true,
	volumeCount: true,
	rating: true,
	language: true,
	studios: true,
	serialization: true,
	authors: true,
	tmdbScore: true,
	malScore: true,
	catalogScore: true,
	catalogPopularity: true,
	releaseStatus: true,
} satisfies Prisma.MediaSelect

export type MediaCatalogField = keyof typeof mediaCatalogSelect

export const mediaCatalogFields = Object.keys(
	mediaCatalogSelect,
) as MediaCatalogField[]

export const TRUSTED_CATALOG_PROVENANCE_VERSION = 1

export function emptyMediaCatalogData() {
	return Object.fromEntries(
		mediaCatalogFields.map(field => [field, null]),
	) as Record<MediaCatalogField, null>
}

/**
 * Provider-owned fields that still have a legacy mirror on Entry. Progress
 * fields (`length`, `chapters`, and `volumes`) are deliberately excluded:
 * those strings still contain a member's current progress in older rows.
 */
export const entryCatalogMetadataFields = [
	'thumbnail',
	'title',
	'type',
	'releaseStart',
	'releaseEnd',
	'nextRelease',
	'genres',
	'description',
	'airYear',
	'startSeason',
	'startYear',
	'rating',
	'language',
	'studios',
	'serialization',
	'authors',
	'tmdbScore',
	'malScore',
] as const satisfies readonly MediaCatalogField[]

export type MediaCatalog = Prisma.MediaGetPayload<{
	select: typeof mediaCatalogSelect
}>

export type MediaCatalogSnapshot = Partial<MediaCatalog>

export function hasCatalogValue(value: unknown) {
	return value !== undefined && value !== null && value !== ''
}

/**
 * Reduce an Entry, favorite, or provider payload to catalog-safe fields. User
 * scores, notes, history, and ownership fields are deliberately not included.
 */
export function catalogDataFromSnapshot(snapshot: Record<string, unknown>) {
	const catalog: Partial<Record<keyof MediaCatalog, unknown>> = {}
	for (const field of mediaCatalogFields) {
		const value = snapshot[field]
		if (hasCatalogValue(value)) catalog[field] = value
	}
	return catalog
}

/** Reduce canonical Media to the provider-owned catalog snapshot. */
export function resolveMediaCatalog(
	media: MediaCatalogSnapshot,
): MediaCatalogSnapshot {
	return catalogDataFromSnapshot(
		media as Record<string, unknown>,
	) as MediaCatalogSnapshot
}

/** Build the legacy Entry snapshot still required by the watchlist UI. */
export function catalogCreateData(
	entry: MediaCatalogSnapshot | undefined,
	kind: string,
) {
	return {
		thumbnail: entry?.thumbnail,
		title: entry?.title?.trim() || `Untitled ${kind}`,
		type: entry?.type,
		releaseStart: entry?.releaseStart,
		releaseEnd: entry?.releaseEnd,
		nextRelease: entry?.nextRelease,
		genres: entry?.genres,
		description: entry?.description,
		airYear: entry?.airYear,
		startSeason: entry?.startSeason,
		startYear: entry?.startYear,
		length: entry?.length,
		chapters: entry?.chapters,
		volumes: entry?.volumes,
		rating: entry?.rating,
		language: entry?.language,
		studios: entry?.studios,
		serialization: entry?.serialization,
		authors: entry?.authors,
		tmdbScore: entry?.tmdbScore,
		malScore: entry?.malScore,
	}
}
