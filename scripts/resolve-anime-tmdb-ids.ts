#!/usr/bin/env -S node --import tsx
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import {
	animeMatchCandidateWhere,
	chooseUniqueTmdbMatch,
	normalizeAnimeMatchScope,
	searchTitles,
	TMDB_WATCH_PROVIDER_KEY,
	TMDB_WATCH_UNRESOLVED_PROVIDER_KEY,
	unresolvedRetryAfter,
	UNRESOLVED_RETRY_DAYS,
	type TmdbCandidate,
} from '#app/utils/tmdb-anime-match.server.ts'
import { assertCatalogWriterRuntimeProof } from './catalog-writer-runtime-guard.mjs'

assertCatalogWriterRuntimeProof(process.env)

const usage = `Usage: npm run catalog:anime-tmdb-ids -- [options]

Map anime to the TMDB entry for the same work, so streaming availability can be
looked up for them and so an anime can be recognised as the same work as a
live-action row. Anime ingested from MAL carry no TMDB id of their own.

The mapping is recorded under the '${TMDB_WATCH_PROVIDER_KEY}' provider, never
under 'tmdb', so TMDB catalog hydration does not claim these rows and overwrite
their MAL-sourced data.

A match must agree on a whole title and on the year, and every known title must
converge on one TMDB entry. Ambiguous anime are skipped, not guessed at.

An anime that cannot be resolved is recorded as such and reconsidered after
${UNRESOLVED_RETRY_DAYS} days, so refusals do not fill the queue and stall it.

Options:
  --commit          Search and write (default: dry-run, no requests)
  --scope SCOPE     'tracked' (default) or 'all'. 'all' considers every anime
                    in the catalog, not only those someone has on a list, which
                    is what cross-kind overlap detection needs. Tracked anime
                    are still searched first in either scope.
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
// Defaults to the original scope. Widening the queue by two orders of magnitude
// is a decision about provider load, so it is made at the call site rather than
// inherited by every existing invocation.
const scopeArg = valueFor('--scope')
const scope = normalizeAnimeMatchScope(scopeArg ?? 'tracked')
if (scopeArg !== undefined && scope !== scopeArg) {
	throw new Error(`--scope must be 'tracked' or 'all'`)
}
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
	// Only anime someone tracks, and only those neither mapped nor refused
	// recently. A mapping does not go stale — it identifies a work, not a fact
	// about it — but a refusal does, so it is reconsidered once it expires.
	const now = new Date()
	const select = {
		id: true,
		title: true,
		type: true,
		startYear: true,
		titles: { select: { value: true } },
	}
	const unmapped = animeMatchCandidateWhere({
		now,
		trackedProviderKey: TMDB_WATCH_PROVIDER_KEY,
		unresolvedProviderKey: TMDB_WATCH_UNRESOLVED_PROVIDER_KEY,
		scope,
	})

	// Tracked anime first, whatever the scope. A daily run has a small budget and
	// the whole catalog is two orders of magnitude larger than the tracked slice,
	// so ordering by id would spend months before reaching a title anyone reads.
	// Within the untracked remainder, best known first for the same reason.
	const tracked = await prisma.media.findMany({
		where: { ...unmapped, trackingStates: { some: {} } },
		select,
		orderBy: { id: 'asc' },
		take: limit,
	})
	const untracked =
		scope === 'all' && tracked.length < limit
			? await prisma.media.findMany({
					where: { ...unmapped, trackingStates: { none: {} } },
					select,
					orderBy: [
						{ catalogPopularity: { sort: 'desc', nulls: 'last' } },
						{ id: 'asc' },
					],
					take: limit - tracked.length,
				})
			: []
	const candidates = [...tracked, ...untracked]

	console.log(`Mode: ${commit ? 'COMMIT' : 'DRY RUN (no search requests)'}`)
	console.log(`Scope: ${scope}`)
	console.log(
		`Anime without a TMDB mapping in this batch: ${candidates.length}` +
			(scope === 'all'
				? ` (${tracked.length} tracked, ${untracked.length} untracked)`
				: ''),
	)
	if (!commit) return

	let resolved = 0
	let unmatched = 0
	let collided = 0
	let failed = 0

	/**
	 * Record that this anime was searched and not resolved. `externalId` holds
	 * the media id, because the row identifies the attempt rather than a TMDB
	 * entry and `(provider, kind, externalId)` still has to be unique.
	 */
	async function recordUnresolved(mediaId: string, kind: string) {
		const attemptedAt = new Date()
		const refreshAfter = unresolvedRetryAfter(attemptedAt)
		await prisma.mediaExternalId.upsert({
			where: {
				provider_kind_externalId: {
					provider: TMDB_WATCH_UNRESOLVED_PROVIDER_KEY,
					kind,
					externalId: mediaId,
				},
			},
			create: {
				mediaId,
				provider: TMDB_WATCH_UNRESOLVED_PROVIDER_KEY,
				kind,
				externalId: mediaId,
				fetchStatus: 'failed',
				lastFetchedAt: attemptedAt,
				refreshAfter,
			},
			update: {
				fetchStatus: 'failed',
				lastFetchedAt: attemptedAt,
				refreshAfter,
				tombstonedAt: null,
			},
		})
	}

	for (const media of candidates) {
		// A film is a film on TMDB too; everything else is indexed as a show.
		const path = media.type?.trim().toLowerCase() === 'movie' ? 'movie' : 'tv'
		const titles = searchTitles(
			media.title ?? '',
			media.titles.map(entry => entry.value),
		)
		if (!titles.length) {
			unmatched++
			await recordUnresolved(media.id, path)
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
				await recordUnresolved(media.id, path)
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
				// Recorded like any other refusal: searching again tomorrow would
				// reach the same already-claimed entry.
				await recordUnresolved(media.id, path)
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
