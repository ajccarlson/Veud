// @vitest-environment jsdom

import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { expect, test } from 'vitest'
import { overviewDiagnosticText } from '#app/routes/users+/$username.index.tsx'
import { RecentActivityData } from '#app/routes/users+/$username_/body.tsx'
import {
	buildScoreBarSeries,
	renderBarChart,
	scoreSeriesLabel,
} from '#app/routes/users+/$username_/stats_/bar.tsx'
import { renderBoxPlotChart } from '#app/routes/users+/$username_/stats_/box_plot.tsx'
import {
	CompletionHistoryChart,
	utcCalendarDayLabel,
} from '#app/routes/users+/$username_/stats_/calendar.tsx'
import { renderChordChart } from '#app/routes/users+/$username_/stats_/chord.tsx'
import {
	firstPopulatedListTypeIndex,
	StatsData,
	statsDiagnosticText,
} from '#app/routes/users+/$username_/stats_/index.tsx'
import {
	buildProfileLineSeries,
	PROFILE_YEAR_LINE_SCALE,
	renderLineChart,
} from '#app/routes/users+/$username_/stats_/line.tsx'
import { renderPieChart } from '#app/routes/users+/$username_/stats_/pie.tsx'
import {
	mediaTypeCategoryLabel,
	renderRadialBar,
} from '#app/routes/users+/$username_/stats_/radial_bar.tsx'
import {
	aggregateWatchlistStatuses,
	watchlistOverview,
} from '#app/routes/users+/$username_/stats_/watchlist.tsx'
import {
	PROFILE_COMPONENT_SCORE_FIELDS,
	type ProfileAnalyticsDiagnostic,
	type ProfileComponentScoreField,
	type ProfileProviderScoreField,
	type ProfileScoreBuckets,
} from '#app/utils/profile-analytics.ts'
import {
	type ListTypeMeta,
	type ProfileActivityData,
	type ProfileShellData,
	type ProfileStatsData,
} from '#app/utils/profile.ts'

const liveActionType: ListTypeMeta = {
	id: 'live',
	name: 'liveaction',
	header: 'Live Action',
	columns: '{"tmdbScore":"number"}',
	mediaType: '["episode"]',
	completionType: '{"past":"watched"}',
}

const animeType: ListTypeMeta = {
	id: 'anime',
	name: 'anime',
	header: 'Anime',
	columns: '{"malScore":"number"}',
	mediaType: '["episode"]',
	completionType: '{"past":"watched"}',
}

function emptyScoreBucket(): ProfileScoreBuckets {
	return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
}

function componentBuckets() {
	return Object.fromEntries(
		PROFILE_COMPONENT_SCORE_FIELDS.map(field => [field, emptyScoreBucket()]),
	) as Record<ProfileComponentScoreField, ProfileScoreBuckets>
}

function providerBuckets() {
	return {
		tmdbScore: emptyScoreBucket(),
		malScore: emptyScoreBucket(),
	} satisfies Record<ProfileProviderScoreField, ProfileScoreBuckets>
}

function diagnostic(
	overrides: Partial<ProfileAnalyticsDiagnostic> = {},
): ProfileAnalyticsDiagnostic {
	return {
		processed: 12,
		truncated: false,
		limit: 100_000,
		completionDaysTruncated: false,
		categoryCandidatesApproximate: false,
		categoryCandidatesTruncated: false,
		historyEntriesRejected: 0,
		historyFinishEventsTruncated: 0,
		watchlistsProcessed: 2,
		watchlistsTruncated: false,
		watchlistLimit: 100,
		...overrides,
	}
}

function profileStatsData({
	userId,
	listTypeCounts,
}: {
	userId: string
	listTypeCounts: Record<string, number>
}): Pick<ProfileShellData, 'listTypes' | 'user'> & ProfileStatsData {
	return {
		user: {
			id: userId,
			username: userId,
			bio: null,
			createdAt: '2025-01-01T00:00:00.000Z',
			image: null,
			banner: null,
		},
		listTypes: [liveActionType, animeType],
		trackingSummaries: {},
		listTypeCounts,
		scoreBuckets: {},
		providerScoreBuckets: {},
		objectiveScores: {},
		releaseYears: {},
		completionYears: {},
		genreMatrices: {},
		mediaTypeCounts: {},
		diagnostic: diagnostic(),
	}
}

test('starts Stats on the first populated media type', () => {
	expect(
		firstPopulatedListTypeIndex([liveActionType, animeType], {
			live: 0,
			anime: 20,
		}),
	).toBe(1)
	expect(
		firstPopulatedListTypeIndex([liveActionType, animeType], {
			live: 0,
			anime: 0,
		}),
	).toBe(0)
})

test('Stats preserves an intentional selection within a profile and resets it during profile navigation', () => {
	const view = render(
		<StatsData
			data={profileStatsData({
				userId: 'profile-a',
				listTypeCounts: { live: 0, anime: 20 },
			})}
		/>,
	)

	expect(screen.getByRole('button', { name: 'Anime' })).toHaveAttribute(
		'aria-pressed',
		'true',
	)
	fireEvent.click(screen.getByRole('button', { name: 'Live Action' }))
	expect(screen.getByRole('button', { name: 'Live Action' })).toHaveAttribute(
		'aria-pressed',
		'true',
	)

	view.rerender(
		<StatsData
			data={profileStatsData({
				userId: 'profile-a',
				listTypeCounts: { live: 1, anime: 21 },
			})}
		/>,
	)
	expect(screen.getByRole('button', { name: 'Live Action' })).toHaveAttribute(
		'aria-pressed',
		'true',
	)

	view.rerender(
		<StatsData
			data={profileStatsData({
				userId: 'profile-b',
				listTypeCounts: { live: 0, anime: 4 },
			})}
		/>,
	)
	expect(screen.getByRole('button', { name: 'Anime' })).toHaveAttribute(
		'aria-pressed',
		'true',
	)
})

test('reports only the relevant partial-profile diagnostics', () => {
	expect(overviewDiagnosticText(diagnostic())).toBe('')
	expect(
		overviewDiagnosticText(
			diagnostic({
				truncated: true,
				completionDaysTruncated: true,
				historyEntriesRejected: 1,
			}),
		),
	).toBe(
		' Partial data: entry limit reached; completion timeline limited; some history could not be fully read.',
	)

	expect(statsDiagnosticText(diagnostic())).toBe('')
	expect(
		statsDiagnosticText(
			diagnostic({
				watchlistsTruncated: true,
				historyFinishEventsTruncated: 1,
				categoryCandidatesApproximate: true,
				categoryCandidatesTruncated: true,
			}),
		),
	).toBe(
		' Partial data: watchlist limit reached; some history could not be fully read; category groups are approximate; category groups are limited.',
	)
})

test('adds only the applicable provider score series with clear labels', () => {
	const components = componentBuckets()
	components.personal[7] = 2
	const providers = providerBuckets()
	providers.tmdbScore[8] = 7
	providers.malScore[8] = 3

	const result = buildScoreBarSeries(
		{
			scoreBuckets: { anime: components },
			providerScoreBuckets: { anime: providers },
		},
		animeType,
	)

	expect(result.barKeys).toEqual(['personal', 'malScore'])
	expect(result.scoreBars[7]).toMatchObject({ score: 8, personal: 2 })
	expect(result.scoreBars[8]).toMatchObject({ score: 9, malScore: 3 })
	expect(scoreSeriesLabel('tmdbScore')).toBe('TMDB Score')
	expect(scoreSeriesLabel('malScore')).toBe('MAL Score')
})

test('charts return useful empty states when no media type is selected', () => {
	render(
		renderBarChart(
			{
				scoreBuckets: {},
				providerScoreBuckets: {},
			},
			undefined,
		),
	)
	expect(screen.getByRole('status')).toHaveTextContent('No scores yet.')
})

test('watchlist chart handles an undefined media type', () => {
	render(watchlistOverview({ trackingSummaries: {} }, undefined))
	expect(screen.getByRole('status')).toHaveTextContent('No watchlist data yet.')
})

test('media-type chart handles empty data and distinguishes its rollup', () => {
	render(renderRadialBar({ listTypes: [], mediaTypeCounts: {} }))
	expect(screen.getByRole('status')).toHaveTextContent(
		'No media type data yet.',
	)
	expect(
		mediaTypeCategoryLabel({
			key: '__veud_category_rollup__',
			label: 'Other',
			isRollup: true,
		}),
	).toBe('All other types')
	expect(
		mediaTypeCategoryLabel({
			key: '__veud_category_rollup__',
			label: 'Other',
		}),
	).toBe('Other')
	expect(mediaTypeCategoryLabel({ key: 'other', label: 'Other' })).toBe('Other')
})

test('line chart keeps every disjoint media series in chronological numeric order', () => {
	const data = {
		listTypes: [liveActionType, animeType],
		releaseYears: {
			live: [
				{ year: 2030, count: 1 },
				{ year: 1984, count: 2 },
			],
			anime: [
				{ year: 2025, count: 3 },
				{ year: 1997, count: 4 },
			],
		},
		completionYears: {},
	}
	const series = buildProfileLineSeries(data, 'release')

	expect(PROFILE_YEAR_LINE_SCALE.type).toBe('linear')
	expect(series).toEqual([
		{
			id: 'Live Action',
			data: [
				{ x: 1984, y: 2 },
				{ x: 2030, y: 1 },
			],
		},
		{
			id: 'Anime',
			data: [
				{ x: 1997, y: 4 },
				{ x: 2025, y: 3 },
			],
		},
	])

	render(renderLineChart(data, 'release'))
	const table = screen.getByRole('table', {
		name: 'Release year distribution values',
	})
	expect(within(table).getByText('1984')).toBeInTheDocument()
	expect(within(table).getByText('2030')).toBeInTheDocument()
})

test('profile charts expose their plotted values as accessible tables', () => {
	const components = componentBuckets()
	components.personal[7] = 2
	const providers = providerBuckets()
	providers.malScore[8] = 3
	const view = render(
		renderBarChart(
			{
				scoreBuckets: { anime: components },
				providerScoreBuckets: { anime: providers },
			},
			animeType,
		),
	)
	let table = screen.getByRole('table', {
		name: 'Score distribution values',
	})
	expect(within(table).getByText('Personal')).toBeInTheDocument()
	expect(within(table).getByText('MAL Score')).toBeInTheDocument()

	view.rerender(
		renderPieChart({
			listTypes: [liveActionType, animeType],
			listTypeCounts: { live: 3, anime: 5 },
		}),
	)
	table = screen.getByRole('table', {
		name: 'List type distribution values',
	})
	expect(within(table).getByText('Live Action')).toBeInTheDocument()
	expect(within(table).getByText('5')).toBeInTheDocument()

	view.rerender(
		renderRadialBar({
			listTypes: [animeType],
			mediaTypeCounts: {
				anime: [
					{ key: 'other', label: 'Other', count: 4 },
					{
						key: '__veud_category_rollup__',
						label: 'Other',
						count: 2,
						isRollup: true,
					},
				],
			},
		}),
	)
	table = screen.getByRole('table', {
		name: 'Media type distribution values',
	})
	expect(within(table).getByText('Other')).toBeInTheDocument()
	expect(within(table).getByText('All other types')).toBeInTheDocument()

	view.rerender(
		renderChordChart(
			{
				genreMatrices: {
					anime: {
						labels: ['Action', 'Drama'],
						values: [
							[3, 2],
							[2, 4],
						],
					},
				},
			},
			animeType,
		),
	)
	table = screen.getByRole('table', { name: 'Genre overlap values' })
	expect(
		within(table).getByRole('row', { name: 'Action Drama 2' }),
	).toBeInTheDocument()

	view.rerender(
		renderBoxPlotChart(
			{
				objectiveScores: {
					anime: {
						source: 'malScore',
						groups: [
							{
								score: 8,
								count: 3,
								min: 6,
								q1: 7,
								median: 8,
								q3: 8.5,
								max: 9,
								mean: 7.8,
							},
						],
					},
				},
			},
			animeType,
		),
	)
	table = screen.getByRole('table', {
		name: 'Personal score distribution by MAL score values',
	})
	expect(
		within(table).getByRole('row', { name: '8 3 6 7 8 8.5 9 7.8' }),
	).toBeInTheDocument()

	view.rerender(
		watchlistOverview(
			{
				trackingSummaries: {
					anime: {
						totalTitles: 5,
						meanScore: 8,
						repeatCount: 0,
						progress: [],
						statuses: [
							{ key: 'watching', label: 'Watching', count: 2 },
							{ key: 'completed', label: 'Completed', count: 3 },
						],
					},
				},
			},
			animeType,
		),
	)
	table = screen.getByRole('table', {
		name: 'Watchlist status distribution values',
	})
	expect(
		within(table).getByRole('row', { name: 'Completed 3 60.00%' }),
	).toBeInTheDocument()

	view.rerender(
		<CompletionHistoryChart
			data={[{ day: '2025-01-02', value: 3 }]}
			from="2025-01-01"
			to="2025-01-31"
		/>,
	)
	table = screen.getByRole('table', { name: 'Completion history values' })
	expect(
		within(table).getByRole('row', { name: '2025-01-02 3' }),
	).toBeInTheDocument()
})

test('watchlist statuses are capped to a fixed legend with a rollup', () => {
	const statuses = Array.from({ length: 14 }, (_, index) => ({
		key: `status-${index + 1}`,
		label: `Status ${index + 1}`,
		count: index + 1,
	}))
	const visible = aggregateWatchlistStatuses(statuses)

	expect(visible).toHaveLength(12)
	expect(visible[0]).toMatchObject({ label: 'Status 14', count: 14 })
	expect(visible.at(-1)).toEqual({
		key: '__other_statuses__',
		label: 'Other statuses',
		count: 6,
	})
	expect(visible.reduce((sum, status) => sum + status.count, 0)).toBe(105)
})

test('completion calendar uses an accessible wrapper and UTC day labels', () => {
	render(<CompletionHistoryChart data={[]} from="2025-01-01" to="2025-01-31" />)
	expect(
		screen.getByRole('img', {
			name: 'Completion history calendar',
		}),
	).toBeInTheDocument()
	expect(utcCalendarDayLabel('2025-01-02')).toBe('2025-01-02')
	expect(utcCalendarDayLabel(new Date('2025-01-02T23:00:00-08:00'))).toBe(
		'2025-01-03',
	)
})

test('partial activity filters explain that only a recent window was scanned', () => {
	const data: ProfileActivityData = {
		listTypes: [liveActionType, animeType],
		activityLimited: true,
		activityEvents: [
			{
				id: 'activity-1',
				action: 'Completed',
				time: '2025-01-02T00:00:00.000Z',
				typeId: animeType.id,
				media: {
					id: 'media-1',
					title: 'Example anime',
					thumbnail: null,
				},
			},
		],
	}
	render(
		<MemoryRouter>
			<RecentActivityData data={data} />
		</MemoryRouter>,
	)

	fireEvent.click(screen.getByRole('button', { name: 'Live Action' }))
	expect(
		screen.getByText('No matches in this recent window', { exact: true }),
	).toBeInTheDocument()
})
