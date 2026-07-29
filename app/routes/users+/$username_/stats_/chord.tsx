import { ResponsiveChord } from '@nivo/chord'
import { ProfileChartDataTable } from '#app/routes/users+/$username_/stats_/visualization-boundary.tsx'
import { veudChartColors, veudNivoTheme } from '#app/utils/nivo-theme.ts'
import {
	type ProfileAnalyticsResult,
	type ProfileCategoryMatrix,
} from '#app/utils/profile-analytics.ts'
import { type ListTypeMeta } from '#app/utils/profile.ts'

function MyResponsiveChord(matrix: ProfileCategoryMatrix) {
	return (
		<div className="user-landing-stats-chart-container user-landing-stats-chord-chart">
			<ResponsiveChord
				colors={veudChartColors}
				theme={veudNivoTheme}
				data={matrix.values}
				keys={matrix.labels}
				margin={{ top: 60, right: 60, bottom: 90, left: 60 }}
				valueFormat=">-.0f"
				padAngle={0.02}
				innerRadiusRatio={0.96}
				innerRadiusOffset={0.02}
				inactiveArcOpacity={0.25}
				arcBorderColor={{
					from: 'color',
					modifiers: [['darker', 0.6]],
				}}
				activeRibbonOpacity={0.75}
				inactiveRibbonOpacity={0.25}
				ribbonBorderColor={{
					from: 'color',
					modifiers: [['darker', 0.6]],
				}}
				labelRotation={-90}
				labelTextColor={{
					from: 'color',
					modifiers: [['darker', 1]],
				}}
				motionConfig="stiff"
				arcTooltip={point => (
					<div
						style={{
							background: 'black',
							color: point.arc.color,
							padding: '9px 12px',
							border: '1px solid #ccc',
						}}
					>
						<div>{`${point.arc.label}: ${point.arc.value}`}</div>
					</div>
				)}
				ribbonTooltip={point => (
					<div
						style={{
							background: 'black',
							padding: '9px 12px',
							border: '1px solid #ccc',
						}}
					>
						<div style={{ color: point.ribbon.source.color }}>
							{`${point.ribbon.source.label}: ${point.ribbon.source.value}`}
						</div>
						<div style={{ color: point.ribbon.target.color }}>
							{`${point.ribbon.target.label}: ${point.ribbon.target.value}`}
						</div>
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
				ariaLabel="Genre overlap"
			/>
			<ProfileChartDataTable
				label="Genre overlap values"
				columns={['Genre', 'Related genre', 'Entries']}
				rows={matrix.values.flatMap((row, rowIndex) =>
					row.flatMap((value, columnIndex) => {
						if (value <= 0 || columnIndex < rowIndex) return []
						return [
							{
								key: `${rowIndex}:${columnIndex}`,
								cells: [
									matrix.labels[rowIndex] ?? `Genre ${rowIndex + 1}`,
									matrix.labels[columnIndex] ?? `Genre ${columnIndex + 1}`,
									value,
								],
							},
						]
					}),
				)}
			/>
		</div>
	)
}

export function renderChordChart(
	data: Pick<ProfileAnalyticsResult, 'genreMatrices'>,
	listType: ListTypeMeta | undefined,
) {
	const matrix = listType ? data.genreMatrices[listType.id] : undefined
	const hasOverlap = matrix?.values.some(row => row.some(value => value > 0))
	if (!matrix || !hasOverlap) {
		return (
			<div
				className="user-landing-stats-chart-container user-landing-stats-chord-chart"
				role="status"
			>
				Not enough genre overlap yet.
			</div>
		)
	}

	return MyResponsiveChord(matrix)
}

export function ChordChart({
	data,
	listType,
}: {
	data: Pick<ProfileAnalyticsResult, 'genreMatrices'>
	listType?: ListTypeMeta
}) {
	return renderChordChart(data, listType)
}
