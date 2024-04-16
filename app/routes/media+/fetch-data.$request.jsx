export async function loader(params) {
  try {
    const tmdbAPIKey = process.env.tmdbAPIKey
    const traktAPIKey = process.env.traktAPIKey
    const traktAccessTokenMain = process.env.traktAccessTokenMain
    const traktAccessTokenBackup = process.env.traktAccessTokenBackup
    const MALClientID = process.env.MALClientID

    const searchParams = new URLSearchParams(params.params.request)
    const fetchMethod = searchParams.get('fetchMethod')
    const url = searchParams.get('url')
    const authorization = searchParams.get('authorization')
    const fetchBody = searchParams.get('fetchBody')
    let sleepTime = searchParams.get('sleepTime')

    if (!sleepTime) {
      sleepTime = 1500
    }
  
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

    return [response, data];
  }
  catch (e) {
    // if (String(e).includes('too many times'))
    //   setVariable('fetchAvailable', false);

    // Utilities.sleep(sleepTime);
    throw new Error('Failed to fetch data!\n' + e);
  }
}