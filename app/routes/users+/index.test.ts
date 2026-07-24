import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { prisma } from '#app/utils/db.server.ts'
import { BASE_URL } from '#tests/utils.ts'
import { loader } from './index.tsx'

test('user search uses portable quoted identifiers and case-insensitive matching', async () => {
	const suffix = faker.string.alphanumeric({ length: 10 }).toLowerCase()
	const username = `Postgres_Portable_${suffix}`
	const user = await prisma.user.create({
		data: {
			email: `${username}@example.com`,
			username,
			name: 'Portable Search',
		},
	})
	await prisma.user.create({
		data: {
			email: `unrelated_${suffix}@example.com`,
			username: `unrelated_${suffix}`,
		},
	})

	const result = await loader({
		url: new URL(`${BASE_URL}/users?search=postgres_portable`),
	} as any)
	if (result instanceof Response) {
		throw new Error(`Expected user-search data, received ${result.status}`)
	}

	expect(result.data).toEqual({
		status: 'idle',
		query: 'postgres_portable',
		users: [
			{
				id: user.id,
				username,
				name: 'Portable Search',
				imageId: null,
			},
		],
	})
})
