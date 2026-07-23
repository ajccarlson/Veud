#!/usr/bin/env -S npx tsx
/**
 * Hydrate prioritized TMDB identities with normalized movie/TV details.
 *
 * Dry-run by default. A dry-run reads the eligible queue and metrics but never
 * calls TMDB. Use --commit to fetch and persist detail records.
 */
import 'dotenv/config'
import os from 'node:os'
import { PrismaClient } from '@prisma/client'
import {
	getTmdbHydrationMetrics,
	hydrateTmdbCatalog,
	tmdbHydrationFeeds,
	type TmdbHydrationFeed,
} from '#app/utils/tmdb-catalog-hydration.server.ts'
import {
	tmdbCatalogKinds,
	type TmdbCatalogKind,
} from '#app/utils/tmdb-catalog-inventory.server.ts'

const usage = `Usage: npm run catalog:tmdb-hydrate -- [options]

Options:
  --kind movie|tv|all       Catalog kind to hydrate (default: all)
  --commit                  Fetch and write details (default: dry-run)
  --limit N                 Maximum detail records per kind (default: 100)
  --concurrency N           Parallel detail requests, maximum 10 (default: 4)
  --delay-ms N              Minimum delay between request starts (default: 100)
  --refresh-days N          Freshness deadline in days (default: 150)
  --seed-priorities         Fetch upcoming, trending, and popular feeds first
  --feeds LIST              Comma-separated priority feeds used with seeding
  --lease-seconds N         Cooperative lease duration (default: 300)
  --worker-id VALUE         Lease owner label (default: hostname:pid)
  --help                    Show this help

A dry-run makes no provider requests. Committed runs persist Retry-After and
stop issuing requests after a 429 until the provider deadline has passed.`

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

function assertKnownArguments() {
	const valueFlags = new Set([
		'--kind',
		'--limit',
		'--concurrency',
		'--delay-ms',
		'--refresh-days',
		'--feeds',
		'--lease-seconds',
		'--worker-id',
	])
	const booleanFlags = new Set(['--commit', '--seed-priorities', '--help'])
	for (let index = 0; index < args.length; index++) {
		const argument = args[index]
		if (booleanFlags.has(argument)) continue
		if (valueFlags.has(argument)) {
			index += 1
			continue
		}
		throw new Error(`Unknown argument: ${argument}`)
	}
}

function nonNegativeInteger(flag: string, fallback: number) {
	const raw = valueFor(flag)
	if (raw === undefined) return fallback
	const value = Number(raw)
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new Error(`${flag} must be a non-negative integer`)
	}
	return value
}

function requestedFeeds() {
	const raw = valueFor('--feeds')
	if (!raw) return [...tmdbHydrationFeeds]
	const feeds = [...new Set(raw.split(',').map(value => value.trim()))]
	if (
		!feeds.length ||
		feeds.some(feed => !tmdbHydrationFeeds.includes(feed as TmdbHydrationFeed))
	) {
		throw new Error('--feeds must contain upcoming, trending, and/or popular')
	}
	return feeds as TmdbHydrationFeed[]
}

function printMetrics(
	label: string,
	metrics: Awaited<ReturnType<typeof getTmdbHydrationMetrics>>,
) {
	console.log(
		[
			`${label}: ${metrics.kind}`,
			`active identities: ${metrics.active} (${metrics.tombstoned} tombstoned)`,
			`hydrated coverage: ${metrics.hydrated}/${metrics.active} (${metrics.coveragePercent}%)`,
			`fresh within ${metrics.freshnessTargetDays} days: ${metrics.fresh}/${metrics.active} (${metrics.freshnessPercent}%)`,
			`eligible queue: ${metrics.queueDepth}; prioritized: ${metrics.highPriority}; deferred failures: ${metrics.failedDeferred}`,
			`recorded provider requests: ${metrics.requestsMade}; 429 events: ${metrics.rateLimitEvents}`,
		].join('\n'),
	)
}

async function main() {
	assertKnownArguments()
	if (args.includes('--help')) {
		console.log(usage)
		return
	}
	const requestedKind = valueFor('--kind') ?? 'all'
	if (
		requestedKind !== 'all' &&
		!tmdbCatalogKinds.includes(requestedKind as TmdbCatalogKind)
	) {
		throw new Error('--kind must be movie, tv, or all')
	}
	const kinds: TmdbCatalogKind[] =
		requestedKind === 'all'
			? [...tmdbCatalogKinds]
			: [requestedKind as TmdbCatalogKind]
	const commit = args.includes('--commit')
	const seedPriorities = args.includes('--seed-priorities')
	const feeds = requestedFeeds()
	const limit = positiveInteger('--limit', 100)
	const concurrency = positiveInteger('--concurrency', 4)
	const requestDelayMs = nonNegativeInteger('--delay-ms', 100)
	const refreshDays = positiveInteger('--refresh-days', 150)
	const leaseSeconds = positiveInteger('--lease-seconds', 300)
	const leaseOwner =
		valueFor('--worker-id') ?? `${os.hostname()}:${process.pid}`

	console.log(
		[
			`Mode: ${commit ? 'COMMIT' : 'DRY-RUN'}`,
			`Kinds: ${kinds.join(', ')}`,
			`Limit per kind: ${limit}`,
			`Concurrency: ${concurrency}`,
			`Minimum request-start delay: ${requestDelayMs}ms`,
			`Freshness target: ${refreshDays} days`,
			`Priority feeds: ${seedPriorities ? feeds.join(', ') : 'not requested'}`,
		].join('\n'),
	)

	const prisma = new PrismaClient()
	try {
		for (const kind of kinds) {
			printMetrics(
				'Before',
				await getTmdbHydrationMetrics(prisma, {
					kind,
					freshnessDays: refreshDays,
				}),
			)
			const result = await hydrateTmdbCatalog({
				prisma,
				kind,
				apiToken: process.env.TMDB_API_KEY,
				commit,
				limit,
				concurrency,
				requestDelayMs,
				refreshDays,
				seedPriorities,
				feeds,
				leaseOwner,
				leaseDurationMs: leaseSeconds * 1_000,
				onCheckpoint(checkpoint) {
					console.log(
						`${kind}: ${checkpoint.recordsHandled} hydrated, ${checkpoint.recordsFailed} failed, ${checkpoint.requestsMade} requests`,
					)
				},
			})
			console.log(
				[
					`${kind}: ${result.dryRun ? 'planned' : 'completed'}`,
					`priority identities seeded: ${result.seeded}`,
					`records: ${result.recordsHandled} hydrated, ${result.recordsFailed} failed`,
					`provider requests: ${result.requestsMade}; 429 events: ${result.rateLimitEvents}`,
					`eligible queue: ${result.queueBefore} -> ${result.queueAfter}`,
					...(result.providerRetryAfter
						? [
								`provider deferred until: ${result.providerRetryAfter.toISOString()}`,
							]
						: []),
				].join('\n'),
			)
			printMetrics(
				'After',
				await getTmdbHydrationMetrics(prisma, {
					kind,
					freshnessDays: refreshDays,
				}),
			)
		}
	} finally {
		await prisma.$disconnect()
	}
}

main().catch(error => {
	console.error(error)
	process.exitCode = 1
})
