import { renderBarChart } from '#app/routes/users+/$username_/stats_/bar.jsx'
import { renderChordChart } from '#app/routes/users+/$username_/stats_/chord.jsx'
import { renderLineChart } from '#app/routes/users+/$username_/stats_/line.jsx'
import { renderPieChart } from '#app/routes/users+/$username_/stats_/pie.jsx'
import { renderRadialBar } from '#app/routes/users+/$username_/stats_/radial_bar.jsx'

export function StatsData(loaderData) {
  return (
    <div className="user-landing-stats-container">
      {renderBarChart(loaderData, "score")}
    </div>
  )
}
