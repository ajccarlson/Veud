import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { prisma } from '#app/utils/db.server.ts'
import { BASE_URL } from '#tests/utils.ts'
import { action } from './forgot-password.tsx'

function requestFor(usernameOrEmail: string) {
	return new Request(`${BASE_URL}/forgot-password`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ usernameOrEmail }),
	})
}

test('password recovery does not disclose whether an account exists', async () => {
	const suffix = faker.string.alphanumeric({ length: 12 }).toLowerCase()
	const user = await prisma.user.create({
		data: {
			email: `recovery_${suffix}@example.com`,
			username: `recovery_${suffix}`,
		},
	})

	const [existing, absent] = await Promise.all([
		action({ request: requestFor(user.email) } as any),
		action({
			request: requestFor(`absent_${suffix}@example.com`),
		} as any),
	])

	for (const response of [existing, absent]) {
		expect(response).toBeInstanceOf(Response)
		expect((response as Response).status).toBe(302)
		expect((response as Response).headers.get('location')).toContain('/verify?')
	}
})
