import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { action, loader } from './notifications.tsx'

async function createUser(prefix: string) {
	const suffix = faker.string.alphanumeric({ length: 10 }).toLowerCase()
	return prisma.user.create({
		data: {
			email: `${prefix}_${suffix}@example.com`,
			username: `${prefix}_${suffix}`,
			name: `${prefix} member`,
		},
	})
}

async function cookieFor(userId: string) {
	const session = await prisma.session.create({
		data: { userId, expirationDate: getSessionExpirationDate() },
	})
	return getSessionCookieHeader(session)
}

function actionRequest(cookie: string, values: Record<string, string>) {
	return new Request(`${BASE_URL}/notifications`, {
		method: 'POST',
		headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams(values),
	})
}

test('notification inbox is recipient-scoped and marks an item read before redirecting', async () => {
	const [recipient, actor, unrelated] = await Promise.all([
		createUser('recipient'),
		createUser('actor'),
		createUser('unrelated'),
	])
	const media = await prisma.media.create({
		data: { kind: 'movie', title: 'Notification Fixture' },
	})
	const review = await prisma.review.create({
		data: { authorId: recipient.id, mediaId: media.id, body: 'Review body' },
	})
	const like = await prisma.reviewLike.create({
		data: { userId: actor.id, reviewId: review.id },
	})
	const notification = await prisma.notification.create({
		data: {
			type: 'review_like',
			recipientId: recipient.id,
			actorId: actor.id,
			reviewId: review.id,
			reviewLikeId: like.id,
		},
	})
	const [recipientCookie, unrelatedCookie] = await Promise.all([
		cookieFor(recipient.id),
		cookieFor(unrelated.id),
	])

	const result = await loader({
		request: new Request(`${BASE_URL}/notifications`, {
			headers: { cookie: recipientCookie },
		}),
		params: {},
	} as any)
	expect(result.data.unreadCount).toBe(1)
	expect(result.data.notifications).toEqual([
		expect.objectContaining({
			id: notification.id,
			type: 'review_like',
			actor: expect.objectContaining({ username: actor.username }),
			review: expect.objectContaining({
				id: review.id,
				media: expect.objectContaining({ id: media.id }),
			}),
		}),
	])

	const denied = await action({
		request: actionRequest(unrelatedCookie, {
			intent: 'read',
			notificationId: notification.id,
		}),
		params: {},
	} as any).catch(error => error)
	expect(denied).toBeInstanceOf(Response)
	expect((denied as Response).status).toBe(404)

	const response = await action({
		request: actionRequest(recipientCookie, {
			intent: 'read',
			notificationId: notification.id,
		}),
		params: {},
	} as any)
	expect(response).toBeInstanceOf(Response)
	expect((response as Response).status).toBe(302)
	expect((response as Response).headers.get('location')).toBe(
		`/media/${media.id}#review-${review.id}`,
	)
	expect(
		await prisma.notification.findUnique({ where: { id: notification.id } }),
	).toEqual(expect.objectContaining({ readAt: expect.any(Date) }))
})

test('mark all read affects only the signed-in recipient', async () => {
	const [recipient, actor] = await Promise.all([
		createUser('recipient'),
		createUser('actor'),
	])
	const media = await prisma.media.create({
		data: { kind: 'anime', title: 'Bulk Read Fixture' },
	})
	const review = await prisma.review.create({
		data: { authorId: recipient.id, mediaId: media.id, body: 'Review body' },
	})
	const comment = await prisma.reviewComment.create({
		data: { authorId: actor.id, reviewId: review.id, body: 'Comment body' },
	})
	await prisma.notification.create({
		data: {
			type: 'review_comment',
			recipientId: recipient.id,
			actorId: actor.id,
			reviewId: review.id,
			reviewCommentId: comment.id,
		},
	})
	const cookie = await cookieFor(recipient.id)

	await action({
		request: actionRequest(cookie, { intent: 'read-all' }),
		params: {},
	} as any)

	expect(
		await prisma.notification.count({
			where: { recipientId: recipient.id, readAt: null },
		}),
	).toBe(0)
})

test('inbox preferences filter delivery and bulk-read only visible categories', async () => {
	const recipient = await createUser('filtered_recipient')
	await prisma.notificationPreference.create({
		data: {
			ownerId: recipient.id,
			inAppSocial: false,
			inAppReleases: true,
		},
	})
	const [social, release] = await Promise.all([
		prisma.notification.create({
			data: { type: 'review_like', recipientId: recipient.id },
		}),
		prisma.notification.create({
			data: { type: 'release_reminder', recipientId: recipient.id },
		}),
	])
	const cookie = await cookieFor(recipient.id)

	const result = await loader({
		request: new Request(`${BASE_URL}/notifications`, {
			headers: { cookie },
		}),
		params: {},
	} as any)
	expect(result.data.notifications.map(notification => notification.id)).toEqual([
		release.id,
	])
	expect(result.data.unreadCount).toBe(1)

	await action({
		request: actionRequest(cookie, { intent: 'read-all' }),
		params: {},
	} as any)
	expect(
		await prisma.notification.findUniqueOrThrow({ where: { id: release.id } }),
	).toMatchObject({ readAt: expect.any(Date) })
	expect(
		await prisma.notification.findUniqueOrThrow({ where: { id: social.id } }),
	).toMatchObject({ readAt: null })
})

test('collection discussion notifications open the source comment', async () => {
	const [recipient, actor] = await Promise.all([
		createUser('collection_recipient'),
		createUser('collection_actor'),
	])
	const collection = await prisma.mediaCollection.create({
		data: {
			ownerId: recipient.id,
			title: 'Notification Collection',
			isPublic: true,
		},
	})
	const comment = await prisma.collectionComment.create({
		data: {
			authorId: actor.id,
			collectionId: collection.id,
			body: 'A useful collection comment.',
		},
	})
	const notification = await prisma.notification.create({
		data: {
			type: 'collection_comment',
			recipientId: recipient.id,
			actorId: actor.id,
			collectionId: collection.id,
			collectionCommentId: comment.id,
		},
	})
	const cookie = await cookieFor(recipient.id)

	const result = await loader({
		request: new Request(`${BASE_URL}/notifications`, {
			headers: { cookie },
		}),
		params: {},
	} as any)
	expect(result.data.notifications).toEqual([
		expect.objectContaining({
			id: notification.id,
			type: 'collection_comment',
			collectionCommentId: comment.id,
			review: null,
			collection: { id: collection.id, title: collection.title },
		}),
	])

	const response = await action({
		request: actionRequest(cookie, {
			intent: 'read',
			notificationId: notification.id,
		}),
		params: {},
	} as any)
	expect(response).toBeInstanceOf(Response)
	expect((response as Response).headers.get('location')).toBe(
		`/collections/${collection.id}#collection-comment-${comment.id}`,
	)
	expect(
		await prisma.notification.findUnique({ where: { id: notification.id } }),
	).toEqual(expect.objectContaining({ readAt: expect.any(Date) }))
})

test('release reminders stay hidden until due and open their canonical title', async () => {
	const recipient = await createUser('release_recipient')
	const releaseAt = new Date(Date.now() + 2 * 60 * 60 * 1000)
	const media = await prisma.media.create({
		data: {
			kind: 'anime',
			title: 'Release Notification Fixture',
			nextRelease: JSON.stringify({
				releaseDate: releaseAt.toISOString(),
				episode: 4,
			}),
		},
	})
	const reminder = await prisma.releaseReminder.create({
		data: { ownerId: recipient.id, mediaId: media.id, leadMinutes: 60 },
	})
	const notification = await prisma.notification.create({
		data: {
			type: 'release_reminder',
			recipientId: recipient.id,
			releaseReminderId: reminder.id,
			releaseAt,
			availableAt: new Date(Date.now() + 60 * 60 * 1000),
		},
	})
	const cookie = await cookieFor(recipient.id)

	const pending = await loader({
		request: new Request(`${BASE_URL}/notifications`, {
			headers: { cookie },
		}),
		params: {},
	} as any)
	expect(pending.data.notifications).toEqual([])
	expect(pending.data.unreadCount).toBe(0)

	const earlyRead = await action({
		request: actionRequest(cookie, {
			intent: 'read',
			notificationId: notification.id,
		}),
		params: {},
	} as any).catch(error => error)
	expect(earlyRead).toBeInstanceOf(Response)
	expect((earlyRead as Response).status).toBe(404)

	await action({
		request: actionRequest(cookie, { intent: 'read-all' }),
		params: {},
	} as any)
	expect(
		await prisma.notification.findUniqueOrThrow({
			where: { id: notification.id },
		}),
	).toMatchObject({ readAt: null })

	await prisma.notification.update({
		where: { id: notification.id },
		data: { availableAt: new Date(Date.now() - 60 * 1000) },
	})
	const due = await loader({
		request: new Request(`${BASE_URL}/notifications`, {
			headers: { cookie },
		}),
		params: {},
	} as any)
	expect(due.data.notifications).toEqual([
		expect.objectContaining({
			id: notification.id,
			type: 'release_reminder',
			actor: null,
			releaseReminder: {
				media: expect.objectContaining({ id: media.id, title: media.title }),
			},
		}),
	])
	expect(due.data.unreadCount).toBe(1)

	const response = await action({
		request: actionRequest(cookie, {
			intent: 'read',
			notificationId: notification.id,
		}),
		params: {},
	} as any)
	expect(response).toBeInstanceOf(Response)
	expect((response as Response).headers.get('location')).toBe(
		`/media/${media.id}`,
	)
})
