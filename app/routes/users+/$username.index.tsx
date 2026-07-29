import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import {
	data as json,
	type LoaderFunctionArgs,
	useLoaderData,
	useOutletContext,
} from 'react-router'
import { ProfileAbout } from '#app/components/profile-about.tsx'
import {
	ProfileEmptyState,
	ProfilePeriodSelect,
} from '#app/components/profile-ui.tsx'
import { StatsOverview } from '#app/routes/users+/$username_/stats-overview.tsx'
import {
	ProfileVisualizationBoundary,
	ProfileVisualizationLoading,
} from '#app/routes/users+/$username_/stats_/visualization-boundary.tsx'
import { type ProfileAnalyticsDiagnostic } from '#app/utils/profile-analytics.ts'
import { loadProfileOverview } from '#app/utils/profile-data.server.ts'
import { profileHeaders } from '#app/utils/profile-headers.ts'
import { type ProfileShellData } from '#app/utils/profile.ts'
import { makeTimings } from '#app/utils/timing.server.ts'

export { ProfileTabErrorBoundary as ErrorBoundary } from '#app/components/profile-ui.tsx'

export async function loader({ request, params }: LoaderFunctionArgs) {
	const timings = makeTimings('profile_overview', 'profile overview loader')
	const overview = await loadProfileOverview(
		request,
		params['username'],
		timings,
	)
	return json(overview, {
		headers: { 'Server-Timing': timings.toString() },
	})
}

export const headers = profileHeaders

const DeferredCompletionHistoryChart = lazy(() =>
	import('#app/routes/users+/$username_/stats_/calendar.tsx').then(module => ({
		default: module.CompletionHistoryChart,
	})),
)

function getMonthName(monthNum: string) {
	const date = new Date(2000, Number(monthNum) - 1, 1)
	return date.toLocaleString('default', { month: 'long' })
}

export function overviewDiagnosticText(diagnostic: ProfileAnalyticsDiagnostic) {
	const details: string[] = []
	if (diagnostic.truncated) details.push('entry limit reached')
	if (diagnostic.watchlistsTruncated) details.push('watchlist limit reached')
	if (diagnostic.completionDaysTruncated) {
		details.push('completion timeline limited')
	}
	if (
		diagnostic.historyEntriesRejected > 0 ||
		diagnostic.historyFinishEventsTruncated > 0
	) {
		details.push('some history could not be fully read')
	}
	return details.length ? ` Partial data: ${details.join('; ')}.` : ''
}

export default function ProfileOverview() {
	const shellData = useOutletContext<ProfileShellData>()
	const overviewData = useLoaderData<typeof loader>()
	const loaderData = { ...shellData, ...overviewData }

	const completionHistory = overviewData.completionHistory
	const completionMonthsByYear = useMemo(() => {
		const periods = new Map<string, Set<string>>()
		for (const { day } of completionHistory.days) {
			const year = day.slice(0, 4)
			const month = day.slice(5, 7)
			const months = periods.get(year) ?? new Set<string>()
			months.add(month)
			periods.set(year, months)
		}
		return Object.fromEntries(
			[...periods].map(([year, months]) => [year, [...months].sort()]),
		) as Record<string, string[]>
	}, [completionHistory.days])
	const completionYears = useMemo(
		() => Object.keys(completionMonthsByYear).sort(),
		[completionMonthsByYear],
	)

	const latestYear = completionYears[completionYears.length - 1]
	const latestMonths = latestYear
		? (completionMonthsByYear[latestYear] ?? [])
		: []
	const [selectedYear, setSelectedYear] = useState(latestYear ?? '')
	const [selectedMonth, setSelectedMonth] = useState(
		latestMonths[latestMonths.length - 1] ?? '',
	)
	const completionMonths = useMemo(
		() => (selectedYear ? (completionMonthsByYear[selectedYear] ?? []) : []),
		[completionMonthsByYear, selectedYear],
	)

	useEffect(() => {
		if (!completionYears.length) {
			setSelectedYear('')
			setSelectedMonth('')
			return
		}
		if (!completionYears.includes(selectedYear)) {
			const nextYear = completionYears[completionYears.length - 1]
			const nextMonths = completionMonthsByYear[nextYear] ?? []
			setSelectedYear(nextYear)
			setSelectedMonth(nextMonths[nextMonths.length - 1] ?? '')
		}
	}, [completionMonthsByYear, completionYears, selectedYear])

	useEffect(() => {
		if (completionMonths.includes(selectedMonth)) return
		setSelectedMonth(completionMonths[completionMonths.length - 1] ?? '')
	}, [completionMonths, selectedMonth])

	function selectYear(year: string) {
		const months = completionMonthsByYear[year] ?? []
		setSelectedYear(year)
		setSelectedMonth(months[months.length - 1] ?? '')
	}

	const selectedRange =
		selectedYear && selectedMonth
			? {
					from: `${selectedYear}-${selectedMonth}-01`,
					to: `${selectedYear}-${selectedMonth}-${new Date(
						Date.UTC(Number(selectedYear), Number(selectedMonth), 0),
					)
						.getUTCDate()
						.toString()
						.padStart(2, '0')}`,
				}
			: null

	return (
		<div className="user-landing-overview">
			<ProfileAbout bio={loaderData.user.bio} />
			<StatsOverview data={loaderData} />
			<section className="user-landing-completion-history-container">
				<div className="user-landing-completion-history-heading">
					<header className="user-landing-section-heading">
						<span>Timeline</span>
						<h2>Completion History</h2>
						<p>
							Finished titles and progress logged during the selected month.
							{overviewDiagnosticText(overviewData.diagnostic)}
						</p>
					</header>
					{selectedRange ? (
						<div
							className="user-landing-completion-history-controls"
							role="group"
							aria-label="Completion history period"
						>
							<ProfilePeriodSelect
								label="Year"
								value={selectedYear}
								options={completionYears.map(year => ({
									key: year,
									label: year,
								}))}
								onValueChange={selectYear}
							/>
							<ProfilePeriodSelect
								label="Month"
								value={selectedMonth}
								options={completionMonths.map(month => ({
									key: month,
									label: getMonthName(month),
								}))}
								onValueChange={setSelectedMonth}
							/>
						</div>
					) : null}
				</div>
				{selectedRange ? (
					<div className="user-landing-completion-history-chart">
						<ProfileVisualizationBoundary
							key={`${selectedYear}:${selectedMonth}`}
						>
							<Suspense
								fallback={
									<ProfileVisualizationLoading label="completion history" />
								}
							>
								<DeferredCompletionHistoryChart
									data={completionHistory.days}
									from={selectedRange.from}
									to={selectedRange.to}
								/>
							</Suspense>
						</ProfileVisualizationBoundary>
					</div>
				) : (
					<ProfileEmptyState
						icon="calendar"
						title="No completion history yet"
						description="Finished titles and logged progress will build your activity calendar here."
					/>
				)}
			</section>
		</div>
	)
}
