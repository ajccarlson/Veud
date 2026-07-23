import { ResponsiveWaffle } from '@nivo/waffle'
import { veudChartColors, veudNivoTheme } from '#app/utils/nivo-theme.ts'

function MyResponsiveWaffle(data: any, waffleDimensions: any) {
	return (
		<div className="user-landing-stats-waffle-chart">
			<ResponsiveWaffle
				colors={veudChartColors}
				theme={veudNivoTheme}
				data={data}
				total={100}
				rows={waffleDimensions.x}
				columns={waffleDimensions.y}
				padding={1}
				valueFormat=".2f"
				margin={{ top: 10, right: 10, bottom: 10, left: 120 }}
				tooltip={(point: any) => {
					// console.log(point)
					return (
						<div
							style={{
								background: 'black',
								color: point.data.color,
								padding: '9px 12px',
								border: '1px solid #ccc',
							}}
						>
							<div>{`${point.data.label}: ${point.data.data.total}`}</div>
							<center>{`(${point.data.formattedValue}%)`}</center>
						</div>
					)
				}}
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

export function watchlistOverview(loaderData: any, listType: any) {
	const summary = loaderData.trackingSummaries?.[listType.id] ?? {
		totalTitles: 0,
		meanScore: null,
		progress: [],
		statuses: [],
	}
	const totalTitles = Number.isFinite(summary.totalTitles)
		? Math.max(0, summary.totalTitles)
		: 0
	const statuses = Array.isArray(summary.statuses)
		? summary.statuses.filter(
				(status: any) =>
					status &&
					typeof status.key === 'string' &&
					typeof status.label === 'string' &&
					Number.isFinite(status.count) &&
					status.count > 0,
			)
		: []
	const waffleData = statuses.map((status: any) => ({
		id: status.key,
		label: status.label,
		value: totalTitles ? (status.count / totalTitles) * 100 : 0,
		total: status.count,
	}))
	const smallestPercentage = Math.min(
		100,
		...waffleData.map((status: any) => status.value),
	)
	const waffleSide = Math.min(
		20,
		Math.max(10, Math.ceil(Math.sqrt(100 / smallestPercentage))),
	)
	const meanScore =
		typeof summary.meanScore === 'number' && Number.isFinite(summary.meanScore)
			? summary.meanScore.toFixed(2)
			: 'N/A'
	const completed = completionLabel(listType.completionType)
	const progress = Array.isArray(summary.progress)
		? summary.progress.filter(
				(item: any) =>
					item &&
					typeof item.unit === 'string' &&
					Number.isFinite(item.current) &&
					item.current > 0,
			)
		: []

	return (
		<div className="user-landing-stats-chart-container user-landing-stats-waffle-chart-container">
			<div className="user-landing-stats-waffle-chart-text-container">
				<div className="user-landing-stats-waffle-chart-text-left">
					<span>{`Total Entries: ${totalTitles}`}</span>
				</div>
				<div className="user-landing-stats-waffle-chart-text-right">
					{`Mean Score: ${meanScore}`}
					<div>
						{progress.map((item: any) => (
							<div key={item.unit}>
								<span>
									{`${item.current} ${progressUnitLabel(item.unit)} ${completed}`}
								</span>
							</div>
						))}
					</div>
				</div>
			</div>
			{MyResponsiveWaffle(waffleData, {
				x: waffleSide,
				y: waffleSide,
			})}
		</div>
	)
}

export function WatchlistChart({ data, listType }: any) {
	return watchlistOverview(data, listType)
}
