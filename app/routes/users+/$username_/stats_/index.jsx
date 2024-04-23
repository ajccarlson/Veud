import { renderBarChart } from '#app/routes/users+/$username_/stats_/bar.jsx'
import { renderBoxPlotChart } from '#app/routes/users+/$username_/stats_/box_plot'
import { renderCalendarChart } from '#app/routes/users+/$username_/stats_/calendar'
import { renderChordChart } from '#app/routes/users+/$username_/stats_/chord.jsx'
import { renderLineChart } from '#app/routes/users+/$username_/stats_/line.jsx'
import { renderPieChart } from '#app/routes/users+/$username_/stats_/pie.jsx'
import { renderRadialBar } from '#app/routes/users+/$username_/stats_/radial_bar.jsx'

export function StatsData(loaderData) {
  return (
    <div className="user-landing-stats-container">
      {/* {renderPieChart(loaderData)}
      {renderBarChart(loaderData, "score")}
      {renderBoxPlotChart(loaderData, "objective scores")}
      {renderLineChart(loaderData, "release")}
      {renderLineChart(loaderData, "watched")}
      {renderChordChart(loaderData)}
      {renderRadialBar(loaderData, "type")}
      {renderCalendarChart(loaderData, "episode history")} */}
    </div>
  )
}
