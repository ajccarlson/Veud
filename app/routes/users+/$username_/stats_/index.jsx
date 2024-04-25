import { useState, useEffect } from 'react'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuPortal,
	DropdownMenuTrigger,
} from '#app/components/ui/dropdown-menu.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { renderBarChart } from '#app/routes/users+/$username_/stats_/bar.jsx'
import { renderBoxPlotChart } from '#app/routes/users+/$username_/stats_/box_plot'
import { renderCalendarChart } from '#app/routes/users+/$username_/stats_/calendar'
import { renderChordChart } from '#app/routes/users+/$username_/stats_/chord.jsx'
import { renderLineChart } from '#app/routes/users+/$username_/stats_/line.jsx'
import { renderPieChart } from '#app/routes/users+/$username_/stats_/pie.jsx'
import { renderRadialBar } from '#app/routes/users+/$username_/stats_/radial_bar.jsx'

export function StatsData(loaderData) {
  const listHeaders = loaderData.listTypes.map(listType => listType.header)

  const [chartIndex, setChartIndex] = useState(0);
  const [headerIndex, setHeaderIndex] = useState(0);
  const [selectedHeader, setSelectedHeader] = useState(listHeaders[headerIndex]);

  useEffect(() => {
  	setSelectedHeader(listHeaders[headerIndex])
  }, [headerIndex, listHeaders]);

  const userStats = {
    listTypeDistribution: {
      header: "List Type Distribution",
      chart: renderPieChart(loaderData),
      typed: false
    },
    score: {
      header: "Score Distribution",
      chart: renderBarChart(loaderData, "score", selectedHeader),
      typed: true
    },
    objectiveScores: {
      header: "Public Score Deviation",
      chart: renderBoxPlotChart(loaderData, "objective scores", selectedHeader),
      typed: true
    },
    release: {
      header: "Release Date Distribution",
      chart: renderLineChart(loaderData, "release"),
      typed: false
    },
    watched: {
      header: "Watch Date Distribution",
      chart: renderLineChart(loaderData, "watched"),
      typed: false
    },
    genreChords: {
      header: "Genre Overlap",
      chart: renderChordChart(loaderData, selectedHeader),
      typed: true
    },
    type: {
      header: "Media Type Distribution",
      chart: renderRadialBar(loaderData, "type"),
      typed: false
    },
    /*episodeHistory: {
      header: "Watch History",
      chart: renderCalendarChart(loaderData, "episode history"),
      typed: false
    },*/
  }
  
  const userStatsKeys = Object.keys(userStats)
  const [selectedChart, setSelectedChart] = useState(userStatsKeys[chartIndex]);

  useEffect(() => {
  	setSelectedChart(userStatsKeys[chartIndex])
  }, [chartIndex, userStats, userStatsKeys]);

  return (
    <div className="user-landing-stats-container">
      <h1 className="user-landing-body-header">Stats</h1>
      {userStats[selectedChart].chart}
      <div className="user-landing-selection-nav-container">
        <button onClick={() => {setChartIndex(chartIndex == 0 ? userStatsKeys.length - 1 : chartIndex - 1)}}>
          <Icon name="triangle-left" className="user-landing-nav-arrow"></Icon>
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <div className="user-landing-dropdown-trigger"> 
              {userStats[selectedChart].header}
            </div>
          </DropdownMenuTrigger>
          <DropdownMenuPortal className="user-landing-dropdown-portal">
            <DropdownMenuContent sideOffset={8} align="start" className="user-landing-dropdown-item-container">
              {Object.entries(userStats).filter(function([eKey, eValue]) { return eValue.header !== userStats[selectedChart].header }).map(([statKey, statValue]) =>
                <DropdownMenuItem className="user-landing-dropdown-item" onClick={() =>
                  {
                    setChartIndex(userStatsKeys.indexOf(statKey))
                  }}>
                  {statValue.header}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenuPortal>
        </DropdownMenu>
        <button onClick={() => {setChartIndex((chartIndex + 1) % (userStatsKeys.length))}}>
          <Icon name="triangle-right" className="user-landing-nav-arrow"></Icon>
        </button>
      </div>
      {userStats[selectedChart].typed ?
        <div className="user-landing-selection-nav-container">
          <button onClick={() => {setHeaderIndex(headerIndex == 0 ? listHeaders.length - 1 : headerIndex - 1)}}>
            <Icon name="triangle-left" className="user-landing-nav-arrow"></Icon>
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <div className="user-landing-dropdown-trigger"> 
                {selectedHeader}
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuPortal className="user-landing-dropdown-portal">
              <DropdownMenuContent sideOffset={8} align="start" className="user-landing-dropdown-item-container">
                {listHeaders.filter(function(e) { return e !== selectedHeader }).map(listType =>
                  <DropdownMenuItem className="user-landing-dropdown-item" onClick={() =>
                    {
                      setHeaderIndex(listHeaders.indexOf(listType))
                    }}>
                    {listType}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenuPortal>
          </DropdownMenu>
          <button onClick={() => {setHeaderIndex((headerIndex + 1) % (listHeaders.length))}}>
            <Icon name="triangle-right" className="user-landing-nav-arrow"></Icon>
          </button>
        </div>
      : null }
    </div>
  )
}
