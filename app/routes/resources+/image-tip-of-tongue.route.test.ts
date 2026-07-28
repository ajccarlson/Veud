import { faker } from '@faker-js/faker'
import sharp from 'sharp'
import { afterEach, expect, test, vi } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { resetAiGatewayStateForTests } from '#app/utils/ai-gateway.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { action } from './image-tip-of-tongue.ts'

afterEach(() => {
	vi.unstubAllEnvs()
	vi.unstubAllGlobals()
	resetAiGatewayStateForTests()
})

function aiResponse(
	suggestions: Array<{
		title: string
		alternateTitle: string | null
		year: number | null
		kind: 'movie'
		reason: string
		matchedClues: string[]
	}>,
) {
	return new Response(
		JSON.stringify({
			output: [
				{
					type: 'message',
					content: [
						{
							type: 'output_text',
							text: JSON.stringify({ suggestions }),
						},
					],
				},
			],
		}),
		{ status: 200, headers: { 'Content-Type': 'application/json' } },
	)
}

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

test('anonymous text clues use the same canonical Tip of My Tongue resource', async () => {
	const suffix = faker.string.alphanumeric({ length: 10 }).toLowerCase()
	const matches = await Promise.all(
		Array.from({ length: 5 }, (_, index) =>
			prisma.media.create({
				data: {
					kind: 'movie',
					title: `Cobalt ${suffix} Archive ${index + 1}`,
					description: `A cobalt ${suffix} key opens an archive beneath a frozen lake.`,
					catalogPopularity: 500 - index,
				},
			}),
		),
	)
	vi.stubEnv('OPENAI_API_KEY', '')
	const formData = new FormData()
	formData.set(
		'q',
		`A cobalt ${suffix} key opens an archive beneath a frozen lake`,
	)
	formData.set('kind', 'movie')

	try {
		const result = await action({
			request: new Request(`${BASE_URL}/resources/image-tip-of-tongue`, {
				method: 'POST',
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
		expect(result.data.items.map(item => item.id)).toEqual(
			matches.map(item => item.id),
		)
		expect(
			result.data.items.every(item => Boolean(item.memoryMatch?.summary)),
		).toBe(true)
	} finally {
		await prisma.media.deleteMany({
			where: { id: { in: matches.map(item => item.id) } },
		})
	}
})

test('anonymous canonical Tip of My Tongue uses configured AI and preserves suggestion order', async () => {
	const suffix = faker.string.alphanumeric({ length: 10 }).toLowerCase()
	const matches = await Promise.all(
		Array.from({ length: 5 }, (_, index) =>
			prisma.media.create({
				data: {
					kind: 'movie',
					title: `Ordered Amber ${suffix} ${index + 1}`,
					description: `An amber ${suffix} journal is hidden in an isolated lighthouse.`,
					catalogPopularity: (index + 1) * 100,
				},
			}),
		),
	)
	const suggestions = matches.map((match, index) => ({
		title: match.title!,
		alternateTitle: null,
		year: null,
		kind: 'movie' as const,
		reason: `${match.title} matches the amber journal and isolated lighthouse.`,
		matchedClues: ['amber journal', 'isolated lighthouse'],
	}))
	vi.stubEnv('OPENAI_API_KEY', 'configured-key')
	const fetchMock = vi.fn<typeof fetch>(async () => aiResponse(suggestions))
	vi.stubGlobal('fetch', fetchMock)
	const formData = new FormData()
	formData.set('q', `An amber ${suffix} journal in an isolated lighthouse`)
	formData.set('kind', 'movie')

	try {
		const result = await action({
			request: new Request(`${BASE_URL}/resources/image-tip-of-tongue`, {
				method: 'POST',
				body: formData,
			}),
			params: {},
		} as any)

		expect(result.data).toEqual(
			expect.objectContaining({
				ok: true,
				source: 'ai',
				fallbackReason: null,
				upload: null,
			}),
		)
		expect(fetchMock).toHaveBeenCalledOnce()
		if (!result.data.ok) throw new Error(result.data.error)
		expect(result.data.items.map(item => item.id)).toEqual(
			matches.map(item => item.id),
		)
		expect(
			result.data.items.every(item => Boolean(item.memoryMatch?.summary)),
		).toBe(true)
	} finally {
		await prisma.media.deleteMany({
			where: { id: { in: matches.map(item => item.id) } },
		})
	}
})

test('anonymous canonical Tip of My Tongue accepts image-only clues', async () => {
	const suffix = faker.string.alphanumeric({ length: 10 }).toLowerCase()
	const matches = await Promise.all(
		Array.from({ length: 5 }, (_, index) =>
			prisma.media.create({
				data: {
					kind: 'movie',
					title: `Violet Image ${suffix} ${index + 1}`,
					description: 'A violet train crosses a glass bridge.',
				},
			}),
		),
	)
	const suggestions = matches.map(match => ({
		title: match.title!,
		alternateTitle: null,
		year: null,
		kind: 'movie' as const,
		reason: `${match.title} contains the violet train and glass bridge.`,
		matchedClues: ['violet train', 'glass bridge'],
	}))
	const source = await sharp({
		create: {
			width: 16,
			height: 16,
			channels: 3,
			background: '#7040a0',
		},
	})
		.png()
		.toBuffer()
	vi.stubEnv('OPENAI_API_KEY', 'configured-key')
	const fetchMock = vi.fn<typeof fetch>(async () => aiResponse(suggestions))
	vi.stubGlobal('fetch', fetchMock)
	const formData = new FormData()
	formData.set('q', '')
	formData.set('kind', 'movie')
	formData.set(
		'image',
		new File([new Uint8Array(source)], 'memory.png', { type: 'image/png' }),
	)

	try {
		const result = await action({
			request: new Request(`${BASE_URL}/resources/image-tip-of-tongue`, {
				method: 'POST',
				body: formData,
			}),
			params: {},
		} as any)

		expect(result.data).toEqual(
			expect.objectContaining({
				ok: true,
				source: 'ai',
				fallbackReason: null,
				upload: { width: 16, height: 16 },
			}),
		)
		expect(fetchMock).toHaveBeenCalledOnce()
		if (!result.data.ok) throw new Error(result.data.error)
		expect(result.data.items.map(item => item.id)).toEqual(
			matches.map(item => item.id),
		)
	} finally {
		await prisma.media.deleteMany({
			where: { id: { in: matches.map(item => item.id) } },
		})
	}
})

test('canonical Tip of My Tongue validation accepts an image or three text characters', async () => {
	const formData = new FormData()
	formData.set('q', 'no')
	formData.set('kind', 'all')

	const result = await action({
		request: new Request(`${BASE_URL}/resources/image-tip-of-tongue`, {
			method: 'POST',
			body: formData,
		}),
		params: {},
	} as any)

	expect(result.init?.status).toBe(400)
	expect(result.data).toEqual({
		ok: false,
		error: 'Add a few details or an image.',
	})
})
