import { ResponsiveTimeRange } from '@nivo/calendar'
import { veudChartColors, veudNivoTheme } from '#app/utils/nivo-theme.ts'

function MyResponsiveTimeRange(data: any, startDate: any, endDate: any) {
	return (
		<div className="user-landing-stats-calendar-chart">
			<ResponsiveTimeRange
				colors={veudChartColors}
				theme={veudNivoTheme}
				data={data}
				from={startDate}
				to={endDate}
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

function addDate(calendarHistory: any[], finishDate: any) {
	const formattedDate = new Date(finishDate).toISOString().split('T')[0]
	const existing = calendarHistory.find(day => day.day === formattedDate)
	if (existing) {
		existing.value += 1
		return
	}
	calendarHistory.push({ day: formattedDate, value: 1 })
}

function collectFinishDates(value: unknown, dates: Set<number>) {
	if (!value || typeof value !== 'object') return
	if (Array.isArray(value)) {
		for (const item of value) collectFinishDates(item, dates)
		return
	}
	for (const [key, child] of Object.entries(value)) {
		if (key === 'finishDate' && Array.isArray(child)) {
			for (const date of child) {
				const timestamp = new Date(date as string | number | Date).getTime()
				if (Number.isFinite(timestamp)) dates.add(timestamp)
			}
		} else {
			collectFinishDates(child, dates)
		}
	}
}

export function renderCalendarChart(loaderData: any, chartType: string) {
	let calendarHistory: any[] = []

	if (chartType == 'completion history') {
		Object.values(loaderData.typedEntries).forEach((value: any) => {
			value.forEach((typedEntry: any) => {
				try {
					const history =
						typeof typedEntry.history === 'string'
							? JSON.parse(typedEntry.history)
							: typedEntry.history
					if (!history || typeof history !== 'object') return
					const finishDates = new Set<number>()
					collectFinishDates(history.progress, finishDates)
					if (history.finished) {
						const finished = new Date(history.finished).getTime()
						if (Number.isFinite(finished)) finishDates.add(finished)
					}
					for (const finishDate of finishDates) {
						addDate(calendarHistory, finishDate)
					}
				} catch (e) {
					return
				}
			})
		})
	}
	if (calendarHistory.length === 0) return {}

	let startDate
	let endDate = new Date()

	startDate =
		calendarHistory.length > 0
			? new Date(
					calendarHistory.reduce(
						(acc, curr) => (curr.day < acc.day ? curr : acc),
						calendarHistory[0] || undefined,
					).day,
				)
			: new Date()

	let yearIterator = startDate.getFullYear()
	let monthIterator = startDate.getMonth() + 1
	let endYear = endDate.getFullYear()
	let endMonth = endDate.getMonth() + 1

	let yearObject: Record<string, any> = {}

	while (yearIterator <= endYear) {
		let monthObject: Record<string, any> = {}

		while (monthIterator <= 12) {
			if (monthIterator > endMonth && yearIterator >= endYear) {
				break
			}

			monthObject[monthIterator] = MyResponsiveTimeRange(
				calendarHistory,
				`${yearIterator}-${monthIterator}-01`,
				`${yearIterator}-${monthIterator}-31`,
			)
			monthIterator++
		}

		yearObject[yearIterator] = monthObject
		yearIterator++
		monthIterator = 1
	}

	return yearObject
}
