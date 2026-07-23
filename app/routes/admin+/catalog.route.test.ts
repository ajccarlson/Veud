import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { action, loader } from './catalog.tsx'

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

function actionRequestFor(
	cookie: string,
	input: { issueId: string; action: string; note?: string },
) {
	const url = new URL(`${BASE_URL}/admin/catalog`)
	const formData = new FormData()
	formData.set('issueId', input.issueId)
	formData.set('action', input.action)
	if (input.note) formData.set('note', input.note)
	return {
		request: new Request(url, {
			method: 'POST',
			headers: { cookie },
			body: formData,
		}),
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
	expect(response.data.quality).toEqual({ counts: [], issues: [] })
})

test('quality review actions require administrators and append an audit event', async () => {
	const [admin, member] = await Promise.all([createUser('admin'), createUser()])
	const media = await prisma.media.create({
		data: { kind: 'movie', title: 'Review candidate' },
	})
	const issue = await prisma.catalogQualityIssue.create({
		data: {
			fingerprint: `route-review-${media.id}`,
			issueType: 'missing_image',
			severity: 'info',
			summary: 'Review candidate is missing an image.',
			primaryMediaId: media.id,
		},
	})
	await expect(
		action(
			actionRequestFor(await cookieFor(member.id), {
				issueId: issue.id,
				action: 'dismiss',
			}),
		),
	).rejects.toMatchObject({ status: 403 })

	const response = await action(
		actionRequestFor(await cookieFor(admin.id), {
			issueId: issue.id,
			action: 'dismiss',
			note: 'Expected provider omission.',
		}),
	)
	expect(response.data).toEqual(
		expect.objectContaining({ ok: true, status: 'dismissed' }),
	)
	expect(
		await prisma.catalogQualityEvent.findFirst({
			where: { issueId: issue.id },
			select: {
				action: true,
				previousStatus: true,
				nextStatus: true,
				note: true,
				actorId: true,
			},
		}),
	).toEqual({
		action: 'dismiss',
		previousStatus: 'open',
		nextStatus: 'dismissed',
		note: 'Expected provider omission.',
		actorId: admin.id,
	})
})
