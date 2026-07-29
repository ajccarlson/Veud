import {
	parseBoundedProfileHistory,
	PROFILE_HISTORY_EVENT_LIMIT,
	profileHistoryTimestamp,
} from './profile-history-bounds.ts'

export const PROFILE_ANALYTICS_ENTRY_LIMIT = 100_000
export const PROFILE_ANALYTICS_COMPLETION_DAY_LIMIT = 1_000
export const PROFILE_ANALYTICS_CATEGORY_LIMIT = 24
export const PROFILE_ANALYTICS_CATEGORY_CANDIDATE_LIMIT = 96
export const PROFILE_ANALYTICS_CATEGORY_SOURCE_CODE_UNIT_LIMIT = 8 * 1024
export const PROFILE_ANALYTICS_GENRES_PER_ENTRY_LIMIT = 64
export const PROFILE_ANALYTICS_MIN_YEAR = 1870
export const PROFILE_ANALYTICS_FUTURE_YEAR_ALLOWANCE = 5

export const PROFILE_COMPONENT_SCORE_FIELDS = [
	'story',
	'character',
	'presentation',
	'sound',
	'performance',
	'enjoyment',
	'averaged',
	'personal',
] as const

export const PROFILE_PROVIDER_SCORE_FIELDS = ['tmdbScore', 'malScore'] as const

export const PROFILE_SCORE_FIELDS = [
	...PROFILE_COMPONENT_SCORE_FIELDS,
	...PROFILE_PROVIDER_SCORE_FIELDS,
] as const

export type ProfileScoreField = (typeof PROFILE_SCORE_FIELDS)[number]
export type ProfileComponentScoreField =
	(typeof PROFILE_COMPONENT_SCORE_FIELDS)[number]
export type ProfileProviderScoreField =
	(typeof PROFILE_PROVIDER_SCORE_FIELDS)[number]

export type ProfileScoreBuckets = [
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
]

export type ProfileAnalyticsDiagnostic = {
	processed: number
	truncated: boolean
	limit: number
	completionDaysTruncated: boolean
	categoryCandidatesApproximate: boolean
	categoryCandidatesTruncated: boolean
	historyEntriesRejected: number
	historyFinishEventsTruncated: number
	watchlistsProcessed?: number
	watchlistsTruncated?: boolean
	watchlistLimit?: number
}

type ProfileAnalyticsScanDiagnostic = Pick<
	ProfileAnalyticsDiagnostic,
	'processed' | 'truncated' | 'limit'
>

export type ProfileAnalyticsMode = 'full' | 'overview' | 'stats'

export type ProfileAnalyticsListType = {
	id: string
	name: string
}

export type ProfileAnalyticsWatchlist = {
	id: string
	typeId: string
}

export type ProfileAnalyticsEntry = {
	watchlistId: string
	type?: unknown
	releaseStart?: unknown
	history?: unknown
	genres?: unknown
	airYear?: unknown
	startSeason?: unknown
	startYear?: unknown
	story?: unknown
	character?: unknown
	presentation?: unknown
	sound?: unknown
	performance?: unknown
	enjoyment?: unknown
	averaged?: unknown
	personal?: unknown
	tmdbScore?: unknown
	malScore?: unknown
	categorySourceTruncated?: boolean
}

export type ProfileYearCount = {
	year: number
	count: number
}

export type ProfileObjectiveScoreSummary = {
	score: number
	min: number
	q1: number
	median: number
	q3: number
	max: number
	mean: number
	count: number
}

export type ProfileObjectiveScores = {
	source: 'tmdbScore' | 'malScore' | null
	groups: ProfileObjectiveScoreSummary[]
}

export type ProfileAnalyticsCategoryCandidate = {
	key: string
	label: string
}

export type ProfileAnalyticsCategoryPlan = {
	genres: Record<string, ProfileAnalyticsCategoryCandidate[]>
	mediaTypes: Record<string, ProfileAnalyticsCategoryCandidate[]>
}

export type ProfileCategoryCount = {
	key: string
	label: string
	count: number
	isRollup?: true
}

export type ProfileCategoryMatrix = {
	labels: string[]
	values: number[][]
}

export type ProfileAnalyticsCategoryResult = {
	genreCounts: Record<string, ProfileCategoryCount[]>
	genreMatrices: Record<string, ProfileCategoryMatrix>
	mediaTypeCounts: Record<string, ProfileCategoryCount[]>
	diagnostic: ProfileAnalyticsScanDiagnostic
}

export type ProfileAnalyticsFirstPass = {
	listTypeCounts: Record<string, number>
	scoreBuckets: Record<
		string,
		Record<ProfileComponentScoreField, ProfileScoreBuckets>
	>
	providerScoreBuckets: Record<
		string,
		Record<ProfileProviderScoreField, ProfileScoreBuckets>
	>
	objectiveScores: Record<string, ProfileObjectiveScores>
	releaseYears: Record<string, ProfileYearCount[]>
	completionYears: Record<string, ProfileYearCount[]>
	completionDays: Array<{ day: string; value: number }>
	categoryPlan: ProfileAnalyticsCategoryPlan
	diagnostic: ProfileAnalyticsDiagnostic
}

export type ProfileAnalyticsResult = Omit<
	ProfileAnalyticsFirstPass,
	'categoryPlan'
> &
	Omit<ProfileAnalyticsCategoryResult, 'diagnostic' | 'genreCounts'>

type ObjectiveSource = Exclude<ProfileObjectiveScores['source'], null>

type ObjectiveHistograms = Record<ObjectiveSource, number[][]>

type NormalizedCategory = {
	key: string
	label: string
}

const OBJECTIVE_PERSONAL_BIN_COUNT = 91
const MILLISECONDS_PER_DAY = 86_400_000
const OTHER_CATEGORY_KEY = '__veud_category_rollup__'

function emptyScoreBuckets(): ProfileScoreBuckets {
	return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
}

function emptyComponentScoreFields() {
	return Object.fromEntries(
		PROFILE_COMPONENT_SCORE_FIELDS.map(field => [field, emptyScoreBuckets()]),
	) as Record<ProfileComponentScoreField, ProfileScoreBuckets>
}

function emptyProviderScoreFields() {
	return Object.fromEntries(
		PROFILE_PROVIDER_SCORE_FIELDS.map(field => [field, emptyScoreBuckets()]),
	) as Record<ProfileProviderScoreField, ProfileScoreBuckets>
}

function emptyObjectiveHistograms(): ObjectiveHistograms {
	const groups = () =>
		Array.from({ length: 10 }, () =>
			Array.from({ length: OBJECTIVE_PERSONAL_BIN_COUNT }, () => 0),
		)
	return {
		tmdbScore: groups(),
		malScore: groups(),
	}
}

function finiteScore(value: unknown) {
	if (value === null || value === undefined || value === '') return null
	const score = Number(value)
	return Number.isFinite(score) && score >= 1 && score <= 10 ? score : null
}

function integerScoreIndex(value: unknown) {
	const score = finiteScore(value)
	return score === null ? null : Math.min(9, Math.floor(score) - 1)
}

function personalTenthIndex(value: unknown) {
	const score = finiteScore(value)
	if (score === null) return null
	return Math.min(
		OBJECTIVE_PERSONAL_BIN_COUNT - 1,
		Math.max(0, Math.round((score - 1) * 10)),
	)
}

function personalValueAt(index: number) {
	return 1 + index / 10
}

function roundStatistic(value: number) {
	return Math.round((value + Number.EPSILON) * 10_000) / 10_000
}

function valueAtRank(histogram: readonly number[], rank: number) {
	let seen = 0
	for (let index = 0; index < histogram.length; index += 1) {
		seen += histogram[index] ?? 0
		if (rank < seen) return personalValueAt(index)
	}
	return personalValueAt(histogram.length - 1)
}

function quantile(
	histogram: readonly number[],
	count: number,
	percentile: number,
) {
	const position = (count - 1) * percentile
	const lowerRank = Math.floor(position)
	const upperRank = Math.ceil(position)
	const lower = valueAtRank(histogram, lowerRank)
	const upper = valueAtRank(histogram, upperRank)
	return roundStatistic(lower + (upper - lower) * (position - lowerRank))
}

function summarizeHistogram(
	score: number,
	histogram: readonly number[],
): ProfileObjectiveScoreSummary | null {
	let count = 0
	let total = 0
	for (let index = 0; index < histogram.length; index += 1) {
		const binCount = histogram[index] ?? 0
		count += binCount
		total += personalValueAt(index) * binCount
	}
	if (!count) return null

	return {
		score,
		min: valueAtRank(histogram, 0),
		q1: quantile(histogram, count, 0.25),
		median: quantile(histogram, count, 0.5),
		q3: quantile(histogram, count, 0.75),
		max: valueAtRank(histogram, count - 1),
		mean: roundStatistic(total / count),
		count,
	}
}

function collectFinishTimestamps(
	value: unknown,
	timestamps: Set<number>,
	budget: { remaining: number; truncated: boolean },
	seen = new Set<object>(),
) {
	if (!value || typeof value !== 'object') return
	if (seen.has(value)) return
	seen.add(value)

	if (Array.isArray(value)) {
		for (const item of value) {
			collectFinishTimestamps(item, timestamps, budget, seen)
			if (budget.truncated) return
		}
		return
	}

	for (const [key, child] of Object.entries(value)) {
		if (key === 'finishDate' && Array.isArray(child)) {
			for (const rawDate of child) {
				if (budget.remaining <= 0) {
					budget.truncated = true
					return
				}
				budget.remaining -= 1
				const timestamp = profileHistoryTimestamp(rawDate)
				if (timestamp !== null) timestamps.add(timestamp)
			}
		} else {
			collectFinishTimestamps(child, timestamps, budget, seen)
			if (budget.truncated) return
		}
	}
}

function yearFromDate(value: unknown) {
	const timestamp = profileHistoryTimestamp(value)
	return timestamp === null ? null : new Date(timestamp).getUTCFullYear()
}

function yearFromText(value: unknown) {
	if (typeof value !== 'string' && typeof value !== 'number') return null
	const match = String(value).match(/(?:^|\D)(\d{4})(?:\D|$)/)
	return match?.[1] ? Number(match[1]) : null
}

function releaseYearForEntry(
	entry: ProfileAnalyticsEntry,
	listTypeName: string,
) {
	const normalizedName = listTypeName.toLowerCase().replace(/[^a-z]/g, '')
	let year: number | null = null
	if (normalizedName === 'liveaction') year = yearFromText(entry.airYear)
	if (normalizedName === 'anime') year = yearFromText(entry.startSeason)
	if (normalizedName === 'manga') year = yearFromText(entry.startYear)
	return year ?? yearFromDate(entry.releaseStart)
}

function objectiveSourceForListType(
	listTypeName: string,
): ProfileObjectiveScores['source'] {
	const normalizedName = listTypeName.toLowerCase().replace(/[^a-z]/g, '')
	if (normalizedName === 'liveaction') return 'tmdbScore'
	if (normalizedName === 'anime' || normalizedName === 'manga')
		return 'malScore'
	return null
}

function normalizeCategory(value: unknown): NormalizedCategory | null {
	if (typeof value !== 'string') return null
	const label = value.slice(0, 120).trim().replace(/\s+/g, ' ')
	if (!label || label.toLowerCase() === 'null') return null
	return { key: label.toLowerCase(), label }
}

function genresFrom(value: unknown) {
	if (typeof value !== 'string') {
		return { genres: [] as NormalizedCategory[], truncated: false }
	}
	const boundedValue = value.slice(
		0,
		PROFILE_ANALYTICS_CATEGORY_SOURCE_CODE_UNIT_LIMIT,
	)
	let truncated = boundedValue.length < value.length
	const genres = new Map<string, NormalizedCategory>()
	for (const rawGenre of boundedValue.split(',')) {
		const genre = normalizeCategory(rawGenre)
		if (!genre || genres.has(genre.key)) continue
		if (genres.size >= PROFILE_ANALYTICS_GENRES_PER_ENTRY_LIMIT) {
			truncated = true
			break
		}
		genres.set(genre.key, genre)
	}
	return { genres: [...genres.values()], truncated }
}

class HeavyHitterSketch {
	private counters = new Map<
		string,
		{ key: string; label: string; estimate: number; error: number }
	>()
	private approximate = false
	private truncated = false

	add(category: NormalizedCategory) {
		const existing = this.counters.get(category.key)
		if (existing) {
			existing.estimate += 1
			return
		}
		if (this.counters.size < PROFILE_ANALYTICS_CATEGORY_CANDIDATE_LIMIT) {
			this.counters.set(category.key, {
				...category,
				estimate: 1,
				error: 0,
			})
			return
		}
		this.approximate = true
		this.truncated = true

		let smallest:
			| { key: string; label: string; estimate: number; error: number }
			| undefined
		for (const candidate of this.counters.values()) {
			if (
				!smallest ||
				candidate.estimate < smallest.estimate ||
				(candidate.estimate === smallest.estimate &&
					candidate.key > smallest.key)
			) {
				smallest = candidate
			}
		}
		if (!smallest) return
		this.counters.delete(smallest.key)
		this.counters.set(category.key, {
			...category,
			estimate: smallest.estimate + 1,
			error: smallest.estimate,
		})
	}

	finish(): ProfileAnalyticsCategoryCandidate[] {
		return [...this.counters.values()]
			.sort((a, b) => b.estimate - a.estimate || a.key.localeCompare(b.key))
			.map(({ key, label }) => ({ key, label }))
	}

	diagnostic() {
		return {
			approximate: this.approximate,
			truncated: this.truncated,
		}
	}
}

class LatestCompletionDays {
	private counts = new Map<number, number>()
	private minimumHeap: number[] = []
	private truncated = false

	add(timestamp: number) {
		const utcDay = Math.floor(timestamp / MILLISECONDS_PER_DAY)
		const count = this.counts.get(utcDay)
		if (count !== undefined) {
			this.counts.set(utcDay, count + 1)
			return
		}

		this.counts.set(utcDay, 1)
		this.push(utcDay)
		if (this.counts.size > PROFILE_ANALYTICS_COMPLETION_DAY_LIMIT) {
			this.truncated = true
			const oldest = this.pop()
			if (oldest !== undefined) this.counts.delete(oldest)
		}
	}

	finish() {
		return [...this.counts]
			.sort(([left], [right]) => left - right)
			.map(([utcDay, value]) => ({
				day: new Date(utcDay * MILLISECONDS_PER_DAY).toISOString().slice(0, 10),
				value,
			}))
	}

	get wasTruncated() {
		return this.truncated
	}

	private push(value: number) {
		const heap = this.minimumHeap
		heap.push(value)
		let index = heap.length - 1
		while (index > 0) {
			const parent = Math.floor((index - 1) / 2)
			if ((heap[parent] ?? value) <= value) break
			heap[index] = heap[parent] as number
			index = parent
		}
		heap[index] = value
	}

	private pop() {
		const heap = this.minimumHeap
		const minimum = heap[0]
		const replacement = heap.pop()
		if (heap.length && replacement !== undefined) {
			let index = 0
			while (true) {
				const left = index * 2 + 1
				const right = left + 1
				if (left >= heap.length) break
				const smallest =
					right < heap.length &&
					(heap[right] as number) < (heap[left] as number)
						? right
						: left
				if ((heap[smallest] as number) >= replacement) break
				heap[index] = heap[smallest] as number
				index = smallest
			}
			heap[index] = replacement
		}
		return minimum
	}
}

function yearCounts(years: ReadonlyMap<number, number>) {
	return [...years]
		.sort(([left], [right]) => left - right)
		.map(([year, count]) => ({ year, count }))
}

function boundedLimit(value: number | undefined) {
	if (value === undefined) return PROFILE_ANALYTICS_ENTRY_LIMIT
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new RangeError(
			'Profile analytics entry limit must be a positive integer',
		)
	}
	return Math.min(value, PROFILE_ANALYTICS_ENTRY_LIMIT)
}

export function createProfileAnalyticsAccumulator({
	listTypes,
	watchlists,
	now = new Date(),
	entryLimit,
	mode = 'full',
}: {
	listTypes: ProfileAnalyticsListType[]
	watchlists: ProfileAnalyticsWatchlist[]
	now?: Date
	entryLimit?: number
	mode?: ProfileAnalyticsMode
}) {
	const limit = boundedLimit(entryLimit)
	const collectOverview = mode === 'full' || mode === 'overview'
	const collectStats = mode === 'full' || mode === 'stats'
	const maxYear = now.getUTCFullYear() + PROFILE_ANALYTICS_FUTURE_YEAR_ALLOWANCE
	const watchlistType = new Map(
		watchlists.map(watchlist => [watchlist.id, watchlist.typeId]),
	)
	const listTypeById = new Map(
		listTypes.map(listType => [listType.id, listType]),
	)
	const listTypeCounts = Object.fromEntries(
		listTypes.map(listType => [listType.id, 0]),
	) as Record<string, number>
	const scoreBuckets = Object.fromEntries(
		listTypes.map(listType => [listType.id, emptyComponentScoreFields()]),
	) as ProfileAnalyticsFirstPass['scoreBuckets']
	const providerScoreBuckets = Object.fromEntries(
		listTypes.map(listType => [listType.id, emptyProviderScoreFields()]),
	) as ProfileAnalyticsFirstPass['providerScoreBuckets']
	const objectiveHistograms = new Map(
		listTypes.map(listType => [listType.id, emptyObjectiveHistograms()]),
	)
	const releaseYearMaps = new Map(
		listTypes.map(listType => [listType.id, new Map<number, number>()]),
	)
	const completionYearMaps = new Map(
		listTypes.map(listType => [listType.id, new Map<number, number>()]),
	)
	const genreSketches = new Map(
		listTypes.map(listType => [listType.id, new HeavyHitterSketch()]),
	)
	const mediaTypeSketches = new Map(
		listTypes.map(listType => [listType.id, new HeavyHitterSketch()]),
	)
	const completionDays = new LatestCompletionDays()
	let processed = 0
	let truncated = false
	let historyEntriesRejected = 0
	let historyFinishEventsTruncated = 0
	let categorySourceTruncated = false

	function inYearRange(year: number) {
		return year >= PROFILE_ANALYTICS_MIN_YEAR && year <= maxYear
	}

	function add(entry: ProfileAnalyticsEntry) {
		if (processed >= limit) {
			truncated = true
			return false
		}
		processed += 1

		const typeId = watchlistType.get(entry.watchlistId)
		const listType = typeId ? listTypeById.get(typeId) : null
		if (!typeId || !listType) return true

		if (collectStats) {
			listTypeCounts[typeId] = (listTypeCounts[typeId] ?? 0) + 1
			const typeScoreBuckets = scoreBuckets[typeId]
			if (typeScoreBuckets) {
				for (const field of PROFILE_COMPONENT_SCORE_FIELDS) {
					const index = integerScoreIndex(entry[field])
					if (index !== null) typeScoreBuckets[field][index] += 1
				}
			}
			const typeProviderScoreBuckets = providerScoreBuckets[typeId]
			if (typeProviderScoreBuckets) {
				for (const field of PROFILE_PROVIDER_SCORE_FIELDS) {
					const index = integerScoreIndex(entry[field])
					if (index !== null) typeProviderScoreBuckets[field][index] += 1
				}
			}

			const objectiveSource = objectiveSourceForListType(listType.name)
			if (objectiveSource) {
				const objectiveIndex = integerScoreIndex(entry[objectiveSource])
				const personalIndex = personalTenthIndex(entry.personal)
				if (objectiveIndex !== null && personalIndex !== null) {
					const histogram =
						objectiveHistograms.get(typeId)?.[objectiveSource][objectiveIndex]
					if (histogram) histogram[personalIndex] += 1
				}
			}

			const releaseYear = releaseYearForEntry(entry, listType.name)
			if (releaseYear !== null && inYearRange(releaseYear)) {
				const years = releaseYearMaps.get(typeId)
				years?.set(releaseYear, (years.get(releaseYear) ?? 0) + 1)
			}
		}

		const parsedHistory = parseBoundedProfileHistory(entry.history)
		if (parsedHistory.rejected) historyEntriesRejected += 1
		let historyEventsTruncated = parsedHistory.finishEventsTruncated
		const history = parsedHistory.history
		if (history) {
			const finishedTimestamp =
				collectOverview || collectStats
					? profileHistoryTimestamp(history.finished)
					: null
			if (collectStats && finishedTimestamp !== null) {
				const finishedYear = new Date(finishedTimestamp).getUTCFullYear()
				if (inYearRange(finishedYear)) {
					const years = completionYearMaps.get(typeId)
					years?.set(finishedYear, (years.get(finishedYear) ?? 0) + 1)
				}
			}

			if (collectOverview) {
				const finishTimestamps = new Set<number>()
				if (finishedTimestamp !== null) finishTimestamps.add(finishedTimestamp)
				const finishBudget = {
					remaining:
						PROFILE_HISTORY_EVENT_LIMIT - (finishedTimestamp === null ? 0 : 1),
					truncated: false,
				}
				collectFinishTimestamps(
					history.progress,
					finishTimestamps,
					finishBudget,
				)
				historyEventsTruncated ||= finishBudget.truncated
				for (const timestamp of finishTimestamps) {
					const year = new Date(timestamp).getUTCFullYear()
					if (inYearRange(year)) completionDays.add(timestamp)
				}
			}
		}
		if (historyEventsTruncated) historyFinishEventsTruncated += 1

		if (collectStats) {
			const genreInput = genresFrom(entry.genres)
			categorySourceTruncated ||=
				Boolean(entry.categorySourceTruncated) || genreInput.truncated
			for (const genre of genreInput.genres) {
				genreSketches.get(typeId)?.add(genre)
			}
			if (typeof entry.type === 'string' && entry.type.length > 120) {
				categorySourceTruncated = true
			}
			const mediaType = normalizeCategory(entry.type)
			if (mediaType) mediaTypeSketches.get(typeId)?.add(mediaType)
		}
		return true
	}

	function addMany(entries: Iterable<ProfileAnalyticsEntry>) {
		let accepted = 0
		for (const entry of entries) {
			if (!add(entry)) break
			accepted += 1
		}
		return accepted
	}

	function markTruncated() {
		truncated = true
	}

	function finish(): ProfileAnalyticsFirstPass {
		const objectiveScores = Object.fromEntries(
			listTypes.map(listType => {
				const source = objectiveSourceForListType(listType.name)
				const groups = source
					? (objectiveHistograms.get(listType.id)?.[source] ?? [])
							.map((histogram, index) =>
								summarizeHistogram(index + 1, histogram),
							)
							.filter(
								(group): group is ProfileObjectiveScoreSummary =>
									group !== null,
							)
					: []
				return [listType.id, { source, groups }]
			}),
		)
		const releaseYears = Object.fromEntries(
			listTypes.map(listType => [
				listType.id,
				yearCounts(releaseYearMaps.get(listType.id) ?? new Map()),
			]),
		)
		const completionYears = Object.fromEntries(
			listTypes.map(listType => [
				listType.id,
				yearCounts(completionYearMaps.get(listType.id) ?? new Map()),
			]),
		)
		const categoryPlan: ProfileAnalyticsCategoryPlan = {
			genres: Object.fromEntries(
				listTypes.map(listType => [
					listType.id,
					genreSketches.get(listType.id)?.finish() ?? [],
				]),
			),
			mediaTypes: Object.fromEntries(
				listTypes.map(listType => [
					listType.id,
					mediaTypeSketches.get(listType.id)?.finish() ?? [],
				]),
			),
		}
		const categorySketchDiagnostics = [
			...genreSketches.values(),
			...mediaTypeSketches.values(),
		].map(sketch => sketch.diagnostic())

		return {
			listTypeCounts: { ...listTypeCounts },
			scoreBuckets,
			providerScoreBuckets,
			objectiveScores,
			releaseYears,
			completionYears,
			completionDays: completionDays.finish(),
			categoryPlan,
			diagnostic: {
				processed,
				truncated,
				limit,
				completionDaysTruncated: completionDays.wasTruncated,
				categoryCandidatesApproximate: categorySketchDiagnostics.some(
					diagnostic => diagnostic.approximate,
				),
				categoryCandidatesTruncated:
					categorySketchDiagnostics.some(diagnostic => diagnostic.truncated) ||
					categorySourceTruncated,
				historyEntriesRejected,
				historyFinishEventsTruncated,
			},
		}
	}

	return { add, addMany, markTruncated, finish }
}

type ExactCategoryState = {
	genreCandidates: ProfileAnalyticsCategoryCandidate[]
	genreIndex: Map<string, number>
	genreCounts: number[]
	genreMatrix: number[][]
	totalGenres: number
	mediaTypeCandidates: ProfileAnalyticsCategoryCandidate[]
	mediaTypeIndex: Map<string, number>
	mediaTypeCounts: number[]
	totalMediaTypes: number
}

function exactCategoryState(
	genreCandidates: ProfileAnalyticsCategoryCandidate[],
	mediaTypeCandidates: ProfileAnalyticsCategoryCandidate[],
): ExactCategoryState {
	return {
		genreCandidates,
		genreIndex: new Map(
			genreCandidates.map((candidate, index) => [candidate.key, index]),
		),
		genreCounts: Array.from({ length: genreCandidates.length }, () => 0),
		genreMatrix: Array.from({ length: genreCandidates.length }, () =>
			Array.from({ length: genreCandidates.length }, () => 0),
		),
		totalGenres: 0,
		mediaTypeCandidates,
		mediaTypeIndex: new Map(
			mediaTypeCandidates.map((candidate, index) => [candidate.key, index]),
		),
		mediaTypeCounts: Array.from(
			{ length: mediaTypeCandidates.length },
			() => 0,
		),
		totalMediaTypes: 0,
	}
}

function topCategories(
	candidates: readonly ProfileAnalyticsCategoryCandidate[],
	counts: readonly number[],
	total: number,
	otherLabel: string,
) {
	const ranked = candidates
		.map((candidate, index) => ({
			...candidate,
			index,
			count: counts[index] ?? 0,
		}))
		.filter(candidate => candidate.count > 0)
		.sort(
			(left, right) =>
				right.count - left.count || left.key.localeCompare(right.key),
		)
		.slice(0, PROFILE_ANALYTICS_CATEGORY_LIMIT)
	const selectedTotal = ranked.reduce(
		(sum, candidate) => sum + candidate.count,
		0,
	)
	const countsResult: ProfileCategoryCount[] = ranked.map(
		({ key, label, count }) => ({ key, label, count }),
	)
	const other = total - selectedTotal
	if (other > 0) {
		let rollupKey = OTHER_CATEGORY_KEY
		const candidateKeys = new Set(candidates.map(candidate => candidate.key))
		while (candidateKeys.has(rollupKey)) rollupKey += '_'
		countsResult.push({
			key: rollupKey,
			label: otherLabel,
			count: other,
			isRollup: true,
		})
	}
	return { ranked, counts: countsResult }
}

export function createProfileAnalyticsCategoryAccumulator({
	listTypes,
	watchlists,
	plan,
	entryLimit,
}: {
	listTypes: ProfileAnalyticsListType[]
	watchlists: ProfileAnalyticsWatchlist[]
	plan: ProfileAnalyticsCategoryPlan
	entryLimit?: number
}) {
	const limit = boundedLimit(entryLimit)
	const watchlistType = new Map(
		watchlists.map(watchlist => [watchlist.id, watchlist.typeId]),
	)
	const states = new Map(
		listTypes.map(listType => [
			listType.id,
			exactCategoryState(
				plan.genres[listType.id] ?? [],
				plan.mediaTypes[listType.id] ?? [],
			),
		]),
	)
	let processed = 0
	let truncated = false

	function add(entry: ProfileAnalyticsEntry) {
		if (processed >= limit) {
			truncated = true
			return false
		}
		processed += 1

		const typeId = watchlistType.get(entry.watchlistId)
		const state = typeId ? states.get(typeId) : null
		if (!state) return true

		const genreIndexes: number[] = []
		for (const genre of genresFrom(entry.genres).genres) {
			state.totalGenres += 1
			const index = state.genreIndex.get(genre.key)
			if (index === undefined) continue
			state.genreCounts[index] = (state.genreCounts[index] ?? 0) + 1
			genreIndexes.push(index)
		}
		for (const row of genreIndexes) {
			for (const column of genreIndexes) {
				if (row === column) continue
				const matrixRow = state.genreMatrix[row]
				if (matrixRow) matrixRow[column] = (matrixRow[column] ?? 0) + 1
			}
		}

		const mediaType = normalizeCategory(entry.type)
		if (mediaType) {
			state.totalMediaTypes += 1
			const index = state.mediaTypeIndex.get(mediaType.key)
			if (index !== undefined) {
				state.mediaTypeCounts[index] = (state.mediaTypeCounts[index] ?? 0) + 1
			}
		}
		return true
	}

	function addMany(entries: Iterable<ProfileAnalyticsEntry>) {
		let accepted = 0
		for (const entry of entries) {
			if (!add(entry)) break
			accepted += 1
		}
		return accepted
	}

	function markTruncated() {
		truncated = true
	}

	function finish(): ProfileAnalyticsCategoryResult {
		const genreCounts: Record<string, ProfileCategoryCount[]> = {}
		const genreMatrices: Record<string, ProfileCategoryMatrix> = {}
		const mediaTypeCounts: Record<string, ProfileCategoryCount[]> = {}

		for (const listType of listTypes) {
			const state = states.get(listType.id)
			if (!state) continue
			const selectedGenres = topCategories(
				state.genreCandidates,
				state.genreCounts,
				state.totalGenres,
				'All other genres',
			)
			genreCounts[listType.id] = selectedGenres.counts
			genreMatrices[listType.id] = {
				labels: selectedGenres.ranked.map(candidate => candidate.label),
				values: selectedGenres.ranked.map(row =>
					selectedGenres.ranked.map(
						column => state.genreMatrix[row.index]?.[column.index] ?? 0,
					),
				),
			}
			mediaTypeCounts[listType.id] = topCategories(
				state.mediaTypeCandidates,
				state.mediaTypeCounts,
				state.totalMediaTypes,
				'All other types',
			).counts
		}

		return {
			genreCounts,
			genreMatrices,
			mediaTypeCounts,
			diagnostic: { processed, truncated, limit },
		}
	}

	return { add, addMany, markTruncated, finish }
}

export function finalizeProfileAnalytics(
	firstPass: ProfileAnalyticsFirstPass,
	categories: ProfileAnalyticsCategoryResult,
): ProfileAnalyticsResult {
	if (
		firstPass.diagnostic.processed !== categories.diagnostic.processed ||
		firstPass.diagnostic.limit !== categories.diagnostic.limit ||
		firstPass.diagnostic.truncated !== categories.diagnostic.truncated
	) {
		throw new Error(
			'Profile analytics category pass did not process the same bounded entry window',
		)
	}

	const { categoryPlan: _categoryPlan, ...base } = firstPass
	const {
		diagnostic: _categoryDiagnostic,
		genreCounts: _genreCounts,
		...categoryResult
	} = categories
	return { ...base, ...categoryResult }
}
