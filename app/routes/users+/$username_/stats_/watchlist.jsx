export function watchlistStats(loaderData, listType) {
  let scoredEntries = 0
  let listSum = 0

  loaderData.typedEntries[listType.id].forEach(typedEntry => {
    if (typedEntry.personal && typedEntry.personal > 0) {
      scoredEntries++
    }

    listSum += Number(typedEntry.personal)
  })

  let listAverage = listSum / scoredEntries
  if (isNaN(listAverage)) {
    listAverage = 0
  }

  return (
    <div class="user-landing-stats-chart-container user-landing-watchlist-chart">
      {`Average: ${listAverage}`}
    </div>
  )
}