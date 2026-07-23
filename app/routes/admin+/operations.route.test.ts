import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { action, loader } from './operations.tsx'

async function createUser(role?: 'site-operator') {
	const suffix = faker.string.alphanumeric({ length: 10 }).toLowerCase()
	return prisma.user.create({
		data: {
			email: `operations_${suffix}@example.com`,
			username: `operations_${suffix}`,
			roles: role
				? {
						create: {
							name: role,
							description: 'Test site operator',
							permissions: {
								create: [
									{
										action: 'read',
										entity: 'operations',
										access: 'any',
									},
									{
										action: 'update',
										entity: 'operations',
										access: 'any',
									},
								],
							},
						},
					}
				: undefined,
		},
	})
}

async function requestFor(userId: string) {
	const session = await prisma.session.create({
		data: { userId, expirationDate: getSessionExpirationDate() },
	})
	const url = new URL(`${BASE_URL}/admin/operations`)
	return {
		request: new Request(url, {
			headers: { cookie: await getSessionCookieHeader(session) },
		}),
		url,
		params: {},
	} as any
}

async function actionRequestFor(
	userId: string,
	input:
		| {
				intent: 'create-incident'
				title: string
				summary: string
				severity: string
				affectedAreas: string[]
		  }
		| {
				intent: 'update-incident'
				incidentId: string
				status: string
				message: string
		  },
) {
	const session = await prisma.session.create({
		data: { userId, expirationDate: getSessionExpirationDate() },
	})
	const url = new URL(`${BASE_URL}/admin/operations`)
	const body = new FormData()
	for (const [key, value] of Object.entries(input)) {
		if (Array.isArray(value)) {
			for (const item of value) body.append(key, item)
		} else {
			body.set(key, value)
		}
	}
	return {
		request: new Request(url, {
			method: 'POST',
			headers: { cookie: await getSessionCookieHeader(session) },
			body,
		}),
		url,
		params: {},
	} as any
}

test('keeps runtime telemetry private to unauthorized members', async () => {
	const member = await createUser()
	await expect(loader(await requestFor(member.id))).rejects.toMatchObject({
		status: 403,
	})
})

test('returns private runtime and database readiness to site operators', async () => {
	const operator = await createUser('site-operator')
	const response = await loader(await requestFor(operator.id))
	expect(response.init?.headers).toEqual(
		expect.objectContaining({ 'Cache-Control': 'private, no-store' }),
	)
	expect(response.data).toEqual(
		expect.objectContaining({
			health: 'healthy',
			database: expect.objectContaining({ status: 'healthy' }),
			runtime: expect.objectContaining({
				requests: expect.any(Object),
				process: expect.objectContaining({ node: expect.any(String) }),
			}),
		}),
	)
})

test('site operators publish journaled incidents while members cannot', async () => {
	const [operator, member] = await Promise.all([
		createUser('site-operator'),
		createUser(),
	])
	const createInput = {
		intent: 'create-incident' as const,
		title: 'Delayed search indexing',
		summary: 'Recently added titles may take longer to appear in search.',
		severity: 'minor',
		affectedAreas: ['catalog', 'search'],
	}
	await expect(
		action(await actionRequestFor(member.id, createInput)),
	).rejects.toMatchObject({ status: 403 })

	const created = await action(await actionRequestFor(operator.id, createInput))
	expect(created.data).toEqual(
		expect.objectContaining({ ok: true, incidentId: expect.any(String) }),
	)
	if (!created.data.ok) throw new Error(created.data.error)
	const incident = await prisma.serviceIncident.findUniqueOrThrow({
		where: { id: created.data.incidentId },
		include: { events: true },
	})
	expect(incident).toEqual(
		expect.objectContaining({
			status: 'investigating',
			affectedAreas: JSON.stringify(['catalog', 'search']),
		}),
	)
	expect(incident.events).toEqual([
		expect.objectContaining({
			status: 'investigating',
			actorId: operator.id,
		}),
	])

	const updated = await action(
		await actionRequestFor(operator.id, {
			intent: 'update-incident',
			incidentId: incident.id,
			status: 'resolved',
			message: 'The indexing queue has returned to normal.',
		}),
	)
	expect(updated.data.ok).toBe(true)
	const resolved = await prisma.serviceIncident.findUniqueOrThrow({
		where: { id: incident.id },
		include: { events: { orderBy: { createdAt: 'asc' } } },
	})
	expect(resolved.status).toBe('resolved')
	expect(resolved.resolvedAt).toBeInstanceOf(Date)
	expect(resolved.events).toHaveLength(2)
	expect(resolved.events[1]).toEqual(
		expect.objectContaining({
			status: 'resolved',
			message: 'The indexing queue has returned to normal.',
			actorId: operator.id,
		}),
	)
})
