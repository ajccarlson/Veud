import { type MediaCatalogSnapshot } from './media-catalog.ts'

export type MediaFact = { label: string; value: string }

function clean(value: unknown) {
	return typeof value === 'string' ? value.trim() || null : null
}

function catalogNames(value: unknown) {
	const raw = clean(value)
	if (!raw || raw.length > 16_000) return null
	try {
		const parsed: unknown = JSON.parse(raw)
		if (!Array.isArray(parsed)) return raw
		const names = parsed.flatMap(item => {
			if (typeof item !== 'string') return []
			const name = item.split('|', 1)[0]?.trim()
			return name ? [name] : []
		})
		return names.length ? names.join(', ') : null
	} catch {
		return raw
	}
}

function positiveCount(value: unknown) {
	return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
		? value.toLocaleString('en-US')
		: null
}

function runtime(minutes: unknown, perEpisode: boolean) {
	if (
		typeof minutes !== 'number' ||
		!Number.isSafeInteger(minutes) ||
		minutes < 1
	)
		return null
	const hours = Math.floor(minutes / 60)
	const remainder = minutes % 60
	const value = [hours ? `${hours}h` : '', remainder ? `${remainder}m` : '']
		.filter(Boolean)
		.join(' ')
	return perEpisode ? `${value} per episode` : value
}

/** Anime and TV formats whose runtime describes the whole work. */
const singleRuntimeFormats = new Set(['movie', 'music'])

/**
 * Whether a runtime describes one instalment rather than the whole work.
 *
 * Kind alone is not enough. An anime film and a one-shot OVA are both kind
 * 'anime', and "2h 5m per episode" on a film is simply wrong.
 */
function episodic(kind: string, catalog: MediaCatalogSnapshot) {
	if (kind !== 'anime' && kind !== 'tv') return false
	// More than one instalment is episodic whatever the provider calls the
	// format. MAL files multi-part films as "Movie" — 5 Centimeters per Second
	// is three, Genius Party seven, Die Neue These twelve — and the runtime
	// stored against them is one part's, not the whole work's. Checking the
	// format first said "2h 5m" for something nobody can watch in 2h 5m.
	if (typeof catalog.episodeCount === 'number' && catalog.episodeCount > 1) {
		return true
	}
	if (catalog.episodeCount === 1) return false
	const format = clean(catalog.type)?.toLowerCase()
	return !(format && singleRuntimeFormats.has(format))
}

function usd(value: unknown) {
	const raw = clean(value)
	if (!raw || !/^\d{1,20}$/.test(raw) || raw === '0') return null
	try {
		return new Intl.NumberFormat('en-US', {
			style: 'currency',
			currency: 'USD',
			maximumFractionDigits: 0,
		}).format(BigInt(raw))
	} catch {
		return null
	}
}

function add(facts: MediaFact[], label: string, value: string | null) {
	if (value) facts.push({ label, value })
}

export function mediaFacts(
	kind: string,
	catalog: MediaCatalogSnapshot,
): MediaFact[] {
	const facts: MediaFact[] = []
	add(facts, 'Status', clean(catalog.releaseStatus))
	add(facts, 'Format', clean(catalog.type))
	const originalTitle = clean(catalog.originalTitle)
	if (
		originalTitle &&
		originalTitle.localeCompare(clean(catalog.title) ?? '', undefined, {
			sensitivity: 'accent',
		}) !== 0
	) {
		add(facts, 'Original title', originalTitle)
	}
	add(facts, 'Original language', clean(catalog.language))
	add(
		facts,
		'Runtime',
		runtime(catalog.runtimeMinutes, episodic(kind, catalog)),
	)
	add(facts, 'Episodes', positiveCount(catalog.episodeCount))
	add(facts, 'Chapters', positiveCount(catalog.chapterCount))
	add(facts, 'Volumes', positiveCount(catalog.volumeCount))
	add(facts, 'Certification', clean(catalog.rating))
	add(facts, 'Studios', catalogNames(catalog.studios))
	add(facts, 'Networks', catalogNames(catalog.networks))
	add(facts, 'Serialization', catalogNames(catalog.serialization))
	add(facts, 'Authors', catalogNames(catalog.authors))
	add(facts, 'Budget', usd(catalog.budget))
	add(facts, 'Revenue', usd(catalog.revenue))
	add(facts, 'Keywords', catalogNames(catalog.keywords))
	return facts
}
