import { ResponsiveLine } from '@nivo/line'
import { ProfileChartDataTable } from '#app/routes/users+/$username_/stats_/visualization-boundary.tsx'
import { veudChartColors, veudNivoTheme } from '#app/utils/nivo-theme.ts'
import { type ProfileAnalyticsResult } from '#app/utils/profile-analytics.ts'
import { type ProfileShellData } from '#app/utils/profile.ts'

type LineMode = 'release' | 'watched'

export type ProfileLineSeries = {
	id: string
	data: Array<{ x: number; y: number }>
}

export const PROFILE_YEAR_LINE_SCALE = {
	type: 'linear',
	min: 'auto',
	max: 'auto',
} as const

function MyResponsiveLine(data: ProfileLineSeries[], mode: LineMode) {
	const label =
		mode === 'release'
			? 'Release year distribution'
			: 'Completion year distribution'
	return (
		<div className="user-landing-stats-chart-container user-landing-stats-line-chart">
			<ResponsiveLine
				colors={veudChartColors}
				theme={veudNivoTheme}
				data={data}
				margin={{ top: 50, right: 110, bottom: 50, left: 60 }}
				xScale={PROFILE_YEAR_LINE_SCALE}
				yScale={{
					type: 'linear',
					min: 'auto',
					max: 'auto',
					stacked: false,
					reverse: false,
				}}
				curve="monotoneX"
				axisBottom={{
					tickSize: 5,
					tickPadding: 5,
					tickRotation: 0,
					legend: 'Year',
					legendOffset: 36,
					legendPosition: 'middle',
					truncateTickAt: 0,
				}}
				axisLeft={{
					tickSize: 5,
					tickPadding: 5,
					tickRotation: 0,
					legend: 'Entries',
					legendOffset: -40,
					legendPosition: 'middle',
					truncateTickAt: 0,
				}}
				enableGridX={false}
				enableGridY={false}
				pointSize={10}
				pointColor={{ theme: 'background' }}
				pointBorderWidth={2}
				pointBorderColor={{ from: 'serieColor' }}
				enablePointLabel
				pointLabelYOffset={-12}
				enableArea
				enableTouchCrosshair
				useMesh
				tooltip={point => (
					<div
						style={{
							background: 'black',
							color: point.point.seriesColor,
							padding: '9px 12px',
							border: '1px solid #ccc',
						}}
					>
						<div>{point.point.seriesId}</div>
						<div>{`${point.point.data.x}: ${point.point.data.y}`}</div>
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
				ariaLabel={label}
			/>
			<ProfileChartDataTable
				label={`${label} values`}
				columns={['Media type', 'Year', 'Entries']}
				rows={data.flatMap(series =>
					series.data.map(point => ({
						key: `${series.id}:${point.x}`,
						cells: [series.id, point.x, point.y],
					})),
				)}
			/>
		</div>
	)
}

export function buildProfileLineSeries(
	data: Pick<ProfileShellData, 'listTypes'> &
		Pick<ProfileAnalyticsResult, 'releaseYears' | 'completionYears'>,
	chartType: LineMode,
) {
	const countsByType =
		chartType === 'release' ? data.releaseYears : data.completionYears
	return data.listTypes
		.map((listType): ProfileLineSeries => ({
			id: listType.header,
			data: (countsByType[listType.id] ?? [])
				.slice()
				.sort((left, right) => left.year - right.year)
				.map(({ year, count }) => ({
					x: year,
					y: count,
				})),
		}))
		.filter(line => line.data.length > 0)
}

export function renderLineChart(
	data: Pick<ProfileShellData, 'listTypes'> &
		Pick<ProfileAnalyticsResult, 'releaseYears' | 'completionYears'>,
	chartType: LineMode,
) {
	const lines = buildProfileLineSeries(data, chartType)
	if (!lines.length) {
		return (
			<div
				className="user-landing-stats-chart-container user-landing-stats-line-chart"
				role="status"
			>
				No {chartType === 'release' ? 'release' : 'completion'} dates yet.
			</div>
		)
	}

	return MyResponsiveLine(lines, chartType)
}

export function LineChart({
	data,
	mode = 'release',
}: {
	data: Pick<ProfileShellData, 'listTypes'> &
		Pick<ProfileAnalyticsResult, 'releaseYears' | 'completionYears'>
	mode?: LineMode
}) {
	return renderLineChart(data, mode)
}
