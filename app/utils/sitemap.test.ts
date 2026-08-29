import { expect, test } from 'vitest'
import {
	SITEMAP_MAX_PAGES,
	SITEMAP_PAGE_SIZE,
	isPublicSitemapPath,
	parseSitemapPage,
	publicPageSitemapPaths,
	robotsResponse,
	robotsTxt,
	sitemapIndexXml,
	sitemapPageCount,
	urlSetXml,
} from './sitemap.server.ts'

test('the catalog is split into whole chunks', () => {
	expect(sitemapPageCount(0)).toBe(0)
	expect(sitemapPageCount(1)).toBe(1)
	expect(sitemapPageCount(SITEMAP_PAGE_SIZE)).toBe(1)
	// A single leftover title still deserves a chunk of its own.
	expect(sitemapPageCount(SITEMAP_PAGE_SIZE + 1)).toBe(2)
	expect(sitemapPageCount(1_500_000)).toBe(60)
})

test('a catalog larger than expected does not produce an unbounded index', () => {
	expect(sitemapPageCount(SITEMAP_PAGE_SIZE * (SITEMAP_MAX_PAGES + 50))).toBe(
		SITEMAP_MAX_PAGES,
	)
	expect(sitemapPageCount(Number.POSITIVE_INFINITY)).toBe(0)
	expect(sitemapPageCount(-5)).toBe(0)
})

test('only a real page number is served', () => {
	expect(parseSitemapPage('1')).toBe(1)
	expect(parseSitemapPage('60')).toBe(60)
	// Pages this route will never advertise are refused before a query is issued.
	expect(parseSitemapPage(String(SITEMAP_MAX_PAGES + 1))).toBeNull()
	expect(parseSitemapPage('0')).toBeNull()
	expect(parseSitemapPage('01')).toBeNull()
	expect(parseSitemapPage('-1')).toBeNull()
	expect(parseSitemapPage('1e6')).toBeNull()
	expect(parseSitemapPage('9999999999')).toBeNull()
	expect(parseSitemapPage(undefined)).toBeNull()
})

test('a url set is well formed and carries what crawlers use', () => {
	const xml = urlSetXml([
		{
			loc: 'https://veud.test/media/abc',
			lastmod: new Date('2026-08-01T10:00:00.000Z'),
			changefreq: 'weekly',
		},
	])
	expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>')
	expect(xml).toContain(
		'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
	)
	expect(xml).toContain('<loc>https://veud.test/media/abc</loc>')
	expect(xml).toContain('<lastmod>2026-08-01T10:00:00.000Z</lastmod>')
	expect(xml).toContain('<changefreq>weekly</changefreq>')
	expect(xml.trimEnd().endsWith('</urlset>')).toBe(true)
})

test('an unusable timestamp is omitted rather than emitted broken', () => {
	// An invalid <lastmod> makes a crawler reject the whole file, so a missing
	// or unparseable date has to become no element at all.
	const xml = urlSetXml([
		{ loc: 'https://veud.test/media/a', lastmod: null },
		{ loc: 'https://veud.test/media/b', lastmod: 'not a date' },
	])
	expect(xml).not.toContain('<lastmod>')
	expect(xml).toContain('<loc>https://veud.test/media/a</loc>')
})

test('a url that needs escaping does not break the document', () => {
	const xml = urlSetXml([{ loc: 'https://veud.test/media/a?x=1&y=2<script>' }])
	expect(xml).toContain(
		'<loc>https://veud.test/media/a?x=1&amp;y=2&lt;script&gt;</loc>',
	)
	expect(xml).not.toContain('<script>')
})

test('the index points at the other sitemaps, not at pages', () => {
	const xml = sitemapIndexXml([
		{ loc: 'https://veud.test/sitemap/pages.xml' },
		{
			loc: 'https://veud.test/sitemap/media/1.xml',
			lastmod: new Date('2026-08-02T00:00:00.000Z'),
		},
	])
	expect(xml).toContain(
		'<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
	)
	expect(xml).toContain('<sitemap>')
	// A sitemap index must not contain <url> elements.
	expect(xml).not.toContain('<url>')
	expect(xml).toContain('<loc>https://veud.test/sitemap/media/1.xml</loc>')
})

test('the catch-all route is never advertised', () => {
	// `generateSitemap` emitted this as a literal `/*`, a URL that always 404s,
	// because it only skipped paths containing a colon.
	expect(isPublicSitemapPath('/*')).toBe(false)
	expect(isPublicSitemapPath('/media/*')).toBe(false)
})

test('sign-in, admin and moderation surfaces are never advertised', () => {
	for (const path of [
		'/login',
		'/logout',
		'/signup',
		'/verify',
		'/appeal',
		'/onboarding',
		'/forgot-password',
		'/reset-password',
		'/admin/cache',
		'/admin/operations',
		'/moderation',
		'/auth/github',
	]) {
		expect(isPublicSitemapPath(path), `${path} should not be advertised`).toBe(
			false,
		)
	}
})

test('real public pages still are', () => {
	for (const path of ['/', '/discover', '/calendar', '/reviews', '/support']) {
		expect(isPublicSitemapPath(path), `${path} should be advertised`).toBe(true)
	}
})

test('a path that merely starts with an excluded word is still public', () => {
	// Prefix matching is on whole path segments, so a future `/loginless` or
	// `/administration` page is not excluded by accident.
	expect(isPublicSitemapPath('/administration')).toBe(true)
	expect(isPublicSitemapPath('/logins')).toBe(true)
})

test('the manifest walk skips resource routes and dynamic paths', () => {
	const paths = publicPageSitemapPaths({
		root: { module: { default: () => null } },
		'routes/discover': { path: 'discover', module: { default: () => null } },
		'routes/$': { path: '*', module: { default: () => null } },
		'routes/admin': { path: 'admin/cache', module: { default: () => null } },
		'routes/media.$id': {
			path: 'media/:mediaId',
			module: { default: () => null },
		},
		// A resource route renders nothing, so it is not a page.
		'routes/resource': {
			path: 'resources/thing',
			module: { loader: () => null },
		},
	})
	expect(paths).toEqual(['/discover'])
})

test('a nested page keeps its parent path', () => {
	const paths = publicPageSitemapPaths({
		'routes/_home': { path: '', module: { default: () => null } },
		'routes/_home.index': {
			index: true,
			parentId: 'routes/_home',
			module: { default: () => null },
		},
		'routes/lists': { path: 'lists', module: { default: () => null } },
	})
	expect(paths).toContain('/lists')
	expect(paths).toContain('/')
})

test('robots.txt is byte-identical to what the removed library produced', () => {
	// `@nasa-gcn/remix-seo` was dropped because its unsatisfiable peer forced
	// legacy-peer-deps for the whole install. Crawler behaviour should not change
	// as a side effect of that, so this pins the exact bytes it emitted.
	expect(
		robotsTxt([{ type: 'sitemap', value: 'https://veud.test/sitemap.xml' }]),
	).toBe('User-agent: *\nAllow: /\nSitemap: https://veud.test/sitemap.xml\n')
})

test('robots.txt keeps the defaults ahead of anything a caller adds', () => {
	expect(
		robotsTxt([
			{ type: 'disallow', value: '/admin' },
			{ type: 'crawlDelay', value: '10' },
		]),
	).toBe('User-agent: *\nAllow: /\nDisallow: /admin\nCrawl-delay: 10\n')
})

test('the robots response declares its length in bytes, not characters', () => {
	// Content-Length is bytes. A multi-byte path would make a character count
	// short, and a truncated robots.txt is read as a shorter policy.
	const body = robotsTxt([
		{ type: 'sitemap', value: 'https://veud.test/sitemap—x.xml' },
	])
	const response = robotsResponse(body)
	expect(response.headers.get('Content-Type')).toBe('text/plain')
	expect(response.headers.get('Content-Length')).toBe(
		String(new TextEncoder().encode(body).byteLength),
	)
	expect(Number(response.headers.get('Content-Length'))).toBeGreaterThan(
		body.length,
	)
})
