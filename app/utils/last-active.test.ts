import { expect, test } from 'vitest'
import {
	getLastActiveLabel,
	LAST_ACTIVE_TOUCH_INTERVAL_MS,
	shouldTouchLastActiveAt,
} from './last-active.ts'

const now = new Date('2026-07-17T20:00:00.000Z')

test('touches users whose activity is missing or stale', () => {
	expect(shouldTouchLastActiveAt(null, now)).toBe(true)
	expect(
		shouldTouchLastActiveAt(
			new Date(now.getTime() - LAST_ACTIVE_TOUCH_INTERVAL_MS),
			now,
		),
	).toBe(true)
})

test('does not touch users again inside the throttle interval', () => {
	expect(
		shouldTouchLastActiveAt(
			new Date(now.getTime() - LAST_ACTIVE_TOUCH_INTERVAL_MS + 1),
			now,
		),
	).toBe(false)
})

test('formats recent, older, and unavailable activity', () => {
	expect(getLastActiveLabel(null, now)).toBe(null)
	expect(
		getLastActiveLabel(
			new Date(now.getTime() - LAST_ACTIVE_TOUCH_INTERVAL_MS),
			now,
		),
	).toBe('Active now')
	expect(
		getLastActiveLabel(new Date('2026-07-15T20:00:00.000Z'), now),
	).toBe('Last active 2 days ago')
})
