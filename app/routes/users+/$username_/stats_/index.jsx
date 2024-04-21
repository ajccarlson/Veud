import { MyResponsivePie } from '#app/routes/users+/$username_/stats_/pie.jsx'

export function StatsData(loaderData) {
  let pieData = [], fill = []
  const fillTypes = ["none", "lines", "dots"]
  let fillIndex = 0

  Object.entries(loaderData.typedEntries).map(([key, value]) => {
    pieData.push({
        id: key,
        label: key,
        value: Object.entries(value).length
    })

    fill.push({
        match: {
        id: key
        },
        id: fillTypes[fillIndex]
    })

    fillIndex = (fillIndex + 1) % (fillTypes.length);
  })

  return (
    <div className="user-landing-stats-container">
      {MyResponsivePie(pieData, fill)}
    </div>
  )
}
