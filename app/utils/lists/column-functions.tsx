export function dateFormatter(params: any) {
  let date = new Date(params);
  let year = new Intl.DateTimeFormat('en', { year: '2-digit' }).format(date);
  let month = new Intl.DateTimeFormat('en', { month: 'numeric' }).format(date);
  let day = new Intl.DateTimeFormat('en', { day: 'numeric' }).format(date);
  return `${month}/${day}/${year}`;
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
  let separatorIndex = params.indexOf("|");

  let image = params.slice(0, separatorIndex);
  let url = params.slice(separatorIndex + 1);

  return (
    <a href={url}>
      <span>
          { (
            <img
                alt={`Thumbnail`}
                src={image}
            />
          ) }
      </span>
    </a>
  )
}

