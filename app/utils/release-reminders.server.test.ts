import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { prisma } from './db.server.ts'
import {
	getNextCanonicalReminderRelease,
	removeReleaseReminder,
	saveReleaseReminder,
	syncReleaseRemindersForUser,
} from './release-reminders.server.ts'

async function createOwner() {
	const suffix = faker.string.alphanumeric({ length: 10 }).toLowerCase()
	return prisma.user.create({
		data: {
			email: `reminder_${suffix}@example.com`,
			username: `reminder_${suffix}`,
		},
	})
}

test('selects the earliest canonical future release and describes its installment', () => {
	const now = new Date('2026-07-19T10:00:00.000Z')
	expect(
		getNextCanonicalReminderRelease(
			{
				releaseStart: new Date('2026-07-22T00:00:00.000Z'),
				nextRelease: JSON.stringify({
					releaseDate: '2026-07-20T18:30:00.000Z',
					season: 2,
					episode: 4,
				}),
			},
			now,
		),
	).toEqual({
		releaseAt: new Date('2026-07-20T18:30:00.000Z'),
		allDay: false,
		label: 'Season 2 · Episode 4',
	})
})

test('creates one scheduled notification and reschedules a pending release', async () => {
	const owner = await createOwner()
	const now = new Date('2026-07-19T10:00:00.000Z')
	const firstRelease = new Date('2026-07-19T14:00:00.000Z')
	const secondRelease = new Date('2026-07-20T18:00:00.000Z')
	const media = await prisma.media.create({
		data: {
			kind: 'anime',
			title: 'Scheduled Reminder Fixture',
			nextRelease: JSON.stringify({
				releaseDate: firstRelease.toISOString(),
				episode: 8,
			}),
		},
	})

	const reminder = await saveReleaseReminder(
		prisma,
		{ ownerId: owner.id, mediaId: media.id, leadMinutes: 60 },
		now,
	)
	let notifications = await prisma.notification.findMany({
		where: { releaseReminderId: reminder.id },
	})
	expect(notifications).toHaveLength(1)
	expect(notifications[0]).toMatchObject({
		type: 'release_reminder',
		recipientId: owner.id,
		actorId: null,
		releaseAt: firstRelease,
		availableAt: new Date('2026-07-19T13:00:00.000Z'),
	})

	await Promise.all([
		syncReleaseRemindersForUser(prisma, owner.id, now),
		syncReleaseRemindersForUser(prisma, owner.id, now),
	])
	expect(
		await prisma.notification.count({
			where: { releaseReminderId: reminder.id },
		}),
	).toBe(1)

	await prisma.media.update({
		where: { id: media.id },
		data: {
			nextRelease: JSON.stringify({
				releaseDate: secondRelease.toISOString(),
				episode: 9,
			}),
		},
	})
	await syncReleaseRemindersForUser(prisma, owner.id, now)
	notifications = await prisma.notification.findMany({
		where: { releaseReminderId: reminder.id },
	})
	expect(notifications).toHaveLength(1)
	expect(notifications[0]).toMatchObject({
		releaseAt: secondRelease,
		availableAt: new Date('2026-07-20T17:00:00.000Z'),
	})

	await saveReleaseReminder(
		prisma,
		{ ownerId: owner.id, mediaId: media.id, leadMinutes: 0 },
		now,
	)
	expect(
		await prisma.notification.findFirstOrThrow({
			where: { releaseReminderId: reminder.id },
		}),
	).toMatchObject({ releaseAt: secondRelease, availableAt: secondRelease })
})

test('keeps an unscheduled subscription and cascades notifications on removal', async () => {
	const owner = await createOwner()
	const now = new Date('2026-07-19T10:00:00.000Z')
	const media = await prisma.media.create({
		data: { kind: 'manga', title: 'Unscheduled Reminder Fixture' },
	})
	const reminder = await saveReleaseReminder(
		prisma,
		{ ownerId: owner.id, mediaId: media.id, leadMinutes: 1440 },
		now,
	)
	expect(
		await prisma.notification.count({
			where: { releaseReminderId: reminder.id },
		}),
	).toBe(0)

	await prisma.media.update({
		where: { id: media.id },
		data: { releaseStart: new Date('2026-07-24T00:00:00.000Z') },
	})
	await syncReleaseRemindersForUser(prisma, owner.id, now)
	expect(
		await prisma.notification.count({
			where: { releaseReminderId: reminder.id },
		}),
	).toBe(1)

	await removeReleaseReminder(prisma, {
		ownerId: owner.id,
		mediaId: media.id,
	})
	expect(
		await prisma.notification.count({
			where: { releaseReminderId: reminder.id },
		}),
	).toBe(0)
})
