import { faker } from '@faker-js/faker'
import { RouterContextProvider } from 'react-router'
import { expect, test } from 'vitest'
import { action, loader } from '#app/routes/settings+/profile.index.tsx'
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
	return response instanceof Response
		? response.status
		: (response.init?.status ?? 200)
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
	return { user, session, cookie: await getSessionCookieHeader(session) }
}

function profileRequest({
	cookie,
	username,
	bio,
	name = 'Updated Name',
}: {
	cookie?: string
	username: string
	bio: string
	name?: string
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
			name,
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
		actionArgs(profileRequest({ cookie, username: user.username, bio: '   ' })),
	)
	expect(getStatus(response)).toBe(200)
	expect(
		await prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
	).toMatchObject({ bio: null })
})

test('clearing an optional full name stores null', async () => {
	const { user, cookie } = await createUserAndCookie()
	const response = await action(
		actionArgs(
			profileRequest({
				cookie,
				username: user.username,
				name: '   ',
				bio: '',
			}),
		),
	)

	expect(getStatus(response)).toBe(200)
	expect(
		await prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
	).toMatchObject({ name: null })
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

function deleteAccountRequest({
	cookie,
	confirmation,
	currentPassword,
}: {
	cookie: string
	confirmation: string
	currentPassword?: string
}) {
	return new Request(`${BASE_URL}/settings/profile`, {
		method: 'POST',
		headers: {
			'content-type': 'application/x-www-form-urlencoded',
			cookie,
		},
		body: new URLSearchParams({
			intent: 'delete-account',
			confirmation,
			...(currentPassword ? { currentPassword } : {}),
		}),
	})
}

test('account deletion rejects an incorrect username confirmation', async () => {
	const { user, cookie } = await createUserAndCookie()
	const response = await action(
		actionArgs(
			deleteAccountRequest({ cookie, confirmation: 'not-the-username' }),
		),
	)

	expect(getStatus(response)).toBe(400)
	expect(
		await prisma.user.findUnique({ where: { id: user.id } }),
	).not.toBeNull()
})

test('account deletion removes owned data and clears authentication', async () => {
	const { user, session, cookie } = await createUserAndCookie()
	const listType = await prisma.listType.create({
		data: {
			name: `delete_account_${user.id}`,
			header: 'Test',
			columns: '',
			mediaType: 'movie',
			completionType: 'episode',
		},
	})
	const watchlist = await prisma.watchlist.create({
		data: {
			name: 'Delete me',
			header: 'Delete me',
			typeId: listType.id,
			ownerId: user.id,
		},
		select: { id: true },
	})

	const response = await action(
		actionArgs(deleteAccountRequest({ cookie, confirmation: user.username })),
	)

	expect(response).toBeInstanceOf(Response)
	expect((response as Response).status).toBe(302)
	expect((response as Response).headers.get('location')).toBe('/')
	expect(await prisma.user.findUnique({ where: { id: user.id } })).toBeNull()
	expect(
		await prisma.session.findUnique({ where: { id: session.id } }),
	).toBeNull()
	expect(
		await prisma.watchlist.findUnique({ where: { id: watchlist.id } }),
	).toBeNull()
	expect((response as Response).headers.get('set-cookie')).toContain(
		'en_session=',
	)
})

test('password-backed account deletion requires the current password', async () => {
	const { user, cookie } = await createUserAndCookie()
	const { getPasswordHash } = await import('#app/utils/auth.server.ts')
	await prisma.password.create({
		data: { userId: user.id, hash: await getPasswordHash('correct-password') },
	})

	const rejected = await action(
		actionArgs(deleteAccountRequest({ cookie, confirmation: user.username })),
	)
	expect(getStatus(rejected)).toBe(400)
	expect(
		await prisma.user.findUnique({ where: { id: user.id } }),
	).not.toBeNull()

	const deleted = await action(
		actionArgs(
			deleteAccountRequest({
				cookie,
				confirmation: user.username,
				currentPassword: 'correct-password',
			}),
		),
	)
	expect(deleted).toBeInstanceOf(Response)
	expect((deleted as Response).status).toBe(302)
	expect(await prisma.user.findUnique({ where: { id: user.id } })).toBeNull()
})

test('account standing exposes decisions and accepts one appeal for the signed-in member', async () => {
	const { user, cookie } = await createUserAndCookie()
	const decision = await prisma.moderationAction.create({
		data: {
			subjectId: user.id,
			action: 'account_warn',
			targetType: 'account',
			targetId: user.id,
			reason: 'Account warning fixture.',
			previousStatus: 'active',
			nextStatus: 'active',
		},
	})
	const request = new Request(`${BASE_URL}/settings/profile`, {
		headers: { cookie },
	})
	const loaded = await loader({
		request,
		url: new URL(request.url),
		params: {},
	} as any)
	expect(loaded.data.user.moderationActionsSubject).toEqual([
		expect.objectContaining({
			id: decision.id,
			reason: 'Account warning fixture.',
		}),
	])

	const response = await action(
		actionArgs(
			new Request(`${BASE_URL}/settings/profile`, {
				method: 'POST',
				headers: {
					cookie,
					'content-type': 'application/x-www-form-urlencoded',
				},
				body: new URLSearchParams({
					intent: 'appeal-moderation',
					actionId: decision.id,
					details: 'This warning was based on mistaken context.',
				}),
			}),
		),
	)
	expect(getStatus(response)).toBe(200)
	expect(
		await prisma.moderationReport.findFirstOrThrow({
			where: { appealOfActionId: decision.id },
			select: {
				reporterId: true,
				reasonCategory: true,
				details: true,
			},
		}),
	).toEqual({
		reporterId: user.id,
		reasonCategory: 'appeal',
		details: 'This warning was based on mistaken context.',
	})
})
