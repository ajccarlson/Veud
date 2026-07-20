#!/usr/bin/env -S npx tsx
/**
 * Stream TMDB's official daily movie/TV ID exports into the canonical catalog.
 *
 * Dry-run by default:
 *   npm run catalog:tmdb-inventory -- --kind movie --limit 1000
 *   npm run catalog:tmdb-inventory -- --kind movie --commit --limit 10000
 *   npm run catalog:tmdb-inventory -- --kind all --commit
 *
 * A limited committed run saves a durable cursor. Re-run the same export date
 * to continue after its last committed line. Full runs apply guarded
 * reconciliation; partial runs never tombstone missing identities.
 */
import 'dotenv/config'
import os from 'node:os'
import { PrismaClient } from '@prisma/client'
import {
	defaultTmdbExportDate,
	importTmdbInventory,
	readTmdbExportLines,
	requireTmdbExportDate,
	tmdbCatalogKinds,
	tmdbDailyExportUrl,
	tmdbMinimumInventoryRecords,
	type TmdbCatalogKind,
} from '#app/utils/tmdb-catalog-inventory.server.ts'

const usage = `Usage: npm run catalog:tmdb-inventory -- [options]

Options:
  --kind movie|tv|all       Inventory to import (default: all)
  --date YYYY-MM-DD         Export date (default: yesterday in UTC)
  --source PATH|HTTPS_URL   Override one export source; requires one kind
  --commit                  Write to the database (default: dry-run)
  --limit N                 Process at most N records per selected kind
  --batch-size N            Records per committed transaction (default: 250)
  --lease-seconds N         Cooperative lease duration (default: 300)
  --minimum-records N       Full-run reconciliation floor
  --no-reconcile            Complete without tombstoning missing identities
  --worker-id VALUE         Lease owner label (default: hostname:pid)
  --help                    Show this help

The official export is gzip-compressed JSON Lines. --limit is resumable in
commit mode and never triggers reconciliation.`

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

function nonNegativeInteger(flag: string) {
	const raw = valueFor(flag)
	if (raw === undefined) return undefined
	const value = Number(raw)
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new Error(`${flag} must be a non-negative integer`)
	}
	return value
}

function assertKnownArguments() {
	const valueFlags = new Set([
		'--kind',
		'--date',
		'--source',
		'--limit',
		'--batch-size',
		'--lease-seconds',
		'--minimum-records',
		'--worker-id',
	])
	const booleanFlags = new Set(['--commit', '--no-reconcile', '--help'])
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
	const exportDate = requireTmdbExportDate(
		valueFor('--date') ?? defaultTmdbExportDate(),
	)
	const sourceOverride = valueFor('--source')
	if (sourceOverride && kinds.length !== 1) {
		throw new Error('--source requires --kind movie or --kind tv')
	}
	const commit = args.includes('--commit')
	const limit = positiveInteger('--limit', Infinity)
	const batchSize = positiveInteger('--batch-size', 250)
	const leaseSeconds = positiveInteger('--lease-seconds', 300)
	const minimumRecords = nonNegativeInteger('--minimum-records')
	const reconcile = !args.includes('--no-reconcile')
	const leaseOwner =
		valueFor('--worker-id') ?? `${os.hostname()}:${process.pid}`

	console.log(
		[
			`Mode: ${commit ? 'COMMIT' : 'DRY-RUN'}`,
			`Kinds: ${kinds.join(', ')}`,
			`Export date: ${exportDate}`,
			`Limit per kind: ${limit === Infinity ? 'none' : limit}`,
			`Batch size: ${batchSize}`,
			`Reconciliation: ${reconcile ? 'guarded' : 'disabled'}`,
		].join('\n'),
	)

	const prisma = commit ? new PrismaClient() : undefined
	try {
		for (const kind of kinds) {
			const source = sourceOverride ?? tmdbDailyExportUrl(kind, exportDate)
			console.log(`\n${kind.toUpperCase()} source: ${source}`)
			const summary = await importTmdbInventory({
				prisma,
				kind,
				exportDate,
				lines: readTmdbExportLines(source),
				commit,
				limit,
				batchSize,
				leaseOwner,
				leaseDurationMs: leaseSeconds * 1_000,
				reconcile,
				minimumRecords: minimumRecords ?? tmdbMinimumInventoryRecords[kind],
				onCheckpoint(checkpoint) {
					console.log(
						`${kind}: committed ${checkpoint.recordsCommittedForExport} records through line ${checkpoint.lastCommittedLine}`,
					)
				},
			})
			console.log(
				[
					`${kind}: ${summary.complete ? 'complete' : 'partial'}`,
					`run records: ${summary.recordsHandled} handled, ${summary.recordsFailed} failed`,
					`export records committed: ${summary.recordsCommittedForExport}`,
					`last line: ${summary.lastCommittedLine}`,
					`tombstoned: ${summary.tombstoned}`,
					...(summary.alreadyComplete ? ['export was already complete'] : []),
				].join('\n'),
			)
		}
	} finally {
		await prisma?.$disconnect()
	}
}

main().catch(error => {
	console.error(error)
	process.exitCode = 1
})
