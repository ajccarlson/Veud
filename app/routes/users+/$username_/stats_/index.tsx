import { useMemo, useState } from 'react'
import { Spacer } from '#app/components/spacer.tsx'
import { TypeSwitcher } from '#app/components/type-switcher.tsx'
import { renderBarChart } from '#app/routes/users+/$username_/stats_/bar.tsx'
import { renderBoxPlotChart } from '#app/routes/users+/$username_/stats_/box_plot.tsx'
import { renderChordChart } from '#app/routes/users+/$username_/stats_/chord.tsx'
import { renderLineChart } from '#app/routes/users+/$username_/stats_/line.tsx'
import { renderPieChart } from '#app/routes/users+/$username_/stats_/pie.tsx'
import { renderRadialBar } from '#app/routes/users+/$username_/stats_/radial_bar.tsx'
import { watchlistOverview } from '#app/routes/users+/$username_/stats_/watchlist.tsx'
import {
	type ProfileAnalyticsData,
	type ProfileShellData,
} from '#app/utils/profile.ts'

const PROFILE_CHARTS = [
	{ key: 'watchlist', header: 'Watchlist Overview', typed: true },
	{
		key: 'listTypeDistribution',
		header: 'List Type Distribution',
		typed: false,
	},
	{ key: 'score', header: 'Score Distribution', typed: true },
	{
		key: 'objectiveScores',
		header: 'Public Score Deviation',
		typed: true,
	},
	{ key: 'release', header: 'Release Date Distribution', typed: false },
	{ key: 'watched', header: 'Watch Date Distribution', typed: false },
	{ key: 'genreChords', header: 'Genre Overlap', typed: true },
	{ key: 'type', header: 'Media Type Distribution', typed: false },
] as const

export function StatsData({
	data: loaderData,
}: {
	data: ProfileShellData & ProfileAnalyticsData
}) {
	const [chartIndex, setChartIndex] = useState(0)
	const [typeIndex, setTypeIndex] = useState(0)
	const selectedType =
		loaderData.listTypes[typeIndex] ?? loaderData.listTypes[0]
	const selectedChart = PROFILE_CHARTS[chartIndex] ?? PROFILE_CHARTS[0]
	const chart = useMemo(() => {
		if (!selectedType) return null
		switch (selectedChart.key) {
			case 'watchlist':
				return watchlistOverview(loaderData, selectedType)
			case 'listTypeDistribution':
				return renderPieChart(loaderData)
			case 'score':
				return renderBarChart(loaderData, 'score', selectedType)
			case 'objectiveScores':
				return renderBoxPlotChart(loaderData, 'objective scores', selectedType)
			case 'release':
				return renderLineChart(loaderData, 'release')
			case 'watched':
				return renderLineChart(loaderData, 'watched')
			case 'genreChords':
				return renderChordChart(loaderData, selectedType)
			case 'type':
				return renderRadialBar(loaderData, 'type')
		}
	}, [loaderData, selectedChart.key, selectedType])

	return (
		<div className="user-landing-stats-container">
			<h1 className="user-landing-body-header">Stats</h1>
			{chart}
			{loaderData.typedEntries &&
			Object.entries(loaderData.typedEntries).length > 0 ? (
				<div className="user-landing-selection-nav-items">
					<TypeSwitcher
						variant="primary"
						options={PROFILE_CHARTS.map(({ key, header }) => ({
							key,
							label: header,
						}))}
						index={chartIndex}
						onIndexChange={setChartIndex}
					/>
					{selectedChart.typed ? (
						<div className="user-landing-selection-secondary-nav-container">
							<Spacer size="4xs" />
							<TypeSwitcher
								variant="secondary"
								options={loaderData.listTypes.map(listType => ({
									key: listType.id,
									label: listType.header,
								}))}
								index={typeIndex}
								onIndexChange={setTypeIndex}
							/>
						</div>
					) : null}
				</div>
			) : (
				<div className="user-landing-dropdown-trigger">
					{selectedChart.header}
				</div>
			)}
		</div>
	)
}
