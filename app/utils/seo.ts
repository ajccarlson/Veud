import { type MetaDescriptor } from 'react-router'

/**
 * The metadata a link carries when it leaves the site.
 *
 * Every page here had a `<title>` and a description and nothing else, so a Veud
 * link pasted into a chat, a forum, or a search result arrived as a bare URL —
 * no title, no artwork, no summary. Sharing a title you are excited about is
 * one of the things this site is for, and it was the one place that showed
 * nothing.
 *
 * Two audiences, two vocabularies: OpenGraph and Twitter cards for the
 * link-unfurling in chat apps and social sites, and Schema.org JSON-LD for
 * search engines, which use it to build the richer result with a rating and a
 * release year attached.
 */

export const SITE_NAME = 'Veud'

/**
 * Long enough to say something useful, short enough that no card cuts it off
 * mid-sentence. Cards vary; this is under every limit worth honouring.
 */
export const MAX_SOCIAL_DESCRIPTION = 200

/**
 * Provider synopses arrive with markup in them — `<br>` between paragraphs and
 * HTML entities from the source page. Nothing renders it as HTML, so it reaches
 * a card as literal angle brackets and `&mdash;`.
 *
 * This is deliberately conservative rather than a sanitizer: it removes tags
 * and decodes the handful of entities that actually show up, and leaves
 * anything stranger alone. Nothing here relies on it for safety — React escapes
 * every attribute it writes — so being incomplete is a cosmetic cost, not a
 * hole.
 */
function flattenProviderText(text: string) {
	return text
		.replace(/<[^>]*>/g, ' ')
		.replace(
			/&(nbsp|amp|quot|apos|#39|mdash|ndash|hellip|lsquo|rsquo);/g,
			entity =>
				({
					'&nbsp;': ' ',
					'&amp;': '&',
					'&quot;': '"',
					'&apos;': "'",
					'&#39;': "'",
					'&mdash;': '—',
					'&ndash;': '–',
					'&hellip;': '…',
					'&lsquo;': '‘',
					'&rsquo;': '’',
				})[entity] ?? entity,
		)
		.replace(/\s+/g, ' ')
		.trim()
}

/**
 * A one-line summary for a card, cut at a word boundary.
 *
 * Falls back rather than returning an empty string: a card with no description
 * is worse than a generic one, because the unfurl looks broken instead of
 * plain.
 */
/**
 * Collapse whitespace without touching the words.
 *
 * Provider synopses arrive with markup in them, which is why the stripper
 * exists. A member's own description is not provider text: `Films < 90 minutes`
 * or `Everything I rated > 8` looks like a tag to a regular expression, and
 * stripping it deletes the sentence they actually wrote from the card while
 * their own page still shows it in full.
 */
function flattenAuthoredText(text: string) {
	return text.replace(/\s+/g, ' ').trim()
}

export function socialDescription(
	text: string | null | undefined,
	fallback: string,
	{
		limit = MAX_SOCIAL_DESCRIPTION,
		source = 'provider',
	}: { limit?: number; source?: 'provider' | 'member' } = {},
) {
	const flat =
		source === 'member'
			? flattenAuthoredText(text ?? '')
			: flattenProviderText(text ?? '')
	if (!flat) return fallback
	if (flat.length <= limit) return flat
	const cut = flat.slice(0, limit)
	const lastSpace = cut.lastIndexOf(' ')
	return `${(lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

/**
 * An absolute URL, which is what every consumer here requires — a crawler and a
 * chat server both fetch these without the page's context, so a path alone
 * resolves against the wrong host or nothing at all.
 *
 * Provider artwork already arrives absolute and is passed through; anything
 * else is resolved against this site.
 */
export function absoluteUrl(
	origin: string,
	value: string | null | undefined,
): string | null {
	if (!value) return null
	try {
		const url = new URL(value, origin)
		// A crawler will not fetch anything else, and `javascript:` in a
		// server-rendered tag is not something to hand on regardless of who wrote
		// the row.
		return url.protocol === 'https:' || url.protocol === 'http:'
			? url.toString()
			: null
	} catch {
		return null
	}
}

export type SocialMetaInput = {
	title: string
	description: string
	/** Absolute, and the address this page should be indexed under. */
	url: string | null
	/** Absolute. Omitted entirely when there is no artwork, never sent empty. */
	image?: string | null
	imageAlt?: string
	/** OpenGraph's vocabulary: `website`, `article`, `profile`, `video.movie`… */
	type?: string
}

/**
 * The OpenGraph and Twitter tags for one page, plus its canonical link.
 *
 * Both vocabularies are emitted because neither is universal: most chat apps
 * read OpenGraph, and several still read only Twitter's. They carry the same
 * facts, so they cannot disagree.
 */
export function socialMeta({
	title,
	description,
	url,
	image,
	imageAlt,
	type = 'website',
}: SocialMetaInput): MetaDescriptor[] {
	const tags: MetaDescriptor[] = [
		{ title },
		{ name: 'description', content: description },
		{ property: 'og:site_name', content: SITE_NAME },
		{ property: 'og:type', content: type },
		{ property: 'og:title', content: title },
		{ property: 'og:description', content: description },
		// A card with artwork is shown large; one without is a small summary. The
		// difference is why the image is worth threading through.
		{
			name: 'twitter:card',
			content: image ? 'summary_large_image' : 'summary',
		},
		{ name: 'twitter:title', content: title },
		{ name: 'twitter:description', content: description },
	]
	if (url) {
		tags.push({ property: 'og:url', content: url })
		// Canonical belongs with the rest of this: the same page is reachable with
		// tracking parameters attached, and every one of those is a duplicate.
		tags.push({ tagName: 'link', rel: 'canonical', href: url })
	}
	if (image) {
		tags.push({ property: 'og:image', content: image })
		tags.push({ name: 'twitter:image', content: image })
		if (imageAlt) {
			tags.push({ property: 'og:image:alt', content: imageAlt })
			tags.push({ name: 'twitter:image:alt', content: imageAlt })
		}
	}
	return tags
}

/**
 * The site's own origin, which only the root loader knows.
 *
 * A `MetaFunction` gets the location but not the host, and every tag here has
 * to be absolute. Rather than hard-coding a domain — which would be wrong in
 * development, wrong in the browser tests, and wrong the day the domain changes
 * — this reads the origin the root loader already derived from the request.
 *
 * Returns an empty string when the root match has no data, which happens on an
 * error boundary. The callers below then omit the URL rather than emitting a
 * relative one.
 */
export function originFromMatches(
	matches: ReadonlyArray<{ id: string; loaderData?: unknown; data?: unknown }>,
) {
	const root = matches.find(match => match.id === 'root')
	const data = (root?.loaderData ?? root?.data) as
		{ requestInfo?: { origin?: string } } | undefined
	return data?.requestInfo?.origin ?? ''
}

/**
 * The catalog's four kinds in OpenGraph's and Schema.org's vocabularies.
 *
 * Anime is the awkward one: the kind says how it was catalogued, not what shape
 * it is, and an anime film is not a series. `type` is the provider's own word
 * for it, so it decides when it says so.
 *
 * Manga has no Schema.org type of its own. `Book` is the nearest thing search
 * engines actually consume; `ComicSeries` exists but is understood by less.
 */
function isFilm(kind: string, type: string | null | undefined) {
	if (kind === 'movie') return true
	if (kind === 'tv' || kind === 'manga') return false
	return /movie|film/i.test(type ?? '')
}

export function openGraphType(kind: string, type?: string | null) {
	if (kind === 'manga') return 'book'
	return isFilm(kind, type) ? 'video.movie' : 'video.tv_show'
}

export function schemaTypeForKind(kind: string, type?: string | null) {
	if (kind === 'manga') return 'Book'
	return isFilm(kind, type) ? 'Movie' : 'TVSeries'
}

/** The catalog stores genres as one comma-separated string. */
export function splitGenres(genres: string | null | undefined) {
	return (genres ?? '')
		.split(',')
		.map(genre => genre.trim())
		.filter(Boolean)
}

/**
 * `YYYY-MM-DD`, which is what `datePublished` means.
 *
 * Loader data arrives as an ISO string rather than a Date, so both are
 * accepted; anything unparseable becomes null and is dropped rather than
 * published as a broken claim.
 */
export function isoDate(value: Date | string | null | undefined) {
	if (!value) return null
	const date = value instanceof Date ? value : new Date(value)
	return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10)
}

/** A JSON-LD block, which is how search engines read structured facts. */
export function structuredData(data: Record<string, unknown>): MetaDescriptor {
	return { 'script:ld+json': { '@context': 'https://schema.org', ...data } }
}

/**
 * Drop keys with nothing behind them.
 *
 * Structured data is read by machines that treat an empty string as a claim.
 * Saying nothing about a release date is honest; saying it is `""` is not.
 */
export function withoutEmptyValues<T extends Record<string, unknown>>(data: T) {
	return Object.fromEntries(
		Object.entries(data).filter(
			([, value]) =>
				value !== null &&
				value !== undefined &&
				value !== '' &&
				!(Array.isArray(value) && value.length === 0),
		),
	)
}
