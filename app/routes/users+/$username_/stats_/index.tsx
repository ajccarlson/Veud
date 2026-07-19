<<<<<<< HEAD
import { useState, useEffect, useMemo } from 'react'
import { Spacer } from '#app/components/spacer.tsx'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuPortal,
	DropdownMenuTrigger,
} from '#app/components/ui/dropdown-menu.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { renderBarChart } from '#app/routes/users+/$username_/stats_/bar.tsx'
import { renderBoxPlotChart } from '#app/routes/users+/$username_/stats_/box_plot.tsx'
import { renderChordChart } from '#app/routes/users+/$username_/stats_/chord.tsx'
import { renderLineChart } from '#app/routes/users+/$username_/stats_/line.tsx'
import { renderPieChart } from '#app/routes/users+/$username_/stats_/pie.tsx'
import { renderRadialBar } from '#app/routes/users+/$username_/stats_/radial_bar.tsx'
import { watchlistOverview} from '#app/routes/users+/$username_/stats_/watchlist.tsx'

export function StatsData(loaderData: any) {
  const [chartIndex, setChartIndex] = useState(0);
  const [typeIndex, setTypeIndex] = useState(0);
  const [selectedType, setSelectedType] = useState(loaderData.listTypes[typeIndex]);

  useEffect(() => {
  	setSelectedType(loaderData.listTypes[typeIndex])
  }, [typeIndex, loaderData.listTypes]);

  const userStats: Record<string, any> = useMemo(() => {
    return {
      watchlist: {
        header: "Watchlist Overview",
        chart: watchlistOverview(loaderData, selectedType),
        typed: true
      },
      listTypeDistribution: {
        header: "List Type Distribution",
        chart: renderPieChart(loaderData),
        typed: false
      },
      score: {
        header: "Score Distribution",
        chart: renderBarChart(loaderData, "score", selectedType),
        typed: true
      },
      objectiveScores: {
        header: "Public Score Deviation",
        chart: renderBoxPlotChart(loaderData, "objective scores", selectedType),
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
        chart: renderChordChart(loaderData, selectedType),
        typed: true
      },
      type: {
        header: "Media Type Distribution",
        chart: renderRadialBar(loaderData, "type"),
        typed: false
      },
    }
  }, [loaderData, selectedType])
  
  const userStatsKeys = Object.keys(userStats)
  const [selectedChart, setSelectedChart] = useState(userStatsKeys[chartIndex]);

  useEffect(() => {
  	setSelectedChart(userStatsKeys[chartIndex])
  }, [chartIndex, userStats, userStatsKeys]);

  return (
    <div className="user-landing-stats-container">
      <h1 className="user-landing-body-header">Stats</h1>
      {userStats[selectedChart].chart}
      {loaderData.typedEntries && Object.entries(loaderData.typedEntries).length > 0 ?
        <div className="user-landing-selection-nav-items">
          <div className="user-landing-selection-nav-container">
            <button onClick={() => {setChartIndex(chartIndex == 0 ? userStatsKeys.length - 1 : chartIndex - 1)}}>
              <Icon name="triangle-left" className="user-landing-nav-arrow user-landing-left-arrow"></Icon>
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <div className="user-landing-dropdown-trigger"> 
                  {userStats[selectedChart].header}
                </div>
              </DropdownMenuTrigger>
              <DropdownMenuPortal>
                <DropdownMenuContent sideOffset={8} align="start" className="user-landing-dropdown-item-container">
                  {Object.entries(userStats).filter(function([eKey, eValue]: [string, any]) { return eValue.header !== userStats[selectedChart].header }).map(([statKey, statValue]: [string, any]) =>
                    <DropdownMenuItem className="user-landing-dropdown-item" key={statKey} onClick={() =>
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
              <Icon name="triangle-right" className="user-landing-nav-arrow user-landing-right-arrow"></Icon>
            </button>
          </div>
          {userStats[selectedChart].typed ?
            <div className="user-landing-selection-secondary-nav-container">
              <Spacer size="4xs"/>
              <div className="user-landing-selection-nav-container">
                <button onClick={() => {setTypeIndex(typeIndex == 0 ? loaderData.listTypes.length - 1 : typeIndex - 1)}}>
                  <Icon name="triangle-left" className="user-landing-nav-arrow user-landing-secondary-left-arrow"></Icon>
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <div className="user-landing-secondary-dropdown-trigger"> 
                      {selectedType.header}
                    </div>
                  </DropdownMenuTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuContent sideOffset={8} align="start" className="user-landing-dropdown-item-container">
                      {loaderData.listTypes.filter(function(e: any) { return e.id !== selectedType.id }).map((listType: any) =>
                        <DropdownMenuItem className="user-landing-dropdown-item" key={listType.id} onClick={() =>
                          {
                            setTypeIndex(loaderData.listTypes.findIndex((type: any) => type.id == listType.id))
                          }}>
                          {listType.header}
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenuPortal>
                </DropdownMenu>
                <button onClick={() => {setTypeIndex((typeIndex + 1) % (loaderData.listTypes.length))}}>
                  <Icon name="triangle-right" className="user-landing-nav-arrow user-landing-secondary-right-arrow"></Icon>
                </button>
              </div>
            </div>
          :
            null
          }
        </div>
      :
        <div className="user-landing-dropdown-trigger"> 
          {userStats[selectedChart].header}
        </div>
      }
    </div>
  )
}
=======
import { useState, useEffect, useMemo } from 'react'
import { Spacer } from '#app/components/spacer.tsx'
import { TypeSwitcher } from '#app/components/type-switcher.tsx'
import { renderBarChart } from '#app/routes/users+/$username_/stats_/bar.tsx'
import { renderBoxPlotChart } from '#app/routes/users+/$username_/stats_/box_plot.tsx'
import { renderChordChart } from '#app/routes/users+/$username_/stats_/chord.tsx'
import { renderLineChart } from '#app/routes/users+/$username_/stats_/line.tsx'
import { renderPieChart } from '#app/routes/users+/$username_/stats_/pie.tsx'
import { renderRadialBar } from '#app/routes/users+/$username_/stats_/radial_bar.tsx'
import { watchlistOverview } from '#app/routes/users+/$username_/stats_/watchlist.tsx'
import { type ProfileData } from '#app/utils/profile.ts'

export function StatsData({ data: loaderData }: { data: ProfileData }) {
  const [chartIndex, setChartIndex] = useState(0);
  const [typeIndex, setTypeIndex] = useState(0);
  const [selectedType, setSelectedType] = useState(loaderData.listTypes[typeIndex]);

  useEffect(() => {
  	setSelectedType(loaderData.listTypes[typeIndex])
  }, [typeIndex, loaderData.listTypes]);

  const userStats: Record<string, any> = useMemo(() => {
    return {
      watchlist: {
        header: "Watchlist Overview",
        chart: watchlistOverview(loaderData, selectedType),
        typed: true
      },
      listTypeDistribution: {
        header: "List Type Distribution",
        chart: renderPieChart(loaderData),
        typed: false
      },
      score: {
        header: "Score Distribution",
        chart: renderBarChart(loaderData, "score", selectedType),
        typed: true
      },
      objectiveScores: {
        header: "Public Score Deviation",
        chart: renderBoxPlotChart(loaderData, "objective scores", selectedType),
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
        chart: renderChordChart(loaderData, selectedType),
        typed: true
      },
      type: {
        header: "Media Type Distribution",
        chart: renderRadialBar(loaderData, "type"),
        typed: false
      },
    }
  }, [loaderData, selectedType])

  const userStatsKeys = Object.keys(userStats)
  const [selectedChart, setSelectedChart] = useState(userStatsKeys[chartIndex]);

  useEffect(() => {
  	setSelectedChart(userStatsKeys[chartIndex])
  }, [chartIndex, userStats, userStatsKeys]);

  return (
    <div className="user-landing-stats-container">
      <h1 className="user-landing-body-header">Stats</h1>
      {userStats[selectedChart].chart}
      {loaderData.typedEntries && Object.entries(loaderData.typedEntries).length > 0 ?
        <div className="user-landing-selection-nav-items">
          <TypeSwitcher
            variant="primary"
            options={userStatsKeys.map(key => ({ key, label: userStats[key].header }))}
            index={chartIndex}
            onIndexChange={setChartIndex}
          />
          {userStats[selectedChart].typed ?
            <div className="user-landing-selection-secondary-nav-container">
              <Spacer size="4xs"/>
              <TypeSwitcher
                variant="secondary"
                options={loaderData.listTypes.map(listType => ({ key: listType.id, label: listType.header }))}
                index={typeIndex}
                onIndexChange={setTypeIndex}
              />
            </div>
          :
            null
          }
        </div>
      :
        <div className="user-landing-dropdown-trigger">
          {userStats[selectedChart].header}
        </div>
      }
    </div>
  )
}
>>>>>>> develop
