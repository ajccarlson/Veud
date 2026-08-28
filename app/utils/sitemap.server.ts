/**
 * The catalog's own pages, told to crawlers.
 *
 * The generated sitemap lists the route manifest — a few dozen static paths —
 * while the catalog it exists to serve is orders of magnitude larger. A page
 * nothing links to and no sitemap mentions is a page search engines will not
 * find, so the whole point of having canonical media pages was going unused.
 */

/**
 * Sitemaps may hold 50,000 URLs. Half that keeps each response comfortably
 * inside the 50MB uncompressed limit and keeps the database read bounded.
 */
export const SITEMAP_PAGE_SIZE = 25_000

/**
 * A ceiling on how many chunks the index will advertise, so a catalog that
 * grows unexpectedly cannot produce an unbounded index, and a crafted request
 * for page 10,000,000 is rejected rather than issuing a query for it.
 */
export const SITEMAP_MAX_PAGES = 200

export function sitemapPageCount(total: number) {
	if (!Number.isFinite(total) || total <= 0) return 0
	return Math.min(SITEMAP_MAX_PAGES, Math.ceil(total / SITEMAP_PAGE_SIZE))
}

/** `1` for the first page; anything else is not a page this serves. */
export function parseSitemapPage(raw: string | undefined) {
	if (!raw || !/^[1-9][0-9]{0,6}$/.test(raw)) return null
	const page = Number(raw)
	return page > SITEMAP_MAX_PAGES ? null : page
}

function escapeXml(value: string) {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&apos;')
}

export type SitemapEntry = {
	loc: string
	lastmod?: Date | string | null
	changefreq?: string
	priority?: number
}

function lastmodValue(value: Date | string | null | undefined) {
	if (!value) return null
	const date = typeof value === 'string' ? new Date(value) : value
	return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function entryXml(tag: 'url' | 'sitemap', entry: SitemapEntry) {
	const lastmod = lastmodValue(entry.lastmod)
	return [
		`\t<${tag}>`,
		`\t\t<loc>${escapeXml(entry.loc)}</loc>`,
		...(lastmod ? [`\t\t<lastmod>${lastmod}</lastmod>`] : []),
		...(entry.changefreq
			? [`\t\t<changefreq>${escapeXml(entry.changefreq)}</changefreq>`]
			: []),
		...(entry.priority !== undefined
			? [`\t\t<priority>${entry.priority.toFixed(1)}</priority>`]
			: []),
		`\t</${tag}>`,
	].join('\n')
}

export function urlSetXml(entries: SitemapEntry[]) {
	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
		...entries.map(entry => entryXml('url', entry)),
		'</urlset>',
		'',
	].join('\n')
}

export function sitemapIndexXml(entries: SitemapEntry[]) {
	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
		...entries.map(entry =>
			entryXml('sitemap', { loc: entry.loc, lastmod: entry.lastmod }),
		),
		'</sitemapindex>',
		'',
	].join('\n')
}

export function xmlResponse(body: string, maxAgeSeconds: number) {
	return new Response(body, {
		headers: {
			'Content-Type': 'application/xml; charset=utf-8',
			'Cache-Control': `public, max-age=${maxAgeSeconds}`,
		},
	})
}
