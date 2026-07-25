import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { action as followAction } from './follow.ts'
import { action } from './user-safety.ts'

async function fixture() {
	const suffix = faker.string.alphanumeric({ length: 10 }).toLowerCase()
	const [owner, target] = await Promise.all([
		prisma.user.create({
			data: {
				email: `safety-owner-${suffix}@example.com`,
				username: `safety-owner-${suffix}`,
			},
		}),
		prisma.user.create({
			data: {
				email: `safety-target-${suffix}@example.com`,
				username: `safety-target-${suffix}`,
			},
		}),
	])
	const session = await prisma.session.create({
		data: { userId: owner.id, expirationDate: getSessionExpirationDate() },
	})
	return {
		owner,
		target,
		cookie: await getSessionCookieHeader(session),
	}
}

function jsonRequest(path: string, cookie: string, body: unknown) {
	return new Request(`${BASE_URL}${path}`, {
		method: 'POST',
		headers: { cookie, 'content-type': 'application/json' },
		body: JSON.stringify(body),
	})
}

test('blocking severs follows and prevents new direct interaction', async () => {
	const { owner, target, cookie } = await fixture()
	await prisma.follow.create({
		data: { followerId: owner.id, followingId: target.id },
	})
	const response = await action({
		request: jsonRequest('/resources/user-safety', cookie, {
			targetId: target.id,
			kind: 'block',
			enabled: true,
		}),
	} as any)
	expect(response.data).toEqual({
		ok: true,
		data: {
			isMuted: false,
			isBlocked: true,
			isBlockedByTarget: false,
		},
	})
	expect(await prisma.follow.count()).toBe(0)

	const follow = await followAction({
		request: jsonRequest('/resources/follow', cookie, {
			userId: target.id,
			intent: 'follow',
		}),
	} as any).catch(error => error)
	expect(follow).toBeInstanceOf(Response)
	expect((follow as Response).status).toBe(404)
})

test('mute is private, idempotent, and independently reversible', async () => {
	const { target, cookie } = await fixture()
	for (const enabled of [true, true, false]) {
		await action({
			request: jsonRequest('/resources/user-safety', cookie, {
				targetId: target.id,
				kind: 'mute',
				enabled,
			}),
		} as any)
	}
	expect(await prisma.userSafetyControl.count()).toBe(0)
})
