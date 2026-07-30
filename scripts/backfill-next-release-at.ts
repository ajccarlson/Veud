#!/usr/bin/env -S npx tsx
/**
 * Repair the queryable next-release mirror and its provider occurrence from
 * the retained raw payload. The command is dry-run by default and is safe to
 * resume because it writes only rows whose derived state differs.
 */
import 'dotenv/config'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { Prisma, PrismaClient } from '@prisma/client'
import {
	deriveNextReleaseAt,
	deriveNextReleaseOccurrence,
	releaseScheduleSources,
	syncNextReleaseOccurrence,
} from '#app/utils/release-occurrences.server.ts'
import { assertCatalogWriterRuntimeProof } from './catalog-writer-runtime-guard.mjs'

assertCatalogWriterRuntimeProof(process.env)

const usage = `Usage:
  npx tsx scripts/backfill-next-release-at.ts [--commit] [--limit N] [--batch-size N]

Dry-run is the default. --commit repairs only mismatched derived state.`
const backfillTransactionOptions = { maxWait: 5_000, timeout: 30_000 }

function integerAfter(name: string, fallback: number) {
	const index = process.argv.indexOf(name)
	if (index < 0) return fallback
	const value = Number.parseInt(process.argv[index + 1] ?? '', 10)
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new Error(`${name} must be a positive integer`)
	}
	return value
}

function sameDate(left: Date | null, right: Date | null) {
	return left?.getTime() === right?.getTime()
}

type StoredOccurrence = {
	source: string
	sourceKey: string
	eventType: string
	releaseAt: Date
	allDay: boolean
	season: number | null
	episode: number | null
	volume: number | null
	chapter: number | null
	name: string | null
	status: string
	observedAt: Date
	expiresAt: Date
}

const backfillMediaSelect = {
	id: true,
	nextRelease: true,
	nextReleaseAt: true,
	releaseOccurrences: {
		where: {
			sourceKey: 'next',
			source: { in: [...releaseScheduleSources] },
		},
		select: {
			source: true,
			sourceKey: true,
			eventType: true,
			releaseAt: true,
			allDay: true,
			season: true,
			episode: true,
			volume: true,
			chapter: true,
			name: true,
			status: true,
			observedAt: true,
			expiresAt: true,
		},
	},
} satisfies Prisma.MediaSelect

type BackfillMediaRow = Prisma.MediaGetPayload<{
	select: typeof backfillMediaSelect
}>

type BackfillRepair = {
	id: string
	nextRelease: string | null
	nextReleaseAt: Date | null
	repairMirror: boolean
	repairOccurrence: boolean
}

type BackfillRepairResult = {
	repairMirror: boolean
	repairOccurrence: boolean
	conflicted: boolean
}

function occurrenceMatches(
	current: StoredOccurrence[],
	expected: ReturnType<typeof deriveNextReleaseOccurrence>,
) {
	if (!expected) return current.length === 0
	if (current.length !== 1) return false
	const row = current[0]
	if (!row) return false
	return (
		row.source === expected.source &&
		row.sourceKey === expected.sourceKey &&
		row.eventType === expected.eventType &&
		sameDate(row.releaseAt, expected.releaseAt) &&
		row.allDay === expected.allDay &&
		row.season === expected.season &&
		row.episode === expected.episode &&
		row.volume === expected.volume &&
		row.chapter === expected.chapter &&
		row.name === expected.name &&
		row.status === expected.status &&
		sameDate(row.observedAt, expected.observedAt) &&
		sameDate(row.expiresAt, expected.expiresAt)
	)
}

export async function repairNextReleaseCandidate(
	transaction: Prisma.TransactionClient,
	id: string,
	options: { beforeGuardedWrite?: () => Promise<void> } = {},
): Promise<BackfillRepairResult> {
	const current = await transaction.media.findUnique({
		where: { id },
		select: backfillMediaSelect,
	})
	if (!current) {
		return {
			repairMirror: false,
			repairOccurrence: false,
			conflicted: false,
		}
	}
	const nextReleaseAt = deriveNextReleaseAt(current.nextRelease)
	const expectedOccurrence = deriveNextReleaseOccurrence(current.nextRelease)
	const repairMirror = !sameDate(current.nextReleaseAt, nextReleaseAt)
	const repairOccurrence = !occurrenceMatches(
		current.releaseOccurrences,
		expectedOccurrence,
	)
	if (!repairMirror && !repairOccurrence) {
		return { repairMirror, repairOccurrence, conflicted: false }
	}

	await options.beforeGuardedWrite?.()
	const rawPayloadGuard =
		current.nextRelease === null
			? Prisma.sql`"nextRelease" IS NULL`
			: Prisma.sql`"nextRelease" = ${current.nextRelease}`
	const changed = await transaction.$executeRaw(
		Prisma.sql`UPDATE "Media"
			SET "nextReleaseAt" = ${nextReleaseAt}
			WHERE "id" = ${id} AND ${rawPayloadGuard}`,
	)
	if (changed !== 1) {
		return {
			repairMirror: false,
			repairOccurrence: false,
			conflicted: true,
		}
	}
	if (repairOccurrence) {
		await syncNextReleaseOccurrence(transaction, id, current.nextRelease)
	}
	return { repairMirror, repairOccurrence, conflicted: false }
}

async function main() {
	if (process.argv.includes('--help')) {
		console.log(usage)
		return
	}
	const knownArguments = new Set(['--commit', '--limit', '--batch-size'])
	for (let index = 2; index < process.argv.length; index += 1) {
		const argument = process.argv[index]
		if (!knownArguments.has(argument)) {
			throw new Error(`Unknown argument: ${argument}\n${usage}`)
		}
		if (argument === '--limit' || argument === '--batch-size') index += 1
	}

	const commit = process.argv.includes('--commit')
	const limit = integerAfter('--limit', Number.MAX_SAFE_INTEGER)
	const batchSize = Math.min(integerAfter('--batch-size', 250), 1_000)
	const prisma = new PrismaClient()
	let scanned = 0
	let validPayloads = 0
	let invalidPayloads = 0
	let mirrorRepairs = 0
	let occurrenceRepairs = 0
	let concurrentRetries = 0
	let lastId: string | null = null

	try {
		while (scanned < limit) {
			const remaining = limit - scanned
			const candidates: BackfillMediaRow[] = await prisma.media.findMany({
				where: {
					AND: [
						...(lastId ? [{ id: { gt: lastId } }] : []),
						{
							OR: [
								{ nextRelease: { not: null } },
								{ nextReleaseAt: { not: null } },
								{
									releaseOccurrences: {
										some: {
											sourceKey: 'next',
											source: { in: [...releaseScheduleSources] },
										},
									},
								},
							],
						},
					],
				},
				orderBy: { id: 'asc' },
				take: Math.min(batchSize, remaining),
				select: backfillMediaSelect,
			})
			if (!candidates.length) break
			lastId = candidates[candidates.length - 1]?.id ?? lastId
			scanned += candidates.length

			const repairs: BackfillRepair[] = candidates.map(
				(row: BackfillMediaRow) => {
					const nextReleaseAt = deriveNextReleaseAt(row.nextRelease)
					const occurrence = deriveNextReleaseOccurrence(row.nextRelease)
					if (nextReleaseAt) validPayloads += 1
					else if (row.nextRelease !== null) invalidPayloads += 1
					const repairMirror = !sameDate(row.nextReleaseAt, nextReleaseAt)
					const repairOccurrence = !occurrenceMatches(
						row.releaseOccurrences,
						occurrence,
					)
					return {
						id: row.id,
						nextRelease: row.nextRelease,
						nextReleaseAt,
						repairMirror,
						repairOccurrence,
					}
				},
			)

			const pendingRepairs = repairs.filter(
				row => row.repairMirror || row.repairOccurrence,
			)
			if (commit && pendingRepairs.length) {
				let pendingIds = pendingRepairs.map(repair => repair.id)
				for (let attempt = 1; pendingIds.length && attempt <= 3; attempt++) {
					const idsForAttempt = pendingIds
					const results = await prisma.$transaction(
						async (transaction: Prisma.TransactionClient) => {
							const repaired: Array<{
								id: string
								result: BackfillRepairResult
							}> = []
							for (const id of idsForAttempt) {
								repaired.push({
									id,
									result: await repairNextReleaseCandidate(transaction, id),
								})
							}
							return repaired
						},
						backfillTransactionOptions,
					)
					pendingIds = []
					for (const { id, result } of results) {
						if (result.repairMirror) mirrorRepairs += 1
						if (result.repairOccurrence) occurrenceRepairs += 1
						if (result.conflicted) {
							concurrentRetries += 1
							pendingIds.push(id)
						}
					}
				}
				if (pendingIds.length) {
					throw new Error(
						`Next-release backfill could not converge after 3 attempts for ${pendingIds.length} concurrently changing row(s).`,
					)
				}
			} else if (!commit) {
				for (const repair of pendingRepairs) {
					if (repair.repairMirror) mirrorRepairs += 1
					if (repair.repairOccurrence) occurrenceRepairs += 1
				}
			}
		}

		console.log(
			[
				`Mode: ${commit ? 'COMMIT' : 'DRY-RUN'}`,
				`Candidate rows scanned: ${scanned}`,
				`Valid schedules: ${validPayloads}`,
				`Invalid retained payloads: ${invalidPayloads}`,
				`Query mirrors ${commit ? 'repaired' : 'requiring repair'}: ${mirrorRepairs}`,
				`Provider occurrences ${commit ? 'repaired' : 'requiring repair'}: ${occurrenceRepairs}`,
				...(commit
					? [`Concurrent guarded-write retries: ${concurrentRetries}`]
					: []),
			].join('\n'),
		)
	} finally {
		await prisma.$disconnect()
	}
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
	main().catch(error => {
		console.error(error)
		process.exitCode = 1
	})
}
