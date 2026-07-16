#!/usr/bin/env node
/**
 * One-off importer: a MyAnimeList *manga* XML export -> a Veud user's manga lists.
 *
 * Mirrors scripts/import-mal-anime.mjs, adapted for manga:
 *   - maps MAL manga status -> one of the user's manga watchlists,
 *   - fetches each title's metadata from the MAL manga API (same fields as Veud's getMangaInfo)
 *     and shapes it like a UI-added manga entry (thumbnail, type, startYear, chapters, volumes,
 *     genres, serialization, authors, malScore, description),
 *   - maps the per-category scores in the MAL `tags` field into Veud's score columns,
 *   - and assigns each entry's position so every list is ordered by DESCENDING personal score
 *     (unrated titles last). That score comes from the tags, so ordering is decided before any
 *     fetch.
 *
 * Manga tag categories: Story, Art, Character, Enjoyment, Overall (no Sound/Animation). "Art" is
 * Veud's "presentation"; "Overall" is personal. Manga entries don't use sound/performance.
 *
 * SAFETY
 *   - DRY-RUN by default (prints, writes nothing). Pass --commit to write.
 *   - DEDUPE by MAL id, so re-runs / resuming after a failure are safe.
 *   - Back up first:  node scripts/backup-db.mjs
 *   - Suggested:  dry-run  ->  --commit --limit 5 (spot-check)  ->  --commit
 *
 * USAGE (from the project root, so .env is loaded):
 *   node scripts/import-mal-manga.mjs <mangalist.xml> --user <veud-username>            # dry-run
 *   node scripts/import-mal-manga.mjs <mangalist.xml> --user <veud-username> --commit   # write
 *   node scripts/import-mal-manga.mjs <mangalist.xml> --user <veud-username> --commit --limit 5
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
const LIST_TYPE = 'manga' // the Veud ListType.name whose lists these entries go into

// MAL manga status -> the user's Veud manga watchlist name.
const STATUS_TO_LIST = {
	'Reading': 'currentlyreading',
	'Completed': 'completed',
	'On-Hold': 'onhold',
	'Dropped': 'dropped',
	'Plan to Read': 'plantoread',
}

// MAL `tags` label -> Veud score column. ("Art" is Veud's "presentation"; "Overall" is personal.
// Manga has no Sound/Animation, and Veud's sound/performance are left unset for manga.)
const TAG_TO_COLUMN = {
	story: 'story',
	art: 'presentation',
	character: 'character',
	enjoyment: 'enjoyment',
	overall: 'personal',
}

const RATE_MS = 400
const MAL_FIELDS =
	'id,title,main_picture,alternative_titles,start_date,end_date,synopsis,mean,rank,popularity,num_list_users,num_scoring_users,nsfw,created_at,updated_at,media_type,status,genres,my_list_status,num_volumes,num_chapters,authors{first_name,last_name},pictures,background,related_anime,related_manga,recommendations,serialization{name}'

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
	const m = block.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))</${tag}>`))
	if (!m) return ''
	return (m[1] != null ? m[1] : m[2] || '').trim()
}

function parseXml(xml) {
	return (xml.match(/<manga>[\s\S]*?<\/manga>/g) || []).map(b => ({
		malId: parseInt(field(b, 'manga_mangadb_id') || '0', 10),
		xmlTitle: field(b, 'manga_title'),
		status: field(b, 'my_status'),
		startDate: field(b, 'my_start_date'),
		finishDate: field(b, 'my_finish_date'),
		tags: field(b, 'my_tags'),
	}))
}

function parseTagScores(tags) {
	const out = { story: 0, character: 0, presentation: 0, enjoyment: 0, personal: 0 }
	if (!tags) return out
	for (const part of tags.split(',')) {
		const m = part.match(/^\s*([A-Za-z]+)\s*:\s*([\d.]*)\s*\/\s*10\s*$/)
		if (!m) continue
		const col = TAG_TO_COLUMN[m[1].toLowerCase()]
		if (!col || m[2] === '') continue
		const val = parseFloat(m[2])
		if (!Number.isFinite(val)) continue
		out[col] = col === 'personal' ? val : Math.round(val)
	}
	return out
}

function toMs(d) {
	if (!d || d === '0000-00-00') return null
	const t = new Date(d).getTime()
	return Number.isFinite(t) ? t : null
}

// Shape MAL manga data like Veud's getMangaInfo/formatMangaInfo (robust against missing fields).
function formatMangaInfo(data) {
	let type = String(data.media_type ?? '').replace('_', ' ')
	if (type.length <= 3) type = type.toUpperCase()
	else type = type.toLowerCase().split(' ').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ')

	const sd = data.start_date ? new Date(data.start_date) : null
	const ed = data.end_date ? new Date(data.end_date) : null
	const validSd = sd && !isNaN(sd.getTime()) ? sd : null
	const validEd = ed && !isNaN(ed.getTime()) ? ed : null
	const startYear = validSd ? validSd.getFullYear() : null
	const genres = Array.isArray(data.genres) ? data.genres.map(g => g.name).join(', ') : ''
	const serialization = Array.isArray(data.serialization)
		? data.serialization.map(m => m.node).filter(Boolean)
			.map(m => (m.id != null ? `${m.name}|https://myanimelist.net/manga/magazine/${m.id}` : m.name))
		: []
	const authors = Array.isArray(data.authors)
		? data.authors.map(a => {
			const name = `${a.node?.first_name ?? ''} ${a.node?.last_name ?? ''}`.trim()
			return a.node?.id != null ? `${name} (${a.role})|https://myanimelist.net/people/${a.node.id}` : `${name} (${a.role})`
		})
		: []
	const image = data.main_picture?.large ?? data.main_picture?.medium ?? ''
	return {
		thumbnail: `${image}|https://myanimelist.net/manga/${data.id}`,
		title: data.title,
		type,
		startYear,
		releaseStart: validSd,
		releaseEnd: validEd,
		chapters: data.num_chapters,
		volumes: data.num_volumes,
		genres,
		serialization,
		authors,
		malScore: data.mean ?? null,
		description: data.synopsis ?? '',
	}
}

async function fetchManga(malId) {
	const res = await fetch(
		`https://api.myanimelist.net/v2/manga/${malId}?fields=${MAL_FIELDS}`,
		{ headers: { 'X-MAL-CLIENT-ID': process.env.MAL_CLIENT_ID } },
	)
	if (!res.ok) throw new Error(`MAL API ${res.status} ${res.statusText}`)
	return res.json()
}

// ---------- main ----------
async function main() {
	if (!XML_PATH || !fs.existsSync(XML_PATH)) {
		console.error('Usage: node scripts/import-mal-manga.mjs <mangalist.xml> --user <veud-username> [--commit] [--limit N]')
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
			if (!listByName.has(name)) throw new Error(`Manga list "${name}" not found for ${USERNAME} — create it or adjust STATUS_TO_LIST.`)
		}

		// Parse, attach scores, drop entries with no status mapping.
		const parsed = parseXml(fs.readFileSync(XML_PATH, 'utf8')).map(e => ({ ...e, scores: parseTagScores(e.tags) }))
		const mapped = parsed.filter(e => STATUS_TO_LIST[e.status] && listByName.has(STATUS_TO_LIST[e.status]))

		// Order each list by DESCENDING personal (unrated last), stable tie-break by title.
		const byList = new Map()
		for (const e of mapped) {
			const name = STATUS_TO_LIST[e.status]
			if (!byList.has(name)) byList.set(name, [])
			byList.get(name).push(e)
		}
		const queue = [] // { entry, watchlistId, position }
		for (const [name, arr] of byList) {
			arr.sort((a, b) => {
				const pa = a.scores.personal, pb = b.scores.personal
				if ((pa === 0) !== (pb === 0)) return pa === 0 ? 1 : -1 // unrated last
				if (pb !== pa) return pb - pa // higher personal first
				return a.xmlTitle.localeCompare(b.xmlTitle)
			})
			// seed positions from the list's current max (lists are expected empty, but be safe)
			const agg = await prisma.entry.aggregate({ where: { watchlistId: listByName.get(name) }, _max: { position: true } })
			let pos = (agg._max.position ?? 0) + 1
			for (const entry of arr) queue.push({ entry, watchlistId: listByName.get(name), position: pos++ })
		}

		console.log(`Parsed ${parsed.length} manga (${mapped.length} with a mapped status). Mode: ${COMMIT ? 'COMMIT' : 'DRY-RUN'}${LIMIT !== Infinity ? `, limit ${LIMIT}` : ''}\n`)

		const stats = { created: 0, dupe: 0, failed: 0 }
		const failures = []
		let processed = 0

		for (const item of queue) {
			if (processed >= LIMIT) break
			const { entry: e, watchlistId, position } = item

			const existing = await prisma.entry.findFirst({
				where: { watchlistId, thumbnail: { endsWith: `/manga/${e.malId}` } },
				select: { id: true },
			})
			if (existing) { stats.dupe++; continue }

			processed++
			let data
			try {
				await sleep(RATE_MS)
				data = await fetchManga(e.malId)
			} catch (err) {
				stats.failed++; failures.push(`${e.malId} (${err.message})`)
				console.warn(`  ! fetch failed for MAL manga ${e.malId}: ${err.message}`)
				continue
			}

			const info = formatMangaInfo(data)
			if (!info.title) { stats.failed++; failures.push(`${e.malId} (no title from MAL)`); continue }

			const sc = e.scores
			const cats = [sc.story, sc.character, sc.presentation, sc.enjoyment]
			const nonZero = cats.filter(c => c)
			const averaged = nonZero.length ? nonZero.reduce((a, b) => a + b, 0) / nonZero.length : 0
			const mal = info.malScore != null ? Number(info.malScore) : null
			// grid divides by 6 (sound/performance count as 0 for manga)
			const differencePersonal = sc.personal ? sc.personal - cats.reduce((a, b) => a + b, 0) / 6 : 0
			const differenceObjective = sc.personal && mal ? sc.personal - mal : 0

			const row = {
				watchlistId,
				position,
				title: info.title,
				type: info.type,
				thumbnail: info.thumbnail,
				startYear: info.startYear != null ? String(info.startYear) : null,
				releaseStart: info.releaseStart,
				releaseEnd: info.releaseEnd,
				nextRelease: null,
				chapters: info.chapters != null ? String(info.chapters) : null,
				volumes: info.volumes != null ? String(info.volumes) : null,
				history: JSON.stringify({
					added: Date.now(),
					started: toMs(e.startDate),
					finished: toMs(e.finishDate),
					progress: null,
					lastUpdated: Date.now(),
				}),
				genres: info.genres,
				serialization: JSON.stringify(info.serialization),
				authors: JSON.stringify(info.authors),
				priority: 'Low',
				story: sc.story, character: sc.character, presentation: sc.presentation, enjoyment: sc.enjoyment,
				averaged, personal: sc.personal, differencePersonal, differenceObjective,
				malScore: mal,
				description: info.description,
				notes: '',
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
				const listName = Object.keys(STATUS_TO_LIST).find(k => STATUS_TO_LIST[k] === lists.find(l => l.id === watchlistId)?.name)
				console.log(`  [DRY] pos ${String(position).padStart(3)} ${(listName || '').padEnd(11)} personal ${String(sc.personal).padStart(4)}  "${info.title}"`)
			}
			stats.created++
			if (stats.created % 50 === 0) console.log(`  … ${stats.created} ${COMMIT ? 'created' : 'planned'}`)
		}

		console.log(`\nDone. ${COMMIT ? 'Created' : 'Would create'}: ${stats.created} | dupes skipped: ${stats.dupe} | fetch/create failures: ${stats.failed}`)
		if (failures.length) console.log(`Failed MAL ids (re-run to retry — dedupe makes it safe):\n  ${failures.join('\n  ')}`)
	} finally {
		await prisma.$disconnect()
	}
}

main().catch(err => { console.error(err); process.exit(1) })
