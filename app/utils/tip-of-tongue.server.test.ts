import { afterEach, expect, test, vi } from 'vitest'
import { consoleError } from '#tests/setup/setup-test-env.ts'
import { prisma } from './db.server.ts'
import { getTipOfTongueMatches } from './tip-of-tongue.server.ts'

afterEach(() => vi.unstubAllEnvs())

function aiSuggestionResponse(
	input: Array<{
		title: string
		alternateTitle?: string | null
		year?: number | null
		kind?: 'movie' | 'tv' | 'anime' | 'manga'
		reason?: string
		matchedClues?: string[]
	}>,
) {
	const suggestions = Array.from({ length: 5 }, (_, index) => {
		const suggestion = input[index]
		return {
			title: suggestion?.title ?? `Unavailable catalog suggestion ${index + 1}`,
			alternateTitle: suggestion?.alternateTitle ?? null,
			year: suggestion?.year ?? null,
			kind: suggestion?.kind ?? input[0]?.kind ?? 'movie',
			reason:
				suggestion?.reason ??
				'This possible match shares the strongest remembered details.',
			matchedClues: suggestion?.matchedClues ?? ['remembered details'],
		}
	})
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

test('local matching does not pad results with unrelated popular titles', async () => {
	await prisma.media.create({
		data: {
			kind: 'movie',
			title: 'Unrelated Popular Harbor',
			description: 'Sailors celebrate a summer festival beside the sea.',
			catalogPopularity: 1_000,
		},
	})

	const result = await getTipOfTongueMatches({
		memory: 'A crystalline typewriter inside a volcano.',
		kind: 'movie',
	})

	expect(result.source).toBe('catalog-match')
	expect(result.matches).toEqual([])
})

test('AI identifies five hypotheses while final matches remain catalog-backed', async () => {
	const expected = await prisma.media.create({
		data: {
			kind: 'anime',
			title: 'Clockwork Summer',
			description: 'Friends discover a clock that repeats the last summer day.',
		},
	})
	vi.stubEnv('OPENAI_API_KEY', 'test-key')
	const fetchImpl = vi.fn<typeof fetch>(async () =>
		aiSuggestionResponse([
			{
				title: 'Clockwork Summer',
				kind: 'anime',
				reason:
					'Clockwork Summer may match the friends, clock, and repeating summer day.',
				matchedClues: ['friends', 'clock', 'summer day'],
			},
		]),
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
				matchedClues: expect.arrayContaining([
					'friends',
					'clock',
					'summer day',
				]),
			}),
		],
	})
	expect(fetchImpl).toHaveBeenCalledOnce()
	const [, requestInit] = fetchImpl.mock.calls[0]!
	const request = JSON.parse(String(requestInit?.body)) as {
		model: string
		store: boolean
		reasoning: { effort: string }
		input: string
		text: { format: { type: string } }
	}
	expect(request.model).toBe('gpt-5.6-luna')
	expect(request.store).toBe(false)
	expect(request.text.format.type).toBe('json_schema')
	expect(request).toEqual(
		expect.objectContaining({
			reasoning: { effort: 'none' },
		}),
	)
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
		return aiSuggestionResponse([
			{
				title: malRestricted.title!,
				kind: 'anime',
				reason: 'This may match the silver clock and summer afternoon.',
				matchedClues: ['silver clock', 'summer afternoon'],
			},
			{
				title: tmdbRestricted.title!,
				kind: 'anime',
				reason: 'This may match friends repeating a summer afternoon.',
				matchedClues: ['friends', 'summer afternoon'],
			},
		])
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

test('MAL-sourced titles can be matched after privacy-safe AI identification', async () => {
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
		aiSuggestionResponse([
			{
				title: candidate.title!,
				kind: 'manga',
				reason: 'This may match the lantern and mirrored forest.',
				matchedClues: ['lantern', 'mirrored forest'],
			},
		]),
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

test('AI identification returns five unique local catalog matches', async () => {
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
		aiSuggestionResponse(
			candidates.map(candidate => ({
				title: candidate.title!,
				kind: 'tv' as const,
				reason:
					'This may match the detective, violet zeppelin, and coastal city.',
				matchedClues: ['detective', 'violet zeppelin', 'coastal city'],
			})),
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
			matchedClues: expect.arrayContaining([
				'detective',
				'violet zeppelin',
				'coastal city',
			]),
		}),
	)
	expect(result.matches.map(match => match.mediaId)).toEqual(
		expect.arrayContaining(candidates.map(candidate => candidate.id)),
	)
})

test('requested media type remains authoritative over an AI suggestion', async () => {
	const [movie, anime] = await Promise.all([
		prisma.media.create({
			data: {
				kind: 'movie',
				title: 'Shared Lantern Title',
				description: 'A live-action traveler carries a lantern.',
			},
		}),
		prisma.media.create({
			data: {
				kind: 'anime',
				title: 'Shared Lantern Title',
				description: 'An animated traveler carries a lantern.',
			},
		}),
	])
	vi.stubEnv('OPENAI_API_KEY', 'test-key')
	const fetchImpl = vi.fn<typeof fetch>(async () =>
		aiSuggestionResponse([
			{
				title: 'Shared Lantern Title',
				kind: 'movie',
				reason: 'This may match the traveler and lantern.',
				matchedClues: ['traveler', 'lantern'],
			},
		]),
	)

	const result = await getTipOfTongueMatches(
		{ memory: 'An animated traveler carries a lantern.', kind: 'anime' },
		{ fetchImpl, allowAi: true },
	)

	expect(result.matches[0]?.mediaId).toBe(anime.id)
	expect(result.matches.map(match => match.mediaId)).not.toContain(movie.id)
})

test('AI identification resolves short canonical titles without alternate-title rows', async () => {
	const candidate = await prisma.media.create({
		data: {
			kind: 'movie',
			title: 'Up',
			description:
				'An elderly widower and a young scout travel in a flying house.',
		},
	})
	vi.stubEnv('OPENAI_API_KEY', 'test-key')
	const fetchImpl = vi.fn<typeof fetch>(async () =>
		aiSuggestionResponse([
			{
				title: 'Up',
				kind: 'movie',
				reason:
					'Up may match the elderly widower, young scout, and flying house.',
				matchedClues: ['elderly widower', 'young scout', 'flying house'],
			},
		]),
	)

	const result = await getTipOfTongueMatches(
		{
			memory:
				'An elderly widower travels with a young scout in a flying house.',
			kind: 'movie',
		},
		{ fetchImpl, allowAi: true },
	)

	expect(result.matches[0]?.mediaId).toBe(candidate.id)
})

test('AI identification is limited per member and falls back to catalog matching', async () => {
	const candidate = await prisma.media.create({
		data: {
			kind: 'manga',
			title: 'Rate Limit Lantern',
			description: 'A lantern guides a traveler through a mirrored forest.',
		},
	})
	vi.stubEnv('OPENAI_API_KEY', 'test-key')
	const fetchImpl = vi.fn<typeof fetch>(async () =>
		aiSuggestionResponse([
			{
				title: candidate.title!,
				kind: 'manga',
				reason: 'This may match the lantern and mirrored forest.',
				matchedClues: ['lantern', 'mirrored forest'],
			},
		]),
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

test('AI quota failures open a circuit while catalog matching stays available', async () => {
	const candidate = await prisma.media.create({
		data: {
			kind: 'movie',
			title: 'Quota Clock',
			description:
				'A clock repeats the final hour inside a mountain observatory.',
		},
	})
	vi.stubEnv('OPENAI_API_KEY', 'test-key')
	consoleError.mockImplementation(() => {})
	const fetchImpl = vi.fn<typeof fetch>(async () => {
		return new Response(
			JSON.stringify({
				error: {
					code: 'insufficient_quota',
					message: 'Quota unavailable.',
				},
			}),
			{ status: 429, headers: { 'Content-Type': 'application/json' } },
		)
	})
	const aiCircuit = { unavailableUntil: 0 }

	const first = await getTipOfTongueMatches(
		{
			memory: 'A clock repeats inside a mountain observatory.',
			kind: 'movie',
		},
		{ fetchImpl, allowAi: true, now: 1_000, aiCircuit },
	)
	const second = await getTipOfTongueMatches(
		{
			memory: 'A clock repeats inside a mountain observatory.',
			kind: 'movie',
		},
		{ fetchImpl, allowAi: true, now: 2_000, aiCircuit },
	)

	expect(fetchImpl).toHaveBeenCalledOnce()
	expect(consoleError).toHaveBeenCalledWith(
		'[tip-of-tongue] AI service unavailable (429, insufficient_quota); using catalog match',
	)
	expect(aiCircuit.unavailableUntil).toBe(3_601_000)
	expect(first).toEqual(
		expect.objectContaining({
			source: 'catalog-match',
			fallbackReason: 'ai-unavailable',
			matches: [
				expect.objectContaining({
					mediaId: candidate.id,
				}),
			],
		}),
	)
	expect(second).toEqual(
		expect.objectContaining({
			source: 'catalog-match',
			fallbackReason: 'ai-unavailable',
		}),
	)
})
