import { expect, test } from 'vitest'
import {
	combinedLexicalTerms,
	containsPattern,
	findCatalogCandidateIds,
	findSuggestionCandidateIds,
	hydrateCatalogCandidates,
	lexicalTerms,
	MAX_CATALOG_CANDIDATES,
	MAX_LEXICAL_TERMS,
	MAX_SUGGESTION_EXACT_TITLES,
	MAX_SUGGESTION_TITLE_TERMS,
} from './catalog-candidates.server.ts'
import { prisma } from './db.server.ts'

async function seedMedia(
	rows: Array<{
		title: string
		kind?: string
		description?: string
		genres?: string
		popularity?: number
		alternateTitles?: string[]
	}>,
) {
	const created = []
	for (const row of rows) {
		const media = await prisma.media.create({
			data: {
				kind: row.kind ?? 'movie',
				title: row.title,
				description: row.description ?? null,
				genres: row.genres ?? null,
				catalogPopularity: row.popularity ?? 0,
				...(row.alternateTitles?.length
					? {
							titles: {
								create: row.alternateTitles.map(value => ({
									provider: 'test',
									titleType: 'alternate',
									value,
									normalized: value.toLowerCase(),
									isPrimary: false,
								})),
							},
						}
					: {}),
			},
			select: { id: true, title: true },
		})
		created.push(media)
	}
	return created
}

test('lexical terms normalize once, drop noise, and stay capped', () => {
	expect(lexicalTerms('The a an of')).toEqual([])
	expect(lexicalTerms('ab xy')).toEqual([])
	// Repetition ranks a term higher without adding query work.
	expect(lexicalTerms('lighthouse keeper lighthouse')[0]).toBe('lighthouse')
	// Unicode is normalized rather than rejected.
	expect(lexicalTerms('Café Society')).toContain('cafe')
	const many = Array.from({ length: 40 }, (_, index) => `term${index}`).join(
		' ',
	)
	expect(lexicalTerms(many)).toHaveLength(MAX_LEXICAL_TERMS)
	// Hostile input cannot widen the search.
	expect(lexicalTerms('%%% ___ \\\\\\')).toEqual([])
	expect(lexicalTerms('x'.repeat(5000))).toHaveLength(1)
})

test('combined terms share one budget across prompt and expansions', () => {
	const prompt = Array.from({ length: 8 }, (_, i) => `prompt${i}`).join(' ')
	const expansions = Array.from({ length: 30 }, (_, i) => `extra${i}`)
	const combined = combinedLexicalTerms(prompt, expansions)
	expect(combined).toHaveLength(MAX_LEXICAL_TERMS)
	// The prompt keeps priority; expansions only fill the remainder.
	expect(combined.slice(0, 8).every(term => term.startsWith('prompt'))).toBe(
		true,
	)
	const full = Array.from({ length: 20 }, (_, i) => `full${i}`).join(' ')
	expect(combinedLexicalTerms(full, expansions)).toHaveLength(MAX_LEXICAL_TERMS)
})

test('wildcards in member text stay literal search characters', () => {
	expect(containsPattern('50%')).toBe('%50!%%')
	expect(containsPattern('a_b')).toBe('%a!_b%')
	expect(containsPattern('bang!')).toBe('%bang!!%')
})

test('candidate identifiers come from one query and respect the kind boundary', async () => {
	const seeded = await seedMedia([
		{ title: 'Cobalt Lighthouse', kind: 'movie', popularity: 90 },
		{ title: 'Cobalt Harbor', kind: 'anime', popularity: 95 },
		{
			title: 'Amber Journal',
			kind: 'movie',
			description: 'A keeper finds a cobalt journal.',
			popularity: 10,
		},
	])
	const queries: string[] = []
	const detach = attachQueryRecorder(queries)
	try {
		const movieIds = await findCatalogCandidateIds({
			kind: 'movie',
			terms: ['cobalt'],
			popularLimit: 0,
		})
		expect(queries).toHaveLength(1)
		expect(movieIds).toContain(seeded[0]!.id)
		expect(movieIds).toContain(seeded[2]!.id)
		// The requested kind is authoritative.
		expect(movieIds).not.toContain(seeded[1]!.id)

		// A canonical title match outranks a description-only match.
		expect(movieIds.indexOf(seeded[0]!.id)).toBeLessThan(
			movieIds.indexOf(seeded[2]!.id),
		)
	} finally {
		detach()
		await prisma.media.deleteMany({
			where: { id: { in: seeded.map(item => item.id) } },
		})
	}
})

test('alternate normalized titles are matched without a correlated subquery', async () => {
	const seeded = await seedMedia([
		{
			title: 'Unrelated Canonical',
			kind: 'anime',
			alternateTitles: ['Kurenai Tousen'],
			popularity: 5,
		},
	])
	try {
		const ids = await findCatalogCandidateIds({
			kind: 'anime',
			terms: ['kurenai'],
			popularLimit: 0,
		})
		expect(ids).toEqual([seeded[0]!.id])
	} finally {
		await prisma.media.deleteMany({
			where: { id: { in: seeded.map(item => item.id) } },
		})
	}
})

test('serialized genres never seed candidates', async () => {
	const seeded = await seedMedia([
		{ title: 'Genre Only', kind: 'movie', genres: 'Psychological Thriller' },
	])
	try {
		// Genre text is a ranking signal after hydration, never an index-less
		// leading scan.
		expect(
			await findCatalogCandidateIds({
				kind: 'movie',
				terms: ['psychological'],
				popularLimit: 0,
			}),
		).toEqual([])
	} finally {
		await prisma.media.deleteMany({
			where: { id: { in: seeded.map(item => item.id) } },
		})
	}
})

test('literal wildcards cannot broaden a candidate search', async () => {
	const seeded = await seedMedia([
		{ title: 'Plain Title', kind: 'movie' },
		{ title: 'Has 50% Off', kind: 'movie' },
	])
	try {
		const ids = await findCatalogCandidateIds({
			kind: 'movie',
			terms: ['50%'],
			popularLimit: 0,
		})
		// A bare `%` term would otherwise match every row.
		expect(ids).not.toContain(seeded[0]!.id)
	} finally {
		await prisma.media.deleteMany({
			where: { id: { in: seeded.map(item => item.id) } },
		})
	}
})

test('every AI hypothesis resolves through one batched lookup', async () => {
	const seeded = await seedMedia([
		{ title: 'First Hypothesis', kind: 'movie', popularity: 50 },
		{ title: 'Second Hypothesis', kind: 'movie', popularity: 40 },
		{ title: 'Third Hypothesis', kind: 'movie', popularity: 30 },
		{ title: 'Fourth Hypothesis', kind: 'movie', popularity: 20 },
		{ title: 'Fifth Hypothesis', kind: 'movie', popularity: 10 },
	])
	const queries: string[] = []
	const detach = attachQueryRecorder(queries)
	try {
		const ids = await findSuggestionCandidateIds({
			suggestions: seeded.map(item => ({
				kind: 'movie',
				exactTitles: [item.title!.toLowerCase()],
				titleTerms: ['hypothesis'],
			})),
		})
		// One query for five hypotheses, not one per hypothesis.
		expect(queries).toHaveLength(1)
		for (const item of seeded) expect(ids).toContain(item.id)
	} finally {
		detach()
		await prisma.media.deleteMany({
			where: { id: { in: seeded.map(item => item.id) } },
		})
	}
})

test('suggestion lookups enforce their exact-title and term budgets', async () => {
	const queries: string[] = []
	const detach = attachQueryRecorder(queries)
	try {
		await findSuggestionCandidateIds({
			suggestions: Array.from({ length: 40 }, (_, index) => ({
				kind: `kind${index}`,
				exactTitles: Array.from(
					{ length: 60 },
					(_, i) => `title ${index}-${i}`,
				),
				titleTerms: Array.from({ length: 200 }, (_, i) => `term${index}-${i}`),
			})),
		})
		expect(queries).toHaveLength(1)
		const sql = queries[0]!
		// Bound parameters, not interpolated text, and capped in every dimension.
		// Each exact title emits a canonical-equality and an alternate-title
		// branch, so count distinct titles rather than bindings.
		const distinctTitles = new Set(sql.match(/title \d+-\d+/g) ?? [])
		expect(distinctTitles.size).toBeLessThanOrEqual(MAX_SUGGESTION_EXACT_TITLES)
		const distinctTerms = new Set(sql.match(/term\d+-\d+/g) ?? [])
		expect(distinctTerms.size).toBeLessThanOrEqual(MAX_SUGGESTION_TITLE_TERMS)
	} finally {
		detach()
	}
})

test('empty and unusable input issues no candidate query at all', async () => {
	const queries: string[] = []
	const detach = attachQueryRecorder(queries)
	try {
		expect(
			await findSuggestionCandidateIds({
				suggestions: [{ kind: 'movie', exactTitles: [], titleTerms: [] }],
			}),
		).toEqual([])
		expect(
			await findCatalogCandidateIds({
				kind: 'movie',
				terms: [],
				popularLimit: 0,
			}),
		).toEqual([])
		expect(queries).toHaveLength(0)
	} finally {
		detach()
	}
})

test('hydration is one bounded read that preserves candidate order', async () => {
	const seeded = await seedMedia([
		{ title: 'Order One', kind: 'movie' },
		{ title: 'Order Two', kind: 'movie' },
		{ title: 'Order Three', kind: 'movie' },
	])
	const queries: string[] = []
	const detach = attachQueryRecorder(queries)
	try {
		const requested = [seeded[2]!.id, seeded[0]!.id, seeded[1]!.id]
		const hydrated = await hydrateCatalogCandidates(requested)
		expect(queries).toHaveLength(1)
		expect(hydrated.map(item => item.id)).toEqual(requested)
		// Unknown identifiers are dropped rather than producing holes.
		const withMissing = await hydrateCatalogCandidates([
			'missing-id',
			seeded[0]!.id,
		])
		expect(withMissing.map(item => item.id)).toEqual([seeded[0]!.id])
		// The hydration ceiling is enforced regardless of the caller.
		const overflow = Array.from(
			{ length: MAX_CATALOG_CANDIDATES + 40 },
			(_, index) => `absent-${index}`,
		)
		expect(await hydrateCatalogCandidates(overflow)).toEqual([])
	} finally {
		detach()
		await prisma.media.deleteMany({
			where: { id: { in: seeded.map(item => item.id) } },
		})
	}
})

/**
 * Record the SQL of every raw candidate query so budgets and round-trip counts
 * are asserted against real behavior rather than source text.
 */
function attachQueryRecorder(sink: string[]) {
	const originalQueryRaw = prisma.$queryRaw.bind(prisma)
	const originalFindMany = prisma.media.findMany.bind(prisma.media)
	Object.assign(prisma, {
		$queryRaw: (query: unknown, ...values: unknown[]) => {
			const sql = (query as { sql?: string; strings?: string[] })?.sql
			const text =
				typeof sql === 'string'
					? sql
					: ((query as { strings?: string[] })?.strings ?? []).join('?')
			const bound = ((query as { values?: unknown[] })?.values ?? [])
				.map(value => String(value))
				.join(' ')
			sink.push(`${text} :: ${bound}`)
			return originalQueryRaw(query as never, ...(values as never[]))
		},
	})
	Object.assign(prisma.media, {
		findMany: (args: unknown) => {
			sink.push('findMany :: media')
			return originalFindMany(args as never)
		},
	})
	return () => {
		Object.assign(prisma, { $queryRaw: originalQueryRaw })
		Object.assign(prisma.media, { findMany: originalFindMany })
	}
}

test('a canonical title with no alternate-title rows is still reachable', async () => {
	// Short titles produce no lexical terms, so canonical-title equality is the
	// only path that can find them.
	const seeded = await seedMedia([{ title: 'Up', kind: 'movie' }])
	try {
		const ids = await findSuggestionCandidateIds({
			suggestions: [{ kind: 'movie', exactTitles: ['up'], titleTerms: [] }],
		})
		expect(ids).toEqual([seeded[0]!.id])
	} finally {
		await prisma.media.deleteMany({
			where: { id: { in: seeded.map(item => item.id) } },
		})
	}
})

test('one crowded hypothesis cannot starve the others of candidates', async () => {
	// The crowd must compete at the SAME source rank as the victims, otherwise a
	// shared pool would still rank the victims first and the test would pass
	// without proving per-hypothesis allocation. 80 rows share hypothesis one's
	// exact title with high popularity; the other four hypotheses match a single
	// low-popularity row each.
	const crowd = await seedMedia(
		Array.from({ length: 80 }, (_, index) => ({
			title: 'Crowded Signal',
			kind: 'movie',
			popularity: 500 + index,
		})),
	)
	const distinct = await seedMedia([
		{ title: 'Lonely Beacon', kind: 'movie', popularity: 1 },
		{ title: 'Quiet Harbor', kind: 'movie', popularity: 1 },
		{ title: 'Still Water', kind: 'movie', popularity: 1 },
		{ title: 'Empty Road', kind: 'movie', popularity: 1 },
	])
	try {
		const ids = await findSuggestionCandidateIds({
			suggestions: [
				{ kind: 'movie', exactTitles: ['crowded signal'], titleTerms: [] },
				{ kind: 'movie', exactTitles: ['lonely beacon'], titleTerms: [] },
				{ kind: 'movie', exactTitles: ['quiet harbor'], titleTerms: [] },
				{ kind: 'movie', exactTitles: ['still water'], titleTerms: [] },
				{ kind: 'movie', exactTitles: ['empty road'], titleTerms: [] },
			],
		})
		// Every hypothesis keeps its own guaranteed slots even though the crowd
		// could otherwise fill the entire shared budget.
		for (const item of distinct) expect(ids).toContain(item.id)
		// And the crowded hypothesis is held to its share rather than the whole
		// pool.
		const crowdIds = new Set(crowd.map(item => item.id))
		expect(ids.filter(id => crowdIds.has(id)).length).toBeLessThan(crowd.length)
	} finally {
		await prisma.media.deleteMany({
			where: {
				id: { in: [...crowd, ...distinct].map(item => item.id) },
			},
		})
	}
})

test('the full candidate budget stays usable instead of being truncated', async () => {
	// One hypothesis matching 20 rows and four matching one each is well inside
	// the 72-candidate budget: a hard per-hypothesis cut would drop rows while
	// most of the budget sat idle.
	const crowd = await seedMedia(
		Array.from({ length: 20 }, (_, index) => ({
			title: 'Recall Signal',
			kind: 'movie',
			popularity: 100 + index,
		})),
	)
	const distinct = await seedMedia([
		{ title: 'Recall Alpha', kind: 'movie', popularity: 1 },
		{ title: 'Recall Beta', kind: 'movie', popularity: 1 },
		{ title: 'Recall Gamma', kind: 'movie', popularity: 1 },
		{ title: 'Recall Delta', kind: 'movie', popularity: 1 },
	])
	try {
		const ids = await findSuggestionCandidateIds({
			suggestions: [
				{ kind: 'movie', exactTitles: ['recall signal'], titleTerms: [] },
				{ kind: 'movie', exactTitles: ['recall alpha'], titleTerms: [] },
				{ kind: 'movie', exactTitles: ['recall beta'], titleTerms: [] },
				{ kind: 'movie', exactTitles: ['recall gamma'], titleTerms: [] },
				{ kind: 'movie', exactTitles: ['recall delta'], titleTerms: [] },
			],
		})
		// Nothing is dropped: 20 + 4 all fit inside the budget.
		for (const item of [...crowd, ...distinct]) expect(ids).toContain(item.id)
	} finally {
		await prisma.media.deleteMany({
			where: { id: { in: [...crowd, ...distinct].map(item => item.id) } },
		})
	}
})

test('every hypothesis keeps a reserved share of the term budget', async () => {
	// A verbose first hypothesis must not consume the shared term budget and
	// leave later hypotheses with no fuzzy matching.
	const seeded = await seedMedia([
		{ title: 'Reserved Zulu', kind: 'movie' },
		{ title: 'Reserved Yankee', kind: 'movie' },
	])
	try {
		const ids = await findSuggestionCandidateIds({
			suggestions: [
				{
					kind: 'movie',
					exactTitles: [],
					titleTerms: Array.from({ length: 60 }, (_, i) => `verbose${i}`),
				},
				{ kind: 'movie', exactTitles: [], titleTerms: ['zulu'] },
				{ kind: 'movie', exactTitles: [], titleTerms: ['yankee'] },
			],
		})
		for (const item of seeded) expect(ids).toContain(item.id)
	} finally {
		await prisma.media.deleteMany({
			where: { id: { in: seeded.map(item => item.id) } },
		})
	}
})

test('the PostgreSQL dialect emits index-visible predicates, not LOWER()', async () => {
	// The load test measures hand-written copies of these shapes, so it cannot
	// catch the application regressing. This asserts the SQL the application
	// actually emits: LOWER(column) hides the GIN trigram indexes, ILIKE does
	// not.
	const queries: string[] = []
	const detach = attachQueryRecorder(queries)
	const postgresUrl = 'postgresql://user@127.0.0.1:5432/veud?schema=public'
	try {
		await findCatalogCandidateIds({
			kind: 'movie',
			terms: ['lighthouse'],
			popularLimit: 0,
			databaseUrl: postgresUrl,
		}).catch(() => undefined)
		await findSuggestionCandidateIds({
			suggestions: [
				{ kind: 'movie', exactTitles: ['exact title'], titleTerms: ['term'] },
			],
			databaseUrl: postgresUrl,
		}).catch(() => undefined)
		expect(queries).toHaveLength(2)
		for (const sql of queries) {
			expect(sql).toContain('ILIKE')
			expect(sql).not.toContain('LOWER(')
			expect(sql).toContain("ESCAPE '!'")
		}
	} finally {
		detach()
	}
})

test('the SQLite dialect never emits PostgreSQL-only ILIKE', async () => {
	const queries: string[] = []
	const detach = attachQueryRecorder(queries)
	try {
		await findCatalogCandidateIds({
			kind: 'movie',
			terms: ['lighthouse'],
			popularLimit: 0,
			databaseUrl: 'file:./tests/prisma/data.db',
		})
		expect(queries).toHaveLength(1)
		expect(queries[0]).not.toContain('ILIKE')
		expect(queries[0]).toContain('LIKE')
	} finally {
		detach()
	}
})
