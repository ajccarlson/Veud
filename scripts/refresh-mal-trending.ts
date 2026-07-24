#!/usr/bin/env -S npx tsx
import 'dotenv/config'
import os from 'node:os'
import { PrismaClient } from '@prisma/client'
import {
	malCatalogKinds,
	type MalCatalogKind,
} from '#app/utils/mal-catalog-inventory.server.ts'
import {
	refreshMalTrending,
	type RefreshMalTrendingSummary,
} from '#app/utils/mal-trending.server.ts'

const usage = `Usage: npm run catalog:mal-trending -- [options]

Options:
  --kind anime|manga|all       Charts to refresh (default: all)
  --limit N                    Candidates per chart (anime: 500; manga: 1000)
  --page-size N                Results per request, at most 500 (default: 500)
  --delay-ms N                 Delay between requests (default: 1000)
  --policy-approval-ref VALUE  MAL storage/redisplay authorization reference
  --worker-id VALUE            Lease owner label (default: hostname:pid)
  --help                       Show this help

MAL_CLIENT_ID and a policy approval reference are required. The job stores
six-hour metric snapshots and replaces Veud's MAL trending feeds.`

const args = process.argv.slice(2)

function valueFor(flag: string) {
	const index = args.indexOf(flag)
	if (index < 0) return undefined
	const value = args[index + 1]
	if (!value || value.startsWith('--'))
		throw new Error(`${flag} requires a value`)
	return value
}

function optionalPositiveInteger(flag: string) {
	const raw = valueFor(flag)
	if (raw === undefined) return undefined
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
		'--limit',
		'--page-size',
		'--delay-ms',
		'--policy-approval-ref',
		'--worker-id',
	])
	for (let index = 0; index < args.length; index++) {
		const argument = args[index]
		if (argument === '--help') continue
		if (valueFlags.has(argument)) {
			index++
			continue
		}
		throw new Error(`Unknown argument: ${argument}`)
	}
}

function printSummary(summary: RefreshMalTrendingSummary) {
	console.log(
		[
			`${summary.kind}: ${summary.candidatesRanked}/${summary.candidatesSeen} candidates ranked`,
			`sample: ${summary.observedAt.toISOString()}`,
			`24-hour history coverage: ${(summary.historyCoverage24h * 100).toFixed(1)}%`,
			`feed: ${summary.published ? 'published' : 'waiting for momentum history'}`,
			...summary.top.map(
				item =>
					`${item.rank}. ${item.title} · audience ${item.audience?.toLocaleString() ?? 'unknown'} · score ${item.rankingScore.toFixed(4)}`,
			),
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
	const clientId = process.env.MAL_CLIENT_ID?.trim()
	if (!clientId) throw new Error('MAL_CLIENT_ID is required')
	const policyApprovalReference =
		valueFor('--policy-approval-ref') ??
		process.env.MAL_CATALOG_POLICY_APPROVAL_REF?.trim()
	if (!policyApprovalReference) {
		throw new Error(
			'--policy-approval-ref or MAL_CATALOG_POLICY_APPROVAL_REF is required',
		)
	}
	const limit = optionalPositiveInteger('--limit')
	const pageSize = optionalPositiveInteger('--page-size')
	const requestDelayMs = nonNegativeInteger('--delay-ms', 1_000)
	const workerId = valueFor('--worker-id') ?? `${os.hostname()}:${process.pid}`
	const prisma = new PrismaClient()
	try {
		for (const kind of kinds) {
			printSummary(
				await refreshMalTrending({
					prisma,
					kind,
					clientId,
					policyApprovalReference,
					limit,
					pageSize,
					requestDelayMs,
					leaseOwner: `${workerId}:${kind}`,
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
