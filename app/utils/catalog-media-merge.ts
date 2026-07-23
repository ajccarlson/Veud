export const catalogMediaFields = [
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
	'length',
	'chapters',
	'volumes',
	'rating',
	'language',
	'studios',
	'serialization',
	'authors',
	'tmdbScore',
	'malScore',
	'catalogScore',
	'catalogPopularity',
	'releaseStatus',
] as const

export type CatalogMediaField = (typeof catalogMediaFields)[number]

export type CatalogMediaMergePreflight = {
	issueId: string
	source: { id: string; title: string | null; kind: string }
	target: { id: string; title: string | null; kind: string }
	safe: boolean
	blockers: Array<{
		code: string
		message: string
		count: number
		examples: string[]
	}>
	warnings: string[]
	moves: Record<string, number>
	prunes: Record<string, number>
	targetFills: CatalogMediaField[]
	targetConflicts: CatalogMediaField[]
	fingerprint: string
	generatedAt: string
}

export function expectedCatalogMergeConfirmation(
	sourceMediaId: string,
	targetMediaId: string,
) {
	return `MERGE ${sourceMediaId} INTO ${targetMediaId}`
}

export function expectedCatalogMergeReversal(mergeId: string) {
	return `REVERT ${mergeId}`
}

export function parseCatalogMediaMergePreflight(value: string) {
	return JSON.parse(value) as CatalogMediaMergePreflight
}
