import { useEffect, useId, useRef, useState } from 'react'
import { Button } from '#app/components/ui/button.tsx'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '#app/components/ui/dropdown-menu.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import { refreshGrid } from '#app/routes/lists+/.$username+/.$list-type+/grid/grid-actions.ts'
import {
	getAnimeInfo,
	getMangaInfo,
	searchMAL,
} from '#app/routes/media+/mal.ts'
import { getTMDBInfo, searchTMDB } from '#app/routes/media+/tmdb.ts'
import {
	mediaIdentityForMal,
	mediaIdentityForTmdb,
	mediaIdentityKey,
	type MediaIdentity,
} from '#app/utils/media-identity.ts'
import '#app/styles/watchlist-search.scss'

type TrackingSummary = {
	mediaId: string
	watchlistId: string | null
	statusLabel: string | null
}

type SearchResultPreview = {
	identity: MediaIdentity
	title: string
	imageUrl: string | null
	year: string | null
	mediaType: string
	provider: 'MAL' | 'TMDB'
}

function humanizeMediaType(value: unknown, fallback: string) {
	if (typeof value !== 'string' || !value.trim()) return fallback
	const normalized = value.trim().toLowerCase().replaceAll('_', ' ')
	if (normalized === 'tv') return 'TV Series'
	if (normalized.length <= 3) return normalized.toUpperCase()
	return normalized.replace(/\b\w/g, character => character.toUpperCase())
}

function yearFrom(value: unknown) {
	if (typeof value !== 'string') return null
	const match = value.match(/^\d{4}/)
	return match?.[0] ?? null
}

export function searchResultPreview(
	result: any,
	listTypeName: string,
	selectedSearchType: string,
): SearchResultPreview | null {
	const title = result.title ?? result.name
	if (!result.id || typeof title !== 'string') return null

	if (listTypeName === 'liveaction') {
		const providerType = result.media_type || selectedSearchType
		const identity = mediaIdentityForTmdb(result.id, providerType)
		if (!identity) return null
		return {
			identity,
			title,
			imageUrl: result.poster_path
				? `https://www.themoviedb.org/t/p/w300_and_h450_bestv2${result.poster_path}`
				: null,
			year: yearFrom(result.release_date ?? result.first_air_date),
			mediaType: humanizeMediaType(providerType, selectedSearchType),
			provider: 'TMDB',
		}
	}

	const kind = listTypeName === 'manga' ? 'manga' : 'anime'
	const imageUrl =
		result.main_picture?.large ?? result.main_picture?.medium ?? null
	return {
		identity: mediaIdentityForMal(result.id, kind),
		title,
		imageUrl,
		year: result.start_season?.year
			? String(result.start_season.year)
			: yearFrom(result.start_date),
		mediaType: humanizeMediaType(
			result.media_type,
			kind === 'anime' ? 'Anime' : 'Manga',
		),
		provider: 'MAL',
	}
}

function entryHistory() {
	const now = Date.now()
	return JSON.stringify({
		added: now,
		started: null,
		finished: null,
		progress: null,
		lastUpdated: now,
	})
}

async function buildEntryFromResult(
	result: any,
	columnParams: any,
	destinationWatchlistId: string,
) {
	const listTypeName = columnParams.listTypeData.name
	const position = Number.MAX_SAFE_INTEGER
	const scoreDefaults = {
		story: 0,
		character: 0,
		presentation: 0,
		enjoyment: 0,
		averaged: 0,
		personal: 0,
		differencePersonal: 0,
		differenceObjective: 0,
		notes: '',
	}

	if (listTypeName === 'liveaction') {
		const providerType = result.media_type || columnParams.selectedSearchType
		const resultInfo: any = await getTMDBInfo(result.id, providerType)
		if (!resultInfo) throw new Error('TMDB did not return title details')
		return {
			mediaIdentity: mediaIdentityForTmdb(result.id, providerType),
			mediaRelations: resultInfo.mediaRelations,
			watchlistId: destinationWatchlistId,
			position,
			thumbnail: resultInfo.thumbnail,
			title: resultInfo.title,
			type: resultInfo.type,
			airYear: String(resultInfo.year),
			releaseStart: new Date(resultInfo.releaseStart),
			releaseEnd: new Date(resultInfo.releaseEnd),
			nextRelease: JSON.stringify(resultInfo.nextRelease),
			length: resultInfo.length,
			rating: resultInfo.rating,
			history: entryHistory(),
			genres: resultInfo.genres,
			language: resultInfo.language,
			...scoreDefaults,
			sound: 0,
			performance: 0,
			tmdbScore: resultInfo.score,
			description: resultInfo.description,
		}
	}

	if (listTypeName === 'anime') {
		const resultInfo: any = await getAnimeInfo(result.id)
		if (!resultInfo) throw new Error('MAL did not return anime details')
		return {
			mediaIdentity: mediaIdentityForMal(result.id, 'anime'),
			mediaRelations: resultInfo.mediaRelations,
			watchlistId: destinationWatchlistId,
			position,
			thumbnail: resultInfo.thumbnail,
			title: resultInfo.title,
			type: resultInfo.type,
			startSeason: resultInfo.startSeason?.name ?? null,
			releaseStart: new Date(resultInfo.releaseStart),
			releaseEnd: new Date(resultInfo.releaseEnd),
			nextRelease: JSON.stringify(resultInfo.nextRelease),
			length: resultInfo.length,
			rating: resultInfo.rating,
			history: entryHistory(),
			genres: resultInfo.genres,
			studios: JSON.stringify(resultInfo.studios),
			priority: 'Low',
			...scoreDefaults,
			sound: 0,
			performance: 0,
			malScore: resultInfo.malScore,
			description: resultInfo.description,
		}
	}

	const resultInfo: any = await getMangaInfo(result.id)
	if (!resultInfo) throw new Error('MAL did not return manga details')
	return {
		mediaIdentity: mediaIdentityForMal(result.id, 'manga'),
		mediaRelations: resultInfo.mediaRelations,
		watchlistId: destinationWatchlistId,
		position,
		thumbnail: resultInfo.thumbnail,
		title: resultInfo.title,
		type: resultInfo.type,
		startYear: String(resultInfo.startYear),
		releaseStart: result.start_date ? new Date(result.start_date) : null,
		chapters: String(resultInfo.chapters),
		volumes: String(resultInfo.volumes),
		history: entryHistory(),
		genres: resultInfo.genres,
		serialization: JSON.stringify(resultInfo.serialization),
		authors: JSON.stringify(resultInfo.authors),
		priority: 'Low',
		...scoreDefaults,
		malScore: resultInfo.malScore,
		description: resultInfo.description,
	}
}

async function requireSuccessfulResponse(response: Response) {
	if (response.ok) return response
	throw new Error(
		(await response.text()) || `Request failed (${response.status})`,
	)
}

export function MediaTypeDropdown(params: any) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					className="cursor-pointer rounded bg-[#6F6F6F] px-[0.5rem] py-[0.1rem] text-base font-bold hover:bg-[#8CA99D]"
				>
					{params.columnParams.selectedSearchType}
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent sideOffset={8} align="start">
				<DropdownMenuItem
					onClick={() => params.columnParams.setSelectedSearchType('Movie')}
				>
					Movie
				</DropdownMenuItem>
				<DropdownMenuItem
					onClick={() => params.columnParams.setSelectedSearchType('TV Series')}
				>
					TV Series
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	)
}

export function MediaSearchBar(params: any) {
	const inputId = useId()
	const dialogInputId = useId()
	const dialogTitleId = useId()
	const dialogRef = useRef<HTMLDialogElement>(null)
	const [searchQuery, setSearchQuery] = useState('')
	const [mediaResults, setMediaResults] = useState<any[]>([])
	const [selectedWatchlistId, setSelectedWatchlistId] = useState(
		params.columnParams.watchlistId,
	)
	const [trackingByIdentity, setTrackingByIdentity] = useState<
		Record<string, TrackingSummary>
	>(params.columnParams.trackingByIdentity ?? {})
	const [isSearching, setIsSearching] = useState(false)
	const [addingIdentity, setAddingIdentity] = useState<string | null>(null)
	const [errorMessage, setErrorMessage] = useState<string | null>(null)
	const [announcement, setAnnouncement] = useState<string | null>(null)

	const destinations = [
		...(params.columnParams.typedWatchlists[
			params.columnParams.listTypeData.id
		] ?? []),
	].sort((first: any, second: any) => first.position - second.position)
	const selectedDestination = destinations.find(
		(destination: any) => destination.id === selectedWatchlistId,
	)

	useEffect(() => {
		setSelectedWatchlistId(params.columnParams.watchlistId)
	}, [params.columnParams.watchlistId])

	useEffect(() => {
		setTrackingByIdentity(params.columnParams.trackingByIdentity ?? {})
	}, [params.columnParams.trackingByIdentity])

	async function search(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault()
		const query = searchQuery.trim()
		if (query.length < 3) {
			setErrorMessage('Enter at least 3 characters to search.')
			return
		}

		setIsSearching(true)
		setErrorMessage(null)
		setAnnouncement(null)
		try {
			let results: any[] | undefined
			if (params.columnParams.listTypeData.name === 'liveaction') {
				results = await searchTMDB(
					query,
					params.columnParams.selectedSearchType,
					8,
				)
			} else if (params.columnParams.listTypeData.name === 'anime') {
				results = await searchMAL(query, 'anime', 8)
			} else {
				results = await searchMAL(query, 'manga', 8)
			}
			setMediaResults(Array.isArray(results) ? results : [])
			if (!dialogRef.current?.open) dialogRef.current?.showModal()
		} catch (error) {
			console.error('[watchlist] search failed', error)
			setMediaResults([])
			setErrorMessage('Search failed. Please try again.')
		} finally {
			setIsSearching(false)
		}
	}

	async function saveResult(result: any, preview: SearchResultPreview) {
		if (!selectedDestination) return
		const identityKey = mediaIdentityKey(preview.identity)
		const tracked = trackingByIdentity[identityKey]
		setAddingIdentity(identityKey)
		setErrorMessage(null)
		try {
			let mediaId: string | undefined = tracked?.mediaId
			if (mediaId) {
				const body = new FormData()
				body.set('mediaId', mediaId)
				body.set('watchlistId', selectedDestination.id)
				const response = await fetch('/resources/quick-track', {
					method: 'POST',
					body,
				})
				await requireSuccessfulResponse(response)
			} else {
				const row = await buildEntryFromResult(
					result,
					params.columnParams,
					selectedDestination.id,
				)
				const response = await fetch(
					'/lists/fetch/add-row/' +
						encodeURIComponent(
							new URLSearchParams({
								authorization: params.columnParams.VEUD_API_KEY,
								listTypeData: JSON.stringify(params.columnParams.listTypeData),
								row: JSON.stringify(row),
							}).toString(),
						),
					{ method: 'POST' },
				)
				await requireSuccessfulResponse(response)
				const entry = (await response.json()) as { mediaId?: string }
				mediaId = entry.mediaId
			}

			if (mediaId) {
				const trackingSummary = {
					mediaId,
					watchlistId: selectedDestination.id,
					statusLabel: selectedDestination.header,
				}
				params.columnParams.trackingByIdentity[identityKey] = trackingSummary
				setTrackingByIdentity(current => ({
					...current,
					[identityKey]: trackingSummary,
				}))
			}
			setAnnouncement(
				`${preview.title} saved to ${selectedDestination.header}.`,
			)
			setSearchQuery('')
			setMediaResults([])
			dialogRef.current?.close()
			await refreshGrid(params.columnParams)
		} catch (error) {
			console.error('[watchlist] failed to add search result', error)
			setErrorMessage('Could not save this title. Please try again.')
		} finally {
			setAddingIdentity(null)
		}
	}

	return (
		<div className="watchlist-search">
			<form onSubmit={search} className="watchlist-search-inline">
				<label className="sr-only" htmlFor={inputId}>
					Search
				</label>
				<input
					type="search"
					id={inputId}
					value={searchQuery}
					placeholder="Search"
					autoComplete="off"
					className="watchlist-search-bar"
					onChange={event => setSearchQuery(event.currentTarget.value)}
				/>
				<StatusButton
					type="submit"
					status={isSearching ? 'pending' : 'idle'}
					disabled={isSearching}
					aria-label="Search catalog"
				>
					<Icon name="magnifying-glass" size="md" />
				</StatusButton>
			</form>
			{errorMessage && !dialogRef.current?.open ? (
				<p role="alert" className="watchlist-search-error-message">
					{errorMessage}
				</p>
			) : null}
			{announcement ? (
				<p role="status" className="watchlist-search-announcement">
					{announcement}
				</p>
			) : null}

			<dialog
				ref={dialogRef}
				className="watchlist-search-dialog"
				aria-labelledby={dialogTitleId}
				onCancel={() => setErrorMessage(null)}
			>
				<div className="watchlist-search-dialog-shell">
					<header className="watchlist-search-dialog-header">
						<div>
							<p className="watchlist-search-eyebrow">Quick add</p>
							<h2 id={dialogTitleId}>Choose a title</h2>
						</div>
						<Button
							type="button"
							variant="ghost"
							size="icon"
							aria-label="Close quick add"
							onClick={() => dialogRef.current?.close()}
						>
							<span aria-hidden="true">×</span>
						</Button>
					</header>

					<div className="watchlist-search-controls">
						<form onSubmit={search} className="watchlist-search-refine">
							<label htmlFor={dialogInputId}>Search the catalog</label>
							<div>
								<input
									id={dialogInputId}
									type="search"
									value={searchQuery}
									autoComplete="off"
									onChange={event => setSearchQuery(event.currentTarget.value)}
								/>
								<Button type="submit" disabled={isSearching}>
									{isSearching ? 'Searching…' : 'Search'}
								</Button>
							</div>
						</form>
						<label className="watchlist-search-destination">
							<span>Add to list</span>
							<select
								value={selectedWatchlistId}
								onChange={event =>
									setSelectedWatchlistId(event.currentTarget.value)
								}
								disabled={addingIdentity !== null}
							>
								{destinations.map((destination: any) => (
									<option key={destination.id} value={destination.id}>
										{destination.header}
									</option>
								))}
							</select>
						</label>
					</div>

					{errorMessage ? (
						<p role="alert" className="watchlist-search-dialog-error">
							{errorMessage}
						</p>
					) : null}

					<div className="watchlist-search-results">
						{mediaResults.length ? (
							mediaResults.map(result => {
								const preview = searchResultPreview(
									result,
									params.columnParams.listTypeData.name,
									params.columnParams.selectedSearchType,
								)
								if (!preview) return null
								const identityKey = mediaIdentityKey(preview.identity)
								const tracked = trackingByIdentity[identityKey]
								const alreadyHere =
									tracked?.watchlistId === selectedDestination?.id
								const actionLabel = alreadyHere
									? `In ${selectedDestination?.header}`
									: tracked
										? `Move to ${selectedDestination?.header}`
										: `Add to ${selectedDestination?.header}`
								return (
									<article
										key={identityKey}
										className="watchlist-search-result"
									>
										<div className="watchlist-search-poster">
											{preview.imageUrl ? (
												<img src={preview.imageUrl} alt="" loading="lazy" />
											) : (
												<span>No poster</span>
											)}
										</div>
										<div className="watchlist-search-result-body">
											<div className="watchlist-search-result-meta">
												<span>{preview.provider}</span>
												<span>{preview.mediaType}</span>
												{preview.year ? <span>{preview.year}</span> : null}
											</div>
											<h3>{preview.title}</h3>
											{tracked?.statusLabel ? (
												<p className="watchlist-search-tracked-state">
													Currently in {tracked.statusLabel}
												</p>
											) : (
												<p className="watchlist-search-untracked-state">
													Not on your lists
												</p>
											)}
											<Button
												type="button"
												size="sm"
												disabled={
													alreadyHere ||
													addingIdentity !== null ||
													!selectedDestination
												}
												aria-label={`${actionLabel} ${preview.title}`}
												onClick={() => saveResult(result, preview)}
											>
												{addingIdentity === identityKey
													? 'Saving…'
													: actionLabel}
											</Button>
										</div>
									</article>
								)
							})
						) : (
							<div className="watchlist-search-empty">
								<h3>No titles found</h3>
								<p>Try another title, spelling, or media type.</p>
							</div>
						)}
					</div>
				</div>
			</dialog>
		</div>
	)
}
