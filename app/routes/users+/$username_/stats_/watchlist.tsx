import { ResponsiveWaffle } from '@nivo/waffle'
import { ProfileChartDataTable } from '#app/routes/users+/$username_/stats_/visualization-boundary.tsx'
import { veudChartColors, veudNivoTheme } from '#app/utils/nivo-theme.ts'
import {
	compactProfileStatuses,
	type ListTypeMeta,
	type ProfileStatsData,
} from '#app/utils/profile.ts'

type WaffleDatum = {
	id: string
	label: string
	value: number
	total: number
}

type WatchlistStatus = {
	key: string
	label: string
	count: number
}

export function aggregateWatchlistStatuses(
	statuses: readonly WatchlistStatus[],
) {
	return compactProfileStatuses(statuses)
}

function MyResponsiveWaffle(data: WaffleDatum[], waffleSide: number) {
	return (
		<div className="user-landing-stats-waffle-chart">
			<ResponsiveWaffle<WaffleDatum>
				colors={veudChartColors}
				theme={veudNivoTheme}
				data={data}
				total={100}
				rows={waffleSide}
				columns={waffleSide}
				padding={1}
				valueFormat=".2f"
				margin={{ top: 10, right: 10, bottom: 10, left: 120 }}
				tooltip={point => (
					<div
						style={{
							background: 'black',
							color: point.data.color,
							padding: '9px 12px',
							border: '1px solid #ccc',
						}}
					>
						<div>{`${point.data.label}: ${point.data.data.total}`}</div>
						<div>{`${point.data.formattedValue}%`}</div>
					</div>
				)}
				borderRadius={3}
				borderColor={{
					from: 'color',
					modifiers: [['darker', 0.3]],
				}}
				motionStagger={2}
				legends={[
					{
						anchor: 'top-left',
						direction: 'column',
						justify: false,
						translateX: -100,
						translateY: 0,
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
								style: {
									itemTextColor: '#66563d',
								},
							},
						],
					},
				]}
				role="img"
				ariaLabel="Watchlist status distribution"
			/>
			<ProfileChartDataTable
				label="Watchlist status distribution values"
				columns={['Status', 'Titles', 'Percent']}
				rows={data.map(status => ({
					key: status.id,
					cells: [status.label, status.total, `${status.value.toFixed(2)}%`],
				}))}
			/>
		</div>
	)
}

function completionLabel(value: unknown) {
	if (typeof value !== 'string') return 'Completed'
	try {
		const parsed = JSON.parse(value) as unknown
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			const past = (parsed as Record<string, unknown>).past
			if (typeof past === 'string' && past.trim()) return titleCase(past)
		}
	} catch {
		if (value.trim() && !value.trim().startsWith('{')) return titleCase(value)
	}
	return 'Completed'
}

function titleCase(value: string) {
	return value
		.replace(/([a-z])([A-Z])/g, '$1 $2')
		.replace(/[-_]+/g, ' ')
		.replace(/\b\w/g, character => character.toUpperCase())
}

function progressUnitLabel(unit: string) {
	const normalized = titleCase(unit)
	return /s$/i.test(normalized) ? normalized : `${normalized}s`
}

export function watchlistOverview(
	loaderData: Pick<ProfileStatsData, 'trackingSummaries'>,
	listType: ListTypeMeta | undefined,
) {
	if (!listType) {
		return (
			<div
				className="user-landing-stats-chart-container user-landing-stats-waffle-chart-container"
				role="status"
			>
				No watchlist data yet.
			</div>
		)
	}

	const summary = loaderData.trackingSummaries[listType.id] ?? {
		totalTitles: 0,
		meanScore: null,
		repeatCount: 0,
		progress: [],
		statuses: [],
	}
	const totalTitles = Math.max(0, summary.totalTitles)
	const statuses = aggregateWatchlistStatuses(summary.statuses)
	const waffleData: WaffleDatum[] = statuses.map(status => ({
		id: status.key,
		label: status.label,
		value: totalTitles ? (status.count / totalTitles) * 100 : 0,
		total: status.count,
	}))
	const smallestPercentage = Math.min(
		100,
		...waffleData.map(status => status.value),
	)
	const waffleSide = Math.min(
		20,
		Math.max(10, Math.ceil(Math.sqrt(100 / smallestPercentage))),
	)
	const meanScore = summary.meanScore?.toFixed(2) ?? 'N/A'
	const completed = completionLabel(listType.completionType)
	const progress = summary.progress.filter(item => item.current > 0)

	return (
		<div className="user-landing-stats-chart-container user-landing-stats-waffle-chart-container">
			<div className="user-landing-stats-waffle-chart-text-container">
				<div className="user-landing-stats-waffle-chart-text-left">
					<span>{`Total Entries: ${totalTitles}`}</span>
				</div>
				<div className="user-landing-stats-waffle-chart-text-right">
					{`Mean Score: ${meanScore}`}
					<div>
						{progress.map(item => (
							<div key={item.unit}>
								<span>
									{`${item.current} ${progressUnitLabel(item.unit)} ${completed}`}
								</span>
							</div>
						))}
					</div>
				</div>
			</div>
			{waffleData.length ? (
				MyResponsiveWaffle(waffleData, waffleSide)
			) : (
				<div className="user-landing-stats-waffle-chart" role="status">
					No status data yet.
				</div>
			)}
		</div>
	)
}

export function WatchlistChart({
	data,
	listType,
}: {
	data: Pick<ProfileStatsData, 'trackingSummaries'>
	listType?: ListTypeMeta
}) {
	return watchlistOverview(data, listType)
}
