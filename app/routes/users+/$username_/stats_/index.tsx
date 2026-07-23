import { useState } from 'react'
import { ProfileEmptyState } from '#app/components/profile-ui.tsx'
import { TypeSwitcher } from '#app/components/type-switcher.tsx'
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
