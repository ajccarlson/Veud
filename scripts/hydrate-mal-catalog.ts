#!/usr/bin/env -S npx tsx
/**
 * Hydrate prioritized MAL identities with normalized anime/manga details.
 *
 * Dry-run by default. Committed runs are sequential, conservatively paced, and
 * require the same documented bulk-storage authorization reference as inventory.
 */
import 'dotenv/config'
import os from 'node:os'
import { PrismaClient } from '@prisma/client'
import {
	getMalHydrationMetrics,
	hydrateMalCatalog,
} from '#app/utils/mal-catalog-hydration.server.ts'
import {
	malCatalogKinds,
	type MalCatalogKind,
} from '#app/utils/mal-catalog-inventory.server.ts'

const usage = `Usage: npm run catalog:mal-hydrate -- [options]

Options:
  --kind anime|manga|all       Catalog kind to hydrate (default: all)
  --commit                     Fetch and write details (default: dry-run)
  --policy-approval-ref VALUE  Documented MAL storage/redisplay authorization reference
  --limit N                    Maximum detail records per kind (default: 100)
  --refresh-days N             Freshness deadline in days (default: 180)
  --delay-ms N                 Delay between requests (default: 1000)
  --lease-seconds N            Cooperative lease duration (default: 300)
  --worker-id VALUE            Lease owner label (default: hostname:pid)
  --help                       Show this help

Commit mode requires MAL_CLIENT_ID and --policy-approval-ref (or
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

function nonNegativeInteger(flag: string, fallback: number) {
	const raw = valueFor(flag)
	if (raw === undefined) return fallback
	const value = Number(raw)
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new Error(`${flag} must be a non-negative integer`)
	}
	return value
}

function assertKnownArguments() {
	const valueFlags = new Set([
		'--kind',
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

function printMetrics(
	label: string,
	metrics: Awaited<ReturnType<typeof getMalHydrationMetrics>>,
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
		!malCatalogKinds.includes(requestedKind as MalCatalogKind)
	) {
		throw new Error('--kind must be anime, manga, or all')
	}
	const kinds: MalCatalogKind[] =
		requestedKind === 'all'
			? [...malCatalogKinds]
			: [requestedKind as MalCatalogKind]
	const commit = args.includes('--commit')
	const clientId = process.env.MAL_CLIENT_ID?.trim()
	const policyApprovalReference =
		valueFor('--policy-approval-ref') ??
		process.env.MAL_CATALOG_POLICY_APPROVAL_REF
	if (commit && !clientId) throw new Error('MAL_CLIENT_ID is required')
	if (commit && !policyApprovalReference?.trim()) {
		throw new Error(
			'Commit mode requires --policy-approval-ref or MAL_CATALOG_POLICY_APPROVAL_REF',
		)
	}
	const limit = positiveInteger('--limit', 100)
	const refreshDays = positiveInteger('--refresh-days', 180)
	const delayMs = nonNegativeInteger('--delay-ms', 1_000)
	const leaseSeconds = positiveInteger('--lease-seconds', 300)
	const leaseOwner =
		valueFor('--worker-id') ?? `${os.hostname()}:${process.pid}`

	console.log(
		[
			`Mode: ${commit ? 'COMMIT' : 'DRY-RUN'}`,
			`Kinds: ${kinds.join(', ')}`,
			`Limit per kind: ${limit}`,
			`Freshness target: ${refreshDays} days`,
			`Request delay: ${delayMs}ms`,
			...(commit
				? [`Policy authorization: ${policyApprovalReference?.trim()}`]
				: []),
		].join('\n'),
	)

	const prisma = new PrismaClient()
	try {
		for (const kind of kinds) {
			printMetrics(
				'Before',
				await getMalHydrationMetrics(prisma, {
					kind,
					freshnessDays: refreshDays,
				}),
			)
			const result = await hydrateMalCatalog({
				prisma,
				kind,
				clientId,
				policyApprovalReference,
				commit,
				limit,
				refreshDays,
				requestDelayMs: delayMs,
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
				await getMalHydrationMetrics(prisma, {
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
