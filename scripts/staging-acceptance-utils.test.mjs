import fs from 'node:fs'
import { expect, test } from 'vitest'
import {
	DEFAULT_STAGING_CONTRACTS,
	executeStagingAcceptance,
} from './staging-acceptance-utils.mjs'

const securityHeaders = {
	'content-security-policy': "default-src 'self'",
	'content-type': 'text/html; charset=utf-8',
	'referrer-policy': 'same-origin',
	'x-content-type-options': 'nosniff',
}

function responseFor(url, body, overrides = {}) {
	return {
		ok: true,
		status: 200,
		url: url.toString(),
		headers: new Headers(securityHeaders),
		text: async () => body,
		...overrides,
	}
}

test('accepts critical staging routes with their content and security contracts', async () => {
	const bodies = new Map(
		DEFAULT_STAGING_CONTRACTS.map(contract => [
			contract.path,
			contract.exactBody ?? `<html>${contract.bodyIncludes}</html>`,
		]),
	)
	const report = await executeStagingAcceptance({
		origin: 'https://staging.example.com',
		fetchImpl: async url => {
			const path = new URL(url).pathname
			const response = responseFor(url, bodies.get(path))
			if (path === '/resources/healthcheck') {
				response.headers.set('content-type', 'text/plain; charset=utf-8')
			}
			return response
		},
		now: new Date('2026-07-21T12:00:00.000Z'),
	})

	expect(report).toMatchObject({
		version: 1,
		measuredAt: '2026-07-21T12:00:00.000Z',
		origin: 'https://staging.example.com',
		summary: { passed: DEFAULT_STAGING_CONTRACTS.length, failed: 0 },
		failures: [],
	})
})

test('rejects missing content, security headers, and off-origin redirects', async () => {
	const contracts = [
		{ path: '/discover', bodyIncludes: 'Discover', contentType: 'text/html' },
	]
	const report = await executeStagingAcceptance({
		origin: 'https://staging.example.com',
		contracts,
		fetchImpl: async url =>
			responseFor(url, '<html>Wrong page</html>', {
				url: 'https://login.example.net/',
				headers: new Headers({ 'content-type': 'text/html' }),
			}),
	})

	expect(report.summary).toMatchObject({ passed: 0, failed: 1 })
	expect(report.failures[0].errors).toEqual(
		expect.arrayContaining([
			'redirected off the staging origin',
			'missing content marker for /discover',
			'missing content-security-policy header',
		]),
	)
})

test('reports a latency-budget failure separately from route contracts', async () => {
	const report = await executeStagingAcceptance({
		origin: 'https://staging.example.com',
		contracts: [
			{ path: '/discover', bodyIncludes: 'Discover', contentType: 'text/html' },
		],
		maximumP95Ms: 0,
		fetchImpl: async url => responseFor(url, '<html>Discover</html>'),
	})
	expect(report.summary).toMatchObject({
		passed: 1,
		failed: 0,
		latencyPassed: false,
	})
})

test('no canary marker is text the global navigation puts on every page', () => {
	// `/discover` matched on "Discover", `/reviews` on "Reviews" and
	// `/collections` on "Collections" — the labels of the site's own navigation,
	// which the root layout renders in the header of every page. Each of those
	// canaries passed for any HTML the server returned, including an error page
	// that still rendered the shell, so it proved the site was up and nothing
	// about the page it named.
	const root = fs.readFileSync(
		new URL('../app/root.tsx', import.meta.url),
		'utf8',
	)
	// The navigation labels are the link text of the site-wide nav components.
	const siteWide = new Set(
		[
			...root.matchAll(
				/^\s*(Discover|Calendar|Reviews|Collections|Members)\s*$/gm,
			),
		].map(match => match[1]),
	)
	expect(
		siteWide.size,
		'expected to find the navigation labels in root.tsx',
	).toBeGreaterThan(2)

	const offenders = DEFAULT_STAGING_CONTRACTS.filter(
		contract => contract.bodyIncludes && siteWide.has(contract.bodyIncludes),
	).map(contract => `${contract.path} matches on "${contract.bodyIncludes}"`)

	expect(
		offenders,
		'a canary matching on a navigation label passes for every page',
	).toEqual([])
})

test('every html canary names text from its own page', () => {
	// A marker shared by two contracts cannot distinguish them either.
	const markers = DEFAULT_STAGING_CONTRACTS.filter(
		contract => contract.bodyIncludes,
	).map(contract => contract.bodyIncludes)
	expect(new Set(markers).size).toBe(markers.length)
})
