#!/usr/bin/env -S npx tsx
/** Backfill and refresh original-language anime voice cast through Jikan. */
import 'dotenv/config'
import os from 'node:os'
import { PrismaClient } from '@prisma/client'
import { hydrateJikanAnimeCast } from '#app/utils/jikan-anime-cast.server.ts'
import { assertCatalogWriterRuntimeProof } from './catalog-writer-runtime-guard.mjs'

assertCatalogWriterRuntimeProof(process.env)

const usage = `Usage: npm run catalog:jikan-anime-cast -- [options]

Options:
  --commit                     Fetch and write cast (default: dry-run)
  --policy-approval-ref VALUE  Documented MAL storage/redisplay authorization reference
  --limit N                    Maximum anime records (default: 100)
  --refresh-days N             Default freshness deadline (default: 180)
  --delay-ms N                 Delay between requests; minimum 1000 (default: 1000)
  --lease-seconds N            Cooperative lease duration (default: 300)
  --worker-id VALUE            Lease owner label (default: hostname:pid)
  --help                       Show this help

Commit mode requires --policy-approval-ref (or
MAL_CATALOG_POLICY_APPROVAL_REF). A dry-run makes no provider requests.`

const args = process.argv.slice(2)

function valueFor(flag: string) {
	const index = args.indexOf(flag)
	if (index < 0) return undefined
	const value = args[index + 1]
	if (!value || value.startsWith('--')) {
		throw new Error(`${flag} requires a value`)
	}
	return value
}

function positiveInteger(flag: string, fallback: number) {
	const raw = valueFor(flag)
	if (raw === undefined) return fallback
	const value = Number(raw)
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new Error(`${flag} must be a positive integer`)
	}
	return value
}

function requestDelay() {
	const value = positiveInteger('--delay-ms', 1_000)
	if (value < 1_000) throw new Error('--delay-ms must be at least 1000')
	return value
}

function assertKnownArguments() {
	const valueFlags = new Set([
		'--policy-approval-ref',
		'--limit',
		'--refresh-days',
		'--delay-ms',
		'--lease-seconds',
		'--worker-id',
	])
	const booleanFlags = new Set(['--commit', '--help'])
	for (let index = 0; index < args.length; index++) {
		const argument = args[index]
		if (booleanFlags.has(argument)) continue
		if (valueFlags.has(argument)) {
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
	const commit = args.includes('--commit')
	const policyApprovalReference =
		valueFor('--policy-approval-ref') ??
		process.env.MAL_CATALOG_POLICY_APPROVAL_REF
	if (commit && !policyApprovalReference?.trim()) {
		throw new Error(
			'Commit mode requires --policy-approval-ref or MAL_CATALOG_POLICY_APPROVAL_REF',
		)
	}
	const limit = positiveInteger('--limit', 100)
	const refreshDays = positiveInteger('--refresh-days', 180)
	const delayMs = requestDelay()
	const leaseSeconds = positiveInteger('--lease-seconds', 300)
	const leaseOwner =
		valueFor('--worker-id') ?? `${os.hostname()}:${process.pid}`

	console.log(
		[
			`Mode: ${commit ? 'COMMIT' : 'DRY-RUN'}`,
			`Limit: ${limit}`,
			`Freshness target: ${refreshDays} days`,
			`Request delay: ${delayMs}ms`,
			...(commit
				? [`Policy authorization: ${policyApprovalReference?.trim()}`]
				: []),
		].join('\n'),
	)

	const prisma = new PrismaClient()
	try {
		const result = await hydrateJikanAnimeCast({
			prisma,
			commit,
			policyApprovalReference,
			limit,
			refreshDays,
			requestDelayMs: delayMs,
			leaseOwner,
			leaseDurationMs: leaseSeconds * 1_000,
			onCheckpoint(checkpoint) {
				console.log(
					`${checkpoint.recordsHandled} hydrated, ${checkpoint.recordsFailed} failed, ${checkpoint.creditsWritten} credits, ${checkpoint.requestsMade} requests`,
				)
			},
		})
		console.log(
			[
				result.dryRun
					? 'Jikan anime cast: planned'
					: 'Jikan anime cast: completed',
				`records: ${result.recordsHandled} hydrated, ${result.recordsFailed} failed`,
				`credits written: ${result.creditsWritten}`,
				`provider requests: ${result.requestsMade}; 429 events: ${result.rateLimitEvents}`,
				`eligible queue: ${result.queueBefore} -> ${result.queueAfter}`,
				...(result.providerRetryAfter
					? [
							`provider deferred until: ${result.providerRetryAfter.toISOString()}`,
						]
					: []),
			].join('\n'),
		)
	} finally {
		await prisma.$disconnect()
	}
}

main().catch(error => {
	console.error(error)
	process.exitCode = 1
})
