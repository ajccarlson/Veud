import { MediaSearchBar, MediaTypeDropdown } from '#app/components/search-add-watchlist-entry.jsx'

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

export function episodeProgressParser(params, oldValue, newValue) {
  try {
    const epsTotal =  [...oldValue.matchAll(/\d+/g)]
    let matchResult, epsProgress

    if (newValue) {
      if (!isNaN(newValue) && newValue > 0) {
        epsProgress = newValue
      } 
      else {
        epsProgress = 0
      }
    }
    else {
      try {
        const historyObject = JSON.parse(params.data.history)
        let lastWatched = {
          episode: 0,
          date: 0
        }
        
        Object.entries(historyObject.progress).forEach(([progressKey, progressValue]) => {
          let currentMax = Math.max(...progressValue.watchDate)
  
          if (currentMax && currentMax > lastWatched.date) {
            lastWatched = {
              episode: Number(progressKey),
              date: currentMax
            }
          }
        })
  
        epsProgress = lastWatched.episode
      } catch(e) {
        epsProgress = 0
      }
    }
    
    try {
      matchResult = epsTotal.slice(-1)[0][0]
    } catch(e) {
      return oldValue
    }

    if (matchResult) {
      return (`${epsProgress} / ${matchResult} eps`)
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

export function hyperlinkRenderer(params, type = undefined) {
  let content, url, inner

  try {
    const paramsObject = JSON.parse(params)

    let itemCount = 0
    let hyperlinkArray = []

    for (const item of paramsObject) {
      const separatorIndex = item.indexOf("|")
      content = item.slice(0, separatorIndex)
      url = item.slice(separatorIndex + 1)

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

export function titleCellRenderer(params, columnParams) {
  if (!params.value || params.value.replace(/\W/g, '') === "") {
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

export function TypeCellRenderer(params, columnParams) { 
  if (!params || params.replace(/\W/g, '') === "") {
    return (
      <MediaTypeDropdown/>
    )
  }
  else {
    return params
  }
}
