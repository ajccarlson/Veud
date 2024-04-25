import { renderBarChart } from '#app/routes/users+/$username_/stats_/bar.jsx'
import { renderBoxPlotChart } from '#app/routes/users+/$username_/stats_/box_plot'
import { renderCalendarChart } from '#app/routes/users+/$username_/stats_/calendar'
import { renderChordChart } from '#app/routes/users+/$username_/stats_/chord.jsx'
import { renderLineChart } from '#app/routes/users+/$username_/stats_/line.jsx'
import { renderPieChart } from '#app/routes/users+/$username_/stats_/pie.jsx'
import { renderRadialBar } from '#app/routes/users+/$username_/stats_/radial_bar.jsx'

export function StatsData(loaderData) {
  function userStats(chartType, params = undefined) {
    if (chartType == "pie") {
      return renderPieChart(loaderData)
    }
    else if (chartType == "score") {
      return renderBarChart(loaderData, "score", params)
    } 
    else if (chartType == "objectiveScores") {
      return renderBoxPlotChart(loaderData, "objective scores", params)
    } 
    else if (chartType == "release") {
      return renderLineChart(loaderData, "release")
    } 
    else if (chartType == "watched") {
      return renderLineChart(loaderData, "watched")
    } 
    else if (chartType == "genres") {
      return renderChordChart(loaderData, params)
    } 
    else if (chartType == "type") {
      return renderRadialBar(loaderData, "type")
    } 
    else if (chartType == "episodeHistory") {
      renderCalendarChart(loaderData, "episode history")
    } 
  }

  return (
    <div className="user-landing-stats-container">
      {userStats("score", "Live Action")}
    </div>
  )
}
