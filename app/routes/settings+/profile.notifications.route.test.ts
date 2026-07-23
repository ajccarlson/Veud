import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { action, loader } from './profile.notifications.tsx'

async function authenticatedRequest(body?: URLSearchParams) {
	const suffix = faker.string.alphanumeric({ length: 10 }).toLowerCase()
	const user = await prisma.user.create({
		data: {
			email: `notification_settings_${suffix}@example.com`,
			username: `notification_settings_${suffix}`,
		},
	})
	const session = await prisma.session.create({
		data: { userId: user.id, expirationDate: getSessionExpirationDate() },
	})
	const cookie = await getSessionCookieHeader(session)
	return {
		user,
		request: new Request(`${BASE_URL}/settings/profile/notifications`, {
			method: body ? 'POST' : 'GET',
			headers: { cookie, 'x-time-zone': 'America/Los_Angeles' },
			body,
		}),
	}
}

test('notification settings default safely and persist a scheduled opt-in digest', async () => {
	const initial = await authenticatedRequest()
	const initialResult = await loader({ request: initial.request } as any)
	expect(initialResult.data.preferences).toMatchObject({
		inAppSocial: true,
		inAppReleases: true,
		emailSocial: false,
		emailReleases: false,
		digestFrequency: 'off',
	})

	const update = await authenticatedRequest(
		new URLSearchParams({
			inAppReleases: 'on',
			emailSocial: 'on',
			digestFrequency: 'daily',
			digestHour: '9',
			digestWeekday: '1',
			timeZone: 'America/Los_Angeles',
		}),
	)
	const result = await action({ request: update.request } as any)
	expect(result.data).toMatchObject({
		ok: true,
		preferences: {
			inAppSocial: false,
			inAppReleases: true,
			emailSocial: true,
			emailReleases: false,
			digestFrequency: 'daily',
			timeZone: 'America/Los_Angeles',
		},
	})
	expect(
		await prisma.notificationPreference.findUniqueOrThrow({
			where: { ownerId: update.user.id },
		}),
	).toMatchObject({
		inAppSocial: false,
		inAppReleases: true,
		emailSocial: true,
		emailReleases: false,
		digestFrequency: 'daily',
		nextDigestAt: expect.any(Date),
	})
})

test('notification settings reject invalid scheduling values', async () => {
	const update = await authenticatedRequest(
		new URLSearchParams({
			emailSocial: 'on',
			digestFrequency: 'weekly',
			digestHour: '25',
			digestWeekday: '8',
			timeZone: 'invalid/time-zone',
		}),
	)
	const result = await action({ request: update.request } as any)
	expect(result.init?.status).toBe(400)
	expect(
		await prisma.notificationPreference.findUnique({
			where: { ownerId: update.user.id },
		}),
	).toBeNull()
})
