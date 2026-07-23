import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { action } from './home-dashboard-preferences.ts'

async function authenticatedRequest(values: Array<[string, string]>) {
	const suffix = faker.string.alphanumeric({ length: 10 }).toLowerCase()
	const user = await prisma.user.create({
		data: {
			email: `dashboard_${suffix}@example.com`,
			username: `dashboard_${suffix}`,
		},
	})
	const session = await prisma.session.create({
		data: { userId: user.id, expirationDate: getSessionExpirationDate() },
	})
	const cookie = await getSessionCookieHeader(session)
	return {
		user,
		request: new Request(`${BASE_URL}/resources/home-dashboard-preferences`, {
			method: 'POST',
			headers: { cookie },
			body: new URLSearchParams(values),
		}),
	}
}

test('dashboard preferences require a complete unique order and persist privately', async () => {
	const invalid = await authenticatedRequest([
		['density', 'compact'],
		['moduleOrder', 'trending'],
	])
	const invalidResult = await action({ request: invalid.request } as any)
	expect(invalidResult.init?.status).toBe(400)
	expect(
		await prisma.homeDashboardPreference.findUnique({
			where: { ownerId: invalid.user.id },
		}),
	).toBeNull()

	const values: Array<[string, string]> = [
		['density', 'compact'],
		['moduleOrder', 'continue'],
		['moduleOrder', 'recommendations'],
		['moduleOrder', 'following'],
		['moduleOrder', 'library'],
		['moduleOrder', 'upcoming'],
		['moduleOrder', 'trending'],
		['collapsedModules', 'following'],
		['collapsedModules', 'upcoming'],
	]
	const valid = await authenticatedRequest(values)
	const result = await action({ request: valid.request } as any)
	expect(result.data).toEqual(
		expect.objectContaining({
			ok: true,
			config: expect.objectContaining({
				density: 'compact',
				collapsedModules: ['following', 'upcoming'],
			}),
		}),
	)
	expect(new Headers(result.init?.headers).get('cache-control')).toBe(
		'private, no-store',
	)
	expect(
		await prisma.homeDashboardPreference.findUniqueOrThrow({
			where: { ownerId: valid.user.id },
		}),
	).toEqual(
		expect.objectContaining({
			density: 'compact',
			moduleOrder: JSON.stringify(values.slice(1, 7).map(([, value]) => value)),
			collapsedModules: JSON.stringify(['following', 'upcoming']),
		}),
	)
})
