/**
 * The catalog columns a merge reconciles between two rows.
 *
 * A field missing here is not merged: the survivor keeps its own value, the
 * loser's is deleted with its row, and the reversal journal has no record of
 * it. `englishTitle` was added to the schema and not to this list, so merging
 * a row that had one into a row that did not simply lost it.
 *
 * `catalog-media-merge-fields.test.ts` compares this against the Prisma schema.
 * Deliberately absent, and asserted there: `nextReleaseAt`, which is derived
 * from `nextRelease` by `deriveNextReleaseAt` and maintained alongside it
 * rather than reconciled on its own.
 */
export const catalogMediaFields = [
	'thumbnail',
	'title',
	'type',
	'releaseStart',
	'releaseEnd',
	'nextRelease',
	'genres',
	'description',
	'originalTitle',
	'englishTitle',
	'airYear',
	'startSeason',
	'startYear',
	'runtimeMinutes',
	'episodeCount',
	'chapterCount',
	'volumeCount',
	'length',
	'chapters',
	'volumes',
	'rating',
	'language',
	'studios',
	'networks',
	'keywords',
	'budget',
	'revenue',
	'videos',
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every(item => typeof item === 'string')
}

function isCountMap(value: unknown): value is Record<string, number> {
	return (
		isRecord(value) &&
		Object.values(value).every(
			count => Number.isSafeInteger(count) && Number(count) >= 0,
		)
	)
}

function isMediaSummary(value: unknown) {
	return (
		isRecord(value) &&
		typeof value.id === 'string' &&
		(value.title === null || typeof value.title === 'string') &&
		typeof value.kind === 'string'
	)
}

function isBlocker(value: unknown) {
	return (
		isRecord(value) &&
		typeof value.code === 'string' &&
		typeof value.message === 'string' &&
		Number.isSafeInteger(value.count) &&
		Number(value.count) >= 0 &&
		isStringArray(value.examples)
	)
}

function isCatalogMediaFieldArray(
	value: unknown,
): value is CatalogMediaField[] {
	const allowed = new Set<string>(catalogMediaFields)
	return isStringArray(value) && value.every(field => allowed.has(field))
}

export function parseCatalogMediaMergePreflight(value: string) {
	const parsed = JSON.parse(value) as unknown
	if (
		!isRecord(parsed) ||
		typeof parsed.issueId !== 'string' ||
		!isMediaSummary(parsed.source) ||
		!isMediaSummary(parsed.target) ||
		typeof parsed.safe !== 'boolean' ||
		!Array.isArray(parsed.blockers) ||
		!parsed.blockers.every(isBlocker) ||
		!isStringArray(parsed.warnings) ||
		!isCountMap(parsed.moves) ||
		!isCountMap(parsed.prunes) ||
		!isCatalogMediaFieldArray(parsed.targetFills) ||
		!isCatalogMediaFieldArray(parsed.targetConflicts) ||
		typeof parsed.fingerprint !== 'string' ||
		typeof parsed.generatedAt !== 'string'
	) {
		throw new Error('Invalid catalog merge preflight')
	}
	return parsed as CatalogMediaMergePreflight
}
