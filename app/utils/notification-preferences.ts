export const notificationDigestFrequencies = ['off', 'daily', 'weekly'] as const
export type NotificationDigestFrequency =
	(typeof notificationDigestFrequencies)[number]

export type NotificationPreferenceConfig = {
	inAppSocial: boolean
	inAppReleases: boolean
	emailSocial: boolean
	emailReleases: boolean
	digestFrequency: NotificationDigestFrequency
	digestHour: number
	digestWeekday: number
	timeZone: string
	nextDigestAt: Date | null
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferenceConfig = {
	inAppSocial: true,
	inAppReleases: true,
	emailSocial: false,
	emailReleases: false,
	digestFrequency: 'off',
	digestHour: 9,
	digestWeekday: 1,
	timeZone: 'UTC',
	nextDigestAt: null,
}

export function isValidTimeZone(value: string) {
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: value }).format()
		return true
	} catch {
		return false
	}
}

export function normalizeNotificationPreferences(
	input?:
		| (Partial<Omit<NotificationPreferenceConfig, 'digestFrequency'>> & {
				digestFrequency?: string | null
		  })
		| null,
	fallbackTimeZone = 'UTC',
): NotificationPreferenceConfig {
	const digestFrequency = notificationDigestFrequencies.includes(
		input?.digestFrequency as NotificationDigestFrequency,
	)
		? (input?.digestFrequency as NotificationDigestFrequency)
		: 'off'
	const timeZone = isValidTimeZone(input?.timeZone ?? '')
		? input!.timeZone!
		: isValidTimeZone(fallbackTimeZone)
			? fallbackTimeZone
			: 'UTC'
	return {
		inAppSocial: input?.inAppSocial ?? true,
		inAppReleases: input?.inAppReleases ?? true,
		emailSocial: input?.emailSocial ?? false,
		emailReleases: input?.emailReleases ?? false,
		digestFrequency,
		digestHour:
			Number.isInteger(input?.digestHour) &&
			input!.digestHour! >= 0 &&
			input!.digestHour! <= 23
				? input!.digestHour!
				: 9,
		digestWeekday:
			Number.isInteger(input?.digestWeekday) &&
			input!.digestWeekday! >= 0 &&
			input!.digestWeekday! <= 6
				? input!.digestWeekday!
				: 1,
		timeZone,
		nextDigestAt: input?.nextDigestAt ?? null,
	}
}

const weekdayIndex = new Map([
	['Sun', 0],
	['Mon', 1],
	['Tue', 2],
	['Wed', 3],
	['Thu', 4],
	['Fri', 5],
	['Sat', 6],
])

export function nextNotificationDigestAt(
	config: Pick<
		NotificationPreferenceConfig,
		| 'digestFrequency'
		| 'digestHour'
		| 'digestWeekday'
		| 'timeZone'
		| 'emailSocial'
		| 'emailReleases'
	>,
	now = new Date(),
) {
	if (
		config.digestFrequency === 'off' ||
		(!config.emailSocial && !config.emailReleases)
	) {
		return null
	}
	const formatter = new Intl.DateTimeFormat('en-US', {
		timeZone: isValidTimeZone(config.timeZone) ? config.timeZone : 'UTC',
		weekday: 'short',
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23',
	})
	const interval = 15 * 60 * 1_000
	let candidate = new Date(Math.floor(now.getTime() / interval) * interval + interval)
	for (let index = 0; index < 8 * 24 * 4; index++) {
		const parts = Object.fromEntries(
			formatter.formatToParts(candidate).map(part => [part.type, part.value]),
		)
		const matchesDay =
			config.digestFrequency === 'daily' ||
			weekdayIndex.get(parts.weekday ?? '') === config.digestWeekday
		if (
			matchesDay &&
			Number(parts.hour) === config.digestHour &&
			Number(parts.minute) === 0
		) {
			return candidate
		}
		candidate = new Date(candidate.getTime() + interval)
	}
	throw new Error('Unable to schedule the next notification digest')
}

export function isReleaseNotificationType(type: string) {
	return type === 'release_reminder'
}
