import { faker } from '@faker-js/faker'
import { expect, test, vi } from 'vitest'
import { prisma } from './db.server.ts'
import { processDueNotificationDigests } from './notification-digests.server.ts'

test('due digests include only opted-in categories and advance idempotently', async () => {
	const suffix = faker.string.alphanumeric({ length: 10 }).toLowerCase()
	const [owner, actor] = await Promise.all([
		prisma.user.create({
			data: {
				email: `digest_owner_${suffix}@example.com`,
				username: `digest_owner_${suffix}`,
			},
		}),
		prisma.user.create({
			data: {
				email: `digest_actor_${suffix}@example.com`,
				username: `digest_actor_${suffix}`,
			},
		}),
	])
	const media = await prisma.media.create({
		data: { kind: 'movie', title: 'Digest Fixture' },
	})
	const review = await prisma.review.create({
		data: { authorId: owner.id, mediaId: media.id, body: 'Digest review' },
	})
	const now = new Date('2026-07-23T09:05:00.000Z')
	await Promise.all([
		prisma.notificationPreference.create({
			data: {
				ownerId: owner.id,
				emailSocial: true,
				emailReleases: false,
				digestFrequency: 'daily',
				digestHour: 9,
				timeZone: 'UTC',
				nextDigestAt: new Date('2026-07-23T09:00:00.000Z'),
			},
		}),
		prisma.notification.create({
			data: {
				type: 'review_like',
				recipientId: owner.id,
				actorId: actor.id,
				reviewId: review.id,
				availableAt: new Date('2026-07-23T08:00:00.000Z'),
			},
		}),
		prisma.notification.create({
			data: {
				type: 'release_reminder',
				recipientId: owner.id,
				availableAt: new Date('2026-07-23T08:30:00.000Z'),
			},
		}),
	])
	const send = vi.fn(async () => ({
		status: 'success' as const,
		data: { id: 'digest-provider-id' },
	}))

	const outcomes = await processDueNotificationDigests({
		now,
		commit: true,
		send,
	})
	expect(outcomes).toEqual([{ ownerId: owner.id, status: 'sent', itemCount: 1 }])
	expect(send).toHaveBeenCalledWith(
		expect.objectContaining({
			to: owner.email,
			subject: '1 new Veud notification',
			text: expect.stringContaining('liked your review of Digest Fixture'),
		}),
	)
	expect(
		await prisma.notificationDigest.findFirstOrThrow({
			where: { ownerId: owner.id },
		}),
	).toMatchObject({
		status: 'sent',
		itemCount: 1,
		providerMessageId: 'digest-provider-id',
	})
	expect(
		await prisma.notificationPreference.findUniqueOrThrow({
			where: { ownerId: owner.id },
		}),
	).toMatchObject({
		nextDigestAt: new Date('2026-07-24T09:00:00.000Z'),
	})

	expect(
		await processDueNotificationDigests({ now, commit: true, send }),
	).toEqual([])
	expect(send).toHaveBeenCalledTimes(1)
})

test('a stale sending claim can be recovered after a worker interruption', async () => {
	const suffix = faker.string.alphanumeric({ length: 10 }).toLowerCase()
	const owner = await prisma.user.create({
		data: {
			email: `digest_recovery_${suffix}@example.com`,
			username: `digest_recovery_${suffix}`,
		},
	})
	const windowStart = new Date('2026-07-22T09:00:00.000Z')
	const windowEnd = new Date('2026-07-23T09:00:00.000Z')
	const now = new Date('2026-07-23T10:00:00.000Z')
	await prisma.notificationPreference.create({
		data: {
			ownerId: owner.id,
			emailSocial: true,
			digestFrequency: 'daily',
			digestHour: 9,
			timeZone: 'UTC',
			nextDigestAt: windowEnd,
		},
	})
	await prisma.notification.create({
		data: {
			type: 'review_like',
			recipientId: owner.id,
			availableAt: new Date('2026-07-23T08:00:00.000Z'),
		},
	})
	const delivery = await prisma.notificationDigest.create({
		data: {
			ownerId: owner.id,
			frequency: 'daily',
			windowStart,
			windowEnd,
			status: 'sending',
			itemCount: 1,
		},
	})
	await prisma.notificationDigest.update({
		where: { id: delivery.id },
		data: { updatedAt: new Date('2026-07-23T09:00:00.000Z') },
	})
	const send = vi.fn(async () => ({
		status: 'success' as const,
		data: { id: 'recovered-provider-id' },
	}))

	expect(
		await processDueNotificationDigests({ now, commit: true, send }),
	).toEqual([{ ownerId: owner.id, status: 'sent', itemCount: 1 }])
	expect(send).toHaveBeenCalledTimes(1)
	expect(
		await prisma.notificationDigest.findUniqueOrThrow({
			where: { id: delivery.id },
		}),
	).toMatchObject({
		status: 'sent',
		providerMessageId: 'recovered-provider-id',
	})
})

test('transport exceptions become durable failed deliveries', async () => {
	const suffix = faker.string.alphanumeric({ length: 10 }).toLowerCase()
	const owner = await prisma.user.create({
		data: {
			email: `digest_failure_${suffix}@example.com`,
			username: `digest_failure_${suffix}`,
		},
	})
	const windowEnd = new Date('2026-07-23T09:00:00.000Z')
	await prisma.notificationPreference.create({
		data: {
			ownerId: owner.id,
			emailSocial: true,
			digestFrequency: 'daily',
			digestHour: 9,
			timeZone: 'UTC',
			nextDigestAt: windowEnd,
		},
	})
	await prisma.notification.create({
		data: {
			type: 'review_like',
			recipientId: owner.id,
			availableAt: new Date('2026-07-23T08:00:00.000Z'),
		},
	})

	expect(
		await processDueNotificationDigests({
			now: new Date('2026-07-23T09:05:00.000Z'),
			commit: true,
			send: vi.fn(async () => {
				throw new Error('Email provider unavailable')
			}),
		}),
	).toEqual([{ ownerId: owner.id, status: 'failed', itemCount: 1 }])
	expect(
		await prisma.notificationDigest.findFirstOrThrow({
			where: { ownerId: owner.id },
		}),
	).toMatchObject({
		status: 'failed',
		error: 'Email provider unavailable',
	})
	expect(
		await prisma.notificationPreference.findUniqueOrThrow({
			where: { ownerId: owner.id },
		}),
	).toMatchObject({ nextDigestAt: windowEnd })
})
