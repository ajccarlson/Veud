import { useEffect, useState } from 'react'
import {
	ProfileEmptyState,
	ProfileOptionNavigator,
	ProfileSegmentedFilter,
} from '#app/components/profile-ui.tsx'
import {
	ProfileChart,
	type ProfileChartKey,
} from '#app/routes/users+/$username_/stats_/chart-loader.tsx'
import { type ProfileAnalyticsDiagnostic } from '#app/utils/profile-analytics.ts'
import {
	type ProfileShellData,
	type ProfileStatsData,
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
		header: 'Personal vs Public Scores',
		typed: true,
	},
	{ key: 'release', header: 'Release Date Distribution', typed: false },
	{ key: 'watched', header: 'Watch Date Distribution', typed: false },
	{ key: 'genreChords', header: 'Genre Overlap', typed: true },
	{ key: 'type', header: 'Media Type Distribution', typed: false },
]

export function firstPopulatedListTypeIndex(
	listTypes: ProfileShellData['listTypes'],
	listTypeCounts: ProfileStatsData['listTypeCounts'],
) {
	const populatedIndex = listTypes.findIndex(
		listType => (listTypeCounts[listType.id] ?? 0) > 0,
	)
	return populatedIndex >= 0 ? populatedIndex : 0
}

export function statsDiagnosticText(diagnostic: ProfileAnalyticsDiagnostic) {
	const details: string[] = []
	if (diagnostic.truncated) details.push('entry limit reached')
	if (diagnostic.watchlistsTruncated) details.push('watchlist limit reached')
	if (
		diagnostic.historyEntriesRejected > 0 ||
		diagnostic.historyFinishEventsTruncated > 0
	) {
		details.push('some history could not be fully read')
	}
	if (diagnostic.categoryCandidatesApproximate) {
		details.push('category groups are approximate')
	}
	if (diagnostic.categoryCandidatesTruncated) {
		details.push('category groups are limited')
	}
	return details.length ? ` Partial data: ${details.join('; ')}.` : ''
}

export function StatsData({
	data: loaderData,
}: {
	data: Pick<ProfileShellData, 'listTypes' | 'user'> & ProfileStatsData
}) {
	const [chartIndex, setChartIndex] = useState(0)
	const defaultTypeId =
		loaderData.listTypes[
			firstPopulatedListTypeIndex(
				loaderData.listTypes,
				loaderData.listTypeCounts,
			)
		]?.id ?? ''
	const [typeSelection, setTypeSelection] = useState(() => ({
		profileId: loaderData.user.id,
		typeId: defaultTypeId,
	}))
	const selectionIsCurrent =
		typeSelection.profileId === loaderData.user.id &&
		loaderData.listTypes.some(type => type.id === typeSelection.typeId)
	const selectedTypeId = selectionIsCurrent
		? typeSelection.typeId
		: defaultTypeId

	useEffect(() => {
		if (
			typeSelection.profileId === loaderData.user.id &&
			typeSelection.typeId === selectedTypeId
		) {
			return
		}
		setTypeSelection({
			profileId: loaderData.user.id,
			typeId: selectedTypeId,
		})
	}, [
		loaderData.user.id,
		selectedTypeId,
		typeSelection.profileId,
		typeSelection.typeId,
	])
	const selectedType =
		loaderData.listTypes.find(type => type.id === selectedTypeId) ??
		loaderData.listTypes[0]
	const selectedChart = PROFILE_CHARTS[chartIndex] ?? PROFILE_CHARTS[0]
	const hasEntries = Object.values(loaderData.listTypeCounts).some(
		count => count > 0,
	)

	return (
		<div className="user-landing-stats-container">
			<header className="user-landing-section-heading">
				<span>Deep dive</span>
				<h2>{selectedChart.header}</h2>
				<p>
					Use the controls to explore a different view of this library.
					{statsDiagnosticText(loaderData.diagnostic)}
				</p>
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
									onValueChange={typeId =>
										setTypeSelection({
											profileId: loaderData.user.id,
											typeId,
										})
									}
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
