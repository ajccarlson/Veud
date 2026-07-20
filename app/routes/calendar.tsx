import {
	data as json,
	Form,
	Link,
	type LoaderFunctionArgs,
	type MetaFunction,
	useLoaderData,
} from 'react-router'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Label } from '#app/components/ui/label.tsx'
import { getUserId } from '#app/utils/auth.server.ts'
import {
	getReleaseCalendar,
	parseReleaseCalendarQuery,
	type ReleaseCalendarQuery,
} from '#app/utils/release-calendar.server.ts'

const kindLabels: Record<ReleaseCalendarQuery['kind'], string> = {
	all: 'All media',
	movie: 'Movies',
	tv: 'TV',
	anime: 'Anime',
	manga: 'Manga',
}

function calendarHref(filters: ReleaseCalendarQuery, start: string) {
	const search = new URLSearchParams({
		start,
		kind: filters.kind,
		scope: filters.scope,
	})
	return `/calendar?${search.toString()}`
}

function displayDay(value: string) {
	return new Date(`${value}T00:00:00.000Z`).toLocaleDateString('en-US', {
		weekday: 'long',
		month: 'short',
		day: 'numeric',
		timeZone: 'UTC',
	})
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

function displayTime(value: Date | string, allDay: boolean) {
	if (allDay) return 'All day'
	return new Date(value).toLocaleTimeString('en-US', {
		hour: 'numeric',
		minute: '2-digit',
		timeZone: 'UTC',
		timeZoneName: 'short',
	})
}

export async function loader({ request }: LoaderFunctionArgs) {
	const viewerId = await getUserId(request)
	const filters = parseReleaseCalendarQuery(new URL(request.url).searchParams)
	return json(await getReleaseCalendar(filters, viewerId))
}

export default function ReleaseCalendarRoute() {
	const data = useLoaderData<typeof loader>()
	const filterKey = `${data.filters.start}:${data.filters.kind}:${data.filters.scope}`

	return (
		<main className="mx-auto w-full max-w-7xl space-y-7 px-4 py-8 text-[#ffefcc] sm:px-6 lg:px-8">
			<header className="flex flex-wrap items-end justify-between gap-5">
				<div className="max-w-3xl space-y-2">
					<p className="text-sm font-bold uppercase tracking-[0.2em] text-[#a2ffd5]">
						What’s next
					</p>
					<h1 className="text-4xl font-black text-[#ff9900]">
						Release calendar
					</h1>
					<p className="text-base leading-7 text-[#c6ded2]">
						Premieres and upcoming episodes from Veud’s canonical catalog. Times
						and date boundaries are shown in UTC.
					</p>
				</div>
				<div className="text-right">
					<div className="text-lg font-black text-[#ffffb1]">
						{displayRange(data.start, data.end)}
					</div>
					<div className="text-sm text-[#a2ffd5]">
						{data.total} scheduled {data.total === 1 ? 'release' : 'releases'}
					</div>
				</div>
			</header>

			<Form
				key={filterKey}
				method="get"
				className="grid gap-4 rounded-2xl border border-[#54806c] bg-[#383040] p-5 sm:grid-cols-2 lg:grid-cols-[minmax(10rem,1fr)_minmax(10rem,1fr)_minmax(10rem,1fr)_auto] lg:items-end"
			>
				<div className="space-y-2">
					<Label htmlFor="calendar-start">Week starting</Label>
					<input
						id="calendar-start"
						name="start"
						type="date"
						defaultValue={data.filters.start}
						className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
				</div>
				<div className="space-y-2">
					<Label htmlFor="calendar-kind">Media type</Label>
					<select
						id="calendar-kind"
						name="kind"
						defaultValue={data.filters.kind}
						className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						{Object.entries(kindLabels).map(([value, label]) => (
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
						className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
				className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3"
			>
				{data.days.map(day => (
					<section
						key={day.date}
						aria-labelledby={`calendar-day-${day.date}`}
						className={`overflow-hidden rounded-2xl border bg-[#383040] ${day.date === data.today ? 'border-[#ffcc66]' : 'border-[#54806c]'}`}
					>
						<header className="flex items-center justify-between border-b border-[#54806c] px-4 py-3">
							<h2
								id={`calendar-day-${day.date}`}
								className="text-lg font-black text-[#ffffb1]"
							>
								{displayDay(day.date)}
							</h2>
							{day.date === data.today ? (
								<span className="rounded-full bg-[#ffcc66]/15 px-2 py-1 text-xs font-bold text-[#ffcc66]">
									Today
								</span>
							) : null}
						</header>
						{day.items.length ? (
							<div className="divide-y divide-[#54806c]/60">
								{day.items.map(item => (
									<article key={item.id} className="flex gap-3 p-4">
										<Link
											to={`/media/${item.mediaId}`}
											className="h-24 w-16 shrink-0 overflow-hidden rounded-lg bg-[#2e2f2b]"
										>
											{item.imageUrl ? (
												<img
													src={item.imageUrl}
													alt=""
													loading="lazy"
													className="h-full w-full object-cover"
												/>
											) : (
												<span className="flex h-full items-center justify-center px-2 text-center text-[0.65rem] text-[#8ca99d]">
													No poster
												</span>
											)}
										</Link>
										<div className="min-w-0 flex-1">
											<div className="text-xs font-bold uppercase tracking-wide text-[#a2ffd5]">
												{displayTime(item.releaseAt, item.allDay)} ·{' '}
												{item.type ||
													kindLabels[
														item.kind as ReleaseCalendarQuery['kind']
													] ||
													item.kind}
											</div>
											<Link
												to={`/media/${item.mediaId}`}
												className="mt-1 block font-black leading-5 text-[#ffffb1] hover:underline"
											>
												{item.title}
											</Link>
											<div className="mt-1 text-sm font-semibold text-[#ffcc66]">
												{item.eventLabel}
											</div>
											{item.eventName ? (
												<div className="line-clamp-2 text-xs text-[#c6ded2]">
													{item.eventName}
												</div>
											) : null}
											<div className="mt-2 flex flex-wrap gap-1.5 text-[0.7rem] text-[#a2ffd5]">
												{item.viewerTracking ? (
													<span className="rounded-full bg-[#a2ffd5]/10 px-2 py-0.5 font-bold text-[#a2ffd5]">
														{item.viewerTracking.statusLabel}
														{item.viewerTracking.score !== null
															? ` · ${item.viewerTracking.score.toLocaleString('en-US', { maximumFractionDigits: 1 })}/10`
															: ''}
													</span>
												) : null}
												<span className="rounded-full bg-[#2e2f2b] px-2 py-0.5">
													{item.trackerCount}{' '}
													{item.trackerCount === 1 ? 'member' : 'members'}{' '}
													tracking
												</span>
											</div>
										</div>
									</article>
								))}
							</div>
						) : (
							<p className="px-4 py-8 text-center text-sm text-[#8ca99d]">
								No scheduled releases
							</p>
						)}
					</section>
				))}
			</section>
		</main>
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
