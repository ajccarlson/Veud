export function watchlistStats(loaderData, listType) {
  let scoredEntries = 0
  let listSum = 0

  let typedLists = {}

  loaderData.typedEntries[listType.id].forEach(typedEntry => {
    if (!typedLists[typedEntry.watchlistId] && typedLists[typedEntry.watchlistId] != 0) {
      typedLists[typedEntry.watchlistId] = 1
    }
    else {
      typedLists[typedEntry.watchlistId]++
    }

    if (typedEntry.personal && typedEntry.personal > 0) {
      scoredEntries++
    }

    listSum += Number(typedEntry.personal)
  })

  let listAverage = listSum / scoredEntries
  if (isNaN(listAverage)) {
    listAverage = "N/A"
  }

  return (
    <div class="user-landing-stats-chart-container user-landing-watchlist-chart">
      {`Average: ${listAverage}`}
      <div>
        {Object.entries(typedLists).map(([listKey, listValue]) => {
          return (
            <div>
              <span>{loaderData.watchLists.find(watchList => watchList.id == listKey).header}</span>
              <span>{listValue}</span>
            </div>
          )
        })}
      </div>
      <span>{`Total Entries: ${loaderData.typedEntries[listType.id].length}`}</span>
    </div>
  )
}