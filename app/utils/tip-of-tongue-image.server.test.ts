import sharp from 'sharp'
import { afterEach, expect, test, vi } from 'vitest'
import { resetAiGatewayStateForTests } from './ai-gateway.server.ts'
import { prisma } from './db.server.ts'
import {
	getImageTipOfTongueMatches,
	TipOfTongueImageError,
} from './tip-of-tongue.server.ts'

afterEach(() => {
	vi.unstubAllEnvs()
	resetAiGatewayStateForTests()
})

function aiResponse(title: string) {
	return new Response(
		JSON.stringify({
			output: [
				{
					type: 'message',
					content: [
						{
							type: 'output_text',
							text: JSON.stringify({
								suggestions: Array.from({ length: 5 }, (_, index) => ({
									title: index === 0 ? title : `${title} ${index + 1}`,
									alternateTitle: null,
									year: 2001 + index,
									kind: 'movie',
									reason: 'The uploaded image includes a red train.',
									matchedClues: ['red train'],
								})),
							}),
						},
					],
				},
			],
		}),
		{ status: 200, headers: { 'content-type': 'application/json' } },
	)
}

test('re-encodes image uploads and sends no catalog record to OpenAI', async () => {
	vi.stubEnv('OPENAI_API_KEY', 'test-key')
	const media = await prisma.media.create({
		data: {
			kind: 'movie',
			title: 'Image Memory Express',
			description: 'A red train passes through a mountain.',
		},
	})
	const source = await sharp({
		create: {
			width: 80,
			height: 60,
			channels: 3,
			background: '#ff0000',
		},
	})
		.png()
		.withMetadata({ orientation: 6 })
		.toBuffer()
	let outbound = ''
	const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
		outbound = String(init?.body ?? '')
		return aiResponse(media.title!)
	})
	const result = await getImageTipOfTongueMatches(
		{
			image: new File([new Uint8Array(source)], 'memory.png', {
				type: 'image/png',
			}),
			prompt: 'I remember a red train',
			kind: 'movie',
		},
		{ rateLimitKey: 'viewer:test', fetchImpl },
	)
	expect(result.matches[0]?.mediaId).toBe(media.id)
	const request = JSON.parse(outbound) as {
		input: Array<{ content: Array<{ type: string; image_url?: string }> }>
		store: boolean
	}
	expect(request.store).toBe(false)
	expect(request.input[0]?.content[1]?.image_url).toMatch(
		/^data:image\/jpeg;base64,/,
	)
	expect(outbound).not.toContain(media.id)
	expect(outbound).not.toContain('mountain')
})

test('rejects malformed and oversized images before network access', async () => {
	vi.stubEnv('OPENAI_API_KEY', 'test-key')
	const fetchImpl = vi.fn<typeof fetch>()
	await expect(
		getImageTipOfTongueMatches(
			{
				image: new File([Buffer.from('not an image')], 'memory.png'),
				prompt: '',
				kind: 'all',
			},
			{ rateLimitKey: 'viewer:test', fetchImpl },
		),
	).rejects.toBeInstanceOf(TipOfTongueImageError)
	await expect(
		getImageTipOfTongueMatches(
			{
				image: new File([new Uint8Array(6 * 1024 * 1024 + 1)], 'oversized.png'),
				prompt: '',
				kind: 'all',
			},
			{ rateLimitKey: 'viewer:test', fetchImpl },
		),
	).rejects.toMatchObject({ status: 413 })
	expect(fetchImpl).not.toHaveBeenCalled()
})
