import { type LoaderFunctionArgs } from 'react-router'
import { getUserId, requireUserId } from '#app/utils/auth.server.ts'
import { getDomainUrl } from '#app/utils/misc.tsx'
import { serializeReleaseCalendar } from '#app/utils/release-calendar-ical.server.ts'
import {
	getReleaseCalendar,
	parseReleaseCalendarQuery,
} from '#app/utils/release-calendar.server.ts'

export async function loader({ request }: LoaderFunctionArgs) {
	const url = new URL(request.url)
	const filters = parseReleaseCalendarQuery(url.searchParams)
	const viewerId =
		filters.scope === 'mine'
			? await requireUserId(request, { url })
			: await getUserId(request)
	const calendar = await getReleaseCalendar(filters, viewerId)
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
