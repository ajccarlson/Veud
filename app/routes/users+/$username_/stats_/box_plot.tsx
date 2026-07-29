import { useId } from 'react'
import { ProfileChartDataTable } from '#app/routes/users+/$username_/stats_/visualization-boundary.tsx'
import { veudChartColors } from '#app/utils/nivo-theme.ts'
import {
	type ProfileAnalyticsResult,
	type ProfileObjectiveScoreSummary,
	type ProfileObjectiveScores,
} from '#app/utils/profile-analytics.ts'
import { type ListTypeMeta } from '#app/utils/profile.ts'

const WIDTH = 840
const HEIGHT = 440
const LEFT = 64
const RIGHT = 816
const TOP = 32
const BOTTOM = 380

function xPosition(score: number) {
	return LEFT + ((score - 1) / 9) * (RIGHT - LEFT)
}

function yPosition(score: number) {
	return BOTTOM - ((score - 1) / 9) * (BOTTOM - TOP)
}

function sourceLabel(source: ProfileObjectiveScores['source']) {
	if (source === 'tmdbScore') return 'TMDB'
	if (source === 'malScore') return 'MAL'
	return 'Objective'
}

function summaryLabel(
	summary: ProfileObjectiveScoreSummary,
	source: ProfileObjectiveScores['source'],
) {
	return `${sourceLabel(source)} score ${summary.score}: ${summary.count} paired ${summary.count === 1 ? 'rating' : 'ratings'}, personal median ${summary.median.toFixed(1)}, mean ${summary.mean.toFixed(1)}, range ${summary.min.toFixed(1)} to ${summary.max.toFixed(1)}`
}

export function renderBoxPlotChart(
	data: Pick<ProfileAnalyticsResult, 'objectiveScores'>,
	listType: ListTypeMeta | undefined,
	titleId = 'profile-objective-score-chart',
) {
	const scores = listType ? data.objectiveScores[listType.id] : undefined
	if (!scores?.groups.length) {
		return (
			<div
				className="user-landing-stats-chart-container user-landing-stats-box-plot-chart"
				role="status"
			>
				No paired personal and public scores yet.
			</div>
		)
	}

	const provider = sourceLabel(scores.source)

	return (
		<div className="user-landing-stats-chart-container user-landing-stats-box-plot-chart">
			<svg
				viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
				width="100%"
				height="100%"
				role="img"
				aria-labelledby={titleId}
				preserveAspectRatio="xMidYMid meet"
			>
				<title id={titleId}>
					{`Personal score distribution by ${provider} score`}
				</title>

				{Array.from({ length: 10 }, (_, index) => index + 1).map(score => {
					const y = yPosition(score)
					return (
						<g key={`y-${score}`}>
							<line
								x1={LEFT}
								x2={RIGHT}
								y1={y}
								y2={y}
								stroke="rgba(255, 255, 255, 0.1)"
							/>
							<text
								x={LEFT - 14}
								y={y + 4}
								textAnchor="end"
								fill="#FFEFCC"
								fontSize="12"
							>
								{score}
							</text>
						</g>
					)
				})}

				<line x1={LEFT} x2={RIGHT} y1={BOTTOM} y2={BOTTOM} stroke="#6F6F6F" />
				<line x1={LEFT} x2={LEFT} y1={TOP} y2={BOTTOM} stroke="#6F6F6F" />

				{Array.from({ length: 10 }, (_, index) => index + 1).map(score => {
					const x = xPosition(score)
					return (
						<g key={`x-${score}`}>
							<line
								x1={x}
								x2={x}
								y1={BOTTOM}
								y2={BOTTOM + 5}
								stroke="#6F6F6F"
							/>
							<text
								x={x}
								y={BOTTOM + 22}
								textAnchor="middle"
								fill="#FFEFCC"
								fontSize="12"
							>
								{score}
							</text>
						</g>
					)
				})}

				<text
					x={(LEFT + RIGHT) / 2}
					y={HEIGHT - 10}
					textAnchor="middle"
					fill="#dbffcc"
					fontSize="13"
				>
					{`${provider} score`}
				</text>
				<text
					x="14"
					y={(TOP + BOTTOM) / 2}
					textAnchor="middle"
					fill="#dbffcc"
					fontSize="13"
					transform={`rotate(-90 14 ${(TOP + BOTTOM) / 2})`}
				>
					Personal score
				</text>

				{scores.groups.map((summary, index) => {
					const x = xPosition(summary.score)
					const minY = yPosition(summary.min)
					const q1Y = yPosition(summary.q1)
					const medianY = yPosition(summary.median)
					const q3Y = yPosition(summary.q3)
					const maxY = yPosition(summary.max)
					const meanY = yPosition(summary.mean)
					const color = veudChartColors[index % veudChartColors.length]
					const boxWidth = 38

					return (
						<g
							key={summary.score}
							tabIndex={0}
							role="img"
							aria-label={summaryLabel(summary, scores.source)}
						>
							<title>{summaryLabel(summary, scores.source)}</title>
							<line
								x1={x}
								x2={x}
								y1={maxY}
								y2={minY}
								stroke={color}
								strokeWidth="2"
							/>
							<line
								x1={x - boxWidth / 3}
								x2={x + boxWidth / 3}
								y1={maxY}
								y2={maxY}
								stroke={color}
								strokeWidth="2"
							/>
							<line
								x1={x - boxWidth / 3}
								x2={x + boxWidth / 3}
								y1={minY}
								y2={minY}
								stroke={color}
								strokeWidth="2"
							/>
							<rect
								x={x - boxWidth / 2}
								y={q3Y}
								width={boxWidth}
								height={Math.max(2, q1Y - q3Y)}
								fill={color}
								fillOpacity="0.72"
								stroke={color}
								strokeWidth="2"
								rx="3"
							/>
							<line
								x1={x - boxWidth / 2}
								x2={x + boxWidth / 2}
								y1={medianY}
								y2={medianY}
								stroke="#2e2f2b"
								strokeWidth="3"
							/>
							<circle
								cx={x}
								cy={meanY}
								r="4"
								fill="#FFEFCC"
								stroke="#2e2f2b"
								strokeWidth="1.5"
							/>
						</g>
					)
				})}
			</svg>
			<ProfileChartDataTable
				label={`Personal score distribution by ${provider} score values`}
				columns={[
					`${provider} score`,
					'Ratings',
					'Minimum',
					'Lower quartile',
					'Median',
					'Upper quartile',
					'Maximum',
					'Mean',
				]}
				rows={scores.groups.map(summary => ({
					key: String(summary.score),
					cells: [
						summary.score,
						summary.count,
						summary.min,
						summary.q1,
						summary.median,
						summary.q3,
						summary.max,
						summary.mean,
					],
				}))}
			/>
		</div>
	)
}

export function BoxPlotChart({
	data,
	listType,
}: {
	data: Pick<ProfileAnalyticsResult, 'objectiveScores'>
	listType?: ListTypeMeta
}) {
	const titleId = useId()
	return renderBoxPlotChart(data, listType, titleId)
}
