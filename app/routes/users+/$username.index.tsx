import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import {
	data as json,
	type LoaderFunctionArgs,
	useLoaderData,
	useOutletContext,
} from 'react-router'
import { ProfileAbout } from '#app/components/profile-about.tsx'
import { ProfileEmptyState } from '#app/components/profile-ui.tsx'
import { Spacer } from '#app/components/spacer.tsx'
import { TypeSwitcher } from '#app/components/type-switcher.tsx'
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
	const [completionMonths, setCompletionMonths] = useState(() =>
		latestYear ? Object.keys(completionHistory.months[latestYear]) : [],
	)
	const [yearIndex, setYearIndex] = useState(
		Math.max(0, completionYears.length - 1),
	)
	const [monthIndex, setMonthIndex] = useState(
		Math.max(0, completionMonths.length - 1),
	)

	useEffect(() => {
		if (!completionYears.length) {
			setCompletionMonths([])
			setYearIndex(0)
			setMonthIndex(0)
			return
		}
		if (yearIndex >= completionYears.length) {
			setYearIndex(completionYears.length - 1)
			return
		}
		setMonthIndex(0)
		setCompletionMonths(
			Object.keys(completionHistory.months[completionYears[yearIndex]]),
		)
	}, [completionHistory, completionYears, yearIndex])
	const selectedYear = completionYears[yearIndex]
	const selectedMonth = completionMonths[monthIndex]
	const selectedRange =
		selectedYear && selectedMonth
			? completionHistory.months[selectedYear]?.[selectedMonth]
			: null

	return (
		<div className="user-landing-overview">
			<ProfileAbout bio={loaderData.user.bio} />
			<StatsOverview data={loaderData} />
			<section className="user-landing-completion-history-container">
				<header className="user-landing-section-heading">
					<span>Timeline</span>
					<h2>Completion History</h2>
					<p>Finished titles and progress logged during the selected month.</p>
				</header>
				{selectedRange ? (
					<>
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
						<div className="user-landing-completion-history-controls">
							<TypeSwitcher
								variant="primary"
								options={completionYears.map(year => ({
									key: year,
									label: year,
								}))}
								index={yearIndex}
								onIndexChange={setYearIndex}
							/>
							<div className="user-landing-selection-secondary-nav-container">
								<Spacer size="4xs" />
								<TypeSwitcher
									variant="secondary"
									options={completionMonths.map(month => ({
										key: month,
										label: getMonthName(month),
									}))}
									index={monthIndex}
									onIndexChange={setMonthIndex}
								/>
							</div>
						</div>
					</>
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
