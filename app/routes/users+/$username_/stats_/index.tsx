import { useState } from 'react'
import {
	ProfileEmptyState,
	ProfileOptionNavigator,
	ProfileSegmentedFilter,
} from '#app/components/profile-ui.tsx'
import {
	ProfileChart,
	type ProfileChartKey,
} from '#app/routes/users+/$username_/stats_/chart-loader.tsx'
import {
	type ProfileAnalyticsData,
	type ProfileShellData,
} from '#app/utils/profile.ts'

const PROFILE_CHARTS: Array<{
	key: ProfileChartKey
	header: string
	typed: boolean
}> = [
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
]

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
	const hasEntries = Object.values(loaderData.typedEntries ?? {}).some(
		entries => entries.length > 0,
	)

	return (
		<div className="user-landing-stats-container">
			<header className="user-landing-section-heading">
				<span>Deep dive</span>
				<h2>{selectedChart.header}</h2>
				<p>Use the controls to explore a different view of this library.</p>
			</header>
			{hasEntries ? (
				<>
					<div
						className="user-landing-stats-toolbar"
						role="group"
						aria-label="Statistics view controls"
					>
						<ProfileOptionNavigator
							label="Chart view"
							options={PROFILE_CHARTS.map(({ key, header }) => ({
								key,
								label: header,
							}))}
							value={selectedChart.key}
							onValueChange={value => {
								const nextIndex = PROFILE_CHARTS.findIndex(
									chart => chart.key === value,
								)
								if (nextIndex >= 0) setChartIndex(nextIndex)
							}}
						/>
						{selectedChart.typed ? (
							<div className="user-landing-stats-media-control">
								<span className="user-landing-control-label">Media</span>
								<ProfileSegmentedFilter
									label="Filter statistics by media type"
									options={loaderData.listTypes.map(listType => ({
										key: listType.id,
										label: listType.header,
									}))}
									value={selectedType?.id ?? ''}
									onValueChange={value => {
										const nextIndex = loaderData.listTypes.findIndex(
											listType => listType.id === value,
										)
										if (nextIndex >= 0) setTypeIndex(nextIndex)
									}}
								/>
							</div>
						) : null}
					</div>
					<div className="user-landing-chart-stage">
						<ProfileChart
							chartKey={selectedChart.key}
							label={selectedChart.header}
							data={loaderData}
							listType={selectedType}
						/>
					</div>
				</>
			) : (
				<ProfileEmptyState
					icon="bar-chart"
					title="Not enough data yet"
					description="Stats will appear after titles are added and tracked in this library."
				/>
			)}
		</div>
	)
}
