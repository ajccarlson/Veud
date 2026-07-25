type ScoreValue =
	| number
	| string
	| { toString(): string }
	| null
	| undefined

type WatchlistEntryScores = {
	averaged: ScoreValue
	personal: ScoreValue
	differencePersonal: ScoreValue
	differenceObjective: ScoreValue
	tmdbScore: ScoreValue
	malScore: ScoreValue
	media:
		| ({
				tmdbScore: ScoreValue
				malScore: ScoreValue
		  } & Record<string, unknown>)
		| null
	trackingState:
		| ({
				score: ScoreValue
		  } & Record<string, unknown>)
		| null
}

function scoreNumber(value: ScoreValue) {
	if (value === null || value === undefined || value === '') return null
	const number = Number(value)
	return Number.isFinite(number) ? number : null
}

function preferredScore(primary: ScoreValue, fallback: ScoreValue) {
	const primaryScore = scoreNumber(primary)
	if (primaryScore !== null && primaryScore !== 0) return primaryScore
	return scoreNumber(fallback)
}

/**
 * Prisma Decimal values are class instances. React Router's single-fetch stream
 * cannot hydrate those instances into usable browser numbers, so every decimal
 * crossing the watchlist loader boundary must be normalized.
 *
 * TrackingState and Media are the canonical records. Entry values remain
 * fallbacks while older rows finish migrating to the normalized data model.
 */
export function normalizeWatchlistEntryScores<
	TEntry extends WatchlistEntryScores,
>(entry: TEntry) {
	const personal = preferredScore(
		entry.trackingState?.score,
		entry.personal,
	)
	const tmdbScore = preferredScore(entry.media?.tmdbScore, entry.tmdbScore)
	const malScore = preferredScore(entry.media?.malScore, entry.malScore)

	return {
		...entry,
		averaged: scoreNumber(entry.averaged),
		personal,
		differencePersonal: scoreNumber(entry.differencePersonal),
		differenceObjective: scoreNumber(entry.differenceObjective),
		tmdbScore,
		malScore,
		media: entry.media
			? {
					...entry.media,
					tmdbScore: scoreNumber(entry.media.tmdbScore),
					malScore: scoreNumber(entry.media.malScore),
				}
			: null,
		trackingState: entry.trackingState
			? {
					...entry.trackingState,
					score: scoreNumber(entry.trackingState.score),
				}
			: null,
	}
}
