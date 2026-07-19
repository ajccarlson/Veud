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
