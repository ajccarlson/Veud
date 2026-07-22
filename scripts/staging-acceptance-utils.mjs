import { performance } from 'node:perf_hooks'

export const DEFAULT_STAGING_CONTRACTS = [
	{
		path: '/resources/healthcheck',
		exactBody: 'OK',
		contentType: 'text/plain',
	},
	{ path: '/', bodyIncludes: 'Trending', contentType: 'text/html' },
	{ path: '/discover', bodyIncludes: 'Discover', contentType: 'text/html' },
	{
		path: '/calendar',
		bodyIncludes: 'Release calendar',
		contentType: 'text/html',
	},
	{ path: '/reviews', bodyIncludes: 'Reviews', contentType: 'text/html' },
	{
		path: '/collections',
		bodyIncludes: 'Collections',
		contentType: 'text/html',
	},
	{
		path: '/credits',
		bodyIncludes: 'Data sources &amp; credits',
		contentType: 'text/html',
	},
	{ path: '/login', bodyIncludes: 'Welcome back!', contentType: 'text/html' },
]

export const REQUIRED_STAGING_HEADERS = [
	'content-security-policy',
	'referrer-policy',
	'x-content-type-options',
]

function percentile(sorted, percent) {
	if (!sorted.length) return 0
	return sorted[Math.max(0, Math.ceil(sorted.length * percent) - 1)]
}

function summarize(results) {
	const durations = results
		.map(result => result.durationMs)
		.sort((left, right) => left - right)
	return {
		passed: results.filter(result => result.ok).length,
		failed: results.filter(result => !result.ok).length,
		p50Ms: Number(percentile(durations, 0.5).toFixed(3)),
		p95Ms: Number(percentile(durations, 0.95).toFixed(3)),
		maxMs: Number((durations.at(-1) ?? 0).toFixed(3)),
	}
}

function validateResponse({
	response,
	body,
	origin,
	contract,
	requiredHeaders,
}) {
	const errors = []
	if (!response.ok) errors.push(`unexpected status ${response.status}`)

	if (response.url) {
		const finalUrl = new URL(response.url)
		if (finalUrl.origin !== origin)
			errors.push('redirected off the staging origin')
	}

	const contentType = response.headers.get('content-type') ?? ''
	if (!contentType.toLowerCase().includes(contract.contentType)) {
		errors.push(`expected ${contract.contentType} content`)
	}
	if (contract.exactBody !== undefined && body.trim() !== contract.exactBody) {
		errors.push('unexpected response body')
	}
	if (contract.bodyIncludes && !body.includes(contract.bodyIncludes)) {
		errors.push(`missing content marker for ${contract.path}`)
	}

	for (const header of requiredHeaders) {
		if (!response.headers.get(header)) errors.push(`missing ${header} header`)
	}
	if (response.headers.get('x-powered-by')) {
		errors.push('x-powered-by header must not be exposed')
	}
	return errors
}

export async function executeStagingAcceptance({
	origin,
	contracts = DEFAULT_STAGING_CONTRACTS,
	repeat = 1,
	timeoutMs = 10_000,
	maximumP95Ms = 2_000,
	requiredHeaders = REQUIRED_STAGING_HEADERS,
	fetchImpl = fetch,
	now = new Date(),
}) {
	const results = []
	for (let iteration = 0; iteration < repeat; iteration++) {
		for (const contract of contracts) {
			const started = performance.now()
			try {
				const response = await fetchImpl(new URL(contract.path, origin), {
					headers: { Accept: 'text/html, text/plain;q=0.9' },
					redirect: 'follow',
					signal: AbortSignal.timeout(timeoutMs),
				})
				const body = await response.text()
				const errors = validateResponse({
					response,
					body,
					origin,
					contract,
					requiredHeaders,
				})
				results.push({
					path: contract.path,
					iteration: iteration + 1,
					status: response.status,
					durationMs: performance.now() - started,
					ok: errors.length === 0,
					...(errors.length ? { errors } : {}),
				})
			} catch (error) {
				results.push({
					path: contract.path,
					iteration: iteration + 1,
					status: null,
					durationMs: performance.now() - started,
					ok: false,
					errors: [error instanceof Error ? error.message : String(error)],
				})
			}
		}
	}

	const summary = summarize(results)
	return {
		version: 1,
		measuredAt: now.toISOString(),
		origin,
		repeat,
		timeoutMs,
		maximumP95Ms,
		paths: contracts.map(contract => contract.path),
		requiredHeaders,
		summary: {
			...summary,
			latencyPassed: summary.p95Ms <= maximumP95Ms,
		},
		failures: results
			.filter(result => !result.ok)
			.map(({ path, iteration, status, errors }) => ({
				path,
				iteration,
				status,
				errors,
			})),
	}
}
