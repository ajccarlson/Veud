#!/usr/bin/env -S node --import tsx
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import {
	chooseUniqueTmdbMatch,
	searchTitles,
	TMDB_WATCH_PROVIDER_KEY,
	type TmdbCandidate,
} from '#app/utils/tmdb-anime-match.server.ts'
import { assertCatalogWriterRuntimeProof } from './catalog-writer-runtime-guard.mjs'

assertCatalogWriterRuntimeProof(process.env)

const usage = `Usage: npm run catalog:anime-tmdb-ids -- [options]

Map tracked anime to the TMDB entry for the same work, so streaming
availability can be looked up for them. Anime ingested from MAL carry no TMDB
id of their own.

The mapping is recorded under the '${TMDB_WATCH_PROVIDER_KEY}' provider, never
under 'tmdb', so TMDB catalog hydration does not claim these rows and overwrite
their MAL-sourced data.

A match must agree on a whole title and on the year, and every known title must
converge on one TMDB entry. Ambiguous anime are skipped, not guessed at.

Options:
  --commit          Search and write (default: dry-run, no requests)
  --limit N         Maximum anime to resolve (default: 200)
  --delay-ms N      Delay between search requests (default: 300)
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
const limit = positiveInteger('--limit', 200)
const delayMs = positiveInteger('--delay-ms', 300)
const apiToken = process.env['TMDB_API_KEY']?.trim()

if (commit && !apiToken) throw new Error('TMDB_API_KEY is required to commit')

const prisma = new PrismaClient()
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Searching every alternate title would cost a request each for no gain — the
 * first few carry the English, romaji and native forms that TMDB indexes.
 */
const MAX_SEARCH_TITLES = 4

async function searchTmdb(path: 'tv' | 'movie', query: string) {
	const response = await fetch(
		`https://api.themoviedb.org/3/search/${path}?query=${encodeURIComponent(query)}`,
		{
			headers: {
				Authorization: `Bearer ${apiToken}`,
				accept: 'application/json',
			},
		},
	)
	if (!response.ok) {
		throw new Error(`TMDB search failed with status ${response.status}`)
	}
	const payload = (await response.json()) as { results?: unknown }
	if (!Array.isArray(payload.results)) return []
	return payload.results.flatMap((entry): TmdbCandidate[] => {
		if (!entry || typeof entry !== 'object') return []
		const result = entry as Record<string, unknown>
		const id = result['id']
		if (typeof id !== 'number') return []
		// TMDB names the fields differently for shows and films.
		const name = result['name'] ?? result['title']
		const originalName = result['original_name'] ?? result['original_title']
		const date = result['first_air_date'] ?? result['release_date']
		return [
			{
				id,
				name: typeof name === 'string' ? name : null,
				originalName: typeof originalName === 'string' ? originalName : null,
				firstAirYear:
					typeof date === 'string' && date.length >= 4
						? date.slice(0, 4)
						: null,
			},
		]
	})
}

async function main() {
	// Only anime someone tracks, and only those with no mapping yet. A mapping
	// does not go stale: it identifies a work, not a fact about it.
	const candidates = await prisma.media.findMany({
		where: {
			kind: 'anime',
			trackingStates: { some: {} },
			externalIds: {
				none: { provider: TMDB_WATCH_PROVIDER_KEY, tombstonedAt: null },
			},
		},
		select: {
			id: true,
			title: true,
			type: true,
			startYear: true,
			titles: { select: { value: true } },
		},
		orderBy: { id: 'asc' },
		take: limit,
	})

	console.log(`Mode: ${commit ? 'COMMIT' : 'DRY RUN (no search requests)'}`)
	console.log(`Tracked anime without a TMDB mapping: ${candidates.length}`)
	if (!commit) return

	let resolved = 0
	let unmatched = 0
	let collided = 0
	let failed = 0

	for (const media of candidates) {
		// A film is a film on TMDB too; everything else is indexed as a show.
		const path = media.type?.trim().toLowerCase() === 'movie' ? 'movie' : 'tv'
		const titles = searchTitles(
			media.title ?? '',
			media.titles.map(entry => entry.value),
		)
		if (!titles.length) {
			unmatched++
			continue
		}
		const year = media.startYear ? String(media.startYear) : null
		try {
			const candidateEntries: TmdbCandidate[] = []
			for (const title of titles.slice(0, MAX_SEARCH_TITLES)) {
				candidateEntries.push(...(await searchTmdb(path, title)))
				await sleep(delayMs)
			}
			const match = chooseUniqueTmdbMatch(titles, year, candidateEntries)
			if (!match) {
				unmatched++
				continue
			}
			// (provider, kind, externalId) is unique, so a collision means another
			// anime already claimed this TMDB entry — an ambiguity across rows that
			// the per-title check cannot see. Leave the existing mapping alone and
			// say so rather than reassigning it.
			const claimed = await prisma.mediaExternalId.findUnique({
				where: {
					provider_kind_externalId: {
						provider: TMDB_WATCH_PROVIDER_KEY,
						kind: path,
						externalId: String(match.tmdbId),
					},
				},
				select: { mediaId: true },
			})
			if (claimed) {
				collided++
				console.warn(
					`${media.title ?? media.id}: TMDB ${match.tmdbId} already mapped to ${claimed.mediaId}`,
				)
				continue
			}
			await prisma.mediaExternalId.create({
				data: {
					mediaId: media.id,
					provider: TMDB_WATCH_PROVIDER_KEY,
					kind: path,
					externalId: String(match.tmdbId),
				},
			})
			resolved++
		} catch (error) {
			failed++
			console.error(
				`${media.title ?? media.id}: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
	}

	console.log(`Anime mapped to TMDB: ${resolved}`)
	console.log(`Anime with no unambiguous match (skipped): ${unmatched}`)
	console.log(`Anime whose TMDB entry was already claimed: ${collided}`)
	console.log(`Anime failed: ${failed}`)
}

try {
	await main()
} finally {
	await prisma.$disconnect()
}
