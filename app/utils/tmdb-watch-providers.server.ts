/**
 * Streaming availability from TMDB's watch-provider endpoint.
 *
 * The data is supplied by JustWatch. TMDB's terms require that the deep link
 * they return is the one used to send a viewer onward, and that JustWatch is
 * credited, so `link` is carried through unchanged and is mandatory: an offer
 * with no link cannot be attributed and is dropped rather than shown.
 *
 * Availability is regional and changes constantly, so every record is stamped
 * with when it was observed and expires on its own.
 */

export const TMDB_WATCH_PROVIDER_SOURCE = 'tmdb'
/** Availability is re-checked well inside this, so a stale row never shows. */
const AVAILABILITY_TTL_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1_000
const REGION_PATTERN = /^[A-Z]{2}$/

/** TMDB groups offers by how the viewer gets access. */
const OFFER_KINDS = ['flatrate', 'free', 'ads', 'rent', 'buy'] as const
export type WatchOfferKind = (typeof OFFER_KINDS)[number]

export type WatchProviderOffer = {
	region: string
	offerKind: WatchOfferKind
	providerId: number
	providerName: string
	logoPath: string | null
	displayPriority: number
	link: string
}

function optionalString(value: unknown) {
	return typeof value === 'string' && value.trim() ? value.trim() : null
}

function safeInteger(value: unknown) {
	return typeof value === 'number' && Number.isSafeInteger(value) ? value : null
}

/**
 * TMDB returns a `link` per region pointing at its own watch page, which is the
 * attributed destination. Anything else — a provider's own URL, a constructed
 * one — would break the terms the data is supplied under.
 */
function attributedLink(value: unknown) {
	const link = optionalString(value)
	if (!link) return null
	let url: URL
	try {
		url = new URL(link)
	} catch {
		return null
	}
	if (url.protocol !== 'https:') return null
	return url.hostname === 'www.themoviedb.org' ||
		url.hostname === 'themoviedb.org'
		? link
		: null
}

/**
 * Flatten one watch-provider payload into offers.
 *
 * Regions with no attributed link are skipped entirely: without it there is no
 * compliant way to send the viewer anywhere, so listing the providers would be
 * worse than showing nothing.
 */
export function normalizeWatchProviders(
	payload: unknown,
): WatchProviderOffer[] {
	if (!payload || typeof payload !== 'object' || Array.isArray(payload))
		return []
	const results = (payload as { results?: unknown }).results
	if (!results || typeof results !== 'object' || Array.isArray(results))
		return []

	const offers: WatchProviderOffer[] = []
	const seen = new Set<string>()
	for (const [region, value] of Object.entries(
		results as Record<string, unknown>,
	)) {
		if (!REGION_PATTERN.test(region)) continue
		if (!value || typeof value !== 'object' || Array.isArray(value)) continue
		const regionValue = value as Record<string, unknown>
		const link = attributedLink(regionValue.link)
		if (!link) continue

		for (const offerKind of OFFER_KINDS) {
			const entries = regionValue[offerKind]
			if (!Array.isArray(entries)) continue
			for (const entry of entries) {
				if (!entry || typeof entry !== 'object' || Array.isArray(entry))
					continue
				const provider = entry as Record<string, unknown>
				const providerId = safeInteger(provider.provider_id)
				const providerName = optionalString(provider.provider_name)
				if (providerId === null || providerId <= 0 || !providerName) continue
				// One provider can appear under several offer kinds for the same
				// region; each is a distinct way to watch, but never list it twice.
				const key = `${region}:${offerKind}:${providerId}`
				if (seen.has(key)) continue
				seen.add(key)
				offers.push({
					region,
					offerKind,
					providerId,
					providerName,
					logoPath: optionalString(provider.logo_path),
					displayPriority: safeInteger(provider.display_priority) ?? 0,
					link,
				})
			}
		}
	}
	offers.sort(
		(first, second) =>
			first.region.localeCompare(second.region) ||
			OFFER_KINDS.indexOf(first.offerKind) -
				OFFER_KINDS.indexOf(second.offerKind) ||
			first.displayPriority - second.displayPriority ||
			first.providerName.localeCompare(second.providerName),
	)
	return offers
}

/** When an observed availability record stops being trustworthy. */
export function watchAvailabilityExpiry(observedAt: Date) {
	return new Date(observedAt.getTime() + AVAILABILITY_TTL_DAYS * DAY_MS)
}

/**
 * How many titles one run per day can keep inside the freshness window.
 *
 * Availability expires on its own, so a queue larger than this does not slow
 * down — it silently stops covering the tail, and those titles show no
 * streaming at all rather than stale streaming. That failure is invisible from
 * the outside, which is why the worker checks it out loud.
 */
export function watchAvailabilityRefreshCapacity(dailyLimit: number) {
	if (!Number.isFinite(dailyLimit) || dailyLimit < 1) return 0
	return Math.trunc(dailyLimit) * AVAILABILITY_TTL_DAYS
}

/** Whether a run of this size can keep the whole queue fresh. */
export function watchAvailabilityKeepsUp(
	eligibleTitles: number,
	dailyLimit: number,
) {
	const capacity = watchAvailabilityRefreshCapacity(dailyLimit)
	if (!Number.isFinite(eligibleTitles) || eligibleTitles < 0) return false
	return eligibleTitles <= capacity
}

/** Offers for one region, in the order they should be shown. */
export function offersForRegion(offers: WatchProviderOffer[], region: string) {
	const wanted = region.trim().toUpperCase()
	return offers.filter(offer => offer.region === wanted)
}
