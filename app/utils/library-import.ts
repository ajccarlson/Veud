export const libraryImportProviders = [
	'myanimelist',
	'anilist',
	'trakt',
	'letterboxd',
] as const

export type LibraryImportProvider = (typeof libraryImportProviders)[number]

export type LibraryImportItem = {
	sourceKey: string
	provider: LibraryImportProvider
	mediaKind: 'anime' | 'manga' | 'movie' | 'tv'
	title: string
	externalId: string | null
	status: string
	score: number | null
	progress: { episodes?: number; chapters?: number; volumes?: number }
	repeatCount: number
	startedAt: string | null
	completedAt: string | null
}

const statusAliases: Record<string, string> = {
	completed: 'completed',
	finished: 'completed',
	'plan to watch': 'planning',
	'plan to read': 'planning',
	planning: 'planning',
	'currently watching': 'current',
	'currently reading': 'current',
	watching: 'current',
	reading: 'current',
	current: 'current',
	'on-hold': 'paused',
	paused: 'paused',
	dropped: 'dropped',
}

function text(value: unknown) {
	if (typeof value === 'number' && Number.isFinite(value)) return String(value)
	return typeof value === 'string' ? value.trim() : ''
}

function finiteNumber(value: unknown) {
	const number = typeof value === 'number' ? value : Number(text(value))
	return Number.isFinite(number) ? number : null
}

function nonNegativeInteger(value: unknown) {
	const number = finiteNumber(value)
	return number === null ? 0 : Math.max(0, Math.floor(number))
}

function normalizedStatus(value: unknown) {
	const source = text(value).toLowerCase().replace(/_/g, ' ')
	return statusAliases[source] ?? (source || 'planning')
}

function normalizedDate(value: unknown) {
	const source = text(value)
	if (!source || source === '0000-00-00') return null
	const date = new Date(source)
	return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function decodeXml(value: string) {
	return value
		.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;|&#39;/g, "'")
		.replace(/&amp;/g, '&')
		.trim()
}

function xmlTag(block: string, name: string) {
	const match = block.match(
		new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'),
	)
	return match ? decodeXml(match[1] ?? '') : ''
}

export function parseMyAnimeListXml(source: string): LibraryImportItem[] {
	const items: LibraryImportItem[] = []
	for (const mediaKind of ['anime', 'manga'] as const) {
		const blocks = source.match(
			new RegExp(
				`<${mediaKind}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${mediaKind}>`,
				'gi',
			),
		)
		for (const block of blocks ?? []) {
			const prefix =
				mediaKind === 'anime' ? 'series_animedb_id' : 'manga_mangadb_id'
			const externalId = xmlTag(block, prefix)
			const title =
				xmlTag(block, 'series_title') || xmlTag(block, 'manga_title')
			if (!title) continue
			items.push({
				sourceKey: `mal:${mediaKind}:${externalId || items.length}`,
				provider: 'myanimelist',
				mediaKind,
				title,
				externalId: externalId || null,
				status: normalizedStatus(xmlTag(block, 'my_status')),
				score: finiteNumber(xmlTag(block, 'my_score')),
				progress:
					mediaKind === 'anime'
						? {
								episodes: nonNegativeInteger(
									xmlTag(block, 'my_watched_episodes'),
								),
							}
						: {
								chapters: nonNegativeInteger(xmlTag(block, 'my_read_chapters')),
								volumes: nonNegativeInteger(xmlTag(block, 'my_read_volumes')),
							},
				repeatCount: nonNegativeInteger(
					xmlTag(
						block,
						mediaKind === 'anime' ? 'my_times_watched' : 'my_times_read',
					),
				),
				startedAt: normalizedDate(xmlTag(block, 'my_start_date')),
				completedAt: normalizedDate(xmlTag(block, 'my_finish_date')),
			})
		}
	}
	return items
}

function parseCsv(source: string) {
	const rows: string[][] = []
	let row: string[] = []
	let field = ''
	let quoted = false
	for (let index = 0; index < source.length; index++) {
		const character = source[index]
		if (character === '"') {
			if (quoted && source[index + 1] === '"') {
				field += '"'
				index++
			} else {
				quoted = !quoted
			}
		} else if (character === ',' && !quoted) {
			row.push(field)
			field = ''
		} else if ((character === '\n' || character === '\r') && !quoted) {
			if (character === '\r' && source[index + 1] === '\n') index++
			row.push(field)
			if (row.some(value => value.length)) rows.push(row)
			row = []
			field = ''
		} else {
			field += character
		}
	}
	row.push(field)
	if (row.some(value => value.length)) rows.push(row)
	return rows
}

export function parseLetterboxdCsv(source: string): LibraryImportItem[] {
	const [rawHeaders, ...rows] = parseCsv(source)
	if (!rawHeaders) return []
	const headers = rawHeaders.map(header => header.trim().toLowerCase())
	const index = (name: string) => headers.indexOf(name.toLowerCase())
	const nameIndex = index('name')
	if (nameIndex < 0) return []
	const uriIndex = index('letterboxd uri')
	const ratingIndex = index('rating')
	const rewatchIndex = index('rewatch')
	const watchedIndex = index('watched date')
	return rows.flatMap((row, rowIndex) => {
		const title = text(row[nameIndex])
		if (!title) return []
		const uri = text(row[uriIndex])
		const slug = uri.match(/letterboxd\.com\/film\/([^/]+)/i)?.[1] ?? null
		const rating = finiteNumber(row[ratingIndex])
		return [
			{
				sourceKey: `letterboxd:movie:${slug || rowIndex}`,
				provider: 'letterboxd' as const,
				mediaKind: 'movie' as const,
				title,
				externalId: slug,
				status: 'completed',
				score: rating === null ? null : Math.min(10, Math.max(0, rating * 2)),
				progress: {},
				repeatCount: /^yes$/i.test(text(row[rewatchIndex])) ? 1 : 0,
				startedAt: null,
				completedAt: normalizedDate(row[watchedIndex]),
			},
		]
	})
}

function object(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {}
}

function collectObjects(value: unknown, output: Record<string, unknown>[]) {
	if (Array.isArray(value)) {
		for (const item of value) collectObjects(item, output)
		return
	}
	const record = object(value)
	if (!Object.keys(record).length) return
	if (record.media || record.movie || record.show) output.push(record)
	else for (const child of Object.values(record)) collectObjects(child, output)
}

export function parseJsonLibraryExport(
	provider: 'anilist' | 'trakt',
	source: string,
): LibraryImportItem[] {
	const parsed: unknown = JSON.parse(source)
	const records: Record<string, unknown>[] = []
	collectObjects(parsed, records)
	return records.flatMap((record, index) => {
		const media = object(record.media || record.movie || record.show)
		const titles = object(media.title)
		const title =
			text(titles.english) ||
			text(titles.romaji) ||
			text(titles.native) ||
			text(media.title) ||
			text(record.title)
		if (!title) return []
		const type = text(media.type || record.type).toLowerCase()
		const mediaKind =
			provider === 'trakt'
				? record.show
					? 'tv'
					: 'movie'
				: type.includes('manga')
					? 'manga'
					: 'anime'
		const ids = object(media.ids)
		const externalId =
			provider === 'anilist'
				? text(media.id || record.mediaId)
				: text(ids.trakt || media.id)
		const score = finiteNumber(record.score || record.rating)
		return [
			{
				sourceKey: `${provider}:${mediaKind}:${externalId || index}`,
				provider,
				mediaKind,
				title,
				externalId: externalId || null,
				status: normalizedStatus(record.status || 'completed'),
				score:
					score === null
						? null
						: provider === 'trakt'
							? Math.min(10, Math.max(0, score))
							: Math.min(10, Math.max(0, score > 10 ? score / 10 : score)),
				progress:
					mediaKind === 'anime' || mediaKind === 'tv'
						? { episodes: nonNegativeInteger(record.progress) }
						: mediaKind === 'manga'
							? {
									chapters: nonNegativeInteger(record.progress),
									volumes: nonNegativeInteger(record.progressVolumes),
								}
							: {},
				repeatCount: nonNegativeInteger(record.repeat || record.rewatchCount),
				startedAt: normalizedDate(record.startedAt || record.started_at),
				completedAt: normalizedDate(
					record.completedAt || record.watched_at || record.completed_at,
				),
			},
		]
	})
}

export function parseLibraryImport(
	provider: LibraryImportProvider,
	source: string,
) {
	if (provider === 'myanimelist') return parseMyAnimeListXml(source)
	if (provider === 'letterboxd') return parseLetterboxdCsv(source)
	return parseJsonLibraryExport(provider, source)
}
