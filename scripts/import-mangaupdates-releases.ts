#!/usr/bin/env -S node --import tsx
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import {
	fetchMangaUpdatesReleases,
	findMangaUpdatesSeriesId,
	MANGAUPDATES_PROVIDER,
	MANGAUPDATES_SOURCE,
	releaseOccurrenceInput,
	type MangaUpdatesFetch,
} from '#app/utils/mangaupdates-releases.server.ts'
import { assertCatalogWriterRuntimeProof } from './catalog-writer-runtime-guard.mjs'

assertCatalogWriterRuntimeProof(process.env)

const usage = `Usage: npm run catalog:mangaupdates-releases -- [options]

Ingest released manga chapters from MangaUpdates for tracked series.

MangaUpdates records releases after they happen and publishes no forward
schedule, so this produces a factual record of chapters that have shipped. It
never predicts a future chapter date.

Options:
  --commit                     Fetch and write (default: dry-run, no requests)
  --policy-approval-ref VALUE  MangaUpdates storage/redisplay authorization reference
  --limit N                    Maximum series to process (default: 50)
  --delay-ms N                 Delay between provider requests (default: 1000)
  --per-page N                 Releases requested per series (default: 25)
  --help                       Show this help

Commit mode requires --policy-approval-ref or
MANGAUPDATES_CATALOG_POLICY_APPROVAL_REF.`

const args = process.argv.slice(2)
if (args.includes('--help')) {
	console.log(usage)
	process.exit(0)
}

function valueFor(flag: string) {
	const index = args.indexOf(flag)
	if (index < 0) return undefined
	const value = args[index + 1]
	if (!value || value.startsWith('--'))
		throw new Error(`${flag} requires a value`)
	return value
}

function positiveInteger(flag: string, fallback: number) {
	const raw = valueFor(flag)
	if (raw === undefined) return fallback
	const parsed = Number(raw)
	if (!Number.isSafeInteger(parsed) || parsed < 1) {
		throw new Error(`${flag} must be a positive integer`)
	}
	return parsed
}

const commit = args.includes('--commit')
const limit = positiveInteger('--limit', 50)
const delayMs = positiveInteger('--delay-ms', 1_000)
const perPage = positiveInteger('--per-page', 25)
const approvalRef =
	valueFor('--policy-approval-ref') ??
	process.env['MANGAUPDATES_CATALOG_POLICY_APPROVAL_REF']?.trim()

if (commit && !approvalRef) {
	throw new Error(
		'--policy-approval-ref or MANGAUPDATES_CATALOG_POLICY_APPROVAL_REF is required',
	)
}

const prisma = new PrismaClient()
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** Requests stay sequential and spaced, as the provider terms require. */
const providerFetch: MangaUpdatesFetch = async (url, init) => {
	const response = await fetch(url, init)
	return {
		ok: response.ok,
		status: response.status,
		json: () => response.json(),
	}
}

async function main() {
	// Only series someone actually tracks, and only those still running: a
	// completed series has no new chapters to record.
	const candidates = await prisma.media.findMany({
		where: {
			kind: 'manga',
			title: { not: null },
			trackingStates: { some: {} },
			NOT: { releaseStatus: { in: ['Finished', 'Discontinued'] } },
		},
		select: {
			id: true,
			title: true,
			externalIds: {
				where: { provider: MANGAUPDATES_PROVIDER, tombstonedAt: null },
				select: { externalId: true },
				take: 1,
			},
		},
		orderBy: { id: 'asc' },
		take: limit,
	})

	console.log(`Mode: ${commit ? 'COMMIT' : 'DRY RUN (no provider requests)'}`)
	console.log(`Tracked ongoing manga selected: ${candidates.length}`)
	if (!commit) {
		const unmapped = candidates.filter(
			media => !media.externalIds.length,
		).length
		console.log(`Series still needing a MangaUpdates id: ${unmapped}`)
		return
	}

	let resolved = 0
	let unresolved = 0
	let written = 0
	let failed = 0

	for (const media of candidates) {
		try {
			let seriesId = Number(media.externalIds[0]?.externalId ?? Number.NaN)
			if (!Number.isSafeInteger(seriesId)) {
				const found = await findMangaUpdatesSeriesId(
					providerFetch,
					media.title ?? '',
					{ approvalRef },
				)
				await sleep(delayMs)
				if (found === null) {
					unresolved++
					continue
				}
				seriesId = found
				await prisma.mediaExternalId.upsert({
					where: {
						provider_kind_externalId: {
							provider: MANGAUPDATES_PROVIDER,
							kind: 'manga',
							externalId: String(seriesId),
						},
					},
					create: {
						provider: MANGAUPDATES_PROVIDER,
						kind: 'manga',
						externalId: String(seriesId),
						mediaId: media.id,
						sourceTitle: media.title,
						lastFetchedAt: new Date(),
						fetchStatus: 'ok',
					},
					update: { lastSeenAt: new Date(), fetchStatus: 'ok' },
				})
				resolved++
			}

			const releases = await fetchMangaUpdatesReleases(
				providerFetch,
				seriesId,
				{
					approvalRef,
					perPage,
				},
			)
			await sleep(delayMs)

			const observedAt = new Date()
			for (const release of releases) {
				const input = releaseOccurrenceInput(release, observedAt)
				await prisma.releaseOccurrence.upsert({
					where: {
						mediaId_source_sourceKey: {
							mediaId: media.id,
							source: MANGAUPDATES_SOURCE,
							sourceKey: input.sourceKey,
						},
					},
					create: { mediaId: media.id, ...input },
					update: input,
				})
				written++
			}
		} catch (error) {
			failed++
			console.error(
				`${media.title ?? media.id}: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
	}

	console.log(`Series ids resolved: ${resolved}`)
	console.log(`Series with no exact MangaUpdates match: ${unresolved}`)
	console.log(`Chapter releases recorded: ${written}`)
	console.log(`Series failed: ${failed}`)
}

try {
	await main()
} finally {
	await prisma.$disconnect()
}
