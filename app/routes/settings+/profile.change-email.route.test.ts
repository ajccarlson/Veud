import { faker } from '@faker-js/faker'
import { RouterContextProvider } from 'react-router'
import { expect, test } from 'vitest'
import { action } from '#app/routes/settings+/profile.change-email.tsx'
import {
	getPasswordHash,
	getSessionExpirationDate,
} from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'

test('password-backed email changes require the current password', async () => {
	const suffix = faker.string.alphanumeric({ length: 10 }).toLowerCase()
	const originalEmail = `change_email_${suffix}@example.com`
	const user = await prisma.user.create({
		data: {
			email: originalEmail,
			username: `change_email_${suffix}`,
			password: { create: { hash: await getPasswordHash('correct-password') } },
		},
	})
	const session = await prisma.session.create({
		data: { userId: user.id, expirationDate: getSessionExpirationDate() },
	})
	const request = new Request(`${BASE_URL}/settings/profile/change-email`, {
		method: 'POST',
		headers: {
			cookie: await getSessionCookieHeader(session),
			'content-type': 'application/x-www-form-urlencoded',
		},
		body: new URLSearchParams({
			email: `new_${suffix}@example.com`,
			currentPassword: 'wrong-password',
		}),
	})

	const result = await action({
		request,
		url: new URL(request.url),
		params: {},
		pattern: '/settings/profile/change-email',
		context: new RouterContextProvider(),
	})

	expect(result instanceof Response ? result.status : result.init?.status).toBe(
		400,
	)
	expect(
		(await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).email,
	).toBe(originalEmail)
})
