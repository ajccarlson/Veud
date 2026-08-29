import { faker } from '@faker-js/faker'
import sharp from 'sharp'
import { afterEach, expect, test, vi } from 'vitest'
import { resetAiGatewayStateForTests } from '#app/utils/ai-gateway.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { honeypot } from '#app/utils/honeypot.server.ts'
import { BASE_URL } from '#tests/utils.ts'
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
	const honeypotInputs = await honeypot.getInputProps()
	formData.set('q', '')
	formData.set('kind', 'movie')
	formData.set('mode', 'memory')
	formData.set(honeypotInputs.nameFieldName, '')
	if (honeypotInputs.validFromFieldName && honeypotInputs.encryptedValidFrom) {
		formData.set(
			honeypotInputs.validFromFieldName,
			honeypotInputs.encryptedValidFrom,
		)
	}
	formData.set(
		'image',
		new File([new Uint8Array(source)], 'memory.png', { type: 'image/png' }),
	)
	expect([...formData.keys()]).toHaveLength(6)

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

test('image Tip of My Tongue rejects text-only submissions', async () => {
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
		error: 'Add an image.',
	})
})

test('anonymous production requests require same-origin browser evidence', async () => {
	vi.stubEnv('NODE_ENV', 'production')
	const formData = new FormData()
	formData.set('q', 'A lighthouse that repeats the same day')
	formData.set('kind', 'movie')

	const result = await action({
		request: new Request(`${BASE_URL}/resources/image-tip-of-tongue`, {
			method: 'POST',
			headers: { origin: 'https://attacker.example' },
			body: formData,
		}),
		params: {},
	} as any)

	expect(result.init?.status).toBe(403)
	expect(result.data).toEqual({
		ok: false,
		error: 'This request could not be verified.',
	})
})
