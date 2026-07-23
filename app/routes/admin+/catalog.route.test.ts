import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { loader } from './catalog.tsx'

async function createUser(role?: 'admin') {
	const suffix = faker.string.alphanumeric({ length: 10 }).toLowerCase()
	return prisma.user.create({
		data: {
			email: `catalog_admin_${suffix}@example.com`,
			username: `catalog_admin_${suffix}`,
			roles: role
				? {
						connectOrCreate: {
							where: { name: role },
							create: { name: role, description: 'Test administrator' },
						},
					}
				: undefined,
		},
	})
}

async function cookieFor(userId: string) {
	const session = await prisma.session.create({
		data: { userId, expirationDate: getSessionExpirationDate() },
	})
	return getSessionCookieHeader(session)
}

function requestFor(cookie: string) {
	const url = new URL(`${BASE_URL}/admin/catalog`)
	return {
		request: new Request(url, { headers: { cookie } }),
		url,
		params: {},
	} as any
}

test('rejects authenticated users who do not have the admin role', async () => {
	const user = await createUser()
	await expect(
		loader(requestFor(await cookieFor(user.id))),
	).rejects.toMatchObject({ status: 403 })
})

test('returns a private no-store snapshot to administrators', async () => {
	const admin = await createUser('admin')
	const response = await loader(requestFor(await cookieFor(admin.id)))
	expect(response.init?.headers).toEqual(
		expect.objectContaining({ 'Cache-Control': 'private, no-store' }),
	)
	expect(response.data.health.status).toBe('uninitialized')
	expect(response.data.coverage).toHaveLength(4)
})
