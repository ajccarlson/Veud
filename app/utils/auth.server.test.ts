import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import {
	getSessionExpirationDate,
	getUserId,
	requireUserId,
} from './auth.server.ts'
import { prisma } from './db.server.ts'

async function createAuthenticatedRequest(lastActiveAt: Date | null) {
	const suffix = faker.string.alphanumeric({ length: 12 }).toLowerCase()
	const user = await prisma.user.create({
		data: {
			email: `${suffix}@example.com`,
			username: `u_${suffix}`,
			lastActiveAt,
		},
		select: { id: true },
	})
	const session = await prisma.session.create({
		data: {
			userId: user.id,
			expirationDate: getSessionExpirationDate(),
		},
		select: { id: true },
	})
	const cookie = await getSessionCookieHeader(session)
	return {
		userId: user.id,
		request: new Request(BASE_URL, { headers: { cookie } }),
	}
}

test('authenticated activity initializes a missing last-active timestamp', async () => {
	const before = new Date()
	const { request, userId } = await createAuthenticatedRequest(null)

	expect(await getUserId(request)).toBe(userId)

	const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
	expect(user.lastActiveAt?.getTime()).toBeGreaterThanOrEqual(before.getTime())
})

test('authenticated activity does not rewrite a recent timestamp', async () => {
	const lastActiveAt = new Date(Date.now() - 60_000)
	const { request, userId } = await createAuthenticatedRequest(lastActiveAt)

	expect(await getUserId(request)).toBe(userId)

	const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
	expect(user.lastActiveAt).toEqual(lastActiveAt)
})

test('authenticated activity refreshes a stale timestamp', async () => {
	const before = new Date()
	const { request, userId } = await createAuthenticatedRequest(
		new Date(Date.now() - 60 * 60 * 1000),
	)

	expect(await getUserId(request)).toBe(userId)

	const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
	expect(user.lastActiveAt?.getTime()).toBeGreaterThanOrEqual(before.getTime())
})

test('requireUserId uses the normalized URL for login redirects', async () => {
	const request = new Request(
		'https://veud.test/settings/profile.data?_routes=routes/settings/profile',
	)
	const url = new URL('https://veud.test/settings/profile?tab=security')

	const response = await requireUserId(request, { url }).catch(error => error)

	expect(response).toBeInstanceOf(Response)
	const location = new URL((response as Response).headers.get('location')!, url)
	expect(location.pathname).toBe('/login')
	expect(location.searchParams.get('redirectTo')).toBe(
		'/settings/profile?tab=security',
	)
})
