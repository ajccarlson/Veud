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

/**
 * Paths a crawler has no business being sent to.
 *
 * The route walk finds every page with a path, which is what makes it useful —
 * a new public page appears without anyone remembering to list it. It also
 * found `/login`, `/logout`, `/verify`, `/admin/cache`, `/admin/catalog`,
 * `/admin/operations` and `/moderation`, none of which a crawler should be
 * pointed at, and `/*`, the catch-all, which it emitted as a literal URL that
 * always 404s.
 *
 * Prefixes rather than exact paths, so a new admin or auth page is excluded the
 * day it is added rather than the day someone notices.
 */
const nonPublicPathPrefixes = [
	'admin',
	'auth',
	'moderation',
	'login',
	'logout',
	'signup',
	'onboarding',
	'verify',
	'appeal',
	'forgot-password',
	'reset-password',
	'settings',
	'me',
]

export function isPublicSitemapPath(path: string) {
	// The catch-all matches everything and resolves to nothing.
	if (path.includes('*')) return false
	// Dynamic segments cannot be enumerated from the manifest; the catalog
	// sitemap covers the one set of them that matters.
	if (path.includes(':')) return false
	const [head] = path.replace(/^\//, '').split('/')
	return !nonPublicPathPrefixes.includes(head ?? '')
}

type ManifestRoute = {
	path?: string
	index?: boolean
	parentId?: string
	module?: Record<string, unknown>
}

/**
 * Every public page in the route manifest, as sitemap paths.
 *
 * Resource routes — those with no component — are skipped the way the library
 * this replaces skipped them: a route that renders nothing is not a page.
 */
export function publicPageSitemapPaths(
	routes: Record<string, ManifestRoute | undefined>,
) {
	const paths = new Set<string>()
	for (const [id, route] of Object.entries(routes)) {
		if (!route || id === 'root') continue
		if (!route.module || !('default' in route.module)) continue

		let path = route.path
			? route.path.replace(/\/$/, '')
			: route.index
				? ''
				: null
		if (path === null) continue

		let parent = route.parentId ? routes[route.parentId] : undefined
		let parentId: string | undefined
		while (parent) {
			const parentPath = parent.path ? parent.path.replace(/\/$/, '') : ''
			path = `${parentPath}/${path}`
			parentId = parent.parentId
			parent = parentId ? routes[parentId] : undefined
		}
		const normalized = `/${path.replace(/^\/+/, '').replace(/\/$/, '')}`
		if (!isPublicSitemapPath(normalized)) continue
		paths.add(normalized === '/' ? '/' : normalized)
	}
	return [...paths].sort()
}

/**
 * The robots.txt directives, in the order a crawler reads them.
 *
 * This replaces `generateRobotsTxt` from `@nasa-gcn/remix-seo`, which was the
 * only runtime use left of a package whose unsatisfiable peer on
 * `@remix-run/react` forced `legacy-peer-deps=true` for the entire install.
 * Output is byte-identical to what that produced: the same default
 * `User-agent: *` and `Allow: /`, then the caller's directives, one per line.
 *
 * Nothing is disallowed, and that is settled rather than outstanding. The
 * sitemap knows which paths are not public, but robots.txt is a public document
 * that people read before crawlers do — `Disallow: /admin` publishes the
 * location of the administrative surface to anyone curious, in exchange for
 * crawl budget on pages that require authentication anyway. Those paths are
 * protected by auth and kept out of the sitemap, which is the half worth doing.
 */
export type RobotsDirective = {
	type: 'userAgent' | 'allow' | 'disallow' | 'sitemap' | 'crawlDelay'
	value: string
}

const robotsDirectiveLabels: Record<RobotsDirective['type'], string> = {
	userAgent: 'User-agent',
	allow: 'Allow',
	disallow: 'Disallow',
	sitemap: 'Sitemap',
	crawlDelay: 'Crawl-delay',
}

export function robotsTxt(directives: RobotsDirective[]) {
	return [
		{ type: 'userAgent', value: '*' } as const,
		{ type: 'allow', value: '/' } as const,
		...directives,
	]
		.map(
			directive =>
				`${robotsDirectiveLabels[directive.type]}: ${directive.value}\n`,
		)
		.join('')
}

export function robotsResponse(body: string) {
	return new Response(body, {
		headers: {
			'Content-Type': 'text/plain',
			'Content-Length': String(new TextEncoder().encode(body).byteLength),
		},
	})
}
