import { useState } from 'react'
import { Icon } from '#app/components/ui/icon.tsx'
import {
	searchMAL,
	getAnimeInfo,
	getMangaInfo,
} from '#app/routes/media+/mal.ts'
import { searchTMDB, getTMDBInfo } from '#app/routes/media+/tmdb.ts'
import { mutateList } from '#app/utils/lists/mutation-client.ts'
import {
	mediaIdentityForMal,
	mediaIdentityForTmdb,
} from '#app/utils/media-identity.ts'
import { type ListTypeMeta } from '#app/utils/profile.ts'

type FavoriteSearchResult = {
	id: string | number
	title?: string
	name?: string
	media_type?: string
}

type FavoriteCatalogInfo = {
	thumbnail?: string | null
	title?: string | null
	type?: string | null
	year?: string | number | null
	startYear?: string | number | null
	startSeason?: { name?: string | null } | null
}

/**
 * Add-to-favorites picker for the profile. Searches the external catalogs (TMDB for
 * liveaction, MyAnimeList for anime/manga) for the currently-selected category, then
 * POSTs the chosen result to the session-authed add-favorite endpoint. The search
 * functions are the same ones the watchlist grid uses, so results/info shapes match.
 */
export function FavoriteSearch({
	listType,
	position,
	onAdded,
}: {
	listType: ListTypeMeta
	position: number
	onAdded: () => void
}) {
	const [query, setQuery] = useState('')
	const [results, setResults] = useState<FavoriteSearchResult[]>([])
	const [status, setStatus] = useState<'idle' | 'searching' | 'adding'>('idle')
	const [error, setError] = useState<string | null>(null)

	async function runSearch() {
		if (query.trim().length < 3 || status !== 'idle') return
		setStatus('searching')
		setError(null)
		let found: FavoriteSearchResult[] = []
		try {
			if (listType.name === 'liveaction') {
				found = (await searchTMDB(query, 'multi', 5)) ?? []
				// multi search can return people; favorites only cover movies/TV
				found = found.filter(
					result => result.media_type === 'movie' || result.media_type === 'tv',
				)
			} else if (listType.name === 'anime') {
				found = (await searchMAL(query, 'anime', 5)) ?? []
			} else if (listType.name === 'manga') {
				found = (await searchMAL(query, 'manga', 5)) ?? []
			}
		} catch {
			found = []
			setError('Search is unavailable. Try again.')
		}
		setResults(found)
		setStatus('idle')
	}

	async function addResult(result: FavoriteSearchResult) {
		if (status === 'adding') return
		setStatus('adding')
		setError(null)
		let favorite: Record<string, unknown> | null = null
		try {
			if (listType.name === 'liveaction') {
				const mediaType =
					result.media_type === 'tv' || result.media_type === 'movie'
						? result.media_type
						: 'movie'
				const info = (await getTMDBInfo(
					result.id,
					mediaType,
				)) as FavoriteCatalogInfo
				const mediaIdentity = mediaIdentityForTmdb(result.id, mediaType)
				if (!mediaIdentity) throw new Error('Unsupported media type')
				favorite = {
					mediaIdentity,
					position,
					thumbnail: info.thumbnail,
					title: info.title,
					typeId: listType.id,
					mediaType: info.type,
					startYear: String(info.year ?? ''),
				}
			} else if (listType.name === 'anime') {
				const info = (await getAnimeInfo(result.id)) as FavoriteCatalogInfo
				favorite = {
					mediaIdentity: mediaIdentityForMal(result.id, 'anime'),
					position,
					thumbnail: info.thumbnail,
					title: info.title,
					typeId: listType.id,
					mediaType: info.type,
					startYear: info.startSeason?.name ?? '',
				}
			} else if (listType.name === 'manga') {
				const info = (await getMangaInfo(result.id)) as FavoriteCatalogInfo
				favorite = {
					mediaIdentity: mediaIdentityForMal(result.id, 'manga'),
					position,
					thumbnail: info.thumbnail,
					title: info.title,
					typeId: listType.id,
					mediaType: info.type,
					startYear: String(info.startYear ?? ''),
				}
			}
			if (favorite) {
				await mutateList('add-favorite', { favorite })
			}
		} catch {
			setError('Could not add this favorite. Try again.')
			setStatus('idle')
			return
		}
		setQuery('')
		setResults([])
		setStatus('idle')
		onAdded()
	}

	const tooShort = query.trim().length > 0 && query.trim().length < 3

	return (
		<div className="user-landing-favorite-search">
			<div className="user-landing-favorite-search-bar">
				<input
					type="search"
					value={query}
					placeholder={`Search ${listType.header.toLowerCase()}…`}
					autoComplete="off"
					onChange={event => setQuery(event.target.value)}
					onKeyDown={event => {
						if (event.key === 'Enter') {
							event.preventDefault()
							void runSearch()
						}
					}}
				/>
				<button
					type="button"
					title="Search"
					onClick={() => void runSearch()}
					disabled={query.trim().length < 3 || status !== 'idle'}
				>
					<Icon name="magnifying-glass" />
				</button>
			</div>
			{tooShort ? (
				<em className="user-landing-favorite-search-hint">
					Type at least 3 characters
				</em>
			) : null}
			{status === 'searching' ? (
				<em className="user-landing-favorite-search-hint">Searching…</em>
			) : null}
			{status === 'adding' ? (
				<em className="user-landing-favorite-search-hint">Adding…</em>
			) : null}
			{error ? (
				<em className="user-landing-favorite-search-error" role="alert">
					{error}
				</em>
			) : null}
			{results.length > 0 ? (
				<ul className="user-landing-favorite-search-results">
					{results.map(result => (
						<li key={result.id}>
							<button
								type="button"
								onClick={() => void addResult(result)}
								disabled={status === 'adding'}
							>
								{result.title ?? result.name}
							</button>
						</li>
					))}
				</ul>
			) : null}
		</div>
	)
}
