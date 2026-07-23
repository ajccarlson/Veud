import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import * as profileCommentRoute from '#app/routes/resources+/profile-comment.ts'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { PROFILE_COMMENT_MAX_LENGTH } from '#app/utils/profile.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'

const { action } = profileCommentRoute

function getStatus(response: Response | { init: ResponseInit | null }) {
	return response instanceof Response
		? response.status
		: (response.init?.status ?? 200)
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

async function authedRequestFor(userId: string, input: unknown) {
	const session = await prisma.session.create({
		data: { userId, expirationDate: getSessionExpirationDate() },
		select: { id: true },
	})
	const cookie = await getSessionCookieHeader(session)
	return new Request(BASE_URL, {
		method: 'POST',
		headers: { cookie, 'content-type': 'application/json' },
		body: JSON.stringify(input),
	})
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
	const request = await authedRequestFor(author.id, {
		intent: 'create',
		profileId: profile.id,
		body: '  Hello from the guestbook.  ',
	})

	const response = await action({
		request,
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

	for (const body of ['   ', 'x'.repeat(PROFILE_COMMENT_MAX_LENGTH + 1)]) {
		const request = await authedRequestFor(author.id, {
			intent: 'create',
			profileId: profile.id,
			body,
		})
		const response = await action({
			request,
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
	const request = await authedRequestFor(author.id, {
		intent: 'delete',
		commentId: comment.id,
	})

	const response = await action({
		request,
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
	const request = await authedRequestFor(profile.id, {
		intent: 'delete',
		commentId: comment.id,
	})

	const response = await action({
		request,
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
	const request = await authedRequestFor(unrelated.id, {
		intent: 'delete',
		commentId: comment.id,
	})

	const response = await action({
		request,
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
		request: new Request(BASE_URL, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				intent: 'create',
				profileId: profile.id,
				body: 'Not allowed',
			}),
		}),
	} as any).catch(error => error)

	expect(response).toBeInstanceOf(Response)
	expect((response as Response).status).toBeGreaterThanOrEqual(300)
	expect((response as Response).status).toBeLessThan(400)
	expect(await prisma.profileComment.count()).toBe(0)
})

test('comment content is accepted only from a bounded JSON body', async () => {
	const author = await createUserRecord()
	const session = await prisma.session.create({
		data: { userId: author.id, expirationDate: getSessionExpirationDate() },
	})
	const cookie = await getSessionCookieHeader(session)

	for (const [request, status] of [
		[
			new Request(BASE_URL, {
				method: 'POST',
				headers: { cookie },
				body: 'intent=create&body=logged-in-the-url',
			}),
			415,
		],
		[
			new Request(BASE_URL, {
				method: 'POST',
				headers: { cookie, 'content-type': 'application/json' },
				body: '{not-json',
			}),
			400,
		],
		[
			new Request(BASE_URL, {
				method: 'POST',
				headers: {
					cookie,
					'content-type': 'application/json',
					'content-length': '4001',
				},
				body: '{}',
			}),
			413,
		],
	] as const) {
		const response = await action({ request } as any).catch(error => error)
		expect(response).toBeInstanceOf(Response)
		expect((response as Response).status).toBe(status)
	}
})
