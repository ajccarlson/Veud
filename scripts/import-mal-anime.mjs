#!/usr/bin/env node
/**
 * One-off importer: a MyAnimeList XML export -> a Veud user's anime lists.
 *
 * For each <anime> in the export it:
 *   - maps the MAL status to one of the user's anime watchlists,
 *   - fetches the title's metadata from the MAL API (same fields Veud's getAnimeInfo uses)
 *     and shapes it exactly like a UI-added entry (thumbnail, type, dates, length, rating,
 *     genres, studios, malScore, description),
 *   - maps the per-category scores stored in the MAL `tags` field into Veud's score columns,
 *   - creates the Entry.
 *
 * SAFETY
 *   - DRY-RUN by default: prints what it *would* create and writes nothing. Pass --commit to write.
 *   - DEDUPE: skips a title if an entry with the same MAL id already exists in the target list,
 *     so re-runs (and resuming after a failure) are safe.
 *   - Back up first anyway:  node scripts/backup-db.mjs
 *   - Recommended rollout:   dry-run  ->  --commit --limit 5 (spot-check in the UI)  ->  --commit
 *
 * USAGE (from the project root, so .env is loaded):
 *   node scripts/import-mal-anime.mjs <export.xml> --user <veud-username>            # dry-run
 *   node scripts/import-mal-anime.mjs <export.xml> --user <veud-username> --commit   # write
 *   node scripts/import-mal-anime.mjs <export.xml> --user <veud-username> --commit --limit 5
 *
 * The Veud username can instead be set as VEUD_USERNAME in .env. The status->list map and the
 * tag->column map below can be adjusted if your list names or rubric labels differ.
 *
 * ENV: reads DATABASE_URL, MAL_CLIENT_ID, and (optionally) VEUD_USERNAME from .env (via dotenv).
 */
import 'dotenv/config'
import fs from 'node:fs'
import { PrismaClient } from '@prisma/client'

// ---------- config ----------
const LIST_TYPE = 'anime' // the Veud ListType.name whose lists these entries go into

// MAL status -> the user's Veud anime watchlist name (resolved to an id at runtime).
const STATUS_TO_LIST = {
	'Watching': 'watching',
	'Completed': 'completed',
	'On-Hold': 'onhold',
	'Dropped': 'dropped',
	'Plan to Watch': 'plantowatch',
}

// MAL `tags` category label -> Veud score column. (MAL "Animation" is Veud's "presentation";
// "Overall" is the personal score. Veud's "performance" has no MAL-tag source and stays 0.)
const TAG_TO_COLUMN = {
	story: 'story',
	character: 'character',
	animation: 'presentation',
	sound: 'sound',
	enjoyment: 'enjoyment',
	overall: 'personal',
}

// Series types to skip (not real anime titles).
const SKIP_TYPES = new Set(['Music', 'CM', 'PV', 'Unknown'])

const RATE_MS = 400 // politeness delay between MAL API calls
const MAL_FIELDS =
	'id,title,main_picture,alternative_titles,start_date,end_date,synopsis,mean,rank,popularity,num_list_users,num_scoring_users,nsfw,created_at,updated_at,media_type,status,genres,my_list_status,num_episodes,start_season,broadcast,source,average_episode_duration,rating,pictures,background,related_anime,related_manga,recommendations,studios,statistics'

// ---------- args ----------
const argv = process.argv.slice(2)
const flagValue = (...names) => {
	for (const n of names) {
		const i = argv.indexOf(n)
		if (i !== -1) return argv[i + 1]
	}
	return undefined
}
const COMMIT = argv.includes('--commit')
const LIMIT = flagValue('--limit') !== undefined ? Number(flagValue('--limit')) : Infinity
// Veud username: --user / -u flag, or VEUD_USERNAME in .env (kept out of the repo by .gitignore).
const USERNAME = flagValue('--user', '-u') ?? process.env.VEUD_USERNAME
// export path = the first positional arg (not a flag or a flag's consumed value)
const consumed = new Set([flagValue('--user', '-u'), flagValue('--limit')].filter(Boolean))
const XML_PATH = argv.find(a => !a.startsWith('-') && !consumed.has(a))

// ---------- helpers ----------
const sleep = ms => new Promise(r => setTimeout(r, ms))

function field(block, tag) {
	const re = new RegExp(`<${tag}>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))</${tag}>`)
	const m = block.match(re)
	if (!m) return ''
	return (m[1] != null ? m[1] : m[2] || '').trim()
}

function parseXml(xml) {
	const blocks = xml.match(/<anime>[\s\S]*?<\/anime>/g) || []
	return blocks.map(b => ({
		malId: parseInt(field(b, 'series_animedb_id') || '0', 10),
		seriesType: field(b, 'series_type'),
		status: field(b, 'my_status'),
		startDate: field(b, 'my_start_date'),
		finishDate: field(b, 'my_finish_date'),
		tags: field(b, 'my_tags'),
	}))
}

// Parse "Story: 5/10, Animation: 8/10, ... , Overall: 8.8/10" -> per-column values.
function parseTagScores(tags) {
	const out = { story: 0, character: 0, presentation: 0, sound: 0, enjoyment: 0, personal: 0 }
	if (!tags) return out
	for (const part of tags.split(',')) {
		const m = part.match(/^\s*([A-Za-z]+)\s*:\s*([\d.]*)\s*\/\s*10\s*$/)
		if (!m) continue
		const col = TAG_TO_COLUMN[m[1].toLowerCase()]
		if (!col || m[2] === '') continue
		const val = parseFloat(m[2])
		if (!Number.isFinite(val)) continue
		// category columns are integers; personal is a decimal
		out[col] = col === 'personal' ? val : Math.round(val)
	}
	return out
}

function toMs(d) {
	if (!d || d === '0000-00-00') return null
	const t = new Date(d).getTime()
	return Number.isFinite(t) ? t : null
}

// Shape MAL API data like Veud's getAnimeInfo/formatAnimeInfo (robust against missing fields).
function formatAnimeInfo(data) {
	let type = String(data.media_type ?? '').replace('_', ' ')
	if (type.length <= 3) type = type.toUpperCase()
	else {
		type = type.toLowerCase()
		if (type.includes('tv')) type = type.replace('tv', 'TV')
		type = type.split(' ').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ')
	}

	const eps = data.num_episodes ?? 0
	let length
	if (eps === 1) {
		const seconds = data.average_episode_duration ?? 0
		const hours = Math.floor(seconds / 3600)
		const minutes = Math.floor((seconds % 3600) / 60)
		length = hours === 0 ? `${minutes}m` : `${hours}h ${minutes}m`
	} else {
		if (type === 'TV') type = 'TV Series'
		length = `${eps} eps`
	}

	let startSeason = null
	const s = data.start_season
	if (s && s.season && s.year) {
		startSeason = `${s.season.charAt(0).toUpperCase()}${s.season.slice(1)} ${s.year}`
	}

	const image = data.main_picture?.large ?? data.main_picture?.medium ?? ''
	return {
		thumbnail: `${image}|https://myanimelist.net/anime/${data.id}`,
		title: data.title,
		type,
		startSeason,
		releaseStart: data.start_date ? new Date(data.start_date) : null,
		releaseEnd: data.end_date ? new Date(data.end_date) : null,
		length,
		rating: data.rating ? String(data.rating).replace('_', '-').toUpperCase() : null,
		genres: Array.isArray(data.genres) ? data.genres.map(g => g.name).join(', ') : '',
		studios: Array.isArray(data.studios)
			? data.studios.map(st => `${st.name}|https://myanimelist.net/anime/producer/${st.id}`)
			: [],
		malScore: data.mean ?? null,
		description: data.synopsis ?? '',
	}
}

async function fetchAnime(malId) {
	const res = await fetch(
		`https://api.myanimelist.net/v2/anime/${malId}?fields=${MAL_FIELDS}`,
		{ headers: { 'X-MAL-CLIENT-ID': process.env.MAL_CLIENT_ID } },
	)
	if (!res.ok) throw new Error(`MAL API ${res.status} ${res.statusText}`)
	return res.json()
}

// ---------- main ----------
async function main() {
	if (!XML_PATH || !fs.existsSync(XML_PATH)) {
		console.error('Usage: node scripts/import-mal-anime.mjs <export.xml> --user <veud-username> [--commit] [--limit N]')
		console.error('  (the Veud username can also come from VEUD_USERNAME in .env instead of --user)')
		process.exit(1)
	}
	if (!USERNAME) {
		console.error('Missing Veud username. Pass --user <username> or set VEUD_USERNAME in .env.')
		process.exit(1)
	}
	if (!process.env.MAL_CLIENT_ID) {
		console.error('MAL_CLIENT_ID is not set (expected in .env).')
		process.exit(1)
	}

	const prisma = new PrismaClient()
	try {
		const user = await prisma.user.findFirst({ where: { username: USERNAME }, select: { id: true } })
		if (!user) throw new Error(`Veud user "${USERNAME}" not found`)

		const listType = await prisma.listType.findFirst({ where: { name: LIST_TYPE }, select: { id: true } })
		if (!listType) throw new Error(`List type "${LIST_TYPE}" not found in this database`)

		const lists = await prisma.watchlist.findMany({
			where: { ownerId: user.id, typeId: listType.id },
			select: { id: true, name: true },
		})
		const listByName = new Map(lists.map(l => [l.name, l.id]))
		for (const name of new Set(Object.values(STATUS_TO_LIST))) {
			if (!listByName.has(name)) {
				throw new Error(`Anime list "${name}" not found for ${USERNAME} — create it first or adjust STATUS_TO_LIST.`)
			}
		}

		// per-list next position, seeded from the current max
		const nextPos = {}
		for (const [name, id] of listByName) {
			const agg = await prisma.entry.aggregate({ where: { watchlistId: id }, _max: { position: true } })
			nextPos[id] = (agg._max.position ?? 0) + 1
		}

		const entries = parseXml(fs.readFileSync(XML_PATH, 'utf8'))
		console.log(`Parsed ${entries.length} anime from the export. Mode: ${COMMIT ? 'COMMIT (writing)' : 'DRY-RUN (no writes)'}${LIMIT !== Infinity ? `, limit ${LIMIT}` : ''}\n`)

		const stats = { created: 0, dupe: 0, skippedType: 0, noList: 0, failed: 0 }
		const failures = []
		let processed = 0

		for (const e of entries) {
			if (processed >= LIMIT) break

			if (SKIP_TYPES.has(e.seriesType)) { stats.skippedType++; continue }
			const listName = STATUS_TO_LIST[e.status]
			const watchlistId = listName && listByName.get(listName)
			if (!watchlistId) { stats.noList++; continue }

			// dedupe by the MAL id embedded at the end of the thumbnail link
			const existing = await prisma.entry.findFirst({
				where: { watchlistId, thumbnail: { endsWith: `/anime/${e.malId}` } },
				select: { id: true },
			})
			if (existing) { stats.dupe++; continue }

			processed++
			let data
			try {
				await sleep(RATE_MS)
				data = await fetchAnime(e.malId)
			} catch (err) {
				stats.failed++; failures.push(`${e.malId} (${err.message})`)
				console.warn(`  ! fetch failed for MAL ${e.malId}: ${err.message}`)
				continue
			}

			const info = formatAnimeInfo(data)
			if (!info.title) {
				stats.failed++; failures.push(`${e.malId} (no title from MAL)`)
				continue
			}
			const sc = parseTagScores(e.tags)
			const cats = [sc.story, sc.character, sc.presentation, sc.sound, 0 /*performance*/, sc.enjoyment]
			const nonZero = cats.filter(c => c)
			const averaged = nonZero.length ? nonZero.reduce((a, b) => a + b, 0) / nonZero.length : 0
			const mal = info.malScore != null ? Number(info.malScore) : null
			const differencePersonal = sc.personal ? sc.personal - cats.reduce((a, b) => a + b, 0) / 6 : 0
			const differenceObjective = sc.personal && mal ? sc.personal - mal : 0

			const row = {
				watchlistId,
				position: nextPos[watchlistId],
				title: info.title,
				type: info.type,
				thumbnail: info.thumbnail,
				releaseStart: info.releaseStart,
				releaseEnd: info.releaseEnd,
				nextRelease: null,
				history: JSON.stringify({
					added: Date.now(),
					started: toMs(e.startDate),
					finished: toMs(e.finishDate),
					progress: null,
					lastUpdated: Date.now(),
				}),
				genres: info.genres,
				startSeason: info.startSeason,
				length: info.length,
				rating: info.rating,
				studios: JSON.stringify(info.studios),
				priority: 'Low',
				description: info.description,
				notes: '',
				story: sc.story, character: sc.character, presentation: sc.presentation,
				sound: sc.sound, performance: 0, enjoyment: sc.enjoyment,
				averaged, personal: sc.personal, differencePersonal, differenceObjective,
				malScore: mal,
			}

			if (COMMIT) {
				try {
					await prisma.entry.create({ data: row })
				} catch (err) {
					stats.failed++; failures.push(`${e.malId} (create failed: ${err.message})`)
					console.warn(`  ! create failed for "${info.title}" (MAL ${e.malId}): ${err.message}`)
					continue
				}
			} else {
				console.log(`  [DRY] ${listName.padEnd(11)} "${info.title}"  scores:{s${sc.story} c${sc.character} p${sc.presentation} so${sc.sound} e${sc.enjoyment} personal${sc.personal}}`)
			}
			nextPos[watchlistId]++
			stats.created++
			if (stats.created % 50 === 0) console.log(`  … ${stats.created} ${COMMIT ? 'created' : 'planned'}`)
		}

		console.log(`\nDone. ${COMMIT ? 'Created' : 'Would create'}: ${stats.created} | dupes skipped: ${stats.dupe} | non-anime types skipped: ${stats.skippedType} | no status mapping: ${stats.noList} | fetch failures: ${stats.failed}`)
		if (failures.length) console.log(`Failed MAL ids (re-run to retry — dedupe makes it safe):\n  ${failures.join('\n  ')}`)
	} finally {
		await prisma.$disconnect()
	}
}

main().catch(err => { console.error(err); process.exit(1) })
