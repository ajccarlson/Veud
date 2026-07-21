export type TrackingProgressSnapshot = {
	unit: string
	current: number
	total: number | null
}

export type TrackingStateSnapshot = {
	status: string
	statusWatchlistId: string | null
	score: number | null
	startedAt: Date | null
	completedAt: Date | null
	repeatCount: number
	progress: TrackingProgressSnapshot[]
	sourceUpdatedAt: number
}

export type TrackingEntryLike = {
	personal?: unknown
	history?: unknown
	length?: unknown
	chapters?: unknown
	volumes?: unknown
}

type HistoryProgress = {
	current: number | null
	latestAt: number
	repeatCount: number
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null
}

function parseHistory(value: unknown): Record<string, unknown> {
	if (typeof value !== 'string' || !value || value === 'null') return {}
	try {
		return asRecord(JSON.parse(value)) ?? {}
	} catch {
		return {}
	}
}

function dateFromUnknown(value: unknown): Date | null {
	if (value === null || value === undefined || value === '' || value === 0) {
		return null
	}
	const date = new Date(value as string | number | Date)
	return Number.isNaN(date.getTime()) ? null : date
}

function dateMs(value: unknown) {
	return dateFromUnknown(value)?.getTime() ?? 0
}

function scoreFromUnknown(value: unknown) {
	const score = Number(value)
	return Number.isFinite(score) && score > 0 ? score : null
}

function counterFromField(value: unknown) {
	if (typeof value !== 'string' && typeof value !== 'number') return null
	const formatted = String(value)
	const values = [...formatted.matchAll(/\d+/g)].map(match => Number(match[0]))
	if (!values.length) return null

	const hasCurrent = formatted.includes('/')
	const totalValue = values.at(-1) ?? 0
	return {
		current: hasCurrent ? (values[0] ?? 0) : null,
		total: totalValue > 0 ? totalValue : null,
	}
}

function historyProgressFromRecord(value: unknown): HistoryProgress {
	const record = asRecord(value)
	if (!record) return { current: null, latestAt: 0, repeatCount: 0 }

	let current: number | null = null
	let latestAt = 0
	let repeatCount = 0
	for (const [progressKey, rawEvent] of Object.entries(record)) {
		if (!/^\d+$/.test(progressKey)) continue
		const event = asRecord(rawEvent)
		if (!event) continue
		const finishDates = Array.isArray(event.finishDate)
			? event.finishDate.map(dateMs).filter(Boolean)
			: []
		repeatCount = Math.max(repeatCount, finishDates.length - 1)
		const eventLatest = finishDates.length ? Math.max(...finishDates) : 0
		const numericProgress = Number(progressKey)
		if (
			eventLatest > latestAt ||
			(eventLatest === latestAt &&
				(current === null || numericProgress > current))
		) {
			current = numericProgress
			latestAt = eventLatest
		}
	}

	return { current, latestAt, repeatCount: Math.max(0, repeatCount) }
}

function normalizeUnit(value: string) {
	const formatted = value.toLowerCase().replace(/[^a-z]/g, '')
	if (formatted === 'episodes') return 'episode'
	if (formatted === 'chapters') return 'chapter'
	if (formatted === 'volumes') return 'volume'
	return formatted || 'item'
}

function historyProgressByUnit(
	history: Record<string, unknown>,
	mediaKind: string,
) {
	const progress = asRecord(history.progress)
	const result = new Map<string, HistoryProgress>()
	if (!progress) return result

	const hasNumericKeys = Object.keys(progress).some(key => /^\d+$/.test(key))
	if (hasNumericKeys) {
		const unit =
			mediaKind === 'anime' || mediaKind === 'tv' ? 'episode' : 'item'
		result.set(unit, historyProgressFromRecord(progress))
	}

	for (const [rawUnit, value] of Object.entries(progress)) {
		if (/^\d+$/.test(rawUnit)) continue
		result.set(normalizeUnit(rawUnit), historyProgressFromRecord(value))
	}
	return result
}

function explicitRepeatCount(history: Record<string, unknown>) {
	const rawValue = history.repeatCount ?? history.rewatchCount
	if (rawValue === null || rawValue === undefined || rawValue === '') return null
	const value = Number(rawValue)
	return Number.isSafeInteger(value) && value >= 0 ? value : null
}

export function trackingStateFromEntry(
	entry: TrackingEntryLike,
	context: {
		status: string
		statusWatchlistId?: string | null
		mediaKind: string
	},
): TrackingStateSnapshot {
	const history = parseHistory(entry.history)
	const historyProgress = historyProgressByUnit(history, context.mediaKind)
	const progress = new Map<string, TrackingProgressSnapshot>()

	const addProgress = (unit: string, fieldValue: unknown, allowed = true) => {
		if (!allowed) return
		const field = counterFromField(fieldValue)
		const historical = historyProgress.get(unit)
		const current = field?.current ?? historical?.current
		if (current === null || current === undefined) {
			if (field?.total === null || field?.total === undefined) return
		}
		progress.set(unit, {
			unit,
			current: Math.max(0, current ?? 0),
			total: field?.total ?? null,
		})
	}

	addProgress(
		'episode',
		entry.length,
		(context.mediaKind === 'anime' || context.mediaKind === 'tv') &&
			typeof entry.length === 'string' &&
			/eps?\b/i.test(entry.length),
	)
	addProgress('chapter', entry.chapters, context.mediaKind === 'manga')
	addProgress('volume', entry.volumes, context.mediaKind === 'manga')

	for (const [unit, historical] of historyProgress) {
		if (progress.has(unit) || historical.current === null) continue
		progress.set(unit, {
			unit,
			current: Math.max(0, historical.current),
			total: null,
		})
	}

	const explicitRepeats = explicitRepeatCount(history)
	let repeatCount = explicitRepeats ?? 0
	if (explicitRepeats === null) {
		for (const historical of historyProgress.values()) {
			repeatCount = Math.max(repeatCount, historical.repeatCount)
		}
	}

	return {
		status: context.status.trim() || 'tracked',
		statusWatchlistId: context.statusWatchlistId ?? null,
		score: scoreFromUnknown(entry.personal),
		startedAt: dateFromUnknown(history.started),
		completedAt: dateFromUnknown(history.finished),
		repeatCount,
		progress: [...progress.values()].sort((a, b) =>
			a.unit.localeCompare(b.unit),
		),
		sourceUpdatedAt: Math.max(
			dateMs(history.lastUpdated),
			dateMs(history.finished),
			dateMs(history.started),
			dateMs(history.added),
		),
	}
}
