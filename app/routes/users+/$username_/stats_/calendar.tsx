import { ResponsiveTimeRange } from '@nivo/calendar'
import { veudChartColors, veudNivoTheme } from '#app/utils/nivo-theme.ts'
import { type CompletionHistoryDay } from '#app/utils/profile-completion-history.ts'

export function CompletionHistoryChart({
	data,
	from,
	to,
}: {
	data: CompletionHistoryDay[]
	from: string
	to: string
}) {
	return (
		<div className="user-landing-stats-calendar-chart">
			<ResponsiveTimeRange
				colors={veudChartColors}
				theme={veudNivoTheme}
				data={data}
				from={from}
				to={to}
				emptyColor="rgba(255, 239, 204, 0.1)"
				margin={{ top: 16, right: 16, bottom: 16, left: 16 }}
				align="center"
				direction="horizontal"
				dayBorderWidth={1}
				dayBorderColor="rgba(162, 255, 213, 0.2)"
				tooltip={point => {
					// console.log(point)
					return (
						<div
							style={{
								background: 'black',
								color: point.color,
								padding: '9px 12px',
								border: '1px solid #ccc',
							}}
						>
							<div>{`${new Date(point.day).toLocaleDateString()}: ${point.value}`}</div>
						</div>
					)
				}}
			/>
		</div>
	)
}
