#!/usr/bin/env -S npx tsx
/**
 * Inventory MAL anime and manga ranking pages into the canonical catalog.
 *
 * Dry-run by default. A committed run requires a reference to the written
 * approval that permits Veud's bulk storage and redisplay of MAL metadata.
 */
import 'dotenv/config'
import os from 'node:os'
import { PrismaClient } from '@prisma/client'
import {
	defaultMalInventoryDate,
	importMalInventory,
	malCatalogKinds,
	malMinimumInventoryRecords,
	requireMalInventoryDate,
	type MalCatalogKind,
} from '#app/utils/mal-catalog-inventory.server.ts'

const usage = `Usage: npm run catalog:mal-inventory -- [options]

Options:
  --kind anime|manga|all       Inventory to scan (default: all)
  --date YYYY-MM-DD            Logical scan date (default: today in UTC)
  --commit                     Write to the database (default: dry-run)
  --policy-approval-ref VALUE  Written MAL storage/redisplay approval reference
  --limit N                    Process at most N records per selected kind
  --page-size N                Ranking records per request, at most 500 (default: 500)
  --delay-ms N                 Delay between MAL requests (default: 1000)
  --lease-seconds N            Cooperative lease duration (default: 300)
  --minimum-records N          Full-run reconciliation floor
  --reconcile                  Tombstone guarded missing identities (default: off)
  --worker-id VALUE            Lease owner label (default: hostname:pid)
  --help                       Show this help

MAL_CLIENT_ID is required. Commit mode also requires --policy-approval-ref or
MAL_CATALOG_POLICY_APPROVAL_REF. Ranking pages are not an authoritative dump,
so reconciliation is disabled unless --reconcile is explicit.`

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

function optionalNonNegativeInteger(flag: string) {
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
		'--policy-approval-ref',
		'--limit',
		'--page-size',
		'--delay-ms',
		'--lease-seconds',
		'--minimum-records',
		'--worker-id',
	])
	const booleanFlags = new Set(['--commit', '--reconcile', '--help'])
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
		!malCatalogKinds.includes(requestedKind as MalCatalogKind)
	) {
		throw new Error('--kind must be anime, manga, or all')
	}
	const kinds: MalCatalogKind[] =
		requestedKind === 'all'
			? [...malCatalogKinds]
			: [requestedKind as MalCatalogKind]
	const inventoryDate = requireMalInventoryDate(
		valueFor('--date') ?? defaultMalInventoryDate(),
	)
	const commit = args.includes('--commit')
	const policyApprovalReference =
		valueFor('--policy-approval-ref') ??
		process.env.MAL_CATALOG_POLICY_APPROVAL_REF
	const clientId = process.env.MAL_CLIENT_ID?.trim()
	if (!clientId) throw new Error('MAL_CLIENT_ID is required')
	if (commit && !policyApprovalReference?.trim()) {
		throw new Error(
			'Commit mode requires --policy-approval-ref or MAL_CATALOG_POLICY_APPROVAL_REF',
		)
	}
	const limit = positiveInteger('--limit', Infinity)
	const pageSize = positiveInteger('--page-size', 500)
	const delayMs = nonNegativeInteger('--delay-ms', 1_000)
	const leaseSeconds = positiveInteger('--lease-seconds', 300)
	const minimumRecords = optionalNonNegativeInteger('--minimum-records')
	const reconcile = args.includes('--reconcile')
	const leaseOwner =
		valueFor('--worker-id') ?? `${os.hostname()}:${process.pid}`

	console.log(
		[
			`Mode: ${commit ? 'COMMIT' : 'DRY-RUN'}`,
			`Kinds: ${kinds.join(', ')}`,
			`Inventory date: ${inventoryDate}`,
			`Limit per kind: ${limit === Infinity ? 'none' : limit}`,
			`Page size: ${pageSize}`,
			`Request delay: ${delayMs}ms`,
			`Reconciliation: ${reconcile ? 'guarded' : 'disabled'}`,
			...(commit
				? [`Policy approval: ${policyApprovalReference?.trim()}`]
				: []),
		].join('\n'),
	)

	const prisma = commit ? new PrismaClient() : undefined
	try {
		for (const kind of kinds) {
			const summary = await importMalInventory({
				prisma,
				kind,
				inventoryDate,
				clientId,
				policyApprovalReference,
				commit,
				limit,
				pageSize,
				requestDelayMs: delayMs,
				leaseOwner,
				leaseDurationMs: leaseSeconds * 1_000,
				reconcile,
				minimumRecords: minimumRecords ?? malMinimumInventoryRecords[kind],
				onCheckpoint(checkpoint) {
					console.log(
						`${kind}: committed ${checkpoint.recordsCommittedForScan} records; next offset ${checkpoint.nextOffset}`,
					)
				},
			})
			console.log(
				[
					`${kind}: ${summary.complete ? 'complete' : 'partial'}`,
					`run records: ${summary.recordsHandled} handled, ${summary.recordsFailed} failed`,
					`scan records committed: ${summary.recordsCommittedForScan}`,
					`next offset: ${summary.nextOffset}`,
					`requests: ${summary.requestsMade}; rate limits: ${summary.rateLimitEvents}`,
					...(summary.providerRetryAfter
						? [
								`provider retry after: ${summary.providerRetryAfter.toISOString()}`,
							]
						: []),
					`tombstoned: ${summary.tombstoned}`,
					...(summary.alreadyComplete
						? ['inventory date was already complete']
						: []),
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
