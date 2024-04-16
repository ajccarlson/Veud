export async function searchMAL(entry, type = 'anime', numResults = 5) {
  const url = "https://api.myanimelist.net/v2/" + type + "?q=" + entry + "&limit=" + numResults
  let response, data

  try {
    response = await fetch('../../../media/fetch-data/' + new URLSearchParams({
      fetchMethod: 'get',
      url: url,
      authorization: 'mal',
      fetchBody: undefined,
      sleepTime: 1500,
    }))
    data = await response.json()
    data.map(e => data = e ? {...data, ...e} : data)

    if (!response || !data)
      throw new Error("Error: no data found!")
  }
  catch (e) {
    console.error('Failed to fetch data for ' + entry + '!\n' + e)
    return
  }

  return data.data.map(entry => entry.node).slice(0, numResults)
}

export async function getAnimeInfo(entryID) {
  const url = "https://api.myanimelist.net/v2/anime/" + entryID + "?fields=id,title,main_picture,alternative_titles,start_date,end_date,synopsis,mean,rank,popularity,num_list_users,num_scoring_users,nsfw,created_at,updated_at,media_type,status,genres,my_list_status,num_episodes,start_season,broadcast,source,average_episode_duration,rating,pictures,background,related_anime,related_manga,recommendations,studios,statistics"
  let response, data

  try {
    try {
      response = await fetch('../../../media/fetch-data/' + new URLSearchParams({
        fetchMethod: 'get',
        url: url,
        authorization: 'mal',
        fetchBody: undefined,
        sleepTime: 1500,
      }))
      data = await response.json()
      data.map(e => data = e ? {...data, ...e} : data)
  
      if (!response || !data)
        throw new Error("Error: no data found!")
    }
    catch (e) {
      console.error('Failed to fetch data for ' + entryID + '!\n' + e)
      return
    }

    console.log(data)
    
    let typeFormatted = data['media_type'].replace('_', ' ')
    if (typeFormatted.length <= 3)
      typeFormatted = typeFormatted.toUpperCase()
    else {
      typeFormatted = typeFormatted.toLowerCase()

      if (typeFormatted.includes("tv"))
        typeFormatted = typeFormatted.replace('tv', 'TV')

      typeFormatted = typeFormatted.split(' ')
        .map((s) => s.charAt(0).toUpperCase() + s.substring(1))
        .join(' ')
    }


    const seasonInfo = data['start_season']
    const seasonURL = "https://myanimelist.net/anime/season/" + seasonInfo['year'] + "/" + seasonInfo['season']
    const seasonText = seasonInfo['season'].charAt(0).toUpperCase() + seasonInfo['season'].slice(1) + ' ' + seasonInfo['year']
    const seasonFormatted = {
      url: seasonURL,
      name: seasonText
    }


    let lengthFormatted
    if (data['num_episodes'] == 1) {
      const seconds = data['average_episode_duration']
      const hours = Math.floor(seconds / 3600)
      const minutes = Math.floor((seconds % 3600) / 60)

      if (hours == 0) {
        lengthFormatted = minutes + "m"
      }
      else {
        lengthFormatted = hours + "h " + minutes + "m"
      }
    }
    else {
      if (typeFormatted == "TV")
        typeFormatted = "TV Series"

      lengthFormatted = (data['num_episodes'] + " eps")
    }


    const ratingFormatted = data['rating'].replace('_', '-').toUpperCase()


    let genresList = []
    for (let genre of data['genres'])
      genresList.push(genre['name'])
    const genres = genresList.join(", ")


    let studios = []
    for (let studio of data['studios']) {
      studios.push({
        'url':  "https://myanimelist.net/anime/producer/" + studio['id'],
        'name': studio['name']
      })
    }

    const malInfo = {
      'thumbnail': data['main_picture']['large'] + "|" + "https://myanimelist.net/anime/" + data['id'],
      'title': data['title'],
      'type': typeFormatted,
      'startSeason': seasonFormatted,
      'length': lengthFormatted,
      'rating': ratingFormatted,
      'genres': genres,
      'studios': studios,
      'malScore': data['mean'],
      'description': data['synopsis']
    }

    console.log(malInfo)

    return malInfo
  }
  catch (e) {
    throw new Error('Error: failed to fetch MAL info!\n' + e)
  }
}

export async function getMangaInfo(entryID) {
  const url = "https://api.myanimelist.net/v2/manga/" + entryID + "?fields=id,title,main_picture,alternative_titles,start_date,end_date,synopsis,mean,rank,popularity,num_list_users,num_scoring_users,nsfw,created_at,updated_at,media_type,status,genres,my_list_status,num_volumes,num_chapters,authors{first_name,last_name},pictures,background,related_anime,related_manga,recommendations,serialization{name}"
  let response, data

  try {
    try {
      response = await fetch('../../../media/fetch-data/' + new URLSearchParams({
        fetchMethod: 'get',
        url: url,
        authorization: 'mal',
        fetchBody: undefined,
        sleepTime: 1500,
      }))
      data = await response.json()
      data.map(e => data = e ? {...data, ...e} : data)
  
      if (!response || !data)
        throw new Error("Error: no data found!")
    }
    catch (e) {
      console.error('Failed to fetch data for ' + entryID + '!\n' + e)
      return
    }

    console.log(data)
    
    let typeFormatted = data['media_type'].replace('_', ' ')
    if (typeFormatted.length <= 3)
      typeFormatted = typeFormatted.toUpperCase()
    else {
      typeFormatted = typeFormatted.toLowerCase()

      typeFormatted = typeFormatted.split(' ')
        .map((s) => s.charAt(0).toUpperCase() + s.substring(1))
        .join(' ')
    }


    const startYear = new Date (data['start_date']).getFullYear()
    console.log(data['start_date'])
    console.log(startYear)


    let genresList = []
    for (let genre of data['genres'])
      genresList.push(genre['name'])
    const genres = genresList.join(", ")


    let serialization = []
    for (let magazine of data['serialization'].map(entry => entry.node)) {
      serialization.push({
        'url':  "https://myanimelist.net/anime/magazine/" + magazine['id'],
        'name': magazine['name']
      })
    }

    let authors = []
    for (let author of data['authors']) {
      authors.push({
        'url':  "https://myanimelist.net/anime/magazine/" + author.node['id'],
        'name': author.node['first_name'] + " " + author.node['last_name'],
        'role': author['role']
      })
    }

    const malInfo = {
      'thumbnail': data['main_picture']['large'] + "|" + "https://myanimelist.net/anime/" + data['id'],
      'title': data['title'],
      'type': typeFormatted,
      'startYear': startYear,
      'chapters': data['num_chapters'],
      'volumes': data['num_volumes'],
      'genres': genres,
      'serialization': serialization,
      'authors': authors,
      'malScore': data['mean'],
      'description': data['synopsis']
    }

    console.log(malInfo)

    return malInfo
  }
  catch (e) {
    throw new Error('Error: failed to fetch MAL info!\n' + e)
  }
}
