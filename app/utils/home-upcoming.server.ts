import { writeStructuredLog } from './operations-observability.server.ts'
import {
	dateKeyInTimeZone,
	getReleaseCalendar,
	isReleaseCalendarCapacityError,
} from './release-calendar.server.ts'

type ReleaseCalendarLoader = typeof getReleaseCalendar

export const homeUpcomingDayPreviewLimit = 3

export async function loadHomeUpcomingCalendar(
	viewerId: string,
	timeZone: string,
	options: {
		now?: Date
		loadCalendar?: ReleaseCalendarLoader
	} = {},
) {
	try {
		return await (options.loadCalendar ?? getReleaseCalendar)(
			{
				start: dateKeyInTimeZone(options.now ?? new Date(), timeZone),
				kind: 'all',
				scope: 'mine',
			},
			viewerId,
			timeZone,
			{ dayPreviewLimit: homeUpcomingDayPreviewLimit },
		)
	} catch (error) {
		if (!isReleaseCalendarCapacityError(error)) throw error
		writeStructuredLog('error', 'release_calendar_capacity_exceeded', {
			surface: 'home',
			message: error.message,
		})
		return null
	}
}
