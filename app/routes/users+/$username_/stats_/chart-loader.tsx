import {
	lazy,
	Suspense,
	type ComponentType,
	type LazyExoticComponent,
} from 'react'
import {
	ProfileVisualizationBoundary,
	ProfileVisualizationLoading,
} from './visualization-boundary.tsx'

export type ProfileChartKey =
	| 'watchlist'
	| 'listTypeDistribution'
	| 'score'
	| 'objectiveScores'
	| 'release'
	| 'watched'
	| 'genreChords'
	| 'type'

type ChartModuleProps = {
	data: any
	listType?: any
	mode?: 'release' | 'watched'
}

const WatchlistChart = lazy(() =>
	import('./watchlist.tsx').then(module => ({
		default: module.WatchlistChart,
	})),
)
const PieChart = lazy(() =>
	import('./pie.tsx').then(module => ({ default: module.PieChart })),
)
const BarChart = lazy(() =>
	import('./bar.tsx').then(module => ({ default: module.BarChart })),
)
const BoxPlotChart = lazy(() =>
	import('./box_plot.tsx').then(module => ({
		default: module.BoxPlotChart,
	})),
)
const LineChart = lazy(() =>
	import('./line.tsx').then(module => ({ default: module.LineChart })),
)
const ChordChart = lazy(() =>
	import('./chord.tsx').then(module => ({ default: module.ChordChart })),
)
const RadialBarChart = lazy(() =>
	import('./radial_bar.tsx').then(module => ({
		default: module.RadialBarChart,
	})),
)

const CHART_MODULES: Record<
	ProfileChartKey,
	LazyExoticComponent<ComponentType<ChartModuleProps>>
> = {
	watchlist: WatchlistChart,
	listTypeDistribution: PieChart,
	score: BarChart,
	objectiveScores: BoxPlotChart,
	release: LineChart,
	watched: LineChart,
	genreChords: ChordChart,
	type: RadialBarChart,
}

export function ProfileChart({
	chartKey,
	label,
	data,
	listType,
}: {
	chartKey: ProfileChartKey
	label: string
	data: any
	listType?: any
}) {
	const Chart = CHART_MODULES[chartKey]
	const mode =
		chartKey === 'release' || chartKey === 'watched' ? chartKey : undefined

	return (
		<ProfileVisualizationBoundary key={`${chartKey}:${listType?.id ?? 'all'}`}>
			<Suspense fallback={<ProfileVisualizationLoading label={label} />}>
				<Chart data={data} listType={listType} mode={mode} />
			</Suspense>
		</ProfileVisualizationBoundary>
	)
}
