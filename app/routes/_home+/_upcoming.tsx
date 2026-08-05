import { Link } from 'react-router'
import { Button } from '#app/components/ui/button.tsx'

type UpcomingItem = {
	id: string
	mediaId: string
	title: string
	kind: string
	type: string | null
	imageUrl: string | null
	releaseAt: Date | string
	allDay: boolean
	eventLabel: string
	eventName: string | null
	trackerCount: number
	viewerTracking: {
		statusLabel: string
		score: number | null
	} | null
}

type UpcomingCalendar = {
	start: string
	timeZone: string
	total: number
	days: Array<{ date: string; items: UpcomingItem[]; totalCount: number }>
}

function displayDay(value: string) {
	return new Date(`${value}T00:00:00.000Z`).toLocaleDateString('en-US', {
		weekday: 'long',
		month: 'short',
		day: 'numeric',
		timeZone: 'UTC',
	})
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

function fullCalendarHref(start: string) {
	return `/calendar?${new URLSearchParams({
		start,
		kind: 'all',
		scope: 'mine',
	}).toString()}`
}

export function UpcomingData({
	calendar,
}: {
	calendar: UpcomingCalendar | null
}) {
	if (!calendar) return null
	const visibleDays = calendar.days.filter(day => day.items.length).slice(0, 4)

	return (
		<section
			className="home-upcoming min-w-0 space-y-4 text-[rgb(var(--veud-parchment))]"
			aria-labelledby="home-upcoming-heading"
		>
			<header className="flex flex-wrap items-end justify-between gap-3">
				<div>
					<h2
						id="home-upcoming-heading"
						className="text-2xl font-black text-[rgb(var(--veud-signal))]"
					>
						Upcoming releases
					</h2>
					<p className="text-sm text-[rgb(var(--veud-accent-bright))]">
						Your tracked premieres and episodes for the next seven days
					</p>
				</div>
				<Button asChild variant="outline" size="sm">
					<Link to={fullCalendarHref(calendar.start)}>View full calendar</Link>
				</Button>
			</header>

			{visibleDays.length ? (
				<div className="home-upcoming-grid grid items-start gap-4">
					{visibleDays.map(day => {
						const visibleItems = day.items.slice(0, 3)
						return (
							<section
								key={day.date}
								aria-labelledby={`home-upcoming-${day.date}`}
								className="overflow-hidden rounded-xl border border-[rgb(var(--veud-rule))] bg-[rgb(var(--veud-panel-violet))]"
							>
								<h3
									id={`home-upcoming-${day.date}`}
									className="border-b border-[rgb(var(--veud-rule))] px-4 py-2 font-black text-[rgb(var(--veud-highlight))]"
								>
									{displayDay(day.date)}
								</h3>
								<div className="divide-y divide-[rgb(var(--veud-rule))]/60">
									{visibleItems.map(item => (
										<article key={item.id} className="flex gap-3 p-3">
											<Link
												to={`/media/${item.mediaId}`}
												aria-hidden="true"
												tabIndex={-1}
												className="h-20 w-14 shrink-0 overflow-hidden rounded-md bg-[rgb(var(--veud-panel))]"
											>
												{item.imageUrl ? (
													<img
														src={item.imageUrl}
														alt=""
														loading="lazy"
														className="h-full w-full object-cover"
													/>
												) : (
													<span className="flex h-full items-center justify-center px-1 text-center text-[0.6rem] text-[rgb(var(--veud-muted-text))]">
														No poster
													</span>
												)}
											</Link>
											<div className="min-w-0 flex-1">
												<div className="text-[0.7rem] font-bold uppercase tracking-wide text-[rgb(var(--veud-accent-bright))]">
													{displayTime(
														item.releaseAt,
														item.allDay,
														calendar.timeZone,
													)}{' '}
													· {item.type || item.kind}
												</div>
												<Link
													to={`/media/${item.mediaId}`}
													className="mt-0.5 block truncate font-black text-[rgb(var(--veud-highlight))] hover:underline"
												>
													{item.title}
												</Link>
												<div className="text-sm font-semibold text-[rgb(var(--veud-gold-bright))]">
													{item.eventLabel}
												</div>
												{item.eventName ? (
													<div className="truncate text-xs text-[rgb(var(--veud-body-text))]">
														{item.eventName}
													</div>
												) : null}
												<div className="mt-1 text-[0.7rem] text-[rgb(var(--veud-accent-bright))]">
													{item.viewerTracking?.statusLabel ?? 'Tracked'}
													{item.viewerTracking?.score !== null &&
													item.viewerTracking?.score !== undefined
														? ` · ${item.viewerTracking.score.toLocaleString('en-US', { maximumFractionDigits: 1 })}/10`
														: ''}
													{` · ${item.trackerCount} ${item.trackerCount === 1 ? 'member' : 'members'} tracking`}
												</div>
											</div>
										</article>
									))}
								</div>
								{day.totalCount > visibleItems.length ? (
									<div className="border-t border-[rgb(var(--veud-rule))]/60 px-4 py-2 text-xs text-[rgb(var(--veud-accent-bright))]">
										+{day.totalCount - visibleItems.length} more on the full
										calendar
									</div>
								) : null}
							</section>
						)
					})}
				</div>
			) : (
				<div className="rounded-xl border border-dashed border-[rgb(var(--veud-rule))] bg-[rgb(var(--veud-panel-violet))] px-6 py-10 text-center">
					<h3 className="font-black text-[rgb(var(--veud-highlight))]">You’re all caught up</h3>
					<p className="mt-1 text-sm text-[rgb(var(--veud-accent-bright))]">
						Nothing is scheduled for your tracked titles in the next seven days.
					</p>
				</div>
			)}
		</section>
	)
}
