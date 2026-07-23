export type RecommendationLaneKey =
	'connected' | 'circle' | 'collections' | 'taste'

export type RecommendationGraphItem = {
	id: string
	kind: string
	title: string
	thumbnail: string | null
	type: string | null
	year: string | null
	reasons: string[]
	viewerTracking: null
}

export type RecommendationLane = {
	key: RecommendationLaneKey
	title: string
	description: string
	items: RecommendationGraphItem[]
}

export type RecommendationGraph = {
	lanes: RecommendationLane[]
	hiddenItems: Array<{
		id: string
		title: string
		feedbackType: string
	}>
	summary: {
		positiveSeeds: number
		preferredGenres: string[]
		followingCount: number
		hiddenCount: number
	}
}
