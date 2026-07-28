import {
	data as json,
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
} from '#app/components/release-calendar-item.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { VeudPage, VeudPageHeader } from '#app/components/ui/veud-layout.tsx'
import { getUserId } from '#app/utils/auth.server.ts'
import { getHints } from '#app/utils/client-hints.tsx'
import {
	getReleaseCalendar,
	parseReleaseCalendarQuery,
	type ReleaseCalendarQuery,
} from '#app/utils/release-calendar.server.ts'
import { releaseReminderAction } from './calendar.server.ts'

const DAY_PARAM = /^\d{4}-\d{2}-\d{2}$/

function dayHref(filters: ReleaseCalendarQuery, week: string, date: string) {
	const search = new URLSearchParams({
		kind: filters.kind,
		scope: filters.scope,
		week,
	})
	return `/calendar/${date}?${search.toString()}`
}

export async function loader({ request, params }: LoaderFunctionArgs) {
	const day = params.day ?? ''
	if (
		!DAY_PARAM.test(day) ||
		Number.isNaN(new Date(`${day}T00:00:00.000Z`).getTime())
	) {
		throw new Response('Not found', { status: 404 })
	}
	const viewerId = await getUserId(request)
	const timeZone = getHints(request).timeZone
	const url = new URL(request.url)
	const search = new URLSearchParams(url.searchParams)
	search.set('start', day)
	const filters = parseReleaseCalendarQuery(search, new Date(), timeZone)
	const calendar = await getReleaseCalendar(filters, viewerId, timeZone, {
		days: 1,
	})
	const week = url.searchParams.get('week')
	return json({
		...calendar,
		day,
		// The overflow link that brought the visitor here remembers its week so
		// the back link returns to the exact view they left.
		weekStart: week && DAY_PARAM.test(week) ? week : null,
	})
}

export async function action({ request }: ActionFunctionArgs) {
	return releaseReminderAction(request)
}

export default function ReleaseCalendarDayRoute() {
	const data = useLoaderData<typeof loader>()
	const day = data.days[0]
	const weekHref = `/calendar?${new URLSearchParams({
		start: data.weekStart ?? data.day,
		kind: data.filters.kind,
		scope: data.filters.scope,
	}).toString()}`

	return (
		<VeudPage>
			<VeudPageHeader
				eyebrow="Release calendar"
				title={displayCalendarDay(data.day)}
				actions={
					<div className="space-y-3 sm:text-right">
						<div className="text-sm font-semibold text-veud-mint">
							{data.total} scheduled {data.total === 1 ? 'release' : 'releases'}
						</div>
						<Button asChild variant="outline" size="sm">
							<Link to={weekHref}>← Back to week view</Link>
						</Button>
					</div>
				}
			/>

			<nav
				aria-label="Calendar days"
				className="flex flex-wrap items-center justify-between gap-3"
			>
				<Button asChild variant="outline">
					<Link
						to={dayHref(
							data.filters,
							data.weekStart ?? data.previousStart,
							data.previousStart,
						)}
					>
						← {displayCalendarDay(data.previousStart)}
					</Link>
				</Button>
				<Button asChild variant="outline">
					<Link
						to={dayHref(
							data.filters,
							data.weekStart ?? data.nextStart,
							data.nextStart,
						)}
					>
						{displayCalendarDay(data.nextStart)} →
					</Link>
				</Button>
			</nav>

			<section
				aria-labelledby={`calendar-day-${data.day}`}
				className={`grid overflow-hidden rounded-2xl border bg-veud-surface shadow-lg shadow-black/10 ${data.day === data.today ? 'border-veud-gold ring-1 ring-veud-gold/25' : 'border-veud-border'}`}
			>
				<header className="flex items-center justify-between gap-3 border-b border-veud-border/70 px-4 py-3">
					<h2
						id={`calendar-day-${data.day}`}
						className="text-lg font-[var(--veud-font-display)] font-black text-veud-yellow"
					>
						Every release this day
					</h2>
					{data.day === data.today ? (
						<span className="rounded-full bg-veud-gold/15 px-2 py-1 text-xs font-bold text-veud-gold">
							Today
						</span>
					) : null}
				</header>
				{day?.items.length ? (
					<div className="divide-y divide-veud-border/50">
						{day.items.map(item => (
							<ReleaseCalendarItem
								key={item.id}
								item={item}
								timeZone={data.timeZone}
								isSignedIn={data.isSignedIn}
							/>
						))}
					</div>
				) : (
					<p className="flex items-center px-4 py-5 text-sm text-veud-sage">
						Nothing scheduled
					</p>
				)}
			</section>
		</VeudPage>
	)
}

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => [
	{
		title: loaderData
			? `Releases on ${displayCalendarDay(loaderData.day)} · Veud`
			: 'Release calendar · Veud',
	},
	{
		name: 'description',
		content: 'Every movie, TV, anime, and manga release scheduled for the day.',
	},
]

export function ErrorBoundary() {
	return <GeneralErrorBoundary />
}
