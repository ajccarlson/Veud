import { formatDistance } from 'date-fns'

export const LAST_ACTIVE_TOUCH_INTERVAL_MS = 5 * 60 * 1000

export function shouldTouchLastActiveAt(
	lastActiveAt: Date | null,
	now: Date,
) {
	return (
		lastActiveAt === null ||
		now.getTime() - lastActiveAt.getTime() >= LAST_ACTIVE_TOUCH_INTERVAL_MS
	)
}

export function getLastActiveLabel(
	lastActiveAt: Date | string | null,
	now = new Date(),
) {
	if (!lastActiveAt) return null

	const lastActiveDate = new Date(lastActiveAt)
	if (
		now.getTime() - lastActiveDate.getTime() <=
		LAST_ACTIVE_TOUCH_INTERVAL_MS
	) {
		return 'Active now'
	}

	return `Last active ${formatDistance(lastActiveDate, now, { addSuffix: true })}`
}
