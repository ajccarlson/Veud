import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { action } from '#app/routes/lists+/.fetch+/create-watchlist.$request.ts'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'

async function fixture() {
	const suffix = faker.string.alphanumeric({ length: 10 }).toLowerCase()
	const owner = await prisma.user.create({
		data: {
			email: `create_list_${suffix}@example.com`,
			username: `create_list_${suffix}`,
		},
	})
	const type = await prisma.listType.create({
		data: {
			name: `create_list_${suffix}`,
			header: 'Movies',
			columns: '{}',
			mediaType: '["movie"]',
			completionType: '{"past":"watched"}',
		},
	})
	const session = await prisma.session.create({
		data: { userId: owner.id, expirationDate: getSessionExpirationDate() },
	})
	return {
		owner,
		type,
		request: new Request(BASE_URL, {
			method: 'POST',
			headers: { cookie: await getSessionCookieHeader(session) },
		}),
	}
}

function params(list: Record<string, unknown>) {
	return {
		request: new URLSearchParams({ list: JSON.stringify(list) }).toString(),
	}
}

function validList(typeId: string) {
	return {
		position: { value: 1, type: 'int' },
		name: { value: 'watching', type: 'string' },
		header: { value: 'Watching', type: 'string' },
		typeId: { value: typeId, type: 'string' },
		displayedColumns: { value: '["title"]', type: 'string' },
		description: { value: '', type: 'string' },
	}
}

test('creates only validated server-owned watchlist fields', async () => {
	const data = await fixture()
	const created = await action({
		request: data.request,
		params: params({
			...validList(data.type.id),
			id: { value: 'attacker-controlled-id', type: 'string' },
			isPublic: { value: false, type: 'bool' },
			entries: {
				value: { create: { title: 'Injected entry', position: 1 } },
				type: 'relation',
			},
		}),
	} as any)

	expect(created).toMatchObject({
		ownerId: data.owner.id,
		typeId: data.type.id,
		position: 1,
		isPublic: true,
	})
	expect(created.id).not.toBe('attacker-controlled-id')
	expect(await prisma.entry.count({ where: { watchlistId: created.id } })).toBe(
		0,
	)
})

test('rejects malformed and oversized watchlist fields', async () => {
	const data = await fixture()
	for (const list of [
		{ ...validList(data.type.id), name: { value: '', type: 'string' } },
		{
			...validList(data.type.id),
			description: { value: 'x'.repeat(5_001), type: 'string' },
		},
	]) {
		const response = await action({
			request: data.request,
			params: params(list),
		} as any).catch(error => error)
		expect(response).toBeInstanceOf(Response)
		expect((response as Response).status).toBe(400)
	}
})
