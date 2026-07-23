import { type Prisma } from '@prisma/client'
import { prisma } from './db.server.ts'
import {
	DEFAULT_NOTIFICATION_PREFERENCES,
	normalizeNotificationPreferences,
	type NotificationPreferenceConfig,
} from './notification-preferences.ts'

export async function getNotificationPreferences(
	ownerId: string,
	fallbackTimeZone = 'UTC',
) {
	const preference = await prisma.notificationPreference.findUnique({
		where: { ownerId },
		select: {
			inAppSocial: true,
			inAppReleases: true,
			emailSocial: true,
			emailReleases: true,
			digestFrequency: true,
			digestHour: true,
			digestWeekday: true,
			timeZone: true,
			nextDigestAt: true,
		},
	})
	return normalizeNotificationPreferences(preference, fallbackTimeZone)
}

export async function saveNotificationPreferences(
	ownerId: string,
	config: NotificationPreferenceConfig,
) {
	const data = {
		inAppSocial: config.inAppSocial,
		inAppReleases: config.inAppReleases,
		emailSocial: config.emailSocial,
		emailReleases: config.emailReleases,
		digestFrequency: config.digestFrequency,
		digestHour: config.digestHour,
		digestWeekday: config.digestWeekday,
		timeZone: config.timeZone,
		nextDigestAt: config.nextDigestAt,
	}
	return prisma.notificationPreference.upsert({
		where: { ownerId },
		create: { ownerId, ...data },
		update: data,
	})
}

export function notificationInboxWhere(
	preferences:
		| Pick<NotificationPreferenceConfig, 'inAppSocial' | 'inAppReleases'>
		| null
		| undefined,
): Prisma.NotificationWhereInput {
	const config = preferences ?? DEFAULT_NOTIFICATION_PREFERENCES
	if (config.inAppSocial && config.inAppReleases) return {}
	if (config.inAppReleases) {
		return { type: { in: ['release_reminder', 'moderation_notice'] } }
	}
	if (config.inAppSocial) {
		return {
			OR: [
				{ type: { not: 'release_reminder' } },
				{ type: 'moderation_notice' },
			],
		}
	}
	return { type: 'moderation_notice' }
}
