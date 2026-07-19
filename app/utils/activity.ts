export type ActivityEventLike = {
	type: string
	status?: string | null
	statusLabel?: string | null
	previousStatus?: string | null
	previousStatusLabel?: string | null
	score?: unknown
	previousScore?: unknown
	progressUnit?: string | null
	progressCurrent?: number | null
	progressPrevious?: number | null
	progressTotal?: number | null
}

function titleCase(value: string) {
	return value
		.replace(/([a-z])([A-Z])/g, '$1 $2')
		.replace(/[-_]+/g, ' ')
		.replace(/\b\w/g, character => character.toUpperCase())
}

function statusLabel(label: string | null | undefined, status: string | null | undefined) {
	return label?.trim() || (status ? titleCase(status) : 'Tracked')
}

function progressCopy(unit: string) {
	if (unit === 'episode') return { verb: 'Watched', singular: 'episode', plural: 'episodes' }
	if (unit === 'chapter') return { verb: 'Read', singular: 'chapter', plural: 'chapters' }
	if (unit === 'volume') return { verb: 'Read', singular: 'volume', plural: 'volumes' }
	return { verb: 'Completed', singular: unit, plural: `${unit}s` }
}

export function activityEventLabel(event: ActivityEventLike) {
	if (event.type === 'status') {
		const next = statusLabel(event.statusLabel, event.status)
		if (!event.previousStatus) return `Added to ${next}`
		const previous = statusLabel(
			event.previousStatusLabel,
			event.previousStatus,
		)
		return previous === next ? `Updated status to ${next}` : `Moved from ${previous} to ${next}`
	}

	if (event.type === 'score') {
		const score = event.score === null || event.score === undefined ? null : Number(event.score)
		return score === null || !Number.isFinite(score)
			? 'Removed rating'
			: `Rated ${score.toLocaleString('en-US', { maximumFractionDigits: 1 })}/10`
	}

	if (event.type === 'progress') {
		const unit = event.progressUnit || 'item'
		const current = event.progressCurrent ?? 0
		const previous = event.progressPrevious ?? 0
		const copy = progressCopy(unit)
		if (current > previous) {
			const first = previous + 1
			return current === first
				? `${copy.verb} ${copy.singular} ${current}`
				: `${copy.verb} ${copy.plural} ${first}–${current}`
		}
		return `Set ${copy.singular} progress to ${current}`
	}

	return titleCase(event.type)
}

export function activityListTypeName(mediaKind: string) {
	if (mediaKind === 'movie' || mediaKind === 'tv') return 'liveaction'
	if (mediaKind === 'anime' || mediaKind === 'manga') return mediaKind
	return null
}
