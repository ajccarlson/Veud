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
