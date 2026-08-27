const MAX_MEDIA_VIDEOS = 8
const MAX_VIDEO_NAME = 160

export type MediaVideo = {
	provider: 'tmdb'
	site: 'youtube' | 'vimeo'
	key: string
	name: string
	type: string
	official: boolean
	publishedAt: string | null
}

export type MediaVideoLink = MediaVideo & {
	url: string
	thumbnailUrl: string | null
}

function record(value: unknown) {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null
}

function text(value: unknown, limit: number) {
	if (typeof value !== 'string') return null
	const result = value.trim()
	return result && result.length <= limit ? result : null
}

function siteAndKey(value: Record<string, unknown>) {
	const rawSite = text(value.site, 20)?.toLowerCase()
	const key = text(value.key, 80)
	if (!key) return null
	if (rawSite === 'youtube' && /^[A-Za-z0-9_-]{6,32}$/.test(key)) {
		return { site: 'youtube' as const, key }
	}
	if (rawSite === 'vimeo' && /^\d{6,20}$/.test(key)) {
		return { site: 'vimeo' as const, key }
	}
	return null
}

function publishedAt(value: unknown) {
	const raw = text(value, 40)
	if (!raw) return null
	const date = new Date(raw)
	return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function videoTypePriority(type: string) {
	return (
		[
			'trailer',
			'teaser',
			'clip',
			'featurette',
			'behind the scenes',
			'bloopers',
		].indexOf(type.toLowerCase()) + 1 || 100
	)
}

function normalizedVideo(
	value: unknown,
	providerRequired: boolean,
): MediaVideo | null {
	const item = record(value)
	if (!item || (providerRequired && item.provider !== 'tmdb')) return null
	const destination = siteAndKey(item)
	const name = text(item.name, MAX_VIDEO_NAME)
	if (!destination || !name) return null
	return {
		provider: 'tmdb',
		...destination,
		name,
		type: text(item.type, 60) ?? 'Video',
		official: item.official === true,
		publishedAt: publishedAt(item.published_at ?? item.publishedAt),
	}
}

function rankVideos(videos: Array<MediaVideo & { sourceOrder: number }>) {
	return videos.sort((left, right) => {
		if (left.official !== right.official) return left.official ? -1 : 1
		const typeDifference =
			videoTypePriority(left.type) - videoTypePriority(right.type)
		if (typeDifference) return typeDifference
		const publishedDifference = (right.publishedAt ?? '').localeCompare(
			left.publishedAt ?? '',
		)
		return publishedDifference || left.sourceOrder - right.sourceOrder
	})
}

/** Normalize TMDB's appended `videos.results` payload into a fixed-size list. */
export function normalizeTmdbVideos(value: unknown): MediaVideo[] {
	const container = record(value)
	if (!container || !Array.isArray(container.results)) return []
	const seen = new Set<string>()
	const videos = container.results.flatMap((item, sourceOrder) => {
		const video = normalizedVideo(item, false)
		if (!video) return []
		const key = `${video.site}:${video.key}`
		if (seen.has(key)) return []
		seen.add(key)
		return [{ ...video, sourceOrder }]
	})
	return rankVideos(videos)
		.slice(0, MAX_MEDIA_VIDEOS)
		.map(({ sourceOrder: _sourceOrder, ...video }) => video)
}

export function serializeMediaVideos(videos: MediaVideo[]) {
	return videos.length
		? JSON.stringify(videos.slice(0, MAX_MEDIA_VIDEOS))
		: null
}

/** Revalidate stored provider data before deriving any external destination. */
export function mediaVideoLinks(value: unknown): MediaVideoLink[] {
	if (typeof value !== 'string' || value.length > 32_000) return []
	let parsed: unknown
	try {
		parsed = JSON.parse(value)
	} catch {
		return []
	}
	if (!Array.isArray(parsed)) return []
	return parsed.slice(0, MAX_MEDIA_VIDEOS).flatMap(item => {
		const video = normalizedVideo(item, true)
		if (!video) return []
		return [
			{
				...video,
				url:
					video.site === 'youtube'
						? `https://www.youtube.com/watch?v=${encodeURIComponent(video.key)}`
						: `https://vimeo.com/${video.key}`,
				thumbnailUrl:
					video.site === 'youtube'
						? `https://i.ytimg.com/vi/${encodeURIComponent(video.key)}/hqdefault.jpg`
						: null,
			},
		]
	})
}
