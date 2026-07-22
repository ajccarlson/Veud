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
