import { type Prisma } from '@prisma/client'

/** Provider-derived fields shared by every user tracking the same work. */
export const mediaCatalogSelect = {
	thumbnail: true,
	title: true,
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

/** Prefer canonical Media values while legacy snapshots remain available. */
export function resolveMediaCatalog(
	media: MediaCatalogSnapshot,
	fallback: MediaCatalogSnapshot | undefined,
): MediaCatalogSnapshot {
	return {
		...(fallback ?? {}),
		...(catalogDataFromSnapshot(
			media as Record<string, unknown>,
		) as MediaCatalogSnapshot),
	}
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
