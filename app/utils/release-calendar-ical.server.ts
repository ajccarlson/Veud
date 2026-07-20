import { type ReleaseCalendarItem } from './release-calendar.server.ts'

type ICalendarInput = {
	start: string
	end: string
	timeZone: string
	filters: {
		kind: string
		scope: string
	}
	days: Array<{
		date: string
		items: ReleaseCalendarItem[]
	}>
}

const encoder = new TextEncoder()

function escapeText(value: string) {
	return value
		.replace(/\\/g, '\\\\')
		.replace(/\r?\n/g, '\\n')
		.replace(/;/g, '\\;')
		.replace(/,/g, '\\,')
}

/** Fold an iCalendar content line at 75 UTF-8 octets, including continuation whitespace. */
export function foldICalendarLine(value: string) {
	const lines: string[] = []
	let current = ''
	let currentBytes = 0
	let limit = 75

	for (const character of value) {
		const characterBytes = encoder.encode(character).length
		if (current && currentBytes + characterBytes > limit) {
			lines.push(current)
			current = character
			currentBytes = characterBytes
			limit = 74
		} else {
			current += character
			currentBytes += characterBytes
		}
	}

	lines.push(current)
	return lines.join('\r\n ')
}

function formatUtcDateTime(value: Date) {
	return value
		.toISOString()
		.replace(/[-:]/g, '')
		.replace(/\.\d{3}Z$/, 'Z')
}

function formatDate(value: Date) {
	return value.toISOString().slice(0, 10).replace(/-/g, '')
}

function addUtcDay(value: Date) {
	return new Date(value.getTime() + 24 * 60 * 60 * 1_000)
}

function calendarName(calendar: ICalendarInput) {
	const scope = calendar.filters.scope === 'mine' ? 'My' : 'All'
	const kind =
		calendar.filters.kind === 'all'
			? ''
			: ` ${calendar.filters.kind[0]?.toUpperCase()}${calendar.filters.kind.slice(1)}`
	return `Veud · ${scope}${kind} releases`
}

function eventDescription(item: ReleaseCalendarItem) {
	return [
		item.eventName,
		item.type || item.kind,
		item.viewerTracking
			? `${item.viewerTracking.statusLabel}${item.viewerTracking.score === null ? '' : ` · ${item.viewerTracking.score}/10`}`
			: null,
		`${item.trackerCount} ${item.trackerCount === 1 ? 'member' : 'members'} tracking on Veud`,
	]
		.filter(Boolean)
		.join('\n')
}

export function serializeReleaseCalendar(
	calendar: ICalendarInput,
	{ origin, generatedAt = new Date() }: { origin: string; generatedAt?: Date },
) {
	const normalizedOrigin = origin.replace(/\/$/, '')
	const uidHost = new URL(normalizedOrigin).hostname || 'veud.net'
	const lines = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//Veud//Release Calendar//EN',
		'CALSCALE:GREGORIAN',
		'METHOD:PUBLISH',
		`X-WR-CALNAME:${escapeText(calendarName(calendar))}`,
		`X-WR-CALDESC:${escapeText(`Veud releases from ${calendar.start} through ${calendar.end}`)}`,
		`X-WR-TIMEZONE:${escapeText(calendar.timeZone)}`,
		'X-PUBLISHED-TTL:PT6H',
	]

	for (const item of calendar.days.flatMap(day => day.items)) {
		const url = `${normalizedOrigin}/media/${encodeURIComponent(item.mediaId)}`
		lines.push(
			'BEGIN:VEVENT',
			`UID:${escapeText(`${item.id}@${uidHost}`)}`,
			`DTSTAMP:${formatUtcDateTime(generatedAt)}`,
		)
		if (item.allDay) {
			lines.push(
				`DTSTART;VALUE=DATE:${formatDate(item.releaseAt)}`,
				`DTEND;VALUE=DATE:${formatDate(addUtcDay(item.releaseAt))}`,
			)
		} else {
			lines.push(`DTSTART:${formatUtcDateTime(item.releaseAt)}`)
		}
		lines.push(
			`SUMMARY:${escapeText(`${item.title} — ${item.eventLabel}`)}`,
			`DESCRIPTION:${escapeText(eventDescription(item))}`,
			`URL:${url}`,
			'END:VEVENT',
		)
	}

	lines.push('END:VCALENDAR')
	return `${lines.map(foldICalendarLine).join('\r\n')}\r\n`
}
