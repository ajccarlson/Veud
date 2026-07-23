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
	externalProvider?: 'mal' | 'tmdb' | 'anilist' | 'trakt' | 'letterboxd'
	status: string
	score: number | null
	progress: { episodes?: number; chapters?: number; volumes?: number }
	repeatCount: number
	startedAt: string | null
	completedAt: string | null
	/**
	 * Ephemeral history identity used only while consolidating exports such as
	 * Trakt's one-row-per-episode history. It is not persisted in an import
	 * preview.
	 */
	historyUnitKey?: string
}

const MAX_EXTERNAL_ID_LENGTH = 200
const MAX_TITLE_LENGTH = 500
const MAX_PROGRESS = 2_147_483_647
const MAX_JSON_NODES = 100_000

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
	repeating: 'current',
	'on-hold': 'paused',
	paused: 'paused',
	dropped: 'dropped',
}

function text(value: unknown) {
	if (typeof value === 'number' && Number.isFinite(value)) return String(value)
	return typeof value === 'string' ? value.trim() : ''
}

function boundedText(value: unknown, maximum: number) {
	return text(value).slice(0, maximum)
}

function titleText(value: unknown) {
	return boundedText(value, MAX_TITLE_LENGTH)
}

function externalIdText(value: unknown) {
	return boundedText(value, MAX_EXTERNAL_ID_LENGTH)
}

function finiteNumber(value: unknown) {
	if (typeof value === 'number') return Number.isFinite(value) ? value : null
	const source = text(value)
	if (!source) return null
	const number = Number(source)
	return Number.isFinite(number) ? number : null
}

function nonNegativeInteger(value: unknown) {
	const number = finiteNumber(value)
	return number === null
		? 0
		: Math.min(MAX_PROGRESS, Math.max(0, Math.floor(number)))
}

function positiveScore(value: unknown) {
	const score = finiteNumber(value)
	return score !== null && score > 0 ? score : null
}

function normalizedStatus(value: unknown) {
	const source = text(value).toLowerCase().replace(/_/g, ' ')
	return statusAliases[source] ?? (source || 'planning')
}

function normalizedDate(value: unknown) {
	const source = text(value)
	if (!source || source === '0000-00-00') return null
	const date = new Date(source)
	if (Number.isNaN(date.getTime())) return null
	const year = date.getUTCFullYear()
	return year >= 1 && year <= 9999 ? date.toISOString() : null
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
			const externalId = externalIdText(xmlTag(block, prefix))
			const title =
				titleText(xmlTag(block, 'series_title')) ||
				titleText(xmlTag(block, 'manga_title'))
			if (!title) continue
			const score = positiveScore(xmlTag(block, 'my_score'))
			items.push({
				sourceKey: `mal:${mediaKind}:${externalId || items.length}`,
				provider: 'myanimelist',
				mediaKind,
				title,
				externalId: externalId || null,
				externalProvider: 'mal',
				status: normalizedStatus(xmlTag(block, 'my_status')),
				score: score === null ? null : Math.min(10, score),
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
	const exportDateIndex = index('date')
	return rows.flatMap((row, rowIndex) => {
		const title = titleText(row[nameIndex])
		if (!title) return []
		const uri = boundedText(row[uriIndex], 2_000)
		const slug = uri.match(/letterboxd\.com\/film\/([^/]+)/i)?.[1] ?? null
		const rating = positiveScore(row[ratingIndex])
		const watchedDate = text(row[watchedIndex] ?? row[exportDateIndex])
		return [
			{
				sourceKey: `letterboxd:movie:${slug || rowIndex}`,
				provider: 'letterboxd' as const,
				mediaKind: 'movie' as const,
				title,
				externalId: slug ? externalIdText(slug) : null,
				externalProvider: 'letterboxd' as const,
				status: watchedDate || rating !== null ? 'completed' : 'planning',
				score: rating === null ? null : Math.min(10, Math.max(0, rating * 2)),
				progress: {},
				repeatCount: /^yes$/i.test(text(row[rewatchIndex])) ? 1 : 0,
				startedAt: null,
				completedAt: normalizedDate(watchedDate),
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
	const pending = [value]
	let visited = 0
	while (pending.length) {
		const current = pending.pop()
		visited += 1
		if (visited > MAX_JSON_NODES) {
			throw new Error('The JSON export is too deeply or densely nested.')
		}
		if (Array.isArray(current)) {
			for (let index = current.length - 1; index >= 0; index--) {
				pending.push(current[index])
			}
			continue
		}
		const record = object(current)
		if (!Object.keys(record).length) continue
		if (record.media || record.movie || record.show) output.push(record)
		else {
			const values = Object.values(record)
			for (let index = values.length - 1; index >= 0; index--) {
				pending.push(values[index])
			}
		}
	}
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
		const title = titleText(
			text(titles.english) ||
				text(titles.romaji) ||
				text(titles.native) ||
				text(media.title) ||
				text(record.title),
		)
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
		const malId = externalIdText(media.idMal || media.id_mal)
		const tmdbId = externalIdText(ids.tmdb)
		const externalProvider =
			provider === 'anilist'
				? malId
					? ('mal' as const)
					: ('anilist' as const)
				: tmdbId
					? ('tmdb' as const)
					: ('trakt' as const)
		const externalId =
			provider === 'anilist'
				? malId || externalIdText(media.id || record.mediaId)
				: tmdbId || externalIdText(ids.trakt || media.id)
		const score = positiveScore(record.score || record.rating)
		const episode = object(record.episode)
		const episodeSeason = nonNegativeInteger(episode.season)
		const episodeNumber = nonNegativeInteger(episode.number)
		const historyUnitKey =
			provider === 'trakt' && Object.keys(episode).length
				? `${episodeSeason}:${episodeNumber || text(episode.title)}`
				: undefined
		const explicitStatus = text(record.status)
		const traktStatus = explicitStatus
			? normalizedStatus(explicitStatus)
			: historyUnitKey
				? 'current'
				: record.watched_at || record.rated_at
					? 'completed'
					: record.listed_at || record.rank
						? 'planning'
						: 'completed'
		return [
			{
				sourceKey: `${provider}:${mediaKind}:${externalId || index}`,
				provider,
				mediaKind,
				title,
				externalId: externalId || null,
				externalProvider,
				status:
					provider === 'trakt'
						? traktStatus
						: normalizedStatus(record.status || 'completed'),
				score:
					score === null
						? null
						: provider === 'trakt'
							? Math.min(10, Math.max(0, score))
							: Math.min(10, Math.max(0, score > 10 ? score / 10 : score)),
				progress: historyUnitKey
					? { episodes: 1 }
					: mediaKind === 'anime' || mediaKind === 'tv'
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
					record.completedAt ||
						(historyUnitKey ? null : record.watched_at) ||
						record.completed_at,
				),
				historyUnitKey,
			},
		]
	})
}

function earliestDate(values: Array<string | null>) {
	const dates = values.filter((value): value is string => Boolean(value)).sort()
	return dates[0] ?? null
}

function latestDate(values: Array<string | null>) {
	const dates = values.filter((value): value is string => Boolean(value)).sort()
	return dates.at(-1) ?? null
}

function normalizedImportTitle(value: string) {
	return value
		.normalize('NFKD')
		.replace(/\p{Mark}/gu, '')
		.toLowerCase()
		.replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
		.trim()
}

function importIdentity(item: LibraryImportItem) {
	const external = item.externalId
		? `${item.externalProvider ?? item.provider}:${item.externalId}`
		: normalizedImportTitle(item.title)
	return `${item.provider}:${item.mediaKind}:${external}`
}

/**
 * Provider history exports can contain one row per viewing. Collapse those
 * rows before reconciliation so a single canonical title cannot be selected
 * twice in the same atomic batch.
 */
export function consolidateLibraryImportItems(items: LibraryImportItem[]) {
	const groups = new Map<string, LibraryImportItem[]>()
	for (const item of items) {
		const key = importIdentity(item)
		groups.set(key, [...(groups.get(key) ?? []), item])
	}
	return [...groups.values()].map(group => {
		const first = group[0]!
		const chronological = group
			.map((item, index) => ({
				item,
				index,
				date: item.completedAt ?? item.startedAt ?? '',
			}))
			.sort(
				(a, b) => a.date.localeCompare(b.date) || a.index - b.index,
			)
			.map(value => value.item)
		const last = chronological.at(-1)!
		const completedRows = group.filter(
			item => item.status === 'completed',
		).length
		const scores = chronological.flatMap(item =>
			item.score === null ? [] : [item.score],
		)
		const historyUnits = new Set(
			group
				.map(item => item.historyUnitKey)
				.filter((value): value is string => Boolean(value)),
		)
		const importedEpisodes = group.some(
			item => item.progress.episodes !== undefined,
		)
			? Math.max(...group.map(item => item.progress.episodes ?? 0))
			: undefined
		return {
			...first,
			status: last.status,
			score: scores.at(-1) ?? null,
			progress: {
				episodes: historyUnits.size
					? Math.max(importedEpisodes ?? 0, historyUnits.size)
					: importedEpisodes,
				chapters: group.some(item => item.progress.chapters !== undefined)
					? Math.max(...group.map(item => item.progress.chapters ?? 0))
					: undefined,
				volumes: group.some(item => item.progress.volumes !== undefined)
					? Math.max(...group.map(item => item.progress.volumes ?? 0))
					: undefined,
			},
			repeatCount: Math.max(
				...group.map(item => item.repeatCount),
				historyUnits.size ? 0 : Math.max(0, completedRows - 1),
			),
			startedAt: earliestDate(group.map(item => item.startedAt)),
			completedAt: latestDate(group.map(item => item.completedAt)),
			historyUnitKey: undefined,
		}
	})
}

export function parseLibraryImport(
	provider: LibraryImportProvider,
	source: string,
) {
	const items =
		provider === 'myanimelist'
			? parseMyAnimeListXml(source)
			: provider === 'letterboxd'
				? parseLetterboxdCsv(source)
				: parseJsonLibraryExport(provider, source)
	return consolidateLibraryImportItems(items)
}
