import { afterEach, expect, test, vi } from 'vitest'
import { consoleError } from '#tests/setup/setup-test-env.ts'
import { resetAiGatewayStateForTests } from './ai-gateway.server.ts'
import { prisma } from './db.server.ts'
import { getTipOfTongueMatches } from './tip-of-tongue.server.ts'

afterEach(() => {
	vi.unstubAllEnvs()
	vi.unstubAllGlobals()
	resetAiGatewayStateForTests()
})

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

test('production text identification retains durable gateway accounting', async () => {
	const now = Date.UTC(2049, 6, 14, 12, 34, 56)
	const dayStartedAt = new Date(Math.floor(now / 86_400_000) * 86_400_000)
	const nextDayStartedAt = new Date(dayStartedAt.getTime() + 86_400_000)
	vi.stubEnv('OPENAI_API_KEY', 'test-key')
	vi.stubEnv('NODE_ENV', 'production')
	const fetchMock = vi.fn<typeof fetch>(async () =>
		aiSuggestionResponse([
			{
				title: 'Durable Text Gateway Candidate',
				kind: 'movie',
				reason: 'This may match the lighthouse and repeating day.',
				matchedClues: ['lighthouse', 'repeating day'],
			},
		]),
	)
	vi.stubGlobal('fetch', fetchMock)

	try {
		await expect(
			getTipOfTongueMatches(
				{
					memory: 'A lighthouse where the same day keeps repeating.',
					kind: 'movie',
				},
				{
					allowAi: true,
					rateLimitKey: 'viewer:durable-text-wrapper',
					now,
				},
			),
		).resolves.toEqual(
			expect.objectContaining({
				source: 'ai',
				fallbackReason: null,
			}),
		)
		expect(fetchMock).toHaveBeenCalledOnce()
		await expect(
			prisma.aiUsageEvent.findFirst({
				where: {
					capability: 'tip-of-tongue',
					promptVersion: 'tomt-text-v2',
					outcome: 'success',
					createdAt: new Date(now),
				},
			}),
		).resolves.not.toBeNull()
		const buckets = await prisma.aiRateLimitBucket.findMany({
			where: {
				capability: 'tip-of-tongue',
				windowStartedAt: {
					gte: dayStartedAt,
					lt: nextDayStartedAt,
				},
			},
		})
		expect(buckets.map(bucket => bucket.windowMs)).toEqual(
			expect.arrayContaining([10 * 60 * 1_000, 24 * 60 * 60 * 1_000]),
		)
	} finally {
		await prisma.aiUsageEvent.deleteMany({
			where: {
				capability: 'tip-of-tongue',
				promptVersion: 'tomt-text-v2',
				createdAt: new Date(now),
			},
		})
		await prisma.aiRateLimitBucket.deleteMany({
			where: {
				capability: 'tip-of-tongue',
				windowStartedAt: {
					gte: dayStartedAt,
					lt: nextDayStartedAt,
				},
			},
		})
	}
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

	// The AI path must be what resolves this, not the supplemental local
	// fallback: assert the AI's own reason and clues survive, so a regression
	// that loses canonical-title matching cannot pass by falling back.
	expect(result.source).toBe('ai')
	expect(result.matches[0]).toEqual({
		mediaId: candidate.id,
		summary: 'Up may match the elderly widower, young scout, and flying house.',
		matchedClues: ['elderly widower', 'young scout', 'flying house'],
	})
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

/**
 * Count the catalog round trips a resolution performs. The budgets are the
 * point of the batched repository: work must stay fixed whatever the prompt or
 * the AI response contains.
 */
function countCatalogQueries() {
	const queries: string[] = []
	// Count real SQL round trips from Prisma's own query event rather than
	// patching a hand-picked list of delegate methods: that approach missed
	// transactions, unlisted models, and raw variants, so equivalent fan-out
	// could hide from the budget.
	const record = (event: { query: string }) => {
		const sql = String(event.query)
		if (!/^\s*(SELECT|WITH)/i.test(sql)) return
		if (/sqlite_master|_prisma_migrations|PRAGMA/i.test(sql)) return
		queries.push(sql.replace(/\s+/g, ' ').slice(0, 60))
	}
	const client = prisma as unknown as {
		$on: (event: 'query', handler: (event: { query: string }) => void) => void
	}
	client.$on('query', record)
	return {
		queries,
		restore() {
			// Prisma exposes no removeListener for $on. A fresh recorder per test
			// keeps counts scoped because each handler only appends to its own
			// array, so there is nothing to undo here.
		},
	}
}

test('local fallback resolves within two catalog queries whatever the prompt', async () => {
	const seeded = await prisma.media.create({
		data: {
			kind: 'movie',
			title: 'Bounded Lighthouse',
			description: 'A keeper tends an isolated lighthouse.',
			catalogPopularity: 40,
		},
	})
	// A deliberately long, repetitive prompt must not add round trips.
	const memory = `${'lighthouse keeper isolated storm journal '.repeat(30)} ${Array.from(
		{ length: 60 },
		(_, index) => `filler${index}`,
	).join(' ')}`
	const counter = countCatalogQueries()
	try {
		const result = await getTipOfTongueMatches(
			{ memory, kind: 'movie' },
			{ allowAi: false },
		)
		expect(result.source).toBe('catalog-match')
		expect(result.matches.map(match => match.mediaId)).toContain(seeded.id)
		// One bounded candidate query, then one logical hydration read. Hydration
		// is two SQL statements because the candidate select includes the titles
		// relation, so the honest SQL total is three.
		expect(
			counter.queries.filter(sql => sql.includes('WITH matched')),
		).toHaveLength(1)
		expect(counter.queries).toHaveLength(3)
	} finally {
		counter.restore()
		await prisma.media.delete({ where: { id: seeded.id } })
	}
})

test('AI resolution plus supplement stays within four catalog queries', async () => {
	const seeded = await Promise.all(
		['Alpha Signal', 'Beta Signal', 'Gamma Signal'].map((title, index) =>
			prisma.media.create({
				data: {
					kind: 'movie',
					title,
					description: `${title} concerns a distant broadcast.`,
					catalogPopularity: 90 - index,
				},
			}),
		),
	)
	vi.stubEnv('OPENAI_API_KEY', 'test-key')
	// Five hypotheses, only three of which can resolve, so the supplemental
	// local fallback also runs. That is the most expensive supported path.
	const fetchImpl = vi.fn<typeof fetch>(async () =>
		aiSuggestionResponse([
			{ title: 'Alpha Signal', kind: 'movie', matchedClues: ['broadcast'] },
			{ title: 'Beta Signal', kind: 'movie', matchedClues: ['broadcast'] },
			{ title: 'Gamma Signal', kind: 'movie', matchedClues: ['broadcast'] },
			{ title: 'Absent One', kind: 'movie', matchedClues: ['broadcast'] },
			{ title: 'Absent Two', kind: 'movie', matchedClues: ['broadcast'] },
		]),
	)
	const counter = countCatalogQueries()
	try {
		const result = await getTipOfTongueMatches(
			{ memory: 'A film about a distant broadcast signal.', kind: 'movie' },
			{ fetchImpl, allowAi: true },
		)
		expect(result.source).toBe('ai')
		// Exactly two candidate queries on the most expensive supported path: one
		// batched hypothesis lookup plus the supplemental local fallback. Five
		// would mean per-hypothesis fan-out returned.
		expect(
			counter.queries.filter(sql => sql.includes('WITH matched')),
		).toHaveLength(2)
		// Two logical resolutions, each one candidate query plus a two-statement
		// hydration read.
		expect(counter.queries).toHaveLength(6)
	} finally {
		counter.restore()
		await prisma.media.deleteMany({
			where: { id: { in: seeded.map(item => item.id) } },
		})
	}
})

test('a fully resolved AI response needs only the batched lookup and hydration', async () => {
	const seeded = await Promise.all(
		['One Ridge', 'Two Ridge', 'Three Ridge', 'Four Ridge', 'Five Ridge'].map(
			(title, index) =>
				prisma.media.create({
					data: {
						kind: 'movie',
						title,
						description: `${title} climbs a ridge.`,
						catalogPopularity: 90 - index,
					},
				}),
		),
	)
	vi.stubEnv('OPENAI_API_KEY', 'test-key')
	const fetchImpl = vi.fn<typeof fetch>(async () =>
		aiSuggestionResponse(
			['One Ridge', 'Two Ridge', 'Three Ridge', 'Four Ridge', 'Five Ridge'].map(
				title => ({ title, kind: 'movie' as const, matchedClues: ['ridge'] }),
			),
		),
	)
	const counter = countCatalogQueries()
	try {
		const result = await getTipOfTongueMatches(
			{ memory: 'Five films that climb a ridge.', kind: 'movie' },
			{ fetchImpl, allowAi: true },
		)
		expect(result.source).toBe('ai')
		expect(result.matches).toHaveLength(5)
		// No supplemental fallback is needed: one batched candidate query and one
		// hydration read (two SQL statements) resolve all five hypotheses.
		expect(
			counter.queries.filter(sql => sql.includes('WITH matched')),
		).toHaveLength(1)
		expect(counter.queries).toHaveLength(3)
		// Every result is a distinct existing canonical media identifier.
		const ids = result.matches.map(match => match.mediaId)
		expect(new Set(ids).size).toBe(5)
		for (const id of ids) {
			expect(seeded.map(item => item.id)).toContain(id)
		}
	} finally {
		counter.restore()
		await prisma.media.deleteMany({
			where: { id: { in: seeded.map(item => item.id) } },
		})
	}
})
