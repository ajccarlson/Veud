export async function searchTMDB(entry, type, numResults) {
  type = type.toLowerCase().replace(/[^0-9a-z]/gi, '');

  if (type.includes('movie'))
    type = 'movie'
  else if (type.includes('tv'))
    type = 'tv'
  else if (type.includes('person'))
    type = 'person'
  else
    type = 'multi'

  const url = "https://api.themoviedb.org/3/search/" + type + "?query=" + entry + "&include_adult=false&language=en-US&page=1";
  let response, data

  try {
    response = await fetch('/media/fetch-data/' + encodeURIComponent(new URLSearchParams({
      fetchMethod: 'get',
      url: url,
      authorization: 'tmdb',
      fetchBody: undefined,
      sleepTime: 1500,
    })))
    data = await response.json();
    data.map(e => data = e ? {...data, ...e} : data)

    if (!response || !data)
      throw new Error("Error: no data found!");
  }
  catch (e) {
    console.error('Failed to fetch data for ' + entry + '!\n' + e);
    return;
  }

  if (numResults) {
    return data.results.slice(0, numResults);
  }
  else {
    return data.results;
  }
}

export async function formatTMDBResults(entry, type, entryID, dataPass, full = true) {
  try {
    let url, response, data = dataPass

    let infoObject = {};

    let posterFill = data.poster_path;
    if (!posterFill)
      posterFill = data.profile_path;

    const description = data.overview;

    if (type != 'person') {
      let title, year, releaseStart, releaseEnd, length;

      if (type == "tv") {
        title = data.name;

        try {
          releaseStart = new Date(data.first_air_date);
        }
        catch(e) {}
        try {
          releaseEnd = new Date(data.last_air_date);
        }
        catch(e) {}
        year = releaseStart.getFullYear();

        length = (data.number_of_episodes + " eps");
      }
      else {
        title = data.title;

        releaseStart = releaseEnd = new Date(data.release_date);
        year = releaseStart.getFullYear();

        const lengthRaw = data.runtime;
        const hours = Math.floor(lengthRaw / 60);
        const minutes = lengthRaw % 60;

        if (hours == 0) {
          length = minutes + "m";
        }
        else {
          length = hours + "h " + minutes + "m";
        }
      }

      let language, genres, nextRelease = null, rating = "NR"

      const score = data.vote_average;

      if (full) {
        if (data.original_language) {
          const languageNames = new Intl.DisplayNames(['en'], {type: 'language'});
          language = languageNames.of(data.original_language);
        }

        if (data.genres) {
          let genresList = [];
          for (let item of data.genres) {
            genresList.push(item.name);
          }
          genres = genresList.join(", ");
        }

        if (type == "tv") {
          try {
            if (data.next_episode_to_air) {
              nextRelease = {
                id: data.next_episode_to_air.id,
                name: data.next_episode_to_air.name,
                overview: data.next_episode_to_air.overview,
                releaseDate: data.next_episode_to_air.air_date,
                episode: data.next_episode_to_air.episode_number,
                season: data.next_episode_to_air.season_number,
                runtime: data.next_episode_to_air.runtime,
                image: `https://www.themoviedb.org/t/p/original${data.next_episode_to_air.still_path}|https://www.themoviedb.org/${type}/${entryID}/watch`,
              }
            }
          }
          catch(e) {}

          url = "https://api.themoviedb.org/3/" + type + "/" + entryID + "/content_ratings";
  
          try {
            response = await fetch('/media/fetch-data/' + encodeURIComponent(new URLSearchParams({
              fetchMethod: 'get',
              url: url,
              authorization: 'tmdb',
              fetchBody: undefined,
              sleepTime: 1500,
            })))
            data = await response.json();
            data.map(e => data = e ? {...data, ...e} : data)
  
            if (!response || !data)
              throw new Error("Error: no data found!");
          }
          catch (e) {
            console.error('Failed to fetch data for ' + entry + '!\n' + e);
            return;
          }
  
          for (let item of data.results) {
            if (item.iso_3166_1 == "US") {
              rating = item.rating;
            }
          }
        }
        else {
          url = "https://api.themoviedb.org/3/" + type + "/" + entryID + "/release_dates";
          
          try {
            response = await fetch('/media/fetch-data/' + encodeURIComponent(new URLSearchParams({
              fetchMethod: 'get',
              url: url,
              authorization: 'tmdb',
              fetchBody: undefined,
              sleepTime: 1500,
            })))
            data = await response.json();
            data.map(e => data = e ? {...data, ...e} : data)
  
            if (!response || !data)
              throw new Error("Error: no data found!");
          }
          catch (e) {
            console.error('Failed to fetch data for ' + entry + '!\n' + e);
            return;
          }
  
          for (let item of data.results) {
            if (item.iso_3166_1 == "US") {
              rating = item.release_dates.at(-1).certification;
            }
          }
        }
      }

      const typeFormatted = type == "tv" ? "TV Series" : type.charAt(0).toUpperCase() + type.slice(1);

      const thumbnail = ("https://www.themoviedb.org/t/p/w600_and_h900_bestv2" + posterFill + "|" + "https://www.themoviedb.org/" + type + "/" + entryID);

      infoObject = {
        'entryID': data.id,
        'thumbnail': thumbnail,
        'title': title,
        'type': typeFormatted,
        'year': year,
        'releaseStart': releaseStart,
        'releaseEnd': releaseEnd,
        'language': language,
        'description': description,
        'length': length,
        'nextRelease': nextRelease,
        'genres': genres,
        'rating': rating,
        'score': score
      };
    }
    else {
      let gender = data.gender == 1 ? 'female' : 'male';

      const thumbnail = ("https://www.themoviedb.org/t/p/w600_and_h900_bestv2" + posterFill + "|" + "https://www.themoviedb.org/" + type + "/" + entryID);

      infoObject = {
        'entryID': data.id,
        'thumbnail': thumbnail,
        'name': data.name,
        'biography': data.biography,
        'birthday': data.birthday,
        'deathday': data.deathday,
        'gender': gender,
        'place_of_birth': data.place_of_birth
      };
    }

    //console.log(infoObject);
    return infoObject;
  }
  catch(e) {
    console.error(e)
  }
}

export async function getTMDBInfo(entry, type/*, override = false*/) {
  try {
    type = type.toLowerCase().replace(/[^0-9a-z]/gi, '');
    if (type.includes('movie'))
      type = 'movie'
    else if (type.includes('tv'))
      type = 'tv'
    else if (type.includes('person'))
      type = 'person'
    else
      type = 'multi'

    let url, response, data, entryID;

    if (!isNaN(entry))
      entryID = entry;
    else {
      const imdbRegex = /^ev\d{7}\/\d{4}(-\d)?$|^(ch|co|ev|nm|tt)\d*$/;

      if (entry.match(imdbRegex)) {
        url = "https://api.themoviedb.org/3/find/" + entry + "?external_source=imdb_id";

        try {
          response = await fetch('/media/fetch-data/' + encodeURIComponent(new URLSearchParams({
            fetchMethod: 'get',
            url: url,
            authorization: 'tmdb',
            fetchBody: undefined,
            sleepTime: 1500,
          })))
          data = await response.json();
          data.map(e => data = e ? {...data, ...e} : data)

          if (!response || !data)
            throw new Error("Error: no data found!");
        }
        catch (e) {
          console.error('Failed to fetch data for ' + entry + '!\n' + e);
        }
        
        if (type == 'tv')
          entryID = data.tv_results[0].id;
        else if (type == 'person')
          entryID = data.person_results[0].id;
        else
          entryID = data.movie_results[0].id;
      }
      else {
        url = "https://api.themoviedb.org/3/search/" + type + "?query=" + entry + "&include_adult=false&language=en-US&page=1";

        try {
          response = await fetch('/media/fetch-data/' + encodeURIComponent(new URLSearchParams({
            fetchMethod: 'get',
            url: url,
            authorization: 'tmdb',
            fetchBody: undefined,
            sleepTime: 1500,
          })))
          data = await response.json();
          data.map(e => data = e ? {...data, ...e} : data)

          if (!response || !data)
            throw new Error("Error: no data found!");
        }
        catch (e) {
          console.error('Failed to fetch data for ' + entry + '!\n' + e);
          return;
        }

        entryID = data.results[0].id;

        if (type == 'multi')
          type = data.results[0].media_type
      }
    }

    url = "https://api.themoviedb.org/3/" + type + "/" + entryID + "&include_adult=false&language=en-US&page=1";

    try {
      response = await fetch('/media/fetch-data/' + encodeURIComponent(new URLSearchParams({
        fetchMethod: 'get',
        url: url,
        authorization: 'tmdb',
        fetchBody: undefined,
        sleepTime: 1500,
      })))
      data = await response.json();
      data.map(e => data = e ? {...data, ...e} : data)

      if (!response || !data)
        throw new Error("Error: no data found!");
    }
    catch (e) {
      console.error('Failed to fetch data for ' + entry + '!\n' + e);
      return;
    }

    return formatTMDBResults(entry, type, entryID, data, true)
  }
  catch (e) {
    console.error(e)
  }
}

export async function getTMDBTrending(type, numResults) {
  try {
    type = type.toLowerCase().replace(/[^0-9a-z]/gi, '');

    if (type.includes('movie'))
      type = 'movie'
    else if (type.includes('tv'))
      type = 'tv'
    else if (type.includes('person'))
      type = 'person'
    else
      type = 'all'

    const url = "https://api.themoviedb.org/3/trending/" + type + "/day?language=en-US&without_keywords=161919";
    let response, data

    try {
      response = await fetch('/media/fetch-data/' + encodeURIComponent(new URLSearchParams({
        fetchMethod: 'get',
        url: url,
        authorization: 'tmdb',
        fetchBody: undefined,
        sleepTime: 1500,
      })))
      data = await response.json()
      data.map(e => data = e ? {...data, ...e} : data)

      if (!response || !data)
        throw new Error("Error: no data found!");
    }
    catch (e) {
      console.error('Failed to fetch trending ' + type + ' data!\n' + e);
      return;
    }

    let resultArray = []

    for (const [index, result] of data.results.entries()) {
      resultArray.push(await formatTMDBResults(result.id, result.media_type, result.id, result, false))

      if (numResults && (index >= (numResults - 1))) {
        break
      }
    }

    return resultArray
  }
  catch(e) {
    console.error(e)
  }
}

export function getFavoriteInfo(entryPass, typePass) {
  try {
    typePass = typePass.toLowerCase();
    const rowData = getTMDBInfo(entryPass, typePass);
    console.log(rowData)

    if (typePass.includes('person'))
      return [rowData['thumbnail'], rowData['name']];
    else
      return [rowData['thumbnail'], rowData['title']];
  }
  catch (e) {
    throw new Error('Failed to get favorite info!\n' + e);
  }
}

export function getTMDBScores(entryPass, typePass = 'movie', currentScore = null) {
  try {
    const rowData = getTMDBInfo(entryPass, typePass);
    const formattedScore = rowData['score'].toFixed(1);
    return parseFloat(formattedScore);
  }
  catch (e) {
    console.error('Failed to fetch score for ' + entryPass + '!\n' + e);
    return currentScore ? currentScore : "?";
  }
}
