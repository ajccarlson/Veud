import { ResponsiveRadialBar } from '@nivo/radial-bar'
import { ProfileChartDataTable } from '#app/routes/users+/$username_/stats_/visualization-boundary.tsx'
import { veudChartColors, veudNivoTheme } from '#app/utils/nivo-theme.ts'
import { type ProfileAnalyticsResult } from '#app/utils/profile-analytics.ts'
import { type ProfileShellData } from '#app/utils/profile.ts'

type ProfileRadialSeries = {
	id: string
	data: Array<{ x: string; y: number }>
}

export function mediaTypeCategoryLabel(category: {
	key: string
	label: string
	isRollup?: true
}) {
	return category.isRollup ? 'All other types' : category.label
}

function MyResponsiveRadialBar(data: ProfileRadialSeries[]) {
	return (
		<div className="user-landing-stats-chart-container user-landing-stats-radial-bar-chart">
			<ResponsiveRadialBar
				colors={veudChartColors}
				theme={veudNivoTheme}
				data={data}
				padding={0.4}
				cornerRadius={2}
				margin={{ top: 40, right: 120, bottom: 40, left: 40 }}
				radialAxisStart={{ tickSize: 5, tickPadding: 5, tickRotation: 0 }}
				circularAxisOuter={{
					tickSize: 5,
					tickPadding: 12,
					tickRotation: 0,
				}}
				enableLabels
				tooltip={point => (
					<div
						style={{
							background: 'black',
							color: point.bar.color,
							padding: '9px 12px',
							border: '1px solid #ccc',
						}}
					>
						<div>{point.bar.groupId}</div>
						<div>{`${point.bar.category}: ${point.bar.value}`}</div>
					</div>
				)}
				legends={[
					{
						anchor: 'left',
						direction: 'column',
						justify: false,
						translateX: 0,
						translateY: 56,
						itemsSpacing: 10,
						itemWidth: 100,
						itemHeight: 18,
						itemTextColor: 'white',
						itemDirection: 'left-to-right',
						itemOpacity: 1,
						symbolSize: 18,
						symbolShape: 'square',
						effects: [
							{
								on: 'hover',
								style: { itemTextColor: '#66563d' },
							},
						],
					},
				]}
				role="img"
				ariaLabel="Media type distribution"
			/>
			<ProfileChartDataTable
				label="Media type distribution values"
				columns={['List type', 'Media type', 'Titles']}
				rows={data.flatMap(series =>
					series.data.map((datum, index) => ({
						key: `${series.id}:${datum.x}:${index}`,
						cells: [series.id, datum.x, datum.y],
					})),
				)}
			/>
		</div>
	)
}

export function renderRadialBar(
	data: Pick<ProfileShellData, 'listTypes'> &
		Pick<ProfileAnalyticsResult, 'mediaTypeCounts'>,
) {
	const bars = data.listTypes
		.map((listType): ProfileRadialSeries => ({
			id: listType.header,
			data: (data.mediaTypeCounts[listType.id] ?? []).map(category => ({
				x: mediaTypeCategoryLabel(category),
				y: category.count,
			})),
		}))
		.filter(series => series.data.length > 0)

	if (!bars.length) {
		return (
			<div
				className="user-landing-stats-chart-container user-landing-stats-radial-bar-chart"
				role="status"
			>
				No media type data yet.
			</div>
		)
	}

	return MyResponsiveRadialBar(bars)
}

export function renderRadialBarChart(
	data: Pick<ProfileShellData, 'listTypes'> &
		Pick<ProfileAnalyticsResult, 'mediaTypeCounts'>,
	_chartType: 'type' = 'type',
) {
	return renderRadialBar(data)
}

export function RadialBarChart({
	data,
}: {
	data: Pick<ProfileShellData, 'listTypes'> &
		Pick<ProfileAnalyticsResult, 'mediaTypeCounts'>
}) {
	return renderRadialBarChart(data)
}
