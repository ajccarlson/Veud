import { type TrackingEntryLike } from './tracking-state.ts'

export { listTypeNameForMediaKind } from './media-kind.ts'

export type SupportedProgressUnit = 'episode' | 'chapter' | 'volume'

export type LegacyProgressUpdate = {
	history: string
	length?: string
	chapters?: string
	volumes?: string
}

export function progressUnitsForMediaKind(
	kind: string,
): SupportedProgressUnit[] {
	if (kind === 'anime' || kind === 'tv') return ['episode']
	if (kind === 'manga') return ['chapter', 'volume']
	return []
}

export function splitLegacyThumbnail(thumbnail: string | null | undefined) {
	if (!thumbnail) return { imageUrl: null, externalUrl: null }
	const separatorIndex = thumbnail.lastIndexOf('|')
	if (separatorIndex < 0) {
		return { imageUrl: thumbnail, externalUrl: null }
	}
	return {
		imageUrl: thumbnail.slice(0, separatorIndex) || null,
		externalUrl: thumbnail.slice(separatorIndex + 1) || null,
	}
}

export function externalMediaUrl(identity: {
	provider: string
	kind: string
	externalId: string
}) {
	if (identity.provider === 'tmdb') {
		return `https://www.themoviedb.org/${identity.kind}/${identity.externalId}`
	}
	if (identity.provider === 'mal') {
		return `https://myanimelist.net/${identity.kind}/${identity.externalId}`
	}
	return null
}

export function totalFromLegacyCounter(value: unknown) {
	if (typeof value !== 'string' && typeof value !== 'number') return null
	const values = [...String(value).matchAll(/\d+/g)].map(match =>
		Number(match[0]),
	)
	const total = values.at(-1)
	return total && total > 0 ? total : null
}

function asRecord(value: unknown): Record<string, any> | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, any>)
		: null
}

function parseHistory(value: unknown) {
	if (typeof value !== 'string' || !value || value === 'null') return null
	try {
		return asRecord(JSON.parse(value))
	} catch {
		return null
	}
}

function progressField(unit: SupportedProgressUnit) {
	if (unit === 'episode') return 'length' as const
	if (unit === 'chapter') return 'chapters' as const
	return 'volumes' as const
}

function formattedCounter(
	unit: SupportedProgressUnit,
	current: number,
	total: number | null,
) {
	const counter = total ? `${current} / ${total}` : String(current)
	return unit === 'episode' ? `${counter} eps` : counter
}

/**
 * Mirror a normalized progress edit into Entry's counter and history fields.
 * A completion event is only added when progress increases, so saving the same
 * value twice does not accidentally manufacture repeat activity.
 */
export function legacyProgressUpdate(
	entry: TrackingEntryLike,
	input: {
		unit: SupportedProgressUnit
		current: number
		previousCurrent: number
		total: number | null
		now?: number
	},
): LegacyProgressUpdate {
	const now = input.now ?? Date.now()
	const history = parseHistory(entry.history) ?? {
		added: now,
		started: null,
		finished: null,
		progress: null,
		lastUpdated: now,
	}
	history.lastUpdated = now

	if (input.current > input.previousCurrent) {
		const rootProgress = asRecord(history.progress) ?? {}
		history.progress = rootProgress
		const progress =
			input.unit === 'episode'
				? rootProgress
				: (asRecord(rootProgress[input.unit]) ?? {})
		if (input.unit !== 'episode') rootProgress[input.unit] = progress

		const progressKey = String(input.current)
		const event = asRecord(progress[progressKey]) ?? {
			completed: false,
			finishDate: [],
		}
		progress[progressKey] = event
		event.completed = true
		const finishDate = Array.isArray(event.finishDate) ? event.finishDate : []
		event.finishDate = finishDate
		finishDate.push(now)
	}

	return {
		[progressField(input.unit)]: formattedCounter(
			input.unit,
			input.current,
			input.total,
		),
		history: JSON.stringify(history),
	} as LegacyProgressUpdate
}
