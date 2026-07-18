import { faker } from '@faker-js/faker'
import { RouterContextProvider } from 'react-router'
import { expect, test } from 'vitest'
import { action } from '#app/routes/settings+/profile.index.tsx'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { PROFILE_BIO_MAX_LENGTH } from '#app/utils/profile.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'

function actionArgs(request: Request): Parameters<typeof action>[0] {
	return {
		request,
		url: new URL(request.url),
		pattern: '/settings/profile',
		params: {},
		context: new RouterContextProvider(),
	}
}

function getStatus(response: Response | { init: ResponseInit | null }) {
	return response instanceof Response ? response.status : response.init?.status ?? 200
}

async function createUserAndCookie() {
	const suffix = faker.string.alphanumeric({ length: 12 }).toLowerCase()
	const user = await prisma.user.create({
		data: {
			email: `${suffix}@example.com`,
			username: `u_${suffix}`,
			name: 'Original Name',
		},
		select: { id: true, username: true },
	})
	const session = await prisma.session.create({
		data: {
			userId: user.id,
			expirationDate: getSessionExpirationDate(),
		},
		select: { id: true },
	})
	return { user, cookie: await getSessionCookieHeader(session) }
}

function profileRequest({
	cookie,
	username,
	bio,
}: {
	cookie?: string
	username: string
	bio: string
}) {
	return new Request(`${BASE_URL}/settings/profile`, {
		method: 'POST',
		headers: {
			'content-type': 'application/x-www-form-urlencoded',
			...(cookie ? { cookie } : {}),
		},
		body: new URLSearchParams({
			intent: 'update-profile',
			username,
			name: 'Updated Name',
			bio,
		}),
	})
}

test('a user can save a trimmed markdown bio', async () => {
	const { user, cookie } = await createUserAndCookie()
	const request = profileRequest({
		cookie,
		username: user.username,
		bio: '  ## Hello\n\nI like **anime**.  ',
	})

	const response = await action(actionArgs(request))
	expect(getStatus(response)).toBe(200)
	expect(
		await prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
	).toMatchObject({ bio: '## Hello\n\nI like **anime**.' })
})

test('clearing a bio stores null', async () => {
	const { user, cookie } = await createUserAndCookie()
	await prisma.user.update({
		where: { id: user.id },
		data: { bio: 'Old bio' },
	})

	const response = await action(
		actionArgs(
			profileRequest({ cookie, username: user.username, bio: '   ' }),
		),
	)
	expect(getStatus(response)).toBe(200)
	expect(
		await prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
	).toMatchObject({ bio: null })
})

test('an oversized bio is rejected without changing the user', async () => {
	const { user, cookie } = await createUserAndCookie()
	const response = await action(
		actionArgs(
			profileRequest({
			cookie,
			username: user.username,
			bio: 'x'.repeat(PROFILE_BIO_MAX_LENGTH + 1),
			}),
		),
	)

	expect(getStatus(response)).toBe(400)
	expect(
		await prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
	).toMatchObject({ name: 'Original Name', bio: null })
})

test('an anonymous user cannot update a profile', async () => {
	const request = profileRequest({ username: 'anonymous', bio: 'Nope' })
	const response = await action(actionArgs(request)).catch(error => error)

	expect(response).toBeInstanceOf(Response)
	expect((response as Response).status).toBeGreaterThanOrEqual(300)
	expect((response as Response).status).toBeLessThan(400)
})
