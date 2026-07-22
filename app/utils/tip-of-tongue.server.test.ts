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
		{ fetchImpl, allowAi: true },
	)

	expect(result).toEqual({
		source: 'ai',
		fallbackReason: null,
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

test('AI results are deduplicated, evidence-checked, and filled to five catalog matches', async () => {
	const candidates = await Promise.all(
		Array.from({ length: 5 }, (_, index) =>
			prisma.media.create({
				data: {
					kind: 'tv',
					title: `Violet Zeppelin Candidate ${index + 1}`,
					description:
						'A detective follows a violet zeppelin above a foggy coastal city.',
					catalogPopularity: 100 - index,
				},
			}),
		),
	)
	vi.stubEnv('OPENAI_API_KEY', 'test-key')
	const fetchImpl = vi.fn<typeof fetch>(
		async () =>
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
												mediaId: candidates[0]!.id,
												summary:
													'The violet airship and coastal mystery are a strong fit.',
												matchedClues: [
													'violet zeppelin',
													'invented spaceship battle',
												],
											},
											{
												mediaId: candidates[0]!.id,
												summary: 'Duplicate result.',
												matchedClues: ['violet zeppelin'],
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
			memory:
				'I remember a detective chasing a violet zeppelin above a coastal city.',
			kind: 'tv',
		},
		{ fetchImpl, allowAi: true },
	)

	expect(result.source).toBe('ai')
	expect(result.fallbackReason).toBeNull()
	expect(result.matches).toHaveLength(5)
	expect(new Set(result.matches.map(match => match.mediaId)).size).toBe(5)
	expect(result.matches[0]).toEqual(
		expect.objectContaining({
			mediaId: candidates[0]!.id,
			matchedClues: ['violet zeppelin'],
		}),
	)
	expect(result.matches.map(match => match.mediaId)).toEqual(
		expect.arrayContaining(candidates.map(candidate => candidate.id)),
	)
})

test('AI ranking is limited per member and falls back to catalog matching', async () => {
	const candidate = await prisma.media.create({
		data: {
			kind: 'manga',
			title: 'Rate Limit Lantern',
			description: 'A lantern guides a traveler through a mirrored forest.',
		},
	})
	vi.stubEnv('OPENAI_API_KEY', 'test-key')
	const fetchImpl = vi.fn<typeof fetch>(
		async () =>
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
												mediaId: candidate.id,
												summary: 'The lantern and mirrored forest match.',
												matchedClues: ['lantern', 'mirrored forest'],
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
	const rateLimitKey = `tip-test-${candidate.id}`
	for (let request = 0; request < 5; request += 1) {
		const result = await getTipOfTongueMatches(
			{
				memory: 'A lantern in a mirrored forest.',
				kind: 'manga',
			},
			{ fetchImpl, allowAi: true, rateLimitKey, now: 1_000_000 },
		)
		expect(result.source).toBe('ai')
	}
	const limited = await getTipOfTongueMatches(
		{
			memory: 'A lantern in a mirrored forest.',
			kind: 'manga',
		},
		{ fetchImpl, allowAi: true, rateLimitKey, now: 1_000_000 },
	)

	expect(fetchImpl).toHaveBeenCalledTimes(5)
	expect(limited).toEqual(
		expect.objectContaining({
			source: 'catalog-match',
			fallbackReason: 'rate-limited',
		}),
	)
})
