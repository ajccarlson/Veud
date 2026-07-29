import { ResponsivePie } from '@nivo/pie'
import { ProfileChartDataTable } from '#app/routes/users+/$username_/stats_/visualization-boundary.tsx'
import { veudChartColors, veudNivoTheme } from '#app/utils/nivo-theme.ts'
import { type ProfileAnalyticsResult } from '#app/utils/profile-analytics.ts'
import { type ProfileShellData } from '#app/utils/profile.ts'

type ProfilePieDatum = {
	id: string
	label: string
	value: number
}

type ProfilePieFill = {
	match: { id: string }
	id: 'lines' | 'dots'
}

function MyResponsivePie(data: ProfilePieDatum[], fill: ProfilePieFill[]) {
	return (
		<div className="user-landing-stats-chart-container user-landing-stats-pie-chart">
			<div
				role="img"
				aria-label="List type distribution"
				style={{ width: '100%', height: '100%' }}
			>
				<ResponsivePie
					colors={veudChartColors}
					theme={veudNivoTheme}
					data={data}
					margin={{ top: 40, right: 80, bottom: 80, left: 80 }}
					sortByValue
					innerRadius={0.5}
					padAngle={0.7}
					cornerRadius={3}
					activeOuterRadiusOffset={8}
					borderWidth={1}
					borderColor={{
						from: 'color',
						modifiers: [['darker', 0.2]],
					}}
					arcLinkLabelsSkipAngle={10}
					arcLinkLabelsTextColor="white"
					arcLinkLabelsThickness={2}
					arcLinkLabelsColor="white"
					arcLabelsSkipAngle={10}
					arcLabelsTextColor="black"
					tooltip={point => (
						<div
							style={{
								background: 'black',
								color: point.datum.color,
								padding: '9px 12px',
								border: '1px solid #ccc',
							}}
						>
							<div>{`${point.datum.label}: ${point.datum.formattedValue}`}</div>
						</div>
					)}
					defs={[
						{
							id: 'dots',
							type: 'patternDots',
							background: 'inherit',
							color: 'rgba(255, 255, 255, 0.3)',
							size: 4,
							padding: 1,
							stagger: true,
						},
						{
							id: 'lines',
							type: 'patternLines',
							background: 'inherit',
							color: 'rgba(255, 255, 255, 0.3)',
							rotation: -45,
							lineWidth: 6,
							spacing: 10,
						},
					]}
					fill={fill}
					motionConfig="default"
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
				/>
			</div>
			<ProfileChartDataTable
				label="List type distribution values"
				columns={['List type', 'Titles']}
				rows={data.map(datum => ({
					key: datum.id,
					cells: [datum.label, datum.value],
				}))}
			/>
		</div>
	)
}

export function renderPieChart(
	data: Pick<ProfileShellData, 'listTypes'> &
		Pick<ProfileAnalyticsResult, 'listTypeCounts'>,
) {
	const pieData: ProfilePieDatum[] = data.listTypes
		.map(listType => ({
			id: listType.header,
			label: listType.header,
			value: data.listTypeCounts[listType.id] ?? 0,
		}))
		.filter(datum => datum.value > 0)
	const patterns: ProfilePieFill['id'][] = ['lines', 'dots']
	const fill = pieData.flatMap<ProfilePieFill>((datum, index) => {
		if (index % 3 === 0) return []
		return [
			{
				match: { id: datum.id },
				id: patterns[(index - 1) % patterns.length] ?? 'lines',
			},
		]
	})

	if (!pieData.length) {
		return (
			<div
				className="user-landing-stats-chart-container user-landing-stats-pie-chart"
				role="status"
			>
				No titles yet.
			</div>
		)
	}

	return MyResponsivePie(pieData, fill)
}

export function PieChart({
	data,
}: {
	data: Pick<ProfileShellData, 'listTypes'> &
		Pick<ProfileAnalyticsResult, 'listTypeCounts'>
}) {
	return renderPieChart(data)
}
