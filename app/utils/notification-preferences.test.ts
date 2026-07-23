import { describe, expect, test } from 'vitest'
import {
	nextNotificationDigestAt,
	normalizeNotificationPreferences,
} from './notification-preferences.ts'

describe('notification preferences', () => {
	test('repairs invalid stored values without silently enabling email', () => {
		expect(
			normalizeNotificationPreferences(
				{
					digestFrequency: 'hourly' as never,
					digestHour: 30,
					digestWeekday: -1,
					timeZone: 'not/a-zone',
				},
				'America/Los_Angeles',
			),
		).toMatchObject({
			inAppSocial: true,
			inAppReleases: true,
			emailSocial: false,
			emailReleases: false,
			digestFrequency: 'off',
			digestHour: 9,
			digestWeekday: 1,
			timeZone: 'America/Los_Angeles',
		})
	})

	test('schedules daily and weekly summaries in the configured zone', () => {
		const base = {
			emailSocial: true,
			emailReleases: false,
			digestHour: 9,
			timeZone: 'UTC',
		}
		expect(
			nextNotificationDigestAt(
				{ ...base, digestFrequency: 'daily', digestWeekday: 1 },
				new Date('2026-07-23T08:10:00.000Z'),
			),
		).toEqual(new Date('2026-07-23T09:00:00.000Z'))
		expect(
			nextNotificationDigestAt(
				{ ...base, digestFrequency: 'weekly', digestWeekday: 1 },
				new Date('2026-07-23T08:10:00.000Z'),
			),
		).toEqual(new Date('2026-07-27T09:00:00.000Z'))
	})

	test('does not schedule email when the digest or both categories are off', () => {
		expect(
			nextNotificationDigestAt({
				emailSocial: true,
				emailReleases: true,
				digestFrequency: 'off',
				digestHour: 9,
				digestWeekday: 1,
				timeZone: 'UTC',
			}),
		).toBeNull()
	})
})
