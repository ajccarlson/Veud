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
				kind: 'anime',
				releaseStart: new Date('2026-07-18T00:00:00.000Z'),
				releaseEnd: null,
				releaseStatus: 'Currently Airing',
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

test('rejects reminders backed by an ended title with a stale schedule', () => {
	expect(
		getNextCanonicalReminderRelease(
			{
				kind: 'anime',
				releaseStart: new Date('2005-01-07T00:00:00.000Z'),
				releaseEnd: new Date('2005-03-25T00:00:00.000Z'),
				releaseStatus: 'Finished Airing',
				nextRelease: JSON.stringify({
					releaseDate: '2026-07-20T18:30:00.000Z',
					episode: 2,
				}),
			},
			new Date('2026-07-19T10:00:00.000Z'),
		),
	).toBeNull()
})

test('removes a previously delivered notification when its schedule becomes invalid', async () => {
	const owner = await createOwner()
	const now = new Date('2026-07-19T10:00:00.000Z')
	const releaseAt = new Date('2026-07-20T18:30:00.000Z')
	const media = await prisma.media.create({
		data: {
			kind: 'anime',
			title: 'Invalidated Reminder Fixture',
			releaseStart: new Date('2005-01-07T00:00:00.000Z'),
			releaseEnd: new Date('2005-03-25T00:00:00.000Z'),
			releaseStatus: 'Finished Airing',
			nextRelease: JSON.stringify({
				releaseDate: releaseAt.toISOString(),
				episode: 2,
			}),
		},
	})
	const reminder = await prisma.releaseReminder.create({
		data: { ownerId: owner.id, mediaId: media.id, leadMinutes: 1440 },
	})
	await prisma.notification.create({
		data: {
			type: 'release_reminder',
			recipientId: owner.id,
			releaseReminderId: reminder.id,
			releaseAt,
			availableAt: new Date('2026-07-19T09:00:00.000Z'),
		},
	})

	await syncReleaseRemindersForUser(prisma, owner.id, now)

	expect(
		await prisma.notification.count({
			where: { releaseReminderId: reminder.id },
		}),
	).toBe(0)
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
