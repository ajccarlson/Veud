import { afterEach, expect, test, vi } from 'vitest'
import { prisma } from './db.server.ts'
import { getTipOfTongueMatches } from './tip-of-tongue.server.ts'

afterEach(() => vi.unstubAllEnvs())

test('descriptive search ranks only catalog titles and exposes matching clues', async () => {
	const expected = await prisma.media.create({
		data: {
			kind: 'movie',
			title: 'The Crimson Balloon',
			description:
				'A child follows a red balloon through the narrow streets of Paris.',
			genres: 'Family, Fantasy',
			catalogPopularity: 1,
		},
	})
	await prisma.media.create({
		data: {
			kind: 'movie',
			title: 'Ocean Signal',
			description: 'A research vessel receives a signal beneath the sea.',
			catalogPopularity: 100,
		},
	})

	const result = await getTipOfTongueMatches({
		memory: 'A child follows a red balloon around Paris.',
		kind: 'movie',
	})

	expect(result.source).toBe('catalog-match')
	expect(result.matches[0]).toEqual(
		expect.objectContaining({
			mediaId: expected.id,
			matchedClues: expect.arrayContaining(['child', 'balloon', 'paris']),
		}),
	)
})

test('AI ranking cannot return a title outside the supplied catalog candidates', async () => {
	const expected = await prisma.media.create({
		data: {
			kind: 'anime',
			title: 'Clockwork Summer',
			description: 'Friends discover a clock that repeats the last summer day.',
		},
	})
	vi.stubEnv('OPENAI_API_KEY', 'test-key')
	const fetchImpl = vi.fn<typeof fetch>(
		async (_input, _init) =>
			new Response(
				JSON.stringify({
					output: [
						{
							type: 'message',
							content: [
								{
									type: 'output_text',
									text: JSON.stringify({
										matches: [
											{
												mediaId: 'invented-media-id',
												summary: 'Invented result.',
												matchedClues: ['summer'],
											},
											{
												mediaId: expected.id,
												summary: 'The repeating summer day matches the memory.',
												matchedClues: ['repeating summer day'],
											},
										],
									}),
								},
							],
						},
					],
				}),
				{ status: 200, headers: { 'Content-Type': 'application/json' } },
			),
	)

	const result = await getTipOfTongueMatches(
		{
			memory: 'An anime where friends repeat the same summer day with a clock.',
			kind: 'anime',
		},
		{ fetchImpl },
	)

	expect(result).toEqual({
		source: 'ai',
		matches: [
			expect.objectContaining({
				mediaId: expected.id,
				matchedClues: ['repeating summer day'],
			}),
		],
	})
	expect(fetchImpl).toHaveBeenCalledOnce()
	const [, requestInit] = fetchImpl.mock.calls[0]!
	const request = JSON.parse(String(requestInit?.body)) as {
		store: boolean
		text: { format: { type: string } }
	}
	expect(request.store).toBe(false)
	expect(request.text.format.type).toBe('json_schema')
})
