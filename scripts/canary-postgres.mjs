#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import {
	executePostgresCanary,
	normalizeCanaryOrigin,
} from './postgres-canary-utils.mjs'

const args = process.argv.slice(2)
const usage = `Usage: npm run db:canary:postgres -- --base-url URL [options]

Options:
  --base-url URL      Canary application origin (required)
  --requests N        Total requests across all paths (default: 40)
  --concurrency N     Concurrent request workers (default: 4)
  --timeout-ms N      Per-request timeout (default: 10000)
  --paths CSV         Read-only paths (default: healthcheck, /, discover, credits)
  --report PATH       Private JSON report path (default: test-results/...)
  --run               Execute requests (default: dry-run)
  --help              Show this help

Remote targets must use HTTPS. The healthcheck path is mandatory, requests do
not contain authentication, and this command performs no application writes.`

function valueFor(flag) {
	const index = args.indexOf(flag)
	if (index < 0) return undefined
	const value = args[index + 1]
	if (!value || value.startsWith('--')) {
		throw new Error(`${flag} requires a value`)
	}
	return value
}

function integer(flag, fallback, maximum) {
	const raw = valueFor(flag)
	if (raw === undefined) return fallback
	const value = Number(raw)
	if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
		throw new Error(`${flag} must be an integer from 1 through ${maximum}`)
	}
	return value
}

function assertKnownArguments() {
	const values = new Set([
		'--base-url',
		'--requests',
		'--concurrency',
		'--timeout-ms',
		'--paths',
		'--report',
	])
	const booleans = new Set(['--run', '--help'])
	for (let index = 0; index < args.length; index++) {
		const argument = args[index]
		if (booleans.has(argument)) continue
		if (values.has(argument)) {
			index++
			continue
		}
		throw new Error(`Unknown argument: ${argument}`)
	}
}

function canaryPaths() {
	const values = (
		valueFor('--paths') ?? '/resources/healthcheck,/,/discover,/credits'
	)
		.split(',')
		.map(value => value.trim())
		.filter(Boolean)
	const paths = [...new Set(values)]
	if (!paths.length) throw new Error('--paths must contain at least one path')
	for (const requestPath of paths) {
		if (
			!requestPath.startsWith('/') ||
			requestPath.startsWith('//') ||
			requestPath.includes('?') ||
			requestPath.includes('#')
		) {
			throw new Error(`Unsafe canary path: ${requestPath}`)
		}
	}
	if (!paths.includes('/resources/healthcheck')) {
		throw new Error('--paths must include /resources/healthcheck')
	}
	return paths
}

async function main() {
	assertKnownArguments()
	if (args.includes('--help')) {
		console.log(usage)
		return
	}
	const rawUrl = valueFor('--base-url')
	if (!rawUrl) throw new Error('--base-url is required')
	const origin = normalizeCanaryOrigin(rawUrl)
	const requestCount = integer('--requests', 40, 10_000)
	const concurrency = integer('--concurrency', 4, 100)
	const timeoutMs = integer('--timeout-ms', 10_000, 120_000)
	const paths = canaryPaths()
	const reportPath = path.resolve(
		valueFor('--report') ??
			`test-results/postgres-canary-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
	)
	console.log(`Canary: ${origin}`)
	console.log(`Paths: ${paths.join(', ')}`)
	console.log(`Requests: ${requestCount}; concurrency: ${concurrency}`)
	console.log(`Mode: ${args.includes('--run') ? 'RUN' : 'DRY-RUN'}`)
	console.log(`Report: ${reportPath}`)
	if (!args.includes('--run')) return

	const report = await executePostgresCanary({
		origin,
		paths,
		requestCount,
		concurrency,
		timeoutMs,
	})
	fs.mkdirSync(path.dirname(reportPath), { recursive: true })
	fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
		mode: 0o600,
	})
	fs.chmodSync(reportPath, 0o600)
	console.log(
		`Canary: ${report.summary.passed}/${requestCount} passed; p95=${report.summary.p95Ms}ms; max=${report.summary.maxMs}ms.`,
	)
	console.log(`Report written: ${reportPath}`)
	if (report.summary.failed) {
		throw new Error(`${report.summary.failed} canary request(s) failed`)
	}
}

main().catch(error => {
	console.error(error)
	process.exitCode = 1
})
