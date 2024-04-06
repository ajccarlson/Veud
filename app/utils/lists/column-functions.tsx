import { MediaSearchBar, MediaTypeDropdown } from '#app/components/search-add-watchlist-entry.jsx'

export function dateFormatter(params: any) {
  if (!params || params == null || params == 0 || params == "1970-01-01T00:00:00.000Z")
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
    if (params > 0) {
      return ('+' + params.toFixed(2))
    }
    else {
      return params.toFixed(2)
    }
}

export function listThumbnailRenderer(params: any) {
  let image, url

  if (!params) {
    image = "https://placehold.co/300x450?text=?"
    url = "https://www.themoviedb.org/"
  }
  else {
    let separatorIndex = params.indexOf("|");

    image = params.slice(0, separatorIndex);
    url = params.slice(separatorIndex + 1);
  }

  return (
    <a href={url}>
      <span>
          { (
            <img 
                alt={`Thumbnail`}
                src={image}
                className="ag-thumbnail-image"
            />
          ) }
      </span>
    </a>
  )
}

export function titleCellRenderer(params: any) {
  if (!params || params.replace(/\W/g, '') === "") {
    return (
      <span className=''>
        <div className="ml-auto hidden max-w-sm flex-1 sm:block">
          <MediaSearchBar status="idle" />
        </div>
      </span>
    )
  }
  else {
    return params
  }
}

export function TypeCellRenderer(params: any) { 
  

  if (!params || params.replace(/\W/g, '') === "") {
    return (
      <MediaTypeDropdown/>
    )
  }
  else {
    return params
  }
}
