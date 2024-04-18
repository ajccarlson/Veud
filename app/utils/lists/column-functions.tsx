import { MediaSearchBar, MediaTypeDropdown } from '#app/components/search-add-watchlist-entry.jsx'

export function dateFormatter(params: any) {
  if (!params || params == null || params == 0 || params == "1970-01-01T00:00:00.000Z" || params == new Date(0))
    return " "

  let date = new Date(params);

  let year = new Intl.DateTimeFormat('en', { year: '2-digit' }).format(date);
  let month = new Intl.DateTimeFormat('en', { month: 'numeric' }).format(date);
  let day = new Intl.DateTimeFormat('en', { day: 'numeric' }).format(date);
  return `${month}/${day}/${year}`;
}

export function timeSince(date: Date) {
  var seconds = Math.floor(((new Date()).valueOf() - date.valueOf()) / 1000);

  var interval = seconds / 31536000;

  if (interval > 1) {
    return Math.floor(interval) + " years";
  }
  interval = seconds / 2592000;
  if (interval > 1) {
    return Math.floor(interval) + " months";
  }
  interval = seconds / 86400;
  if (interval > 1) {
    return Math.floor(interval) + " days";
  }
  interval = seconds / 3600;
  if (interval > 1) {
    return Math.floor(interval) + " hours";
  }
  interval = seconds / 60;
  if (interval > 1) {
    return Math.floor(interval) + " minutes";
  }
  return Math.floor(seconds) + " seconds";
}

export function differenceFormatter(params: any) {
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

export function hyperlinkRenderer(params: any, type: any = undefined) {
  let content, url, inner

  try {
    const paramsObject: any = JSON.parse(params)

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

export function titleCellRenderer(params: any, columnParams: any) {
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

export function TypeCellRenderer(params: any, columnParams: any) { 
  if (!params || params.replace(/\W/g, '') === "") {
    return (
      <MediaTypeDropdown/>
    )
  }
  else {
    return params
  }
}
