import { faker } from '@faker-js/faker'
import { afterEach, expect, test, vi } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { action } from './image-tip-of-tongue.ts'

afterEach(() => {
	vi.unstubAllEnvs()
})

test('Tip of My Tongue accepts text clues without a separate image form', async () => {
	const suffix = faker.string.alphanumeric({ length: 10 }).toLowerCase()
	const viewer = await prisma.user.create({
		data: {
			email: `tomt_text_${suffix}@example.com`,
			username: `tomt_text_${suffix}`,
		},
	})
	const session = await prisma.session.create({
		data: {
			userId: viewer.id,
			expirationDate: getSessionExpirationDate(),
		},
	})
	const matches = await Promise.all(
		Array.from({ length: 5 }, (_, index) =>
			prisma.media.create({
				data: {
					kind: 'movie',
					title: `Unified Lantern Memory ${index + 1}`,
					description:
						'A glass lantern guides a violinist through a mirrored forest.',
					catalogPopularity: 500 - index,
				},
			}),
		),
	)
	vi.stubEnv('OPENAI_API_KEY', '')
	const formData = new FormData()
	formData.set('q', 'A glass lantern and violinist in a mirrored forest')
	formData.set('kind', 'movie')

	try {
		const result = await action({
			request: new Request(`${BASE_URL}/resources/image-tip-of-tongue`, {
				method: 'POST',
				headers: { cookie: await getSessionCookieHeader(session) },
				body: formData,
			}),
			params: {},
		} as any)

		expect(result.data).toEqual(
			expect.objectContaining({
				ok: true,
				source: 'catalog-match',
				fallbackReason: 'not-configured',
				upload: null,
			}),
		)
		if (!result.data.ok) throw new Error(result.data.error)
		expect(result.data.items).toHaveLength(5)
		expect(result.data.items.map(item => item.id)).toEqual(
			expect.arrayContaining(matches.map(item => item.id)),
		)
	} finally {
		await prisma.media.deleteMany({
			where: { id: { in: matches.map(item => item.id) } },
		})
	}
})
