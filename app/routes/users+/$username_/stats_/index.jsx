import { renderChordChart } from '#app/routes/users+/$username_/stats_/chord.jsx'
import { renderLineChart } from '#app/routes/users+/$username_/stats_/line.jsx'
import { renderPieChart } from '#app/routes/users+/$username_/stats_/pie.jsx'

export function StatsData(loaderData) {
  return (
    <div className="user-landing-stats-container">
      {renderPieChart(loaderData)}
      {renderLineChart(loaderData, "release")}
      {renderLineChart(loaderData, "watched")}
      {renderChordChart(loaderData)}
    </div>
  )
}
