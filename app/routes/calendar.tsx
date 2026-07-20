import {
	data as json,
	Form,
	Link,
	type ActionFunctionArgs,
	type LoaderFunctionArgs,
	type MetaFunction,
	useLoaderData,
} from 'react-router'
import { z } from 'zod'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Label } from '#app/components/ui/label.tsx'
import { getUserId, requireUserId } from '#app/utils/auth.server.ts'
import { getHints } from '#app/utils/client-hints.tsx'
import { prisma } from '#app/utils/db.server.ts'
import {
	getReleaseCalendar,
	parseReleaseCalendarQuery,
	type ReleaseCalendarQuery,
} from '#app/utils/release-calendar.server.ts'
import {
	releaseReminderLeadMinutes,
	removeReleaseReminder,
	saveReleaseReminder,
	type ReleaseReminderLeadMinutes,
} from '#app/utils/release-reminders.server.ts'

const ReminderLeadSchema = z.coerce
	.number()
	.int()
	.refine(value =>
		releaseReminderLeadMinutes.includes(value as ReleaseReminderLeadMinutes),
	)
	.transform(value => value as ReleaseReminderLeadMinutes)

const ReminderActionSchema = z.discriminatedUnion('intent', [
	z.object({
		intent: z.literal('release-reminder-save'),
		mediaId: z.string().min(1).max(100),
		leadMinutes: ReminderLeadSchema,
	}),
	z.object({
		intent: z.literal('release-reminder-delete'),
		mediaId: z.string().min(1).max(100),
	}),
])

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

function calendarExportHref(filters: ReleaseCalendarQuery) {
	const search = new URLSearchParams({
		start: filters.start,
		kind: filters.kind,
		scope: filters.scope,
	})
	return `/resources/calendar.ics?${search.toString()}`
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

function displayTime(value: Date | string, allDay: boolean, timeZone: string) {
	if (allDay) return 'All day'
	return new Date(value).toLocaleTimeString('en-US', {
		hour: 'numeric',
		minute: '2-digit',
		timeZone,
		timeZoneName: 'short',
	})
}

function displayTimeZone(timeZone: string) {
	const name = new Intl.DateTimeFormat('en-US', {
		timeZone,
		timeZoneName: 'longGeneric',
	})
		.formatToParts(new Date())
		.find(part => part.type === 'timeZoneName')?.value
	return timeZone === 'UTC' ? 'UTC' : `${name ?? timeZone} (${timeZone})`
}

export async function loader({ request }: LoaderFunctionArgs) {
	const viewerId = await getUserId(request)
	const timeZone = getHints(request).timeZone
	const filters = parseReleaseCalendarQuery(
		new URL(request.url).searchParams,
		new Date(),
		timeZone,
	)
	return json(await getReleaseCalendar(filters, viewerId, timeZone))
}

export async function action({ request }: ActionFunctionArgs) {
	const viewerId = await requireUserId(request)
	const parsed = ReminderActionSchema.safeParse(
		Object.fromEntries(await request.formData()),
	)
	if (!parsed.success) {
		throw new Response('Invalid reminder action', { status: 400 })
	}
	const media = await prisma.media.findUnique({
		where: { id: parsed.data.mediaId },
		select: { id: true },
	})
	if (!media) throw new Response('Media not found', { status: 404 })

	if (parsed.data.intent === 'release-reminder-save') {
		const leadMinutes = parsed.data.leadMinutes
		const reminder = await prisma.$transaction(transaction =>
			saveReleaseReminder(transaction, {
				ownerId: viewerId,
				mediaId: media.id,
				leadMinutes,
			}),
		)
		return json({ ok: true, reminderId: reminder.id })
	}

	await removeReleaseReminder(prisma, {
		ownerId: viewerId,
		mediaId: media.id,
	})
	return json({ ok: true })
}

function reminderLeadLabel(leadMinutes: number) {
	if (leadMinutes === 0) return 'At release'
	if (leadMinutes === 60) return '1 hour before'
	if (leadMinutes === 1440) return '1 day before'
	return `${leadMinutes} minutes before`
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
						use your browser time zone: {displayTimeZone(data.timeZone)}.
					</p>
				</div>
				<div className="space-y-3 text-right">
					<div className="text-lg font-black text-[#ffffb1]">
						{displayRange(data.start, data.end)}
					</div>
					<div className="text-sm text-[#a2ffd5]">
						{data.total} scheduled {data.total === 1 ? 'release' : 'releases'}
					</div>
					<Button asChild variant="outline" size="sm">
						<a href={calendarExportHref(data.filters)} download>
							Export this week (.ics)
						</a>
					</Button>
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
				className="relative space-y-3 before:absolute before:bottom-6 before:left-[1.15rem] before:top-6 before:w-px before:bg-[#54806c]/50 sm:before:left-[1.4rem] lg:before:hidden"
			>
				{data.days.map(day => (
					<section
						key={day.date}
						aria-labelledby={`calendar-day-${day.date}`}
						className={`relative ml-10 grid overflow-hidden rounded-2xl border bg-[#383040] shadow-[0_18px_55px_rgba(10,12,10,0.16)] sm:ml-12 lg:ml-0 lg:grid-cols-[12rem_minmax(0,1fr)] ${day.date === data.today ? 'border-[#ffcc66] ring-1 ring-[#ffcc66]/25' : day.items.length ? 'border-[#54806c]' : 'border-[#54806c]/50 bg-[#383040]/65'}`}
					>
						<span
							aria-hidden="true"
							className={`absolute -left-[2.05rem] top-5 h-3 w-3 rounded-full border-2 sm:-left-[2.35rem] lg:hidden ${day.date === data.today ? 'border-[#ffcc66] bg-[#ffcc66]' : day.items.length ? 'border-[#a2ffd5] bg-[#383040]' : 'border-[#54806c] bg-[#2e2f2b]'}`}
						/>
						<header className="flex items-center justify-between gap-3 border-b border-[#54806c]/70 px-4 py-3 lg:block lg:border-b-0 lg:border-r lg:px-5 lg:py-5">
							<h2
								id={`calendar-day-${day.date}`}
								className="text-lg font-black text-[#ffffb1] lg:text-xl"
							>
								{displayDay(day.date)}
							</h2>
							<div className="flex items-center gap-2 lg:mt-2">
								{day.date === data.today ? (
									<span className="rounded-full bg-[#ffcc66]/15 px-2 py-1 text-xs font-bold text-[#ffcc66]">
										Today
									</span>
								) : null}
								<span className="text-xs font-semibold text-[#8ca99d]">
									{day.items.length}{' '}
									{day.items.length === 1 ? 'release' : 'releases'}
								</span>
							</div>
						</header>
						{day.items.length ? (
							<div className="divide-y divide-[#54806c]/50">
								{day.items.map(item => (
									<article
										key={item.id}
										className="grid gap-3 p-4 transition-colors hover:bg-[#2e2f2b]/35 sm:grid-cols-[6.75rem_4rem_minmax(0,1fr)]"
									>
										<div className="sm:pt-1">
											<div className="font-black tabular-nums text-[#a2ffd5]">
												{displayTime(
													item.releaseAt,
													item.allDay,
													data.timeZone,
												)}
											</div>
											<div className="mt-1 text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[#8ca99d]">
												{item.type ||
													kindLabels[
														item.kind as ReleaseCalendarQuery['kind']
													] ||
													item.kind}
											</div>
										</div>
										<Link
											to={`/media/${item.mediaId}`}
											className="h-24 w-16 overflow-hidden rounded-lg bg-[#2e2f2b] shadow-md"
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
											<Link
												to={`/media/${item.mediaId}`}
												className="block text-base font-black leading-5 text-[#ffffb1] hover:underline"
											>
												{item.title}
											</Link>
											<div className="mt-1 flex flex-wrap items-center gap-2">
												<span
													className={`rounded-full px-2 py-0.5 text-xs font-bold ${item.eventType === 'premiere' ? 'bg-[#ff9900]/15 text-[#ffcc66]' : item.eventType === 'chapter' ? 'bg-[#b99cff]/15 text-[#d8c7ff]' : 'bg-[#a2ffd5]/10 text-[#a2ffd5]'}`}
												>
													{item.eventLabel}
												</span>
												{item.eventName ? (
													<span className="line-clamp-1 text-xs text-[#c6ded2]">
														{item.eventName}
													</span>
												) : null}
											</div>
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
											{data.isSignedIn ? (
												item.viewerReminder ? (
													<Form method="post" className="mt-3">
														<input
															type="hidden"
															name="intent"
															value="release-reminder-delete"
														/>
														<input
															type="hidden"
															name="mediaId"
															value={item.mediaId}
														/>
														<Button
															type="submit"
															variant="ghost"
															size="sm"
															aria-label={`Remove reminder for ${item.title}`}
															className="text-[#a2ffd5]"
														>
															Reminder on ·{' '}
															{reminderLeadLabel(
																item.viewerReminder.leadMinutes,
															)}
														</Button>
													</Form>
												) : (
													<Form method="post" className="mt-3">
														<input
															type="hidden"
															name="intent"
															value="release-reminder-save"
														/>
														<input
															type="hidden"
															name="mediaId"
															value={item.mediaId}
														/>
														<input
															type="hidden"
															name="leadMinutes"
															value="60"
														/>
														<Button
															type="submit"
															variant="outline"
															size="sm"
															aria-label={`Set reminder for ${item.title}`}
														>
															Remind me · 1 hour before
														</Button>
													</Form>
												)
											) : null}
										</div>
									</article>
								))}
							</div>
						) : (
							<p className="flex items-center px-4 py-5 text-sm text-[#8ca99d]">
								Nothing scheduled
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
