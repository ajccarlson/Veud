import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import {
	changeUserPassword,
	getPasswordHash,
	getSessionExpirationDate,
	getUserId,
	login,
	requireUserId,
	resetUserPassword,
	verifyUserPassword,
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

test('login accepts either a username or an email address', async () => {
	const suffix = faker.string.alphanumeric({ length: 12 }).toLowerCase()
	const password = faker.internet.password()
	const user = await prisma.user.create({
		data: {
			email: `${suffix}@example.com`,
			username: `u_${suffix}`,
			password: { create: { hash: await getPasswordHash(password) } },
		},
		select: { id: true, email: true, username: true },
	})

	const usernameSession = await login({
		usernameOrEmail: user.username.toUpperCase(),
		password,
	})
	const emailSession = await login({
		usernameOrEmail: user.email.toUpperCase(),
		password,
	})

	expect(usernameSession?.userId).toBe(user.id)
	expect(emailSession?.userId).toBe(user.id)
	expect(
		await login({
			usernameOrEmail: user.email,
			password: 'incorrect-password',
		}),
	).toBeNull()
})

test('password recovery creates a missing credential and revokes every session', async () => {
	const suffix = faker.string.alphanumeric({ length: 12 }).toLowerCase()
	const user = await prisma.user.create({
		data: {
			email: `${suffix}@example.com`,
			username: `oauth_${suffix}`,
			sessions: {
				create: [
					{ expirationDate: getSessionExpirationDate() },
					{ expirationDate: getSessionExpirationDate() },
				],
			},
		},
		select: { id: true, username: true },
	})

	await resetUserPassword({
		username: user.username,
		password: 'Recovered-password-123!',
	})

	expect(
		await verifyUserPassword({ id: user.id }, 'Recovered-password-123!'),
	).toEqual({ id: user.id })
	expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0)
})

test('authenticated password changes retain only the current session', async () => {
	const suffix = faker.string.alphanumeric({ length: 12 }).toLowerCase()
	const user = await prisma.user.create({
		data: {
			email: `${suffix}@example.com`,
			username: `password_${suffix}`,
			password: {
				create: { hash: await getPasswordHash('Old-password-123!') },
			},
			sessions: {
				create: [
					{ expirationDate: getSessionExpirationDate() },
					{ expirationDate: getSessionExpirationDate() },
				],
			},
		},
		select: {
			id: true,
			sessions: { orderBy: { id: 'asc' }, select: { id: true } },
		},
	})
	const currentSessionId = user.sessions[0]!.id

	await changeUserPassword({
		userId: user.id,
		password: 'New-password-123!',
		preserveSessionId: currentSessionId,
	})

	expect(
		await prisma.session.findMany({
			where: { userId: user.id },
			select: { id: true },
		}),
	).toEqual([{ id: currentSessionId }])
	expect(
		await verifyUserPassword({ id: user.id }, 'New-password-123!'),
	).toEqual({ id: user.id })
})

test('suspended accounts cannot authenticate and active sessions are revoked', async () => {
	const suffix = faker.string.alphanumeric({ length: 12 }).toLowerCase()
	const password = 'Suspended-password-123!'
	const user = await prisma.user.create({
		data: {
			email: `${suffix}@example.com`,
			username: `suspended_${suffix}`,
			accountStatus: 'suspended',
			suspensionEndsAt: new Date(Date.now() + 86_400_000),
			accountStatusReason: 'Account safety review.',
			password: { create: { hash: await getPasswordHash(password) } },
			sessions: { create: { expirationDate: getSessionExpirationDate() } },
		},
		select: { id: true, sessions: { select: { id: true } } },
	})

	expect(await verifyUserPassword({ id: user.id }, password)).toBeNull()
	const cookie = await getSessionCookieHeader(user.sessions[0]!)
	const response = await getUserId(
		new Request(BASE_URL, { headers: { cookie } }),
	).catch(error => error)
	expect(response).toBeInstanceOf(Response)
	expect((response as Response).headers.get('location')).toBe(
		'/login?account=suspended',
	)
	expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0)
})

test('expired timed suspensions are cleared automatically', async () => {
	const suffix = faker.string.alphanumeric({ length: 12 }).toLowerCase()
	const password = 'Restored-password-123!'
	const user = await prisma.user.create({
		data: {
			email: `${suffix}@example.com`,
			username: `restored_${suffix}`,
			accountStatus: 'suspended',
			suspensionEndsAt: new Date(Date.now() - 60_000),
			accountStatusReason: 'Expired action.',
			password: { create: { hash: await getPasswordHash(password) } },
		},
		select: { id: true },
	})

	expect(await verifyUserPassword({ id: user.id }, password)).toEqual({
		id: user.id,
	})
	expect(
		await prisma.user.findUniqueOrThrow({
			where: { id: user.id },
			select: {
				accountStatus: true,
				suspensionEndsAt: true,
				accountStatusReason: true,
			},
		}),
	).toEqual({
		accountStatus: 'active',
		suspensionEndsAt: null,
		accountStatusReason: null,
	})
	await expect(
		prisma.moderationAction.findFirst({
			where: {
				subjectId: user.id,
				action: 'account_suspension_expired',
			},
			select: {
				actorId: true,
				previousStatus: true,
				nextStatus: true,
			},
		}),
	).resolves.toEqual({
		actorId: null,
		previousStatus: 'suspended',
		nextStatus: 'active',
	})
})
