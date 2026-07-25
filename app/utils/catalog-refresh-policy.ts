const DAY_MS = 24 * 60 * 60 * 1_000

type CatalogRefreshInput = {
	defaultDays: number
	entryCount: number
	releaseStatus?: unknown
	releaseEnd?: unknown
	nextRelease?: unknown
	now?: Date
}

const activeStatusTerms = [
	'currently airing',
	'currently publishing',
	'returning',
	'planned',
	'production',
	'ongoing',
	'upcoming',
	'not yet',
]

const settledStatusTerms = [
	'finished',
	'ended',
	'released',
	'completed',
	'cancelled',
	'canceled',
	'discontinued',
]

function validDate(value: unknown) {
	if (value instanceof Date && Number.isFinite(value.getTime())) return value
	if (typeof value !== 'string' && typeof value !== 'number') return null
	const date = new Date(value)
	return Number.isFinite(date.getTime()) ? date : null
}

function nextReleaseDate(value: unknown): Date | null {
	if (value === null || value === undefined || value === '') return null
	let candidate: unknown = value
	if (typeof value === 'string') {
		try {
			candidate = JSON.parse(value)
		} catch {
			return validDate(value)
		}
	}
	if (!candidate || typeof candidate !== 'object') return validDate(candidate)
	const record = candidate as Record<string, unknown>
	return validDate(
		record.releaseDate ??
			record.releaseAt ??
			record.airingAt ??
			record.date ??
			null,
	)
}

/**
 * Provider-wide catalogs can refresh slowly, but titles somebody actively
 * tracks need tighter freshness. Ongoing titles refresh every two days, recent
 * completions weekly, and settled titles monthly.
 */
export function catalogRefreshDays(input: CatalogRefreshInput) {
	if (!Number.isSafeInteger(input.defaultDays) || input.defaultDays < 1) {
		throw new Error('defaultDays must be a positive safe integer')
	}
	if (!Number.isSafeInteger(input.entryCount) || input.entryCount < 0) {
		throw new Error('entryCount must be a non-negative safe integer')
	}
	if (input.entryCount === 0) return input.defaultDays

	const now = input.now ?? new Date()
	const status =
		typeof input.releaseStatus === 'string'
			? input.releaseStatus.trim().toLowerCase()
			: ''
	const nextRelease = nextReleaseDate(input.nextRelease)
	if (
		(!settledStatusTerms.some(term => status.includes(term)) &&
			activeStatusTerms.some(term => status.includes(term))) ||
		(nextRelease !== null && nextRelease > now)
	) {
		return Math.min(input.defaultDays, 2)
	}

	const releaseEnd = validDate(input.releaseEnd)
	if (
		releaseEnd &&
		releaseEnd.getTime() >= now.getTime() - 60 * DAY_MS
	) {
		return Math.min(input.defaultDays, 7)
	}
	return Math.min(input.defaultDays, 30)
}

export function catalogRefreshAfter(
	input: CatalogRefreshInput & { fetchedAt: Date },
) {
	return new Date(
		input.fetchedAt.getTime() + catalogRefreshDays(input) * DAY_MS,
	)
}

export function catalogRefreshIsOverdue(
	input: CatalogRefreshInput & {
		lastFetchedAt: Date | null
		refreshAfter: Date | null
	},
) {
	if (!input.lastFetchedAt) return true
	const dueAt = catalogRefreshAfter({
		...input,
		fetchedAt: input.lastFetchedAt,
	})
	return (
		dueAt <= (input.now ?? new Date()) &&
		(!input.refreshAfter || input.refreshAfter > dueAt)
	)
}
