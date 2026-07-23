import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { action } from './recommendation-feedback.ts'

async function fixture() {
	const suffix = faker.string.alphanumeric({ length: 10 }).toLowerCase()
	const [owner, other, media] = await Promise.all([
		prisma.user.create({
			data: {
				email: `feedback_owner_${suffix}@example.com`,
				username: `feedback_owner_${suffix}`,
			},
		}),
		prisma.user.create({
			data: {
				email: `feedback_other_${suffix}@example.com`,
				username: `feedback_other_${suffix}`,
			},
		}),
		prisma.media.create({
			data: { kind: 'movie', title: `Feedback title ${suffix}` },
		}),
	])
	const session = await prisma.session.create({
		data: { userId: owner.id, expirationDate: getSessionExpirationDate() },
	})
	return {
		owner,
		other,
		media,
		cookie: await getSessionCookieHeader(session),
	}
}

function request(cookie: string, data: Record<string, string>) {
	return new Request(`${BASE_URL}/resources/recommendation-feedback`, {
		method: 'POST',
		headers: { cookie },
		body: new URLSearchParams(data),
	})
}

test('recommendation feedback is validated, private, upserted, and reversible', async () => {
	const { owner, other, media, cookie } = await fixture()
	const invalid = await action({
		request: request(cookie, {
			intent: 'hide',
			mediaId: media.id,
			feedbackType: 'unsupported',
		}),
	} as any)
	expect(invalid.init?.status).toBe(400)

	const hidden = await action({
		request: request(cookie, {
			intent: 'hide',
			mediaId: media.id,
			feedbackType: 'not_interested',
			sourceLane: 'circle',
		}),
	} as any)
	expect(hidden.data).toEqual(
		expect.objectContaining({ ok: true, feedbackType: 'not_interested' }),
	)
	expect(new Headers(hidden.init?.headers).get('cache-control')).toBe(
		'private, no-store',
	)
	await action({
		request: request(cookie, {
			intent: 'hide',
			mediaId: media.id,
			feedbackType: 'show_less',
			sourceLane: 'taste',
		}),
	} as any)
	expect(
		await prisma.recommendationFeedback.findUnique({
			where: { ownerId_mediaId: { ownerId: owner.id, mediaId: media.id } },
		}),
	).toEqual(
		expect.objectContaining({
			feedbackType: 'show_less',
			sourceLane: 'taste',
		}),
	)
	await prisma.recommendationFeedback.create({
		data: {
			ownerId: other.id,
			mediaId: media.id,
			feedbackType: 'not_interested',
		},
	})

	const restored = await action({
		request: request(cookie, { intent: 'restore', mediaId: media.id }),
	} as any)
	expect(restored.data).toEqual(
		expect.objectContaining({ ok: true, intent: 'restore' }),
	)
	expect(
		await prisma.recommendationFeedback.count({
			where: { ownerId: owner.id, mediaId: media.id },
		}),
	).toBe(0)
	expect(
		await prisma.recommendationFeedback.count({
			where: { ownerId: other.id, mediaId: media.id },
		}),
	).toBe(1)
})
