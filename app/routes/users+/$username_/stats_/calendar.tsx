import { ResponsiveTimeRange } from '@nivo/calendar'
import { ProfileChartDataTable } from '#app/routes/users+/$username_/stats_/visualization-boundary.tsx'
import { veudChartColors, veudNivoTheme } from '#app/utils/nivo-theme.ts'
import { type CompletionHistoryDay } from '#app/utils/profile-completion-history.ts'

export function utcCalendarDayLabel(value: string | Date) {
	if (typeof value === 'string') {
		const canonicalDay = /^(\d{4}-\d{2}-\d{2})(?:$|T)/.exec(value)?.[1]
		if (canonicalDay) return canonicalDay
	}
	const date = value instanceof Date ? value : new Date(value)
	if (Number.isNaN(date.getTime())) return String(value)
	return [
		date.getUTCFullYear().toString().padStart(4, '0'),
		(date.getUTCMonth() + 1).toString().padStart(2, '0'),
		date.getUTCDate().toString().padStart(2, '0'),
	].join('-')
}

export function CompletionHistoryChart({
	data,
	from,
	to,
}: {
	data: CompletionHistoryDay[]
	from: string
	to: string
}) {
	const visibleDays = data.filter(day => day.day >= from && day.day <= to)
	return (
		<div className="user-landing-stats-calendar-chart">
			<div
				role="img"
				aria-label="Completion history calendar"
				style={{ width: '100%', height: '100%' }}
			>
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
					tooltip={point => (
						<div
							style={{
								background: 'black',
								color: point.color,
								padding: '9px 12px',
								border: '1px solid #ccc',
							}}
						>
							<div>{`${utcCalendarDayLabel(point.day)}: ${point.value}`}</div>
						</div>
					)}
				/>
			</div>
			<ProfileChartDataTable
				label="Completion history values"
				columns={['Date', 'Completions']}
				rows={visibleDays.map(day => ({
					key: day.day,
					cells: [day.day, day.value],
				}))}
				emptyText={`No completions from ${from} through ${to}.`}
			/>
		</div>
	)
}
