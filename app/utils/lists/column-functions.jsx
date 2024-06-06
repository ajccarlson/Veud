import { MediaSearchBar, MediaTypeDropdown } from '#app/components/search-add-watchlist-entry.jsx'
import { refreshGrid } from '#app/routes/lists+/.$username+/.$list-type+/$watchlist_grid.jsx'
import { searchMAL, getAnimeInfo, getMangaInfo } from "#app/routes/media+/mal.jsx"
import { searchTMDB, getTMDBInfo } from "#app/routes/media+/tmdb.jsx"

export function dateFormatter(params) {
  try {
    if (!params || params == null || params == 0 || params == "1970-01-01T00:00:00.000Z" || params == new Date(0))
      return " "
  
    let date = new Date(params);
  
    let year = new Intl.DateTimeFormat('en', { year: '2-digit' }).format(date);
    let month = new Intl.DateTimeFormat('en', { month: 'numeric' }).format(date);
    let day = new Intl.DateTimeFormat('en', { day: 'numeric' }).format(date);
    return `${month}/${day}/${year}`;
  }
  catch(e) {
    console.error(e)
  }
}

export function mediaProgressParser(params, columnParams, oldValue, newValue) {
  let mediaType

  try {
    const mediaTypeArray = JSON.parse(columnParams.listTypeData.mediaType)
    const mediaTypesFormatted = mediaTypeArray.map(mediaTypeRaw => `${mediaTypeRaw}s`)
    const typeIndex = mediaTypesFormatted.findIndex(e => e === params.column.colId)

    if (!mediaTypesFormatted || mediaTypesFormatted.length < 1) {
      mediaType = "episode"
    }
    else if (typeIndex > 0) {
      mediaType = mediaTypeArray[typeIndex]
    }
    else {
      mediaType = mediaTypeArray[0]
    }

    let mediaTotal
    try {
      mediaTotal = [...oldValue.matchAll(/\d+/g)]
    }
    catch(e) {
      mediaTotal = 0
    }

    if (!oldValue) {
      oldValue = 0
    }
    
    let matchResult, mediaProgress

    if (newValue) {
      if (!isNaN(newValue) && newValue > 0) {
        mediaProgress = newValue
      } 
      else {
        mediaProgress = 0
      }
    }
    else {
      try {
        const historyObject = JSON.parse(params.data.history)
        let lastWatched = {
          entry: 0,
          date: 0
        }

        let progressObject
        if (params.column.colId == "length") {
          progressObject = historyObject.progress
        }
        else {
          progressObject = historyObject.progress[mediaType]
        }
        
        Object.entries(progressObject).forEach(([progressKey, progressValue]) => {
          let currentMax = Math.max(...progressValue.finishDate)
  
          if (currentMax && currentMax > lastWatched.date) {
            lastWatched = {
              entry: Number(progressKey),
              date: currentMax
            }
          }
        })
  
        mediaProgress = lastWatched.entry
      } catch(e) {
        mediaProgress = 0
      }
    }
    
    try {
      matchResult = mediaTotal.slice(-1)[0][0]
    } catch(e) {
      return {
        progress: 0,
        total: oldValue
      }
    }

    if (matchResult) {
      return {
        progress: mediaProgress,
        total: matchResult
      }
    }
  }
  catch(e) {
    console.error(e)
  }
}

export function timeSince(date) {
  const seconds = Math.floor(((new Date()).valueOf() - date.valueOf()) / 1000);
  let interval = seconds / 31536000;
  let flooredInterval = Math.floor(interval)

  function updateInterval(denominator) {
    interval = seconds / denominator;
    flooredInterval = Math.floor(interval)
  }


  if (interval > 1) {
    if (flooredInterval == 1)
      return flooredInterval + " year";
    else
      return flooredInterval + " years";
  }
  
  updateInterval(2592000);

  if (interval > 1) {
    if (flooredInterval == 1)
      return flooredInterval + " month";
    else
      return flooredInterval + " months";
  }

  updateInterval(86400);

  if (interval > 1) {
    if (flooredInterval == 1)
      return flooredInterval + " day";
    else
      return flooredInterval + " days";
  }

  updateInterval(3600);

  if (interval > 1) {
    if (flooredInterval == 1)
      return flooredInterval + " hour";
    else
      return flooredInterval + " hours";
  }

  updateInterval(60);

  if (interval > 1) {
    if (flooredInterval == 1)
      return flooredInterval + " minute";
    else
      return flooredInterval + " minutes";
  }

  if (Math.floor(seconds) == 1)
    return flooredInterval + " second";
  else
    return flooredInterval + " seconds";
}

export function differenceFormatter(params) {
  try {
    if (params > 0) {
      return ('+' + params.toFixed(2))
    }
    else {
      return params.toFixed(2)
    }
  }
  catch(e) {
    return params
  }
}

export function getStartYear(entry, passedType, listTypes) {
  try {
    let typeData = listTypes.find((listType) => listType.id == passedType.id)

    if (Object.keys(JSON.parse(typeData.columns)).includes("airYear")) {
      return entry.airYear
    }
    else if (Object.keys(JSON.parse(typeData.columns)).includes("startSeason")) {
      return entry.startSeason
    }
    else if (Object.keys(JSON.parse(typeData.columns)).includes("startYear")) {
      return entry.startYear
    }
    else {
      return false
    }
  }
  catch(e) {

  }
}

export function getThumbnailInfo(thumbnail) {
  const separatorIndex = thumbnail.indexOf("|")

  return {
    content: thumbnail.slice(0, separatorIndex),
    url: thumbnail.slice(separatorIndex + 1)
  }
}

export function hyperlinkRenderer(params, type = undefined) {
  let content, url, inner

  try {
    const paramsObject = JSON.parse(params)

    let itemCount = 0
    let hyperlinkArray = []

    for (const item of paramsObject) {
      const {content, url} = getThumbnailInfo(item)

      if (itemCount % 2 == 0) {
        inner = <span className='ag-list-odd'>
          {content}
        </span>
      }
      else {
        inner = <span className='ag-list-even'>
          {content}
        </span>
      }

      hyperlinkArray.push(
        <a href={url}>
          {inner}
        </a>
      )
    }

    return hyperlinkArray
  }
  catch(e) {
    if (!params || params.replace(/\W/g, '') == "" && type == "thumbnail") {
      content = "https://placehold.co/300x450?text=?"
      url = "https://www.themoviedb.org/"
    }
    else {
      const separatorIndex = params.indexOf("|")
      content = params.slice(0, separatorIndex)
      url = params.slice(separatorIndex + 1)
    }

    if (type == "thumbnail") {
      inner = <span>
        { (
          <img 
              alt={`Thumbnail`}
              src={content}
              className="ag-thumbnail-image"
          />
        ) }
      </span>
    }
    else {
      inner = <span>
        {content}
      </span>
    }

    return (
      <a href={url}>
        {inner}
      </a>
    )
  }
}

export function getSiteID(url) {
  try {
    const linkSplit = url.split('/').filter(Boolean);

    let linkSite
    if (linkSplit.findIndex(element => element.includes("imdb")) > -1)
      linkSite = 'imdb';
    else if (linkSplit.findIndex(element => element.includes("tmdb")) || linkSplit.findIndex(element => element.includes("themoviedb")) > -1)
      linkSite = 'tmdb';
    else if (linkSplit.findIndex(element => element.includes("myanimelist")) > -1)
      linkSite = 'mal';
    else
      throw new Error

    const id = linkSplit.at(-1);

    return {
      'site': linkSite,
      'id': id
    };
  }
  catch (e) {
    console.error(url)
    throw new Error('Failed to get site ID!\n' + e);
  }
}

export function titleCellRenderer(params, columnParams) {
  if (!params.value || params.value.replace(/\W/g, '') === "" && (columnParams.currentUserId == columnParams.listOwner.id)) {
    return (
      <span className=''>
        <div className="ml-auto hidden max-w-sm flex-1 sm:block">
          <MediaSearchBar params={params} columnParams={columnParams}/>
        </div>
      </span>
    )
  }
  else {
    return params.value
  }
}

export function typeCellRenderer(params, columnParams) { 
  if ((!params.value || params.value.replace(/\W/g, '') === ""  && (columnParams.currentUserId == columnParams.listOwner.id)) && columnParams.listTypeData.id == "yducsgix") {
    return (
      <MediaTypeDropdown columnParams={columnParams}/>
    )
  }
  else {
    return params.value
  }
}

export async function updateRowInfo(params, columnParams, bulk) {
  let entryInfo, rawInfo, resultInfo, updateRow

  try {
    const separatorIndex = params.data.thumbnail.indexOf("|")
    const entryUrl = params.data.thumbnail.slice(separatorIndex + 1)
    
    entryInfo = getSiteID(entryUrl)
  }
  catch(e) {
    if (columnParams.listTypeData.name == "liveaction") {
      rawInfo = await searchTMDB(params.data.title, params.data.type, 5)
      entryInfo = {
        "site": "tmdb",
        'id': rawInfo[0].id
      }
    }
    else if (columnParams.listTypeData.name == "anime") {
      rawInfo = await searchMAL(params.data.title, 'anime', 5)
      entryInfo = {
        "site": "mal",
        'id': rawInfo[0].id
      }
    }
    else if (columnParams.listTypeData.name == "manga") {
      rawInfo = await searchMAL(params.data.title, 'manga', 5)
      entryInfo = {
        "site": "mal",
        'id': rawInfo[0].id
      }
    }
  }

  if (columnParams.listTypeData.name == "liveaction") {
    resultInfo = await getTMDBInfo(entryInfo.id, params.data.type)
    updateRow = {/*id: " ", */watchlistId: params.data.watchlistId, position: params.data.position, thumbnail: resultInfo.thumbnail, title: resultInfo.title, type: resultInfo.type, airYear: String(resultInfo.year), releaseStart: new Date(resultInfo.releaseStart), releaseEnd: new Date(resultInfo.releaseEnd), nextRelease:  JSON.stringify(resultInfo.nextRelease), length: resultInfo.length, rating: resultInfo.rating, history: params.data.history, genres: resultInfo.genres , language: resultInfo.language, story: params.data.story, character: params.data.character, presentation: params.data.presentation, sound: params.data.sound, performance: params.data.performance, enjoyment: params.data.enjoyment, averaged: params.data.averaged, personal: params.data.personal, differencePersonal: params.data.differencePersonal, tmdbScore: resultInfo.score, differenceObjective: params.data.differenceObjective, description: resultInfo.description, notes: params.data.notes}
  }
  else if (columnParams.listTypeData.name == "anime") {
    resultInfo = await getAnimeInfo(entryInfo.id)
    updateRow = {/*id: " ", */watchlistId: params.data.watchlistId, position: params.data.position, thumbnail: resultInfo.thumbnail, title: resultInfo.title, type: resultInfo.type, startSeason: resultInfo.startSeason.name, releaseStart: new Date(resultInfo.releaseStart), releaseEnd: new Date(resultInfo.releaseEnd), nextRelease:  JSON.stringify(resultInfo.nextRelease), length: resultInfo.length, rating: resultInfo.rating, history: params.data.history, genres: resultInfo.genres , studios: JSON.stringify(resultInfo.studios), priority: params.data.priority, story: params.data.story, character: params.data.character, presentation: params.data.presentation, sound: params.data.sound, performance: params.data.performance, enjoyment: params.data.enjoyment, averaged: params.data.averaged, personal: params.data.personal, differencePersonal: params.data.differencePersonal, malScore: resultInfo.malScore, differenceObjective: params.data.differenceObjective, description: resultInfo.description, notes: params.data.notes}
  }
  else if (columnParams.listTypeData.name == "manga") {
    resultInfo = await getMangaInfo(entryInfo.id)
    updateRow = {/*id: " ", */watchlistId: params.data.watchlistId, position: params.data.position, thumbnail: resultInfo.thumbnail, title: resultInfo.title, type: resultInfo.type, startYear: String(resultInfo.startYear), releaseStart: new Date(resultInfo.releaseStart), releaseEnd: new Date(resultInfo.releaseEnd), nextRelease:  JSON.stringify(resultInfo.nextRelease), chapters: String(resultInfo.chapters), volumes: String(resultInfo.volumes), history: params.data.history, genres: resultInfo.genres , serialization: JSON.stringify(resultInfo.serialization), authors: JSON.stringify(resultInfo.authors), priority: params.data.priority, story: params.data.story, character: params.data.character, presentation: params.data.presentation, enjoyment: params.data.enjoyment, averaged: params.data.averaged, personal: params.data.personal, differencePersonal: params.data.differencePersonal, malScore: resultInfo.malScore, differenceObjective: params.data.differenceObjective, description: resultInfo.description, notes: params.data.notes}
  }

  const rowUpdateResponse = await fetch('/lists/fetch/update-row/' + encodeURIComponent(new URLSearchParams({
    listTypeData: JSON.stringify(columnParams.listTypeData),
    rowIndex: params.data.id,
    row: JSON.stringify(updateRow)
  })))
  const rowUpdateData = await rowUpdateResponse.json();
  //console.log(rowUpdateData)

  const updateResponse = await fetch('/lists/fetch/now-updated/' + encodeURIComponent(new URLSearchParams({
    watchlistId: params.data.watchlistId
  })))

  if (!bulk) {
    refreshGrid(columnParams);
  }
}
