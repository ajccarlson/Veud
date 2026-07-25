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

type NormalizedMedia<TMedia> = TMedia extends null
	? null
	: TMedia extends Record<string, unknown>
		? Omit<TMedia, 'tmdbScore' | 'malScore'> & {
				tmdbScore: number | null
				malScore: number | null
			}
		: null

type NormalizedTrackingState<TState> = TState extends null
	? null
	: TState extends Record<string, unknown>
		? Omit<TState, 'score'> & { score: number | null }
		: null

export type NormalizedWatchlistEntryScores<
	TEntry extends WatchlistEntryScores,
> = Omit<
	TEntry,
	| 'averaged'
	| 'personal'
	| 'differencePersonal'
	| 'differenceObjective'
	| 'tmdbScore'
	| 'malScore'
	| 'media'
	| 'trackingState'
> & {
	averaged: number | null
	personal: number | null
	differencePersonal: number | null
	differenceObjective: number | null
	tmdbScore: number | null
	malScore: number | null
	media: NormalizedMedia<TEntry['media']>
	trackingState: NormalizedTrackingState<TEntry['trackingState']>
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
>(entry: TEntry): NormalizedWatchlistEntryScores<TEntry> {
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
	} as unknown as NormalizedWatchlistEntryScores<TEntry>
}
