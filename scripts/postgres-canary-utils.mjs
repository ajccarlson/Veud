import { performance } from 'node:perf_hooks'

export function normalizeCanaryOrigin(value) {
	let url
	try {
		url = new URL(value)
	} catch {
		throw new Error('--base-url must be a valid HTTP(S) URL')
	}
	if (!['http:', 'https:'].includes(url.protocol)) {
		throw new Error('--base-url must use http:// or https://')
	}
	if (url.username || url.password) {
		throw new Error('--base-url must not contain credentials')
	}
	if (url.pathname !== '/' || url.search || url.hash) {
		throw new Error(
			'--base-url must be an origin without a path, query, or hash',
		)
	}
	const local = ['localhost', '127.0.0.1', '[::1]'].includes(
		url.hostname.toLowerCase(),
	)
	if (url.protocol !== 'https:' && !local) {
		throw new Error('Remote canary targets must use https://')
	}
	return url.origin
}

function percentile(sorted, percent) {
	if (!sorted.length) return 0
	return sorted[Math.max(0, Math.ceil(sorted.length * percent) - 1)]
}

export function summarizeDurations(results) {
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

export async function executePostgresCanary({
	origin,
	paths,
	requestCount,
	concurrency,
	timeoutMs,
	fetchImpl = fetch,
	now = new Date(),
}) {
	const results = new Array(requestCount)
	let nextIndex = 0

	async function worker() {
		while (nextIndex < requestCount) {
			const index = nextIndex++
			const requestPath = paths[index % paths.length]
			const started = performance.now()
			try {
				const response = await fetchImpl(new URL(requestPath, origin), {
					headers: { Accept: 'text/html, text/plain;q=0.9' },
					redirect: 'follow',
					signal: AbortSignal.timeout(timeoutMs),
				})
				const body = await response.text()
				const validBody =
					requestPath === '/resources/healthcheck'
						? body.trim() === 'OK'
						: body.length > 0
				results[index] = {
					path: requestPath,
					ok: response.ok && validBody,
					status: response.status,
					durationMs: performance.now() - started,
					...(!validBody ? { error: 'unexpected response body' } : {}),
				}
			} catch (error) {
				results[index] = {
					path: requestPath,
					ok: false,
					status: null,
					durationMs: performance.now() - started,
					error: error instanceof Error ? error.message : String(error),
				}
			}
		}
	}

	await Promise.all(
		Array.from({ length: Math.min(concurrency, requestCount) }, () => worker()),
	)
	const pathSummaries = paths.map(requestPath => {
		const matching = results.filter(result => result.path === requestPath)
		return { path: requestPath, ...summarizeDurations(matching) }
	})
	return {
		version: 1,
		measuredAt: now.toISOString(),
		origin,
		requestCount,
		concurrency,
		timeoutMs,
		paths: pathSummaries,
		summary: summarizeDurations(results),
		failures: results
			.filter(result => !result.ok)
			.map(({ path: requestPath, status, error }) => ({
				path: requestPath,
				status,
				error,
			})),
	}
}
