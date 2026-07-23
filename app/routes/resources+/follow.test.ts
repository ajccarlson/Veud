import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { action } from './follow.ts'

async function fixture() {
	const suffix = faker.string.alphanumeric({ length: 10 }).toLowerCase()
	const [follower, following] = await Promise.all([
		prisma.user.create({
			data: {
				email: `follower_${suffix}@example.com`,
				username: `follower_${suffix}`,
			},
		}),
		prisma.user.create({
			data: {
				email: `following_${suffix}@example.com`,
				username: `following_${suffix}`,
			},
		}),
	])
	const session = await prisma.session.create({
		data: { userId: follower.id, expirationDate: getSessionExpirationDate() },
	})
	return {
		follower,
		following,
		request: new Request(BASE_URL, {
			method: 'POST',
			headers: { cookie: await getSessionCookieHeader(session) },
		}),
	}
}

function args(
	request: Request,
	input: Record<string, string>,
): Parameters<typeof action>[0] {
	const headers = new Headers(request.headers)
	headers.set('content-type', 'application/json')
	return {
		request: new Request(request.url, {
			method: 'POST',
			headers,
			body: JSON.stringify(input),
		}),
		url: new URL(request.url),
		params: {},
	} as any
}

test('follow and unfollow are explicit and idempotent', async () => {
	const data = await fixture()
	const input = { userId: data.following.id, intent: 'follow' }
	await action(args(data.request, input))
	await action(args(data.request, input))
	expect(
		await prisma.follow.count({
			where: { followerId: data.follower.id, followingId: data.following.id },
		}),
	).toBe(1)

	await action(args(data.request, { ...input, intent: 'unfollow' }))
	expect(
		await prisma.follow.count({
			where: { followerId: data.follower.id, followingId: data.following.id },
		}),
	).toBe(0)
})

test('unknown intents and missing profiles are rejected', async () => {
	const data = await fixture()
	for (const [input, status] of [
		[{ userId: data.following.id, intent: 'toggle' }, 400],
		[{ userId: 'missing-user', intent: 'follow' }, 404],
	] as const) {
		const response = await action(args(data.request, input)).catch(
			error => error,
		)
		expect(response).toBeInstanceOf(Response)
		expect((response as Response).status).toBe(status)
	}
})

test('follow mutations require a JSON request body', async () => {
	const data = await fixture()
	const response = await action({
		request: data.request,
		url: new URL(data.request.url),
		params: {},
	} as any).catch(error => error)
	expect(response).toBeInstanceOf(Response)
	expect((response as Response).status).toBe(415)
})
