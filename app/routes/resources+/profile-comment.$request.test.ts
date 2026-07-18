import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import * as profileCommentRoute from '#app/routes/resources+/profile-comment.$request.ts'
import { PROFILE_COMMENT_MAX_LENGTH } from '#app/utils/profile.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'

const { action } = profileCommentRoute

function getStatus(response: Response | { init: ResponseInit | null }) {
	return response instanceof Response ? response.status : response.init?.status ?? 200
}

async function createUserRecord() {
	const suffix = faker.string.alphanumeric({ length: 12 }).toLowerCase()
	return prisma.user.create({
		data: {
			email: `${suffix}@example.com`,
			username: `u_${suffix}`,
			name: faker.person.fullName(),
		},
		select: { id: true },
	})
}

async function authedRequestFor(userId: string) {
	const session = await prisma.session.create({
		data: { userId, expirationDate: getSessionExpirationDate() },
		select: { id: true },
	})
	const cookie = await getSessionCookieHeader(session)
	return new Request(BASE_URL, { method: 'POST', headers: { cookie } })
}

function requestParam(values: Record<string, string>) {
	return new URLSearchParams(values).toString()
}

async function createComment({
	authorId,
	profileId,
	body = faker.lorem.sentence(),
}: {
	authorId: string
	profileId: string
	body?: string
}) {
	return prisma.profileComment.create({ data: { authorId, profileId, body } })
}

test('profile-comment exposes only an action', () => {
	expect(typeof action).toBe('function')
	expect(
		(profileCommentRoute as Record<string, unknown>).loader,
	).toBeUndefined()
})

test('a signed-in user can leave a trimmed comment on a profile', async () => {
	const author = await createUserRecord()
	const profile = await createUserRecord()
	const request = await authedRequestFor(author.id)

	const response = await action({
		request,
		params: {
			request: requestParam({
				intent: 'create',
				profileId: profile.id,
				body: '  Hello from the guestbook.  ',
			}),
		},
	} as any)

	expect(getStatus(response)).toBe(200)
	const stored = await prisma.profileComment.findFirst()
	expect(stored).toMatchObject({
		authorId: author.id,
		profileId: profile.id,
		body: 'Hello from the guestbook.',
	})
})

test('empty and oversized comments are rejected', async () => {
	const author = await createUserRecord()
	const profile = await createUserRecord()
	const request = await authedRequestFor(author.id)

	for (const body of ['   ', 'x'.repeat(PROFILE_COMMENT_MAX_LENGTH + 1)]) {
		const response = await action({
			request,
			params: {
				request: requestParam({
					intent: 'create',
					profileId: profile.id,
					body,
				}),
			},
		} as any).catch(error => error)

		expect(response).toBeInstanceOf(Response)
		expect((response as Response).status).toBe(400)
	}

	expect(await prisma.profileComment.count()).toBe(0)
})

test('an author can delete their comment', async () => {
	const author = await createUserRecord()
	const profile = await createUserRecord()
	const comment = await createComment({
		authorId: author.id,
		profileId: profile.id,
	})
	const request = await authedRequestFor(author.id)

	const response = await action({
		request,
		params: {
			request: requestParam({ intent: 'delete', commentId: comment.id }),
		},
	} as any)

	expect(getStatus(response)).toBe(200)
	expect(
		await prisma.profileComment.findUnique({ where: { id: comment.id } }),
	).toBeNull()
})

test('a profile owner can moderate a comment left on their profile', async () => {
	const author = await createUserRecord()
	const profile = await createUserRecord()
	const comment = await createComment({
		authorId: author.id,
		profileId: profile.id,
	})
	const request = await authedRequestFor(profile.id)

	const response = await action({
		request,
		params: {
			request: requestParam({ intent: 'delete', commentId: comment.id }),
		},
	} as any)

	expect(getStatus(response)).toBe(200)
	expect(
		await prisma.profileComment.findUnique({ where: { id: comment.id } }),
	).toBeNull()
})

test('an unrelated user cannot delete a comment', async () => {
	const author = await createUserRecord()
	const profile = await createUserRecord()
	const unrelated = await createUserRecord()
	const comment = await createComment({
		authorId: author.id,
		profileId: profile.id,
	})
	const request = await authedRequestFor(unrelated.id)

	const response = await action({
		request,
		params: {
			request: requestParam({ intent: 'delete', commentId: comment.id }),
		},
	} as any).catch(error => error)

	expect(response).toBeInstanceOf(Response)
	expect((response as Response).status).toBe(404)
	expect(
		await prisma.profileComment.findUnique({ where: { id: comment.id } }),
	).not.toBeNull()
})

test('an anonymous user cannot create a comment', async () => {
	const profile = await createUserRecord()

	const response = await action({
		request: new Request(BASE_URL, { method: 'POST' }),
		params: {
			request: requestParam({
				intent: 'create',
				profileId: profile.id,
				body: 'Not allowed',
			}),
		},
	} as any).catch(error => error)

	expect(response).toBeInstanceOf(Response)
	expect((response as Response).status).toBeGreaterThanOrEqual(300)
	expect((response as Response).status).toBeLessThan(400)
	expect(await prisma.profileComment.count()).toBe(0)
})
