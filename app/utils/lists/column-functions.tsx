import {
	MediaSearchBar,
	MediaTypeDropdown,
} from '#app/components/search-add-watchlist-entry.tsx'
import { refreshGrid } from '#app/routes/lists+/.$username+/.$list-type+/grid/grid-actions.ts'
import {
	searchMAL,
	getAnimeInfo,
	getMangaInfo,
} from '#app/routes/media+/mal.ts'
import { searchTMDB, getTMDBInfo } from '#app/routes/media+/tmdb.ts'
import {
	mediaIdentityForMal,
	mediaIdentityForTmdb,
} from '#app/utils/media-identity.ts'
import { serializeNextRelease } from '#app/utils/release-schedule.ts'

export function dateFormatter(params: any) {
	try {
		if (
			!params ||
			params == null ||
			params == 0 ||
			params == '1970-01-01T00:00:00.000Z' ||
			params == new Date(0)
		)
			return ' '

		let date = new Date(params)

		let year = new Intl.DateTimeFormat('en', { year: '2-digit' }).format(date)
		let month = new Intl.DateTimeFormat('en', { month: 'numeric' }).format(date)
		let day = new Intl.DateTimeFormat('en', { day: 'numeric' }).format(date)
		return `${month}/${day}/${year}`
	} catch (e) {
		console.error(e)
	}
}

export function mediaProgressParser(
	params: any,
	columnParams: any,
	oldValue: any,
	newValue: any,
) {
	let mediaType: any

	try {
		const mediaTypeArray = JSON.parse(
			columnParams.listTypeData.mediaType,
		) as any[]
		const mediaTypesFormatted = mediaTypeArray.map(
			mediaTypeRaw => `${mediaTypeRaw}s`,
		)
		const typeIndex = mediaTypesFormatted.findIndex(
			e => e === params.column.colId,
		)

		if (!mediaTypesFormatted || mediaTypesFormatted.length < 1) {
			mediaType = 'episode'
		} else if (typeIndex > 0) {
			mediaType = mediaTypeArray[typeIndex]
		} else {
			mediaType = mediaTypeArray[0]
		}

		let mediaTotal: any
		try {
			mediaTotal = [...oldValue.matchAll(/\d+/g)]
		} catch (e) {
			mediaTotal = 0
		}

		if (!oldValue) {
			oldValue = 0
		}

		let matchResult, mediaProgress

		if (newValue) {
			if (!isNaN(newValue) && newValue > 0) {
				mediaProgress = newValue
			} else {
				mediaProgress = 0
			}
		} else {
			try {
				const historyObject = JSON.parse(params.data.history) as any
				let lastWatched = {
					entry: 0,
					date: 0,
				}

				let progressObject
				if (params.column.colId == 'length') {
					progressObject = historyObject.progress
				} else {
					progressObject = historyObject.progress[mediaType]
				}

				Object.entries(progressObject).forEach(
					([progressKey, progressValue]: [string, any]) => {
						let currentMax = Math.max(...progressValue.finishDate)

						if (currentMax && currentMax > lastWatched.date) {
							lastWatched = {
								entry: Number(progressKey),
								date: currentMax,
							}
						}
					},
				)

				mediaProgress = lastWatched.entry
			} catch (e) {
				mediaProgress = 0
			}
		}

		try {
			matchResult = mediaTotal.slice(-1)[0][0]
		} catch (e) {
			return {
				progress: 0,
				total: oldValue,
			}
		}

		if (matchResult) {
			return {
				progress: mediaProgress,
				total: matchResult,
			}
		}
	} catch (e) {
		console.error(e)
	}
}

export function timeSince(date: Date | number) {
	const seconds = Math.floor((new Date().valueOf() - date.valueOf()) / 1000)
	let interval = seconds / 31536000
	let flooredInterval = Math.floor(interval)

	function updateInterval(denominator: number) {
		interval = seconds / denominator
		flooredInterval = Math.floor(interval)
	}

	if (interval > 1) {
		if (flooredInterval == 1) return flooredInterval + ' year'
		else return flooredInterval + ' years'
	}

	updateInterval(2592000)

	if (interval > 1) {
		if (flooredInterval == 1) return flooredInterval + ' month'
		else return flooredInterval + ' months'
	}

	updateInterval(86400)

	if (interval > 1) {
		if (flooredInterval == 1) return flooredInterval + ' day'
		else return flooredInterval + ' days'
	}

	updateInterval(3600)

	if (interval > 1) {
		if (flooredInterval == 1) return flooredInterval + ' hour'
		else return flooredInterval + ' hours'
	}

	updateInterval(60)

	if (interval > 1) {
		if (flooredInterval == 1) return flooredInterval + ' minute'
		else return flooredInterval + ' minutes'
	}

	if (Math.floor(seconds) == 1) return flooredInterval + ' second'
	else return flooredInterval + ' seconds'
}

export function getStartYear(entry: any, passedType: any, listTypes: any[]) {
	try {
		let typeData = listTypes.find(listType => listType.id == passedType.id)

		if (
			Object.keys(
				JSON.parse(typeData.columns) as Record<string, unknown>,
			).includes('airYear')
		) {
			return entry.airYear
		} else if (
			Object.keys(
				JSON.parse(typeData.columns) as Record<string, unknown>,
			).includes('startSeason')
		) {
			return entry.startSeason
		} else if (
			Object.keys(
				JSON.parse(typeData.columns) as Record<string, unknown>,
			).includes('startYear')
		) {
			return entry.startYear
		} else {
			return false
		}
	} catch (e) {}
}

export function getThumbnailInfo(thumbnail: string | null | undefined) {
	const value = thumbnail ?? ''
	const separatorIndex = value.indexOf('|')
	if (separatorIndex < 0) return { content: value, url: '' }

	return {
		content: value.slice(0, separatorIndex),
		url: value.slice(separatorIndex + 1),
	}
}

export function hyperlinkRenderer(
	params: string,
	type: any = undefined,
	mediaId: string | null = null,
) {
	let content, url, inner

	try {
		const paramsObject = JSON.parse(params) as any[]

		let itemCount = 0
		let hyperlinkArray = []

		for (const item of paramsObject) {
			const { content, url } = getThumbnailInfo(item)

			if (itemCount % 2 == 0) {
				inner = <span className="ag-list-odd">{content}</span>
			} else {
				inner = <span className="ag-list-even">{content}</span>
			}

			hyperlinkArray.push(<a href={url}>{inner}</a>)
		}

		return hyperlinkArray
	} catch (e) {
		if (!params || (params.replace(/\W/g, '') == '' && type == 'thumbnail')) {
			content = '/favicons/favicon.png'
			url = '/discover'
		} else {
			const thumbnail = getThumbnailInfo(params)
			content = thumbnail.content
			url = thumbnail.url
		}

		if (mediaId) url = `/media/${encodeURIComponent(mediaId)}`

		if (type == 'thumbnail') {
			inner = (
				<span>
					{
						<img
							alt={`Thumbnail`}
							src={content}
							className="ag-thumbnail-image"
						/>
					}
				</span>
			)
		} else {
			inner = <span>{content}</span>
		}

		return <a href={url}>{inner}</a>
	}
}

export function getSiteID(url: string) {
	try {
		const linkSplit = url.split('/').filter(Boolean)

		let linkSite
		if (linkSplit.findIndex(element => element.includes('imdb')) > -1)
			linkSite = 'imdb'
		else if (
			linkSplit.findIndex(element => element.includes('tmdb')) > -1 ||
			linkSplit.findIndex(element => element.includes('themoviedb')) > -1
		)
			linkSite = 'tmdb'
		else if (
			linkSplit.findIndex(element => element.includes('myanimelist')) > -1
		)
			linkSite = 'mal'
		else throw new Error()

		const id = linkSplit.at(-1)

		return {
			site: linkSite,
			id: id,
		}
	} catch (e) {
		console.error(url)
		throw new Error('Failed to get site ID!\n' + e)
	}
}

// getSiteID throws for a thumbnail URL that doesn't match any known site (imdb/tmdb/mal) --
// updateRowInfo relies on that throw to trigger its title-search fallback. Render-time callers
// (checking/toggling favorites) can't recover the same way and shouldn't crash the page over an
// unrecognized thumbnail; this wrapper gives them null instead.
export function getSiteIdSafe(url: string) {
	try {
		return getSiteID(url)
	} catch (e) {
		return null
	}
}

export function titleCellRenderer(params: any, columnParams: any) {
	if (
		(!params.value || params.value.replace(/\W/g, '') === '') &&
		columnParams.currentUserId == columnParams.listOwner.id
	) {
		return (
			<div className="w-full min-w-0">
				<div className="ml-auto w-full max-w-sm">
					<MediaSearchBar params={params} columnParams={columnParams} />
				</div>
			</div>
		)
	} else {
		return params.value
	}
}

export function typeCellRenderer(params: any, columnParams: any) {
	if (
		(!params.value ||
			(params.value.replace(/\W/g, '') === '' &&
				columnParams.currentUserId == columnParams.listOwner.id)) &&
		columnParams.listTypeData.id == 'yducsgix'
	) {
		return <MediaTypeDropdown columnParams={columnParams} />
	} else {
		return params.value
	}
}

export async function updateRowInfo(params: any, columnParams: any, bulk: any) {
	let entryInfo: any, rawInfo: any, resultInfo: any, updateRow: any

	try {
		const separatorIndex = params.data.thumbnail.indexOf('|')
		const entryUrl = params.data.thumbnail.slice(separatorIndex + 1)

		entryInfo = getSiteID(entryUrl)
	} catch (e) {
		if (columnParams.listTypeData.name == 'liveaction') {
			rawInfo = await searchTMDB(params.data.title, params.data.type, 5)
			entryInfo = {
				site: 'tmdb',
				id: rawInfo[0].id,
			}
		} else if (columnParams.listTypeData.name == 'anime') {
			rawInfo = await searchMAL(params.data.title, 'anime', 5)
			entryInfo = {
				site: 'mal',
				id: rawInfo[0].id,
			}
		} else if (columnParams.listTypeData.name == 'manga') {
			rawInfo = await searchMAL(params.data.title, 'manga', 5)
			entryInfo = {
				site: 'mal',
				id: rawInfo[0].id,
			}
		}
	}

	if (columnParams.listTypeData.name == 'liveaction') {
		resultInfo = await getTMDBInfo(entryInfo.id, params.data.type)
		updateRow = {
			/*id: " ", */ mediaIdentity: mediaIdentityForTmdb(
				entryInfo.id,
				resultInfo.type,
			),
			watchlistId: params.data.watchlistId,
			position: params.data.position,
			thumbnail: resultInfo.thumbnail,
			title: resultInfo.title,
			type: resultInfo.type,
			airYear: String(resultInfo.year),
			releaseStart: new Date(resultInfo.releaseStart),
			releaseEnd: new Date(resultInfo.releaseEnd),
			nextRelease: serializeNextRelease(resultInfo.nextRelease),
			length: resultInfo.length,
			rating: resultInfo.rating,
			history: params.data.history,
			genres: resultInfo.genres,
			language: resultInfo.language,
			story: params.data.story,
			character: params.data.character,
			presentation: params.data.presentation,
			sound: params.data.sound,
			performance: params.data.performance,
			enjoyment: params.data.enjoyment,
			averaged: params.data.averaged,
			personal: params.data.personal,
			differencePersonal: params.data.differencePersonal,
			tmdbScore: resultInfo.score,
			differenceObjective: params.data.differenceObjective,
			description: resultInfo.description,
			notes: params.data.notes,
		}
	} else if (columnParams.listTypeData.name == 'anime') {
		resultInfo = await getAnimeInfo(entryInfo.id)
		updateRow = {
			/*id: " ", */ mediaIdentity: mediaIdentityForMal(entryInfo.id, 'anime'),
			watchlistId: params.data.watchlistId,
			position: params.data.position,
			thumbnail: resultInfo.thumbnail,
			title: resultInfo.title,
			type: resultInfo.type,
			startSeason: resultInfo.startSeason.name,
			releaseStart: new Date(resultInfo.releaseStart),
			releaseEnd: new Date(resultInfo.releaseEnd),
			nextRelease: serializeNextRelease(resultInfo.nextRelease),
			length: resultInfo.length,
			rating: resultInfo.rating,
			history: params.data.history,
			genres: resultInfo.genres,
			studios: JSON.stringify(resultInfo.studios),
			priority: params.data.priority,
			story: params.data.story,
			character: params.data.character,
			presentation: params.data.presentation,
			sound: params.data.sound,
			performance: params.data.performance,
			enjoyment: params.data.enjoyment,
			averaged: params.data.averaged,
			personal: params.data.personal,
			differencePersonal: params.data.differencePersonal,
			malScore: resultInfo.malScore,
			differenceObjective: params.data.differenceObjective,
			description: resultInfo.description,
			notes: params.data.notes,
		}
	} else if (columnParams.listTypeData.name == 'manga') {
		resultInfo = await getMangaInfo(entryInfo.id)
		updateRow = {
			/*id: " ", */ mediaIdentity: mediaIdentityForMal(entryInfo.id, 'manga'),
			watchlistId: params.data.watchlistId,
			position: params.data.position,
			thumbnail: resultInfo.thumbnail,
			title: resultInfo.title,
			type: resultInfo.type,
			startYear: String(resultInfo.startYear),
			releaseStart: new Date(resultInfo.releaseStart),
			releaseEnd: new Date(resultInfo.releaseEnd),
			nextRelease: serializeNextRelease(resultInfo.nextRelease),
			chapters: String(resultInfo.chapters),
			volumes: String(resultInfo.volumes),
			history: params.data.history,
			genres: resultInfo.genres,
			serialization: JSON.stringify(resultInfo.serialization),
			authors: JSON.stringify(resultInfo.authors),
			priority: params.data.priority,
			story: params.data.story,
			character: params.data.character,
			presentation: params.data.presentation,
			enjoyment: params.data.enjoyment,
			averaged: params.data.averaged,
			personal: params.data.personal,
			differencePersonal: params.data.differencePersonal,
			malScore: resultInfo.malScore,
			differenceObjective: params.data.differenceObjective,
			description: resultInfo.description,
			notes: params.data.notes,
		}
	}

	const rowUpdateResponse = await fetch(
		'/lists/fetch/update-row/' +
			encodeURIComponent(
				new URLSearchParams({
					rowIndex: params.data.id,
					row: JSON.stringify(updateRow),
				} as any).toString(),
			),
		{ method: 'POST' },
	)
	await rowUpdateResponse.json()
	//console.log(rowUpdateData)

	await fetch(
		'/lists/fetch/now-updated/' +
			encodeURIComponent(
				new URLSearchParams({
					watchlistId: params.data.watchlistId,
				} as any).toString(),
			),
		{ method: 'POST' },
	)

	if (!bulk) {
		refreshGrid(columnParams)
	}
}
