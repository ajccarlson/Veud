import { fetchData } from "#app/routes/media+/fetch-data.jsx"

export async function searchTMDB(entry, type) {
  type = type.toLowerCase().replace(/[^0-9a-z]/gi, '');

  if (type.includes('tv'))
    type = 'tv'
  else if (type.includes('person'))
    type = 'person'
  else
    type = 'movie'

  const url = "https://api.themoviedb.org/3/search/" + type + "?query=" + encodeURIComponent(entry) + "&include_adult=false&language=en-US&page=1";
  let response, data

  try {
    [response, data] = await fetchData('get', url, 'tmdb', undefined, 1500/*, override*/);
    if (!response || !data)
      throw new Error("Error: no data found!");
  }
  catch (e) {
    console.error('Failed to fetch data for ' + entry + '!\n' + e);
    return;
  }

  return data.results
}

export function getTMDBInfo(entry, type/*, override = false*/) {
  try {
    type = type.toLowerCase().replace(/[^0-9a-z]/gi, '');
    if (type.includes('tv'))
      type = 'tv'
    else if (type.includes('person'))
      type = 'person'
    else
      type = 'movie'

    let url, response, data, entryID;

    if (!isNaN(entry))
      entryID = entry;
    else {
      const imdbRegex = /^ev\d{7}\/\d{4}(-\d)?$|^(ch|co|ev|nm|tt)\d*$/;

      if (entry.match(imdbRegex)) {
        url = "https://api.themoviedb.org/3/find/" + encodeURIComponent(entry) + "?external_source=imdb_id";

        try {
          [response, data] = fetchData('get', url, 'tmdb', undefined, 1500/*, override*/);
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
        url = "https://api.themoviedb.org/3/search/multi?query=" + encodeURIComponent(entry) + "&include_adult=false&language=en-US&page=1";

        try {
          [response, data] = fetchData('get', url, 'tmdb', undefined, 1500/*, override*/);
          if (!response || !data)
            throw new Error("Error: no data found!");
        }
        catch (e) {
          console.error('Failed to fetch data for ' + entry + '!\n' + e);
          return;
        }

        entryID = data.results[0].id;
      }
    }

    url = "https://api.themoviedb.org/3/" + encodeURIComponent(type) + "/" + encodeURIComponent(entryID) + "&include_adult=false&language=en-US&page=1";

    try {
      [response, data] = fetchData('get', url, 'tmdb', undefined, 1500/*, override*/);
      if (!response || !data)
        throw new Error("Error: no data found!");
    }
    catch (e) {
      console.error('Failed to fetch data for ' + entry + '!\n' + e);
      return;
    }

    let infoObject = {};

    let posterFill = data.poster_path;
    if (!posterFill)
      posterFill = data.profile_path;

    const thumbnail = ("=HYPERLINK(\"" + "https://www.themoviedb.org/" + type + "/" + entryID + "\", Image(\"https://www.themoviedb.org/t/p/w600_and_h900_bestv2" + posterFill + "\"))");
    const description = data.overview;

    if (type != 'person') {
      let title, year, length;

      if (type == "tv") {
        title = data.name;
        year = new Date(data.first_air_date).getFullYear();
        length = (data.number_of_episodes + " eps");
      }
      else {
        title = data.title;
        year = new Date(data.release_date).getFullYear();

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

      const languageNames = new Intl.DisplayNames(['en'], {type: 'language'});
      const language = languageNames.of(data.original_language);

      let genresList = [];
      for (let item of data.genres) {
        genresList.push(item.name);
      }
      const genres = genresList.join(", ");

      let rating = "NR";

      const score = data.vote_average;

      if (type == "tv") {
        url = "https://api.themoviedb.org/3/" + encodeURIComponent(type) + "/" + encodeURIComponent(entryID) + "/content_ratings";

        try {
          [response, data] = fetchData('get', url, 'tmdb', undefined, 1500/*, override*/);
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
        url = "https://api.themoviedb.org/3/" + encodeURIComponent(type) + "/" + encodeURIComponent(entryID) + "/release_dates";
        
        try {
          [response, data] = fetchData('get', url, 'tmdb', undefined, 1500/*, override*/);
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

      const typeFormatted = type == "tv" ? "TV Series" : type.charAt(0).toUpperCase() + type.slice(1);

      infoObject = {
        'entryID': data.id,
        'thumbnail': thumbnail,
        'title': title,
        'type': typeFormatted,
        'year': year,
        'language': language,
        'description': description,
        'length': length,
        'genres': genres,
        'rating': rating,
        'score': score
      };
    }
    else {
      let gender = data.gender == 1 ? 'female' : 'male';

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

    console.log(infoObject);
    return infoObject;
  }
  catch (e) {
    console.error(e)
  }
}

// export function monitorNewTitles() {
//   try {
//     const ss = SpreadsheetApp.getActiveSpreadsheet();
//     const sheetName = SpreadsheetApp.getActiveSheet().getName();
//     const sheets = ['Plan to Watch (Movies)', 'Plan to Watch (Foreign Movies)', 'Plan to Watch (TV)'];

//     if (sheets.includes(sheetName)) {
//       const sheet = ss.getSheetByName(sheetName);
//       const editedCell = sheet.getActiveCell();
//       const editedRow = editedCell.getRow();
//       const rowRange = sheet.getRange(editedRow, 1, 1, 10);

//       console.log('editedRow: ' + editedRow);
//       console.log('column: ' + editedCell.getColumn());

//       if (editedCell.getColumn() == 3 && !sheet.getRange('A' + editedRow).getValue()) {
//         const entryPass = sheet.getRange('C' + editedRow).getValue();
//         let typePass;

//         console.log(entryPass);

//         if (sheetName == 'Plan to Watch (TV)')
//           typePass = 'tv';
//         else
//           typePass = 'movie';

//         console.log(typePass);
        
//         const rowData = getTMDBInfo(entryPass, typePass, true);

//         const rowFormat = [["=ROW()-1", rowData['thumbnail'], rowData['title'], rowData['type'], rowData['year'], rowData['length'], rowData['rating'], rowData['genres'], rowData['language'], rowData['description']]];

//         try {
//           rowRange.setValues(rowFormat);
//         }
//         catch(e) {
//           console.log(e)
//         }
//       }
//     }
//   }
//   catch (e) {
//     console.error('Failed to monitor new titles!\n' + e);
//   }
// }

export function getFavoriteInfo(entryPass, typePass) {
  try {
    typePass = typePass.toLowerCase();
    const rowData = getTMDBInfo(entryPass, typePass, true);
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
    const rowData = getTMDBInfo(entryPass, typePass, false);
    const formattedScore = rowData['score'].toFixed(1);
    return parseFloat(formattedScore);
  }
  catch (e) {
    console.error('Failed to fetch score for ' + entryPass + '!\n' + e);
    return currentScore ? currentScore : "?";
  }
}
