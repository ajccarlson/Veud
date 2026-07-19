import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { loader } from './index.tsx'

async function createUser(prefix: string) {
	const suffix = faker.string.alphanumeric({ length: 10 }).toLowerCase()
	return prisma.user.create({
		data: {
			email: `${prefix}_${suffix}@example.com`,
			username: `${prefix}_${suffix}`,
			name: `${prefix} member`,
		},
	})
}

test('signed-in home feed contains activity only from followed members', async () => {
	const [viewer, followed, unrelated] = await Promise.all([
		createUser('viewer'),
		createUser('followed'),
		createUser('unrelated'),
	])
	const media = await prisma.media.create({
		data: { kind: 'movie', title: 'Personalized Home Fixture' },
	})
	await Promise.all([
		prisma.follow.create({
			data: { followerId: viewer.id, followingId: followed.id },
		}),
		prisma.review.create({
			data: {
				authorId: followed.id,
				mediaId: media.id,
				body: 'Visible followed review.',
			},
		}),
		prisma.review.create({
			data: {
				authorId: unrelated.id,
				mediaId: media.id,
				body: 'Hidden unrelated review.',
			},
		}),
	])
	const session = await prisma.session.create({
		data: {
			userId: viewer.id,
			expirationDate: getSessionExpirationDate(),
		},
	})
	const cookie = await getSessionCookieHeader(session)

	const result = await loader({
		request: new Request(BASE_URL, { headers: { cookie } }),
		params: {},
	} as any)

	expect(result.data.followingCount).toBe(1)
	expect(result.data.followingFeed).toEqual([
		expect.objectContaining({
			kind: 'review',
			actor: expect.objectContaining({ id: followed.id }),
			review: expect.objectContaining({ body: 'Visible followed review.' }),
		}),
	])
	expect(result.data.suggestedMembers).toEqual([])
})

test('anonymous home loader does not expose a personalized feed', async () => {
	const result = await loader({
		request: new Request(BASE_URL),
		params: {},
	} as any)

	expect(result.data.followingCount).toBe(0)
	expect(result.data.followingFeed).toEqual([])
	expect(result.data.suggestedMembers).toEqual([])
})

test('new members receive discovery suggestions that exclude themselves', async () => {
	const [viewer, candidate] = await Promise.all([
		createUser('new_viewer'),
		createUser('candidate'),
	])
	const session = await prisma.session.create({
		data: {
			userId: viewer.id,
			expirationDate: getSessionExpirationDate(),
		},
	})
	const cookie = await getSessionCookieHeader(session)

	const result = await loader({
		request: new Request(BASE_URL, { headers: { cookie } }),
		params: {},
	} as any)

	expect(result.data.followingCount).toBe(0)
	expect(result.data.followingFeed).toEqual([])
	expect(result.data.suggestedMembers).toEqual([
		expect.objectContaining({ id: candidate.id }),
	])
	expect(
		result.data.suggestedMembers.some(member => member.id === viewer.id),
	).toBe(false)
})
