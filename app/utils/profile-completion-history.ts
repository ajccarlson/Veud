export type CompletionHistoryDay = {
	day: string
	value: number
}

export type CompletionHistoryRange = {
	from: string
	to: string
}

export type CompletionHistory = {
	days: CompletionHistoryDay[]
	months: Record<string, Record<string, CompletionHistoryRange>>
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

function addDate(days: CompletionHistoryDay[], finishDate: number) {
	const day = new Date(finishDate).toISOString().split('T')[0]
	const existing = days.find(candidate => candidate.day === day)
	if (existing) {
		existing.value += 1
		return
	}
	days.push({ day, value: 1 })
}

export function buildCompletionHistory(
	typedEntries: Record<string, any[]>,
	endDate = new Date(),
): CompletionHistory {
	const days: CompletionHistoryDay[] = []

	for (const entries of Object.values(typedEntries)) {
		for (const entry of entries) {
			try {
				const history =
					typeof entry.history === 'string'
						? JSON.parse(entry.history)
						: entry.history
				if (!history || typeof history !== 'object') continue
				const finishDates = new Set<number>()
				collectFinishDates(history.progress, finishDates)
				if (history.finished) {
					const finished = new Date(history.finished).getTime()
					if (Number.isFinite(finished)) finishDates.add(finished)
				}
				for (const finishDate of finishDates) addDate(days, finishDate)
			} catch {
				continue
			}
		}
	}

	if (!days.length) return { days, months: {} }

	days.sort((a, b) => a.day.localeCompare(b.day))
	const firstDay = days.reduce(
		(earliest, current) => (current.day < earliest.day ? current : earliest),
		days[0],
	)
	const [firstYear, firstMonth] = firstDay.day
		.split('-')
		.map(component => Number(component))
	let year = firstYear
	let month = firstMonth
	const endYear = endDate.getFullYear()
	const endMonth = endDate.getMonth() + 1
	const months: CompletionHistory['months'] = {}

	while (year <= endYear) {
		const yearMonths: Record<string, CompletionHistoryRange> = {}
		while (month <= 12) {
			if (year >= endYear && month > endMonth) break
			const paddedMonth = String(month).padStart(2, '0')
			const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
			yearMonths[month] = {
				from: `${year}-${paddedMonth}-01`,
				to: `${year}-${paddedMonth}-${lastDay}`,
			}
			month += 1
		}
		months[year] = yearMonths
		year += 1
		month = 1
	}

	return { days, months }
}
