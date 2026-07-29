import {
	data as json,
	Form,
	Link,
	type ActionFunctionArgs,
	type LoaderFunctionArgs,
	type MetaFunction,
	useLoaderData,
} from 'react-router'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import {
	displayCalendarDay,
	ReleaseCalendarItem,
	releaseCalendarKindLabels,
} from '#app/components/release-calendar-item.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Input } from '#app/components/ui/input.tsx'
import { Label } from '#app/components/ui/label.tsx'
import { VeudPage, VeudPageHeader } from '#app/components/ui/veud-layout.tsx'
import { getUserId } from '#app/utils/auth.server.ts'
import { getHints } from '#app/utils/client-hints.tsx'
import {
	getReleaseCalendar,
	parseReleaseCalendarQuery,
	releaseCalendarDayPreviewLimit,
	type ReleaseCalendarQuery,
} from '#app/utils/release-calendar.server.ts'
import {
	loadReleaseCalendarOrUnavailable,
	releaseReminderAction,
} from './calendar.server.ts'

function calendarHref(filters: ReleaseCalendarQuery, start: string) {
	const search = new URLSearchParams({
		start,
		kind: filters.kind,
		scope: filters.scope,
	})
	return `/calendar?${search.toString()}`
}

function calendarDayHref(filters: ReleaseCalendarQuery, date: string) {
	const search = new URLSearchParams({
		kind: filters.kind,
		scope: filters.scope,
		week: filters.start,
	})
	return `/calendar/${date}?${search.toString()}`
}

function calendarExportHref(filters: ReleaseCalendarQuery) {
	const search = new URLSearchParams({
		start: filters.start,
		kind: filters.kind,
		scope: filters.scope,
	})
	return `/resources/calendar.ics?${search.toString()}`
}

function displayRange(start: string, end: string) {
	const startDate = new Date(`${start}T00:00:00.000Z`)
	const endDate = new Date(`${end}T00:00:00.000Z`)
	const sameYear = startDate.getUTCFullYear() === endDate.getUTCFullYear()
	return `${startDate.toLocaleDateString('en-US', {
		month: 'long',
		day: 'numeric',
		...(sameYear ? {} : { year: 'numeric' }),
		timeZone: 'UTC',
	})} – ${endDate.toLocaleDateString('en-US', {
		month: 'long',
		day: 'numeric',
		year: 'numeric',
		timeZone: 'UTC',
	})}`
}

export async function loader({ request }: LoaderFunctionArgs) {
	const viewerId = await getUserId(request)
	const timeZone = getHints(request).timeZone
	const filters = parseReleaseCalendarQuery(
		new URL(request.url).searchParams,
		new Date(),
		timeZone,
	)
	return json(
		await loadReleaseCalendarOrUnavailable(() =>
			getReleaseCalendar(filters, viewerId, timeZone, {
				dayPreviewLimit: releaseCalendarDayPreviewLimit,
			}),
		),
	)
}

export async function action({ request }: ActionFunctionArgs) {
	return releaseReminderAction(request)
}

export default function ReleaseCalendarRoute() {
	const data = useLoaderData<typeof loader>()
	const filterKey = `${data.filters.start}:${data.filters.kind}:${data.filters.scope}`

	return (
		<VeudPage>
			<VeudPageHeader
				eyebrow="What’s next"
				title="Release calendar"
				actions={
					<div className="space-y-3 sm:text-right">
						<div className="text-lg font-black text-veud-yellow">
							{displayRange(data.start, data.end)}
						</div>
						<div className="text-sm font-semibold text-veud-mint">
							{data.total} scheduled {data.total === 1 ? 'release' : 'releases'}
						</div>
						<Button asChild variant="outline" size="sm">
							<a href={calendarExportHref(data.filters)} download>
								Export this week (.ics)
							</a>
						</Button>
					</div>
				}
			/>

			<Form
				key={filterKey}
				method="get"
				className="grid gap-4 rounded-2xl border border-veud-border bg-veud-surface p-5 shadow-lg shadow-black/10 sm:grid-cols-2 lg:grid-cols-[minmax(10rem,1fr)_minmax(10rem,1fr)_minmax(10rem,1fr)_auto] lg:items-end"
			>
				<div className="space-y-2">
					<Label htmlFor="calendar-start">Week starting</Label>
					<Input
						id="calendar-start"
						name="start"
						type="date"
						defaultValue={data.filters.start}
					/>
				</div>
				<div className="space-y-2">
					<Label htmlFor="calendar-kind">Media type</Label>
					<select
						id="calendar-kind"
						name="kind"
						defaultValue={data.filters.kind}
						className="h-10 w-full rounded-xl border border-veud-border/65 bg-veud-ink/65 px-3 text-sm text-veud-cream shadow-inner shadow-black/15 focus:border-veud-mint focus:outline-none focus:ring-2 focus:ring-veud-mint/35"
					>
						{Object.entries(releaseCalendarKindLabels).map(([value, label]) => (
							<option key={value} value={value}>
								{label}
							</option>
						))}
					</select>
				</div>
				<div className="space-y-2">
					<Label htmlFor="calendar-scope">Release scope</Label>
					<select
						id="calendar-scope"
						name="scope"
						defaultValue={data.filters.scope}
						className="h-10 w-full rounded-xl border border-veud-border/65 bg-veud-ink/65 px-3 text-sm text-veud-cream shadow-inner shadow-black/15 focus:border-veud-mint focus:outline-none focus:ring-2 focus:ring-veud-mint/35"
					>
						<option value="all">All releases</option>
						{data.isSignedIn ? <option value="mine">My titles</option> : null}
					</select>
				</div>
				<Button type="submit">Show schedule</Button>
			</Form>

			<nav
				aria-label="Calendar weeks"
				className="flex flex-wrap items-center justify-between gap-3"
			>
				<Button asChild variant="outline">
					<Link to={calendarHref(data.filters, data.previousStart)}>
						← Previous week
					</Link>
				</Button>
				<Button asChild variant="ghost">
					<Link to={calendarHref(data.filters, data.todayStart)}>
						This week
					</Link>
				</Button>
				<Button asChild variant="outline">
					<Link to={calendarHref(data.filters, data.nextStart)}>
						Next week →
					</Link>
				</Button>
			</nav>

			<section
				aria-label="Weekly release schedule"
				className="relative space-y-3 before:absolute before:bottom-6 before:left-[1.15rem] before:top-6 before:w-px before:bg-veud-border/50 sm:before:left-[1.4rem] lg:before:hidden"
			>
				{data.days.map(day => (
					<section
						key={day.date}
						aria-labelledby={`calendar-day-${day.date}`}
						className={`relative ml-10 grid overflow-hidden rounded-2xl border bg-veud-surface shadow-lg shadow-black/10 sm:ml-12 lg:ml-0 lg:grid-cols-[12rem_minmax(0,1fr)] ${day.date === data.today ? 'border-veud-gold ring-1 ring-veud-gold/25' : day.totalCount ? 'border-veud-border' : 'border-veud-border/50 bg-veud-surface/65'}`}
					>
						<span
							aria-hidden="true"
							className={`absolute -left-[2.05rem] top-5 h-3 w-3 rounded-full border-2 sm:-left-[2.35rem] lg:hidden ${day.date === data.today ? 'border-veud-gold bg-veud-gold' : day.totalCount ? 'border-veud-mint bg-veud-surface' : 'border-veud-border bg-veud-ink'}`}
						/>
						<header className="flex items-center justify-between gap-3 border-b border-veud-border/70 px-4 py-3 lg:block lg:border-b-0 lg:border-r lg:px-5 lg:py-5">
							<h2
								id={`calendar-day-${day.date}`}
								className="text-lg font-[var(--veud-font-display)] font-black text-veud-yellow lg:text-xl"
							>
								{displayCalendarDay(day.date)}
							</h2>
							<div className="flex items-center gap-2 lg:mt-2">
								{day.date === data.today ? (
									<span className="rounded-full bg-veud-gold/15 px-2 py-1 text-xs font-bold text-veud-gold">
										Today
									</span>
								) : null}
								<span className="text-xs font-semibold text-veud-sage">
									{day.totalCount}{' '}
									{day.totalCount === 1 ? 'release' : 'releases'}
								</span>
							</div>
						</header>
						{day.items.length ? (
							<div className="divide-y divide-veud-border/50">
								{day.items.map(item => (
									<ReleaseCalendarItem
										key={item.id}
										item={item}
										timeZone={data.timeZone}
										isSignedIn={data.isSignedIn}
									/>
								))}
								{day.totalCount > day.items.length ? (
									<div className="p-3">
										<Button
											asChild
											variant="ghost"
											size="sm"
											className="w-full justify-center text-veud-mint"
										>
											<Link to={calendarDayHref(data.filters, day.date)}>
												View all {day.totalCount} releases →
											</Link>
										</Button>
									</div>
								) : null}
							</div>
						) : (
							<p className="flex items-center px-4 py-5 text-sm text-veud-sage">
								Nothing scheduled
							</p>
						)}
					</section>
				))}
			</section>
		</VeudPage>
	)
}

export const meta: MetaFunction = () => [
	{ title: 'Release calendar · Veud' },
	{
		name: 'description',
		content:
			'Browse upcoming movie, television, anime, and manga releases on Veud.',
	},
]

export function ErrorBoundary() {
	return <GeneralErrorBoundary />
}
