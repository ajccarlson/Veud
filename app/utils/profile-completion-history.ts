export type CompletionHistoryDay = {
	day: string
	value: number
}

export type CompletionHistory = {
	days: CompletionHistoryDay[]
}

export function buildCompletionHistoryFromDays(
	inputDays: Iterable<CompletionHistoryDay>,
): CompletionHistory {
	const dayCounts = new Map<string, number>()
	for (const day of inputDays) {
		if (!/^\d{4}-\d{2}-\d{2}$/.test(day.day)) continue
		if (!Number.isFinite(day.value) || day.value <= 0) continue
		dayCounts.set(day.day, (dayCounts.get(day.day) ?? 0) + day.value)
	}
	const days = [...dayCounts]
		.map(([day, value]) => ({ day, value }))
		.sort((a, b) => a.day.localeCompare(b.day))
	return { days }
}
