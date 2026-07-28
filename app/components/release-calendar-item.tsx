import { Form, Link } from 'react-router'
import { Button } from '#app/components/ui/button.tsx'

export const releaseCalendarKindLabels = {
	all: 'All media',
	movie: 'Movies',
	tv: 'TV',
	anime: 'Anime',
	manga: 'Manga',
} as const

export function displayCalendarDay(value: string) {
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

function reminderLeadLabel(leadMinutes: number) {
	if (leadMinutes === 0) return 'At release'
	if (leadMinutes === 60) return '1 hour before'
	if (leadMinutes === 1440) return '1 day before'
	return `${leadMinutes} minutes before`
}

export type ReleaseCalendarItemView = {
	id: string
	mediaId: string
	title: string
	kind: string
	type: string | null
	imageUrl: string | null
	releaseAt: Date | string
	allDay: boolean
	eventType: 'premiere' | 'episode' | 'chapter' | 'release'
	eventLabel: string
	eventName: string | null
	trackerCount: number
	viewerTracking: {
		status: string
		statusLabel: string
		score: number | null
	} | null
	viewerReminder: {
		id: string
		leadMinutes: number
	} | null
}

export function ReleaseCalendarItem({
	item,
	timeZone,
	isSignedIn,
}: {
	item: ReleaseCalendarItemView
	timeZone: string
	isSignedIn: boolean
}) {
	return (
		<article
			key={item.id}
			className="grid gap-3 p-4 transition-colors hover:bg-veud-ink/35 sm:grid-cols-[6.75rem_4rem_minmax(0,1fr)]"
		>
			<div className="sm:pt-1">
				<div className="font-black tabular-nums text-veud-mint">
					{displayTime(item.releaseAt, item.allDay, timeZone)}
				</div>
				<div className="mt-1 text-[0.68rem] font-bold uppercase tracking-[0.12em] text-veud-sage">
					{item.type ||
						releaseCalendarKindLabels[
							item.kind as keyof typeof releaseCalendarKindLabels
						] ||
						item.kind}
				</div>
			</div>
			<Link
				to={`/media/${item.mediaId}`}
				className="h-24 w-16 overflow-hidden rounded-lg bg-veud-ink shadow-md"
			>
				{item.imageUrl ? (
					<img
						src={item.imageUrl}
						alt=""
						loading="lazy"
						className="h-full w-full object-cover"
					/>
				) : (
					<span className="flex h-full items-center justify-center px-2 text-center text-[0.65rem] text-veud-sage">
						No poster
					</span>
				)}
			</Link>
			<div className="min-w-0 flex-1">
				<Link
					to={`/media/${item.mediaId}`}
					className="block text-base font-black leading-5 text-veud-yellow hover:underline"
				>
					{item.title}
				</Link>
				<div className="mt-1 flex flex-wrap items-center gap-2">
					<span
						className={`rounded-full px-2 py-0.5 text-xs font-bold ${item.eventType === 'premiere' ? 'bg-veud-amber/15 text-veud-gold' : item.eventType === 'chapter' ? 'bg-violet-300/15 text-violet-200' : 'bg-veud-mint/10 text-veud-mint'}`}
					>
						{item.eventLabel}
					</span>
					{item.eventName ? (
						<span className="line-clamp-1 text-xs text-veud-copy">
							{item.eventName}
						</span>
					) : null}
				</div>
				<div className="mt-2 flex flex-wrap gap-1.5 text-[0.7rem] text-veud-mint">
					{item.viewerTracking ? (
						<span className="rounded-full bg-veud-mint/10 px-2 py-0.5 font-bold text-veud-mint">
							{item.viewerTracking.statusLabel}
							{item.viewerTracking.score !== null
								? ` · ${item.viewerTracking.score.toLocaleString('en-US', { maximumFractionDigits: 1 })}/10`
								: ''}
						</span>
					) : null}
					<span className="rounded-full bg-veud-ink px-2 py-0.5">
						{item.trackerCount}{' '}
						{item.trackerCount === 1 ? 'member' : 'members'} tracking
					</span>
				</div>
				{isSignedIn ? (
					item.viewerReminder ? (
						<Form method="post" className="mt-3">
							<input
								type="hidden"
								name="intent"
								value="release-reminder-delete"
							/>
							<input type="hidden" name="mediaId" value={item.mediaId} />
							<Button
								type="submit"
								variant="ghost"
								size="sm"
								aria-label={`Remove reminder for ${item.title}`}
								className="text-veud-mint"
							>
								Reminder on ·{' '}
								{reminderLeadLabel(item.viewerReminder.leadMinutes)}
							</Button>
						</Form>
					) : (
						<Form method="post" className="mt-3">
							<input type="hidden" name="intent" value="release-reminder-save" />
							<input type="hidden" name="mediaId" value={item.mediaId} />
							<input type="hidden" name="leadMinutes" value="60" />
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
	)
}
