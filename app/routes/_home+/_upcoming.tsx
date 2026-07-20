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
	total: number
	days: Array<{ date: string; items: UpcomingItem[] }>
}

function displayDay(value: string) {
	return new Date(`${value}T00:00:00.000Z`).toLocaleDateString('en-US', {
		weekday: 'long',
		month: 'short',
		day: 'numeric',
		timeZone: 'UTC',
	})
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
			className="w-full max-w-4xl space-y-4 self-center px-4 text-[#ffefcc]"
			aria-labelledby="home-upcoming-heading"
		>
			<header className="flex flex-wrap items-end justify-between gap-3">
				<div>
					<h2
						id="home-upcoming-heading"
						className="text-2xl font-black text-[#ff9900]"
					>
						Upcoming releases
					</h2>
					<p className="text-sm text-[#a2ffd5]">
						Your tracked premieres and episodes for the next seven days · UTC
					</p>
				</div>
				<Button asChild variant="outline" size="sm">
					<Link to={fullCalendarHref(calendar.start)}>View full calendar</Link>
				</Button>
			</header>

			{visibleDays.length ? (
				<div className="grid items-start gap-4 md:grid-cols-2">
					{visibleDays.map(day => {
						const visibleItems = day.items.slice(0, 3)
						return (
							<section
								key={day.date}
								aria-labelledby={`home-upcoming-${day.date}`}
								className="overflow-hidden rounded-xl border border-[#54806c] bg-[#383040]"
							>
								<h3
									id={`home-upcoming-${day.date}`}
									className="border-b border-[#54806c] px-4 py-2 font-black text-[#ffffb1]"
								>
									{displayDay(day.date)}
								</h3>
								<div className="divide-y divide-[#54806c]/60">
									{visibleItems.map(item => (
										<article key={item.id} className="flex gap-3 p-3">
											<Link
												to={`/media/${item.mediaId}`}
												className="h-20 w-14 shrink-0 overflow-hidden rounded-md bg-[#2e2f2b]"
											>
												{item.imageUrl ? (
													<img
														src={item.imageUrl}
														alt=""
														loading="lazy"
														className="h-full w-full object-cover"
													/>
												) : (
													<span className="flex h-full items-center justify-center px-1 text-center text-[0.6rem] text-[#8ca99d]">
														No poster
													</span>
												)}
											</Link>
											<div className="min-w-0 flex-1">
												<div className="text-[0.7rem] font-bold uppercase tracking-wide text-[#a2ffd5]">
													{displayTime(item.releaseAt, item.allDay)} ·{' '}
													{item.type || item.kind}
												</div>
												<Link
													to={`/media/${item.mediaId}`}
													className="mt-0.5 block truncate font-black text-[#ffffb1] hover:underline"
												>
													{item.title}
												</Link>
												<div className="text-sm font-semibold text-[#ffcc66]">
													{item.eventLabel}
												</div>
												{item.eventName ? (
													<div className="truncate text-xs text-[#c6ded2]">
														{item.eventName}
													</div>
												) : null}
												<div className="mt-1 text-[0.7rem] text-[#a2ffd5]">
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
								{day.items.length > visibleItems.length ? (
									<div className="border-t border-[#54806c]/60 px-4 py-2 text-xs text-[#a2ffd5]">
										+{day.items.length - visibleItems.length} more on the full
										calendar
									</div>
								) : null}
							</section>
						)
					})}
				</div>
			) : (
				<div className="rounded-xl border border-dashed border-[#54806c] bg-[#383040] px-6 py-10 text-center">
					<h3 className="font-black text-[#ffffb1]">You’re all caught up</h3>
					<p className="mt-1 text-sm text-[#a2ffd5]">
						Nothing is scheduled for your tracked titles in the next seven days.
					</p>
				</div>
			)}
		</section>
	)
}
