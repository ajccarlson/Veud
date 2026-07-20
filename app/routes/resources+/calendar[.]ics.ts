import { type LoaderFunctionArgs } from 'react-router'
import { getUserId, requireUserId } from '#app/utils/auth.server.ts'
import { getHints } from '#app/utils/client-hints.tsx'
import { getDomainUrl } from '#app/utils/misc.tsx'
import { serializeReleaseCalendar } from '#app/utils/release-calendar-ical.server.ts'
import {
	getReleaseCalendar,
	parseReleaseCalendarQuery,
} from '#app/utils/release-calendar.server.ts'

export async function loader({ request }: LoaderFunctionArgs) {
	const url = new URL(request.url)
	const timeZone = getHints(request).timeZone
	const filters = parseReleaseCalendarQuery(
		url.searchParams,
		new Date(),
		timeZone,
	)
	const viewerId =
		filters.scope === 'mine'
			? await requireUserId(request, { url })
			: await getUserId(request)
	const calendar = await getReleaseCalendar(filters, viewerId, timeZone)
	const body = serializeReleaseCalendar(calendar, {
		origin: getDomainUrl(request),
	})

	return new Response(body, {
		headers: {
			'Content-Type': 'text/calendar; charset=utf-8',
			'Content-Disposition': `attachment; filename="veud-releases-${calendar.start}.ics"`,
			'Cache-Control': 'private, no-store',
			'X-Content-Type-Options': 'nosniff',
		},
	})
}
