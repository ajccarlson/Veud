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
import { buildCompletionHistory } from '#app/utils/profile-completion-history.ts'
import { loadProfileAnalytics } from '#app/utils/profile-data.server.ts'
import { profileHeaders } from '#app/utils/profile-headers.ts'
import { type ProfileShellData } from '#app/utils/profile.ts'
import { makeTimings } from '#app/utils/timing.server.ts'

export { ProfileTabErrorBoundary as ErrorBoundary } from '#app/components/profile-ui.tsx'

export async function loader({ request, params }: LoaderFunctionArgs) {
	const timings = makeTimings('profile_overview', 'profile overview loader')
	const analytics = await loadProfileAnalytics(
		request,
		params['username'],
		timings,
	)
	return json(analytics, {
		headers: { 'Server-Timing': timings.toString() },
	})
}

export const headers = profileHeaders

const DeferredCompletionHistoryChart = lazy(() =>
	import('#app/routes/users+/$username_/stats_/calendar.tsx').then(module => ({
		default: module.CompletionHistoryChart,
	})),
)

function getMonthName(monthNum: any) {
	const date = new Date(2000, monthNum - 1, 1)
	return date.toLocaleString('default', { month: 'long' })
}

export default function ProfileOverview() {
	const shellData = useOutletContext<ProfileShellData>()
	const analyticsData = useLoaderData<typeof loader>()
	const loaderData = { ...shellData, ...analyticsData }

	const completionHistory = useMemo(
		() => buildCompletionHistory(analyticsData.typedEntries),
		[analyticsData.typedEntries],
	)
	const completionYears = useMemo(
		() => Object.keys(completionHistory.months),
		[completionHistory],
	)

	const latestYear = completionYears[completionYears.length - 1]
	const latestMonths = latestYear
		? Object.keys(completionHistory.months[latestYear])
		: []
	const [selectedYear, setSelectedYear] = useState(latestYear ?? '')
	const [selectedMonth, setSelectedMonth] = useState(
		latestMonths[latestMonths.length - 1] ?? '',
	)
	const completionMonths = useMemo(
		() =>
			selectedYear
				? Object.keys(completionHistory.months[selectedYear] ?? {})
				: [],
		[completionHistory, selectedYear],
	)

	useEffect(() => {
		if (!completionYears.length) {
			setSelectedYear('')
			setSelectedMonth('')
			return
		}
		if (!completionYears.includes(selectedYear)) {
			const nextYear = completionYears[completionYears.length - 1]
			const nextMonths = Object.keys(completionHistory.months[nextYear] ?? {})
			setSelectedYear(nextYear)
			setSelectedMonth(nextMonths[nextMonths.length - 1] ?? '')
		}
	}, [completionHistory, completionYears, selectedYear])

	useEffect(() => {
		if (completionMonths.includes(selectedMonth)) return
		setSelectedMonth(completionMonths[completionMonths.length - 1] ?? '')
	}, [completionMonths, selectedMonth])

	function selectYear(year: string) {
		const months = Object.keys(completionHistory.months[year] ?? {})
		setSelectedYear(year)
		setSelectedMonth(months[months.length - 1] ?? '')
	}

	const selectedRange =
		selectedYear && selectedMonth
			? completionHistory.months[selectedYear]?.[selectedMonth]
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
