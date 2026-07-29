import { ResponsiveBar } from '@nivo/bar'
import { ProfileChartDataTable } from '#app/routes/users+/$username_/stats_/visualization-boundary.tsx'
import { veudChartColors, veudNivoTheme } from '#app/utils/nivo-theme.ts'
import {
	type ProfileAnalyticsResult,
	PROFILE_COMPONENT_SCORE_FIELDS,
	type ProfileProviderScoreField,
	type ProfileScoreBuckets,
	type ProfileScoreField,
} from '#app/utils/profile-analytics.ts'
import { type ListTypeMeta } from '#app/utils/profile.ts'

const SCORE_LABELS: Record<ProfileScoreField, string> = {
	story: 'Story',
	character: 'Character',
	presentation: 'Presentation',
	sound: 'Sound',
	performance: 'Performance',
	enjoyment: 'Enjoyment',
	averaged: 'Average',
	personal: 'Personal',
	tmdbScore: 'TMDB Score',
	malScore: 'MAL Score',
}

export function scoreSeriesLabel(field: ProfileScoreField) {
	return SCORE_LABELS[field]
}

type ScoreBarDatum = { score: number } & Record<string, number>

function configuredProviderFields(listType: ListTypeMeta) {
	try {
		const columns = JSON.parse(listType.columns) as unknown
		if (!columns || typeof columns !== 'object' || Array.isArray(columns)) {
			return []
		}
		return (['tmdbScore', 'malScore'] as const).filter(
			field => field in columns,
		)
	} catch {
		if (listType.name === 'liveaction') return ['tmdbScore'] as const
		if (listType.name === 'anime' || listType.name === 'manga') {
			return ['malScore'] as const
		}
		return []
	}
}

export function buildScoreBarSeries(
	data: Pick<ProfileAnalyticsResult, 'scoreBuckets' | 'providerScoreBuckets'>,
	listType: ListTypeMeta | undefined,
) {
	const componentBuckets = listType ? data.scoreBuckets[listType.id] : undefined
	const providerBuckets = listType
		? data.providerScoreBuckets[listType.id]
		: undefined
	const bucketsByField: Partial<
		Record<ProfileScoreField, ProfileScoreBuckets>
	> = {
		...componentBuckets,
		...providerBuckets,
	}
	const providerFields: readonly ProfileProviderScoreField[] = listType
		? configuredProviderFields(listType)
		: []
	const barKeys: ProfileScoreField[] = [
		...PROFILE_COMPONENT_SCORE_FIELDS,
		...providerFields,
	].filter(field => bucketsByField[field]?.some(count => count > 0))
	const scoreBars: ScoreBarDatum[] = Array.from(
		{ length: 10 },
		(_, scoreIndex) => {
			const datum: ScoreBarDatum = { score: scoreIndex + 1 }
			for (const field of barKeys) {
				datum[field] = bucketsByField[field]?.[scoreIndex] ?? 0
			}
			return datum
		},
	)
	return { barKeys, scoreBars }
}

function MyResponsiveBar(data: ScoreBarDatum[], barKeys: ProfileScoreField[]) {
	return (
		<div className="user-landing-stats-chart-container user-landing-stats-bar-chart">
			<ResponsiveBar
				colors={veudChartColors}
				theme={veudNivoTheme}
				data={data}
				keys={barKeys}
				indexBy="score"
				margin={{ top: 50, right: 130, bottom: 50, left: 60 }}
				padding={0.3}
				valueScale={{ type: 'linear' }}
				indexScale={{ type: 'band', round: true }}
				tooltip={point => (
					<div
						style={{
							background: 'black',
							color: point.color,
							padding: '9px 12px',
							border: '1px solid #ccc',
						}}
					>
						<div>{`Score ${point.indexValue}`}</div>
						<div>{`${scoreSeriesLabel(point.id as ProfileScoreField)}: ${point.value}`}</div>
					</div>
				)}
				borderColor={{
					from: 'color',
					modifiers: [['darker', 1.6]],
				}}
				axisTop={null}
				axisRight={null}
				axisBottom={{
					tickSize: 5,
					tickPadding: 5,
					tickRotation: 0,
					legend: 'Score',
					legendPosition: 'middle',
					legendOffset: 32,
					truncateTickAt: 0,
				}}
				axisLeft={{
					tickSize: 5,
					tickPadding: 5,
					tickRotation: 0,
					legend: 'Entries',
					legendPosition: 'middle',
					legendOffset: -40,
					truncateTickAt: 0,
				}}
				labelSkipWidth={12}
				labelSkipHeight={12}
				labelTextColor={{
					from: 'color',
					modifiers: [['darker', 1.6]],
				}}
				legendLabel={datum => scoreSeriesLabel(datum.id as ProfileScoreField)}
				legends={[
					{
						anchor: 'bottom-right',
						direction: 'column',
						justify: false,
						translateX: 120,
						translateY: 0,
						itemsSpacing: 10,
						itemWidth: 100,
						itemHeight: 18,
						itemTextColor: 'white',
						itemDirection: 'left-to-right',
						itemOpacity: 1,
						symbolSize: 18,
						symbolShape: 'square',
						dataFrom: 'keys',
						effects: [
							{
								on: 'hover',
								style: { itemTextColor: '#66563d' },
							},
						],
					},
				]}
				role="img"
				ariaLabel="Score distribution"
				barAriaLabel={bar =>
					`${scoreSeriesLabel(bar.id as ProfileScoreField)}: ${bar.formattedValue} entries with score ${bar.indexValue}`
				}
			/>
			<ProfileChartDataTable
				label="Score distribution values"
				columns={['Score', ...barKeys.map(scoreSeriesLabel)]}
				rows={data
					.filter(datum => barKeys.some(field => datum[field] > 0))
					.map(datum => ({
						key: String(datum.score),
						cells: [datum.score, ...barKeys.map(field => datum[field] ?? 0)],
					}))}
			/>
		</div>
	)
}

export function renderBarChart(
	data: Pick<ProfileAnalyticsResult, 'scoreBuckets' | 'providerScoreBuckets'>,
	listType: ListTypeMeta | undefined,
) {
	const { barKeys, scoreBars } = buildScoreBarSeries(data, listType)
	if (!barKeys.length) {
		return (
			<div
				className="user-landing-stats-chart-container user-landing-stats-bar-chart"
				role="status"
			>
				No scores yet.
			</div>
		)
	}

	return MyResponsiveBar(scoreBars, barKeys)
}

export function BarChart({
	data,
	listType,
}: {
	data: Pick<ProfileAnalyticsResult, 'scoreBuckets' | 'providerScoreBuckets'>
	listType?: ListTypeMeta
}) {
	return renderBarChart(data, listType)
}
