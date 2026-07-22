#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { normalizeCanaryOrigin } from './postgres-canary-utils.mjs'
import {
	DEFAULT_STAGING_CONTRACTS,
	executeStagingAcceptance,
} from './staging-acceptance-utils.mjs'

const args = process.argv.slice(2)
const usage = `Usage: npm run staging:check -- --base-url URL [options]

Options:
  --base-url URL    Staging application origin (required)
  --repeat N        Requests per critical path (default: 1)
  --timeout-ms N    Per-request timeout (default: 10000)
  --max-p95-ms N    Maximum accepted p95 latency (default: 2000)
  --report PATH     JSON report path (default: test-results/...)
  --run             Execute checks (default: dry-run)
  --help            Show this help

Remote targets must use HTTPS. Checks are unauthenticated, read-only, remain on
the supplied origin, and verify critical content plus production security headers.`

function valueFor(flag) {
	const index = args.indexOf(flag)
	if (index < 0) return undefined
	const value = args[index + 1]
	if (!value || value.startsWith('--'))
		throw new Error(`${flag} requires a value`)
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
		'--repeat',
		'--timeout-ms',
		'--max-p95-ms',
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

async function main() {
	assertKnownArguments()
	if (args.includes('--help')) {
		console.log(usage)
		return
	}
	const rawUrl = valueFor('--base-url')
	if (!rawUrl) throw new Error('--base-url is required')
	const origin = normalizeCanaryOrigin(rawUrl)
	const repeat = integer('--repeat', 1, 100)
	const timeoutMs = integer('--timeout-ms', 10_000, 120_000)
	const maximumP95Ms = integer('--max-p95-ms', 2_000, 120_000)
	const reportPath = path.resolve(
		valueFor('--report') ??
			`test-results/staging-acceptance-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
	)

	console.log(`Staging origin: ${origin}`)
	console.log(
		`Paths: ${DEFAULT_STAGING_CONTRACTS.map(({ path }) => path).join(', ')}`,
	)
	console.log(`Repeat: ${repeat}; maximum p95: ${maximumP95Ms}ms`)
	console.log(`Mode: ${args.includes('--run') ? 'RUN' : 'DRY-RUN'}`)
	console.log(`Report: ${reportPath}`)
	if (!args.includes('--run')) return

	const report = await executeStagingAcceptance({
		origin,
		repeat,
		timeoutMs,
		maximumP95Ms,
	})
	fs.mkdirSync(path.dirname(reportPath), { recursive: true })
	fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
		mode: 0o600,
	})
	fs.chmodSync(reportPath, 0o600)
	console.log(
		`Acceptance: ${report.summary.passed}/${report.summary.passed + report.summary.failed} passed; p95=${report.summary.p95Ms}ms.`,
	)
	console.log(`Report written: ${reportPath}`)
	if (report.summary.failed || !report.summary.latencyPassed) {
		throw new Error(
			report.summary.failed
				? `${report.summary.failed} staging request(s) failed`
				: `p95 latency exceeded ${maximumP95Ms}ms`,
		)
	}
}

main().catch(error => {
	console.error(error)
	process.exitCode = 1
})
