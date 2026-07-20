import { type Prisma } from '@prisma/client'
import { parseStoredNextRelease } from './release-calendar.server.ts'

const MINUTE_MS = 60 * 1_000

export const releaseReminderLeadMinutes = [0, 60, 24 * 60] as const
export type ReleaseReminderLeadMinutes =
	(typeof releaseReminderLeadMinutes)[number]

type ReminderDatabase = Pick<
	Prisma.TransactionClient,
	'releaseReminder' | 'notification'
>

type ReminderMedia = {
	releaseStart: Date | null
	nextRelease: string | null
}

export type CanonicalReminderRelease = {
	releaseAt: Date
	allDay: boolean
	label: string
}

function nextReleaseLabel(release: ReturnType<typeof parseStoredNextRelease>) {
	if (!release) return 'Scheduled release'
	if (release.chapter !== null) {
		return release.volume === null
			? `Chapter ${release.chapter}`
			: `Volume ${release.volume} · Chapter ${release.chapter}`
	}
	if (release.episode !== null) {
		return release.season === null
			? `Episode ${release.episode}`
			: `Season ${release.season} · Episode ${release.episode}`
	}
	return 'Scheduled release'
}

export function getNextCanonicalReminderRelease(
	media: ReminderMedia,
	now = new Date(),
): CanonicalReminderRelease | null {
	const candidates: CanonicalReminderRelease[] = []
	const next = parseStoredNextRelease(media.nextRelease)
	if (next && next.releaseAt.getTime() > now.getTime()) {
		candidates.push({
			releaseAt: next.releaseAt,
			allDay: next.allDay,
			label: nextReleaseLabel(next),
		})
	}
	if (media.releaseStart && media.releaseStart.getTime() > now.getTime()) {
		const allDay =
			media.releaseStart.getUTCHours() === 0 &&
			media.releaseStart.getUTCMinutes() === 0 &&
			media.releaseStart.getUTCSeconds() === 0
		if (
			!candidates.some(
				candidate =>
					candidate.releaseAt.toISOString().slice(0, 10) ===
					media.releaseStart!.toISOString().slice(0, 10),
			)
		) {
			candidates.push({
				releaseAt: media.releaseStart,
				allDay,
				label: 'Premiere',
			})
		}
	}
	return (
		candidates.sort(
			(left, right) => left.releaseAt.getTime() - right.releaseAt.getTime(),
		)[0] ?? null
	)
}

function notificationAvailableAt(releaseAt: Date, leadMinutes: number) {
	return new Date(releaseAt.getTime() - leadMinutes * MINUTE_MS)
}

async function reconcileReminder(
	db: ReminderDatabase,
	reminder: {
		id: string
		ownerId: string
		leadMinutes: number
		media: ReminderMedia
		notifications: Array<{
			id: string
			releaseAt: Date | null
			availableAt: Date
		}>
	},
	now: Date,
) {
	const release = getNextCanonicalReminderRelease(reminder.media, now)
	const releaseTime = release?.releaseAt.getTime() ?? null
	const stalePendingIds = reminder.notifications
		.filter(
			notification =>
				notification.availableAt.getTime() > now.getTime() &&
				notification.releaseAt?.getTime() !== releaseTime,
		)
		.map(notification => notification.id)
	if (stalePendingIds.length) {
		await db.notification.deleteMany({
			where: { id: { in: stalePendingIds } },
		})
	}
	if (!release) return null

	const availableAt = notificationAvailableAt(
		release.releaseAt,
		reminder.leadMinutes,
	)
	const existing = reminder.notifications.find(
		notification => notification.releaseAt?.getTime() === releaseTime,
	)
	if (existing) {
		if (
			existing.availableAt.getTime() > now.getTime() &&
			existing.availableAt.getTime() !== availableAt.getTime()
		) {
			await db.notification.update({
				where: { id: existing.id },
				data: { availableAt },
			})
		}
		return existing.id
	}

	const notification = await db.notification.upsert({
		where: {
			releaseReminderId_releaseAt: {
				releaseReminderId: reminder.id,
				releaseAt: release.releaseAt,
			},
		},
		update: {},
		create: {
			type: 'release_reminder',
			recipientId: reminder.ownerId,
			releaseReminderId: reminder.id,
			releaseAt: release.releaseAt,
			availableAt,
		},
		select: { id: true },
	})
	return notification.id
}

export async function syncReleaseRemindersForUser(
	db: ReminderDatabase,
	ownerId: string,
	now = new Date(),
) {
	const reminders = await db.releaseReminder.findMany({
		where: { ownerId },
		select: {
			id: true,
			ownerId: true,
			leadMinutes: true,
			media: { select: { releaseStart: true, nextRelease: true } },
			notifications: {
				where: { releaseAt: { gt: now } },
				select: { id: true, releaseAt: true, availableAt: true },
			},
		},
	})
	for (const reminder of reminders) {
		await reconcileReminder(db, reminder, now)
	}
	return reminders.length
}

export async function saveReleaseReminder(
	db: ReminderDatabase,
	input: {
		ownerId: string
		mediaId: string
		leadMinutes: ReleaseReminderLeadMinutes
	},
	now = new Date(),
) {
	const reminder = await db.releaseReminder.upsert({
		where: {
			ownerId_mediaId: {
				ownerId: input.ownerId,
				mediaId: input.mediaId,
			},
		},
		update: { leadMinutes: input.leadMinutes },
		create: input,
		select: {
			id: true,
			ownerId: true,
			leadMinutes: true,
			media: { select: { releaseStart: true, nextRelease: true } },
			notifications: {
				where: { releaseAt: { gt: now } },
				select: { id: true, releaseAt: true, availableAt: true },
			},
		},
	})
	await reconcileReminder(db, reminder, now)
	return reminder
}

export async function removeReleaseReminder(
	db: ReminderDatabase,
	input: { ownerId: string; mediaId: string },
) {
	return db.releaseReminder.deleteMany({
		where: input,
	})
}
