export async function loader(params) {
  try {
    const TMDB_API_KEY = process.env.TMDB_API_KEY

    const TRAKT_API_KEY = process.env.TRAKT_API_KEY
    // const TRAKT_CLIENT_SECRET = process.env.TRAKT_CLIENT_SECRET
    const TRAKT_ACCESS_TOKEN_MAIN = process.env.TRAKT_ACCESS_TOKEN_MAIN
    const TRAKT_ACCESS_TOKEN_BACKUP = process.env.TRAKT_ACCESS_TOKEN_BACKUP

    const MAL_CLIENT_ID = process.env.MAL_CLIENT_ID
    // const MAL_CLIENT_SECRET = process.env.MAL_CLIENT_SECRET

    // const ANILIST_CLIENT_ID = process.env.ANILIST_CLIENT_ID
    // const ANILIST_CLIENT_SECRET = process.env.ANILIST_CLIENT_SECRET

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

    let fetchHeaders = {'Content-Type': 'application/json'};
    let fetchAuthorization;
    
    if (authorization.toLowerCase().includes('mal')) {
      fetchAuthorization = MAL_CLIENT_ID;

      fetchHeaders["X-MAL-CLIENT-ID"] = fetchAuthorization;
    }
    else if (!authorization.toLowerCase().includes('anilist')) {
      if (authorization.toLowerCase().includes('trakt')) {
        if (authorization.toLowerCase().includes('main'))
          fetchAuthorization = TRAKT_ACCESS_TOKEN_MAIN;
        else if (authorization.toLowerCase().includes('backup'))
          fetchAuthorization = TRAKT_ACCESS_TOKEN_BACKUP;

        fetchHeaders['trakt-api-version'] = '2'
        fetchHeaders['trakt-api-key'] = TRAKT_API_KEY;
      }
      else if (authorization.toLowerCase().includes('tmdb'))
        fetchAuthorization = TMDB_API_KEY;

      fetchHeaders['Authorization'] = ('Bearer ' + fetchAuthorization);
    }

    let options = {
      "method" : fetchMethod,
      "headers": fetchHeaders
    };

    if (fetchBody && fetchBody != "undefined")
      options['body'] = fetchBody;

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
    throw new Error('Failed to fetch data!\n' + e);
  }
}