const tmdbAPIKey=process.env.tmdbAPIKey
const traktAPIKey=process.env.traktAPIKey
const traktAccessTokenMain=process.env.traktAccessTokenMain
const traktAccessTokenBackup=process.env.traktAccessTokenBackup
const MALClientID=process.env.MALClientID
const MALUser=process.env.MALUser

export async function fetchData(fetchMethod, url, authorization, fetchBody, sleepTime = 1500/*, override = false*/) {
  console.log("0.1")
  try {
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    // if (!checkTime() && !override && !Boolean(getVariable('devMode')))
    //   throw new Error("Error: fetch called outside of working time range (>= 12 && <= 24)");

    let fetchHeaders = {'Content-Type': 'application/json'};
    let fetchAuthorization;
    
    if (authorization.toLowerCase().includes('mal')) {
      fetchAuthorization = MALClientID;

      fetchHeaders["X-MAL-CLIENT-ID"] = fetchAuthorization;
    }
    else {
      if (authorization.toLowerCase().includes('trakt')) {
        if (authorization.toLowerCase().includes('main'))
          fetchAuthorization = traktAccessTokenMain;
        else if (authorization.toLowerCase().includes('backup'))
          fetchAuthorization = traktAccessTokenBackup;

        fetchHeaders['trakt-api-version'] = '2'
        fetchHeaders['trakt-api-key'] = traktAPIKey;
      }
      else if (authorization.toLowerCase().includes('tmdb'))
        fetchAuthorization = tmdbAPIKey;
      // else if (authorization.toLowerCase().includes('google')) {
      //   fetchHeaders = {};
      //   fetchAuthorization = ScriptApp.getOAuthToken();
      // }

      fetchHeaders['Authorization'] = ('Bearer ' + fetchAuthorization);
    }

    let options = {
      "method" : fetchMethod,
      "headers": fetchHeaders
    };

    //console.log(options);

    if (fetchBody)
      options['payload'] = JSON.stringify(fetchBody);

    let response, data;
    try {
      response = await fetch(url, options)
      data = await response.json();
    }
    catch(e) {
      throw new Error(e);
    }

    //console.log(data);

    await sleep(sleepTime);

    console.log("HERE")

    return [response, data];
  }
  catch (e) {
    // if (String(e).includes('too many times'))
    //   setVariable('fetchAvailable', false);

    // Utilities.sleep(sleepTime);
    throw new Error('Failed to fetch data!\n' + e);
  }
}

// function fetchTest() {
//   try {
//     const url = "https://api.themoviedb.org/3/discover/movie?include_adult=false&include_video=false&language=en-US&page=1&sort_by=popularity.desc";
//     const [response, data] = fetchData('get', url, 'tmdb', undefined, 0, true);
//     if (!response || !data) {
//       console.error("Error: no data found!");
//       return false;
//     }
//     else {
//       setVariable('fetchAvailable', true);
//       return true;
//     }
//   }
//   catch (e) {
//     setVariable('fetchAvailable', false);
//     console.error('UrlFetchApp is not working!\n' + e);
//     return false;
//   }
// }
