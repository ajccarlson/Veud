#!/usr/bin/env -S node --import tsx
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { TMDB_WATCH_PROVIDER_KEY } from '#app/utils/tmdb-anime-match.server.ts'
import {
	normalizeWatchProviders,
	watchAvailabilityExpiry,
	watchAvailabilityKeepsUp,
	watchAvailabilityRefreshCapacity,
} from '#app/utils/tmdb-watch-providers.server.ts'
import { assertCatalogWriterRuntimeProof } from './catalog-writer-runtime-guard.mjs'

assertCatalogWriterRuntimeProof(process.env)

const usage = `Usage: npm run catalog:tmdb-watch-providers -- [options]

Record where tracked titles can be watched, from TMDB's watch-provider endpoint.

The data is supplied by JustWatch. Only the link TMDB returns is stored as the
destination, and an offer without one is never recorded.

Only media carrying a TMDB id can be resolved. Anime have none of their own and
are resolved through the mapping written by catalog:anime-tmdb-ids.

Options:
  --commit          Fetch and write (default: dry-run, no requests)
  --limit N         Maximum titles to process (default: 100)
  --delay-ms N      Delay between provider requests (default: 300)
  --help            Show this help

Commit mode requires TMDB_API_KEY.`

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
const limit = positiveInteger('--limit', 100)
const delayMs = positiveInteger('--delay-ms', 300)
const apiToken = process.env['TMDB_API_KEY']?.trim()

if (commit && !apiToken) throw new Error('TMDB_API_KEY is required to commit')

const prisma = new PrismaClient()
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** TMDB paths differ by kind; only these two carry watch providers. */
const TMDB_PATHS = ['movie', 'tv']

/**
 * Film and television carry their own TMDB id. Anime carry a mapping written by
 * catalog:anime-tmdb-ids under a separate provider, so that TMDB catalog
 * hydration does not claim those rows and overwrite their MAL-sourced data.
 */
const PROVIDERS = ['tmdb', TMDB_WATCH_PROVIDER_KEY]

async function fetchProviders(path: string, externalId: string) {
	const response = await fetch(
		`https://api.themoviedb.org/3/${path}/${encodeURIComponent(externalId)}/watch/providers`,
		{
			headers: {
				Authorization: `Bearer ${apiToken}`,
				accept: 'application/json',
			},
		},
	)
	if (response.status === 404) return null
	if (!response.ok) {
		throw new Error(
			`TMDB watch providers failed with status ${response.status}`,
		)
	}
	return response.json()
}

async function main() {
	// Only titles someone tracks, and only those whose availability has expired
	// or was never recorded. Availability changes constantly but not per minute.
	const now = new Date()
	const candidates = await prisma.media.findMany({
		where: {
			trackingStates: { some: {} },
			// The kind that decides the TMDB path is the external id's, not the
			// media's: an anime is a `tv` entry on TMDB.
			externalIds: {
				some: {
					provider: { in: PROVIDERS },
					kind: { in: TMDB_PATHS },
					tombstonedAt: null,
				},
			},
			OR: [
				{ watchAvailability: { none: {} } },
				{ watchAvailability: { some: { expiresAt: { lte: now } } } },
			],
		},
		select: {
			id: true,
			title: true,
			externalIds: {
				where: {
					provider: { in: PROVIDERS },
					kind: { in: TMDB_PATHS },
					tombstonedAt: null,
				},
				select: { externalId: true, kind: true },
				take: 1,
			},
		},
		orderBy: { id: 'asc' },
		take: limit,
	})

	// Everything this worker is responsible for keeping fresh, not just what is
	// due right now: a queue larger than one week of runs quietly loses its
	// tail, and those titles show no streaming rather than stale streaming.
	const eligible = await prisma.media.count({
		where: {
			trackingStates: { some: {} },
			externalIds: {
				some: {
					provider: { in: PROVIDERS },
					kind: { in: TMDB_PATHS },
					tombstonedAt: null,
				},
			},
		},
	})

	console.log(`Mode: ${commit ? 'COMMIT' : 'DRY RUN (no provider requests)'}`)
	console.log(`Tracked titles needing availability: ${candidates.length}`)
	console.log(`Tracked titles this worker must keep fresh: ${eligible}`)
	if (!watchAvailabilityKeepsUp(eligible, limit)) {
		console.warn(
			`WARNING: at ${limit} titles per daily run this worker can keep ` +
				`${watchAvailabilityRefreshCapacity(limit)} titles fresh, but ${eligible} ` +
				'need it. The excess will expire and show no streaming information. ' +
				'Raise VEUD_PRODUCTION_WATCH_PROVIDER_LIMIT or run the timer more often.',
		)
	}
	if (!commit) return

	let refreshed = 0
	let offersWritten = 0
	let withoutOffers = 0
	let failed = 0

	for (const media of candidates) {
		const mapping = media.externalIds[0]
		if (!mapping) continue
		try {
			const payload = await fetchProviders(mapping.kind, mapping.externalId)
			await sleep(delayMs)
			const offers = normalizeWatchProviders(payload)
			const observedAt = new Date()
			const expiresAt = watchAvailabilityExpiry(observedAt)

			// Replace the whole set for this title: an offer that disappeared from
			// the provider must disappear here, not linger until it expires.
			await prisma.$transaction(async tx => {
				await tx.watchAvailability.deleteMany({ where: { mediaId: media.id } })
				if (!offers.length) return
				await tx.watchAvailability.createMany({
					data: offers.map(offer => ({
						mediaId: media.id,
						region: offer.region,
						offerKind: offer.offerKind,
						providerId: offer.providerId,
						providerName: offer.providerName,
						logoPath: offer.logoPath,
						displayPriority: offer.displayPriority,
						link: offer.link,
						observedAt,
						expiresAt,
					})),
				})
			})
			offersWritten += offers.length
			if (!offers.length) withoutOffers++
			refreshed++
		} catch (error) {
			failed++
			console.error(
				`${media.title ?? media.id}: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
	}

	console.log(`Titles refreshed: ${refreshed}`)
	console.log(`Offers recorded: ${offersWritten}`)
	console.log(`Titles with no availability anywhere: ${withoutOffers}`)
	console.log(`Titles failed: ${failed}`)
}

try {
	await main()
} finally {
	await prisma.$disconnect()
}
