import { afterEach, expect, test, vi } from 'vitest'
import { prisma } from './db.server.ts'
import { getTipOfTongueMatches } from './tip-of-tongue.server.ts'

afterEach(() => vi.unstubAllEnvs())

function aiPlanResponse(searchTerms: string[]) {
	return new Response(
		JSON.stringify({
			output: [
				{
					type: 'message',
					content: [
						{
							type: 'output_text',
							text: JSON.stringify({
								searchTerms,
								interpretation:
									'These are uncertain clues for a local catalog search.',
							}),
						},
					],
				},
			],
		}),
		{ status: 200, headers: { 'Content-Type': 'application/json' } },
	)
}

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

test('local matching retains meaningful short clues and selects the relevant sentence', async () => {
	const expected = await prisma.media.create({
		data: {
			kind: 'movie',
			title: 'The Red Dog Returns',
			description:
				'The town prepares for a quiet festival. A boy searches for his red dog after the war.',
			catalogPopularity: 1,
		},
	})
	await prisma.media.create({
		data: {
			kind: 'movie',
			title: 'Popular Harbor',
			description: 'Sailors celebrate a summer festival beside the sea.',
			catalogPopularity: 100,
		},
	})

	const result = await getTipOfTongueMatches({
		memory: 'A boy searches for his red dog after a war.',
		kind: 'movie',
	})

	expect(result.matches[0]).toEqual(
		expect.objectContaining({
			mediaId: expected.id,
			summary: 'A boy searches for his red dog after the war.',
			matchedClues: expect.arrayContaining(['boy', 'red', 'dog', 'war']),
		}),
	)
})

test('AI expands clues while final matches remain catalog-backed', async () => {
	const expected = await prisma.media.create({
		data: {
			kind: 'anime',
			title: 'Clockwork Summer',
			description: 'Friends discover a clock that repeats the last summer day.',
		},
	})
	vi.stubEnv('OPENAI_API_KEY', 'test-key')
	const fetchImpl = vi.fn<typeof fetch>(async () =>
		aiPlanResponse(['time loop', 'clock', 'summer day', 'friendship']),
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
				matchedClues: expect.arrayContaining(['friends', 'summer', 'day']),
			}),
		],
	})
	expect(fetchImpl).toHaveBeenCalledOnce()
	const [, requestInit] = fetchImpl.mock.calls[0]!
	const request = JSON.parse(String(requestInit?.body)) as {
		model: string
		store: boolean
		input: string
		text: { format: { type: string } }
	}
	expect(request.model).toBe('gpt-5.6-sol')
	expect(request.store).toBe(false)
	expect(request.text.format.type).toBe('json_schema')
	expect(JSON.parse(request.input)).toEqual({
		memory: 'An anime where friends repeat the same summer day with a clock.',
		requestedMediaType: 'anime',
	})
})

test('catalog and provider metadata are never sent to external AI', async () => {
	const malRestricted = await prisma.media.create({
		data: {
			kind: 'anime',
			title: 'MAL Restricted Clock',
			description: 'A silver clock repeats a forgotten summer afternoon.',
			externalIds: {
				create: {
					provider: 'mal',
					kind: 'anime',
					externalId: 'policy-restricted-mal-title',
				},
			},
		},
	})
	const tmdbRestricted = await prisma.media.create({
		data: {
			kind: 'anime',
			title: 'TMDB Restricted Summer',
			description: 'Friends repeat a summer afternoon beside a silver clock.',
			externalIds: {
				create: {
					provider: 'tmdb',
					kind: 'tv',
					externalId: 'policy-restricted-tmdb-title',
				},
			},
		},
	})
	vi.stubEnv('OPENAI_API_KEY', 'test-key')
	const memory = 'A silver clock repeats a summer afternoon.'
	const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
		const request = JSON.parse(String(init?.body)) as { input: string }
		expect(JSON.parse(request.input)).toEqual({
			memory,
			requestedMediaType: 'anime',
		})
		expect(request.input).not.toContain(malRestricted.title!)
		expect(request.input).not.toContain(tmdbRestricted.title!)
		expect(request.input).not.toContain('externalId')
		return aiPlanResponse(['silver clock', 'summer', 'time loop'])
	})

	const result = await getTipOfTongueMatches(
		{ memory, kind: 'anime' },
		{ fetchImpl, allowAi: true },
	)

	expect(fetchImpl).toHaveBeenCalledOnce()
	expect(result.source).toBe('ai')
	expect(result.matches.map(match => match.mediaId)).toEqual(
		expect.arrayContaining([malRestricted.id, tmdbRestricted.id]),
	)
})

test('MAL-sourced titles can be matched after privacy-safe AI clue expansion', async () => {
	const candidate = await prisma.media.create({
		data: {
			kind: 'manga',
			title: 'Local Only Lantern',
			description: 'A lantern guides a traveler through a mirrored forest.',
			externalIds: {
				create: {
					provider: 'mal',
					kind: 'manga',
					externalId: 'local-only-mal-title',
				},
			},
		},
	})
	vi.stubEnv('OPENAI_API_KEY', 'test-key')
	const fetchImpl = vi.fn<typeof fetch>(async () =>
		aiPlanResponse(['lantern', 'mirror forest', 'lost traveler']),
	)

	const result = await getTipOfTongueMatches(
		{ memory: 'A lantern in a mirrored forest.', kind: 'manga' },
		{ fetchImpl, allowAi: true },
	)

	expect(fetchImpl).toHaveBeenCalledOnce()
	expect(result).toEqual(
		expect.objectContaining({
			source: 'ai',
			fallbackReason: null,
			matches: [
				expect.objectContaining({
					mediaId: candidate.id,
				}),
			],
		}),
	)
})

test('AI-expanded search returns five unique local catalog matches', async () => {
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
	const fetchImpl = vi.fn<typeof fetch>(async () =>
		aiPlanResponse(['airship', 'detective', 'coastal mystery', 'violet']),
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
			matchedClues: expect.arrayContaining(['detective', 'violet', 'zeppelin']),
		}),
	)
	expect(result.matches.map(match => match.mediaId)).toEqual(
		expect.arrayContaining(candidates.map(candidate => candidate.id)),
	)
})

test('AI clue expansion is limited per member and falls back to catalog matching', async () => {
	const candidate = await prisma.media.create({
		data: {
			kind: 'manga',
			title: 'Rate Limit Lantern',
			description: 'A lantern guides a traveler through a mirrored forest.',
		},
	})
	vi.stubEnv('OPENAI_API_KEY', 'test-key')
	const fetchImpl = vi.fn<typeof fetch>(async () =>
		aiPlanResponse(['lantern', 'mirrored forest']),
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
