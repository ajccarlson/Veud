import { expect, test } from 'vitest'
import {
	SITEMAP_MAX_PAGES,
	SITEMAP_PAGE_SIZE,
	parseSitemapPage,
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
