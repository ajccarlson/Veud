import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { normalizeCatalogTitle } from './catalog-sync.server.ts'
import { prisma } from './db.server.ts'
import { discoveryKinds, type DiscoveryQuery } from './discovery.server.ts'

const MAX_CANDIDATES = 72
const MAX_MATCHES = 5
const AI_REQUEST_LIMIT = 5
const AI_REQUEST_WINDOW_MS = 10 * 60 * 1_000
const aiRequestHistory = new Map<string, number[]>()
const STOP_WORDS = new Set([
	'about',
	'and',
	'after',
	'again',
	'also',
	'any',
	'because',
	'before',
	'but',
	'could',
	'didn',
	'does',
	'for',
	'from',
	'had',
	'has',
	'have',
	'her',
	'him',
	'his',
	'into',
	'just',
	'like',
	'movie',
	'not',
	'our',
	'out',
	'remember',
	'scene',
	'show',
	'some',
	'something',
	'than',
	'that',
	'the',
	'there',
	'they',
	'this',
	'was',
	'were',
	'what',
	'where',
	'which',
	'who',
	'why',
	'with',
	'woman',
	'would',
	'you',
	'your',
])

const AiCluePlanSchema = z.object({
	searchTerms: z.array(z.string().trim().min(2).max(60)).max(20),
	interpretation: z.string().trim().min(1).max(240),
})

type Candidate = {
	id: string
	title: string | null
	kind: string
	type: string | null
	genres: string | null
	description: string | null
	releaseStart: Date | null
	startYear: string | null
	airYear: string | null
}

export type TipOfTongueMatch = {
	mediaId: string
	summary: string
	matchedClues: string[]
}

export type TipOfTongueResults = {
	matches: TipOfTongueMatch[]
	source: 'ai' | 'catalog-match'
	fallbackReason:
		| 'not-configured'
		| 'sign-in-required'
		| 'rate-limited'
		| 'ai-error'
		| 'ai-empty'
		| null
}

function memoryTerms(memory: string) {
	const counts = new Map<string, number>()
	for (const word of normalizeCatalogTitle(memory).match(/[a-z0-9]+/g) ?? []) {
		if (word.length < 3 || STOP_WORDS.has(word)) continue
		counts.set(word, (counts.get(word) ?? 0) + 1)
	}
	return [...counts.entries()]
		.sort(
			(left, right) => right[1] - left[1] || right[0].length - left[0].length,
		)
		.slice(0, 16)
		.map(([word]) => word)
}

function excerptFor(candidate: Candidate, matchedClues: string[]) {
	const description = candidate.description?.trim()
	if (!description) {
		return `${candidate.title ?? 'This title'} is a catalog match for your description.`
	}
	const sentences = description
		.split(/(?<=[.!?])\s+/)
		.map(sentence => sentence.trim())
		.filter(Boolean)
	const bestSentence = sentences.reduce(
		(best, sentence) => {
			const normalized = normalizeCatalogTitle(sentence)
			const score = matchedClues.filter(clue =>
				normalized.includes(clue),
			).length
			return score > best.score ? { sentence, score } : best
		},
		{ sentence: sentences[0] ?? description, score: -1 },
	).sentence
	if (bestSentence.length <= 240) return bestSentence
	const shortened = bestSentence.slice(0, 237)
	const lastSpace = shortened.lastIndexOf(' ')
	return `${shortened.slice(0, Math.max(lastSpace, 160)).trimEnd()}…`
}

function candidateWhere(kind: DiscoveryQuery['kind']) {
	return {
		title: { not: null },
		...(kind === 'all' ? {} : { kind }),
	}
}

async function candidatesFor(
	memory: string,
	kind: DiscoveryQuery['kind'],
	expandedTerms: string[] = [],
) {
	const terms = [
		...new Set([
			...memoryTerms(memory),
			...expandedTerms.flatMap(term => memoryTerms(term)),
		]),
	].slice(0, 28)
	const base = candidateWhere(kind)
	const select = {
		id: true,
		title: true,
		kind: true,
		type: true,
		genres: true,
		description: true,
		releaseStart: true,
		startYear: true,
		airYear: true,
	} satisfies Prisma.MediaSelect
	const lexicalIds = terms.length
		? await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
				SELECT "Media"."id"
				FROM "Media"
				WHERE "Media"."title" IS NOT NULL
				${
					kind === 'all'
						? Prisma.empty
						: Prisma.sql`AND "Media"."kind" = ${kind}`
				}
				AND (
					${Prisma.join(
						terms.map(term => {
							const pattern = `%${term}%`
							return Prisma.sql`
								LOWER(COALESCE("Media"."title", '')) LIKE ${pattern}
								OR LOWER(COALESCE("Media"."description", '')) LIKE ${pattern}
								OR LOWER(COALESCE("Media"."genres", '')) LIKE ${pattern}
								OR EXISTS (
									SELECT 1
									FROM "MediaTitle"
									WHERE "MediaTitle"."mediaId" = "Media"."id"
									AND "MediaTitle"."normalized" LIKE ${pattern}
								)
							`
						}),
						' OR ',
					)}
				)
				ORDER BY COALESCE("Media"."catalogPopularity", 0) DESC, "Media"."title" ASC
				LIMIT ${MAX_CANDIDATES}
			`)
		: []
	const lexicalIdOrder = lexicalIds.map(item => item.id)
	const [lexicalRows, popular] = await Promise.all([
		lexicalIdOrder.length
			? prisma.media.findMany({
					where: { id: { in: lexicalIdOrder } },
					select,
				})
			: Promise.resolve([]),
		prisma.media.findMany({
			where: base,
			select,
			orderBy: [{ catalogPopularity: 'desc' }, { title: 'asc' }],
			take: 24,
		}),
	])
	const lexicalById = new Map(lexicalRows.map(item => [item.id, item]))
	const lexical = lexicalIdOrder.flatMap(id => {
		const item = lexicalById.get(id)
		return item ? [item] : []
	})
	return [
		...new Map([...lexical, ...popular].map(item => [item.id, item])).values(),
	].slice(0, MAX_CANDIDATES)
}

function localMatches(
	memory: string,
	candidates: Candidate[],
	limit = MAX_MATCHES,
	expandedTerms: string[] = [],
) {
	const terms = memoryTerms(memory)
	const expansionWords = [
		...new Set(expandedTerms.flatMap(term => memoryTerms(term))),
	].filter(term => !terms.includes(term))
	return candidates
		.map((candidate, originalIndex) => {
			const title = normalizeCatalogTitle(candidate.title ?? '')
			const genres = normalizeCatalogTitle(candidate.genres ?? '')
			const description = normalizeCatalogTitle(candidate.description ?? '')
			const matchedClues = terms.filter(
				term =>
					title.includes(term) ||
					genres.includes(term) ||
					description.includes(term),
			)
			const matchedExpansions = expansionWords.filter(
				term =>
					title.includes(term) ||
					genres.includes(term) ||
					description.includes(term),
			)
			const score =
				matchedClues.reduce(
					(total, term) =>
						total +
						(title.includes(term) ? 8 : 0) +
						(genres.includes(term) ? 3 : 0) +
						(description.includes(term) ? 2 : 0),
					0,
				) +
				matchedExpansions.reduce(
					(total, term) =>
						total +
						(title.includes(term) ? 3 : 0) +
						(genres.includes(term) ? 2 : 0) +
						(description.includes(term) ? 1 : 0),
					0,
				)
			return { candidate, originalIndex, matchedClues, score }
		})
		.sort(
			(left, right) =>
				right.score - left.score || left.originalIndex - right.originalIndex,
		)
		.slice(0, limit)
		.map(({ candidate, matchedClues }) => ({
			mediaId: candidate.id,
			summary: excerptFor(candidate, matchedClues),
			matchedClues: matchedClues.slice(0, 5),
		}))
}

function consumeAiRequest(key: string, now: number) {
	const cutoff = now - AI_REQUEST_WINDOW_MS
	const recent = (aiRequestHistory.get(key) ?? []).filter(
		timestamp => timestamp > cutoff,
	)
	if (recent.length >= AI_REQUEST_LIMIT) {
		aiRequestHistory.set(key, recent)
		return false
	}
	recent.push(now)
	aiRequestHistory.set(key, recent)
	if (aiRequestHistory.size > 5_000) {
		for (const [storedKey, timestamps] of aiRequestHistory) {
			if (!timestamps.some(timestamp => timestamp > cutoff)) {
				aiRequestHistory.delete(storedKey)
			}
			if (aiRequestHistory.size <= 4_000) break
		}
	}
	return true
}

function responseText(payload: unknown) {
	const parsed = z
		.object({
			output: z.array(
				z.object({
					type: z.string(),
					content: z
						.array(z.object({ type: z.string(), text: z.string().optional() }))
						.optional(),
				}),
			),
		})
		.safeParse(payload)
	if (!parsed.success) return null
	for (const output of parsed.data.output) {
		for (const content of output.content ?? []) {
			if (content.type === 'output_text' && content.text) return content.text
		}
	}
	return null
}

async function aiCluePlan(
	memory: string,
	kind: DiscoveryQuery['kind'],
	fetchImpl: typeof fetch,
	apiKey: string,
) {
	const response = await fetchImpl('https://api.openai.com/v1/responses', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${apiKey}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			model: process.env.OPENAI_TIP_OF_TONGUE_MODEL || 'gpt-5.6-sol',
			store: false,
			reasoning: { effort: 'low' },
			instructions:
				'Turn a person’s incomplete memory of a film, television series, anime, or manga into concise catalog search clues. Return up to 20 specific search terms: distinctive objects, settings, character roles, plot devices, genres, visual details, likely title words, and reasonable synonyms. Do not request personal information. The interpretation must make uncertainty explicit and must not claim a definite identification.',
			input: JSON.stringify({
				memory,
				requestedMediaType: kind,
			}),
			text: {
				verbosity: 'low',
				format: {
					type: 'json_schema',
					name: 'tip_of_tongue_clue_plan',
					strict: true,
					schema: {
						type: 'object',
						additionalProperties: false,
						required: ['searchTerms', 'interpretation'],
						properties: {
							searchTerms: {
								type: 'array',
								maxItems: 20,
								items: { type: 'string' },
							},
							interpretation: { type: 'string' },
						},
					},
				},
			},
		}),
		signal: AbortSignal.timeout(20_000),
	})
	if (!response.ok) throw new Error(`AI search failed (${response.status})`)
	const text = responseText(await response.json())
	if (!text) throw new Error('AI search returned no structured text')
	return AiCluePlanSchema.parse(JSON.parse(text))
}

export async function getTipOfTongueMatches(
	input: { memory: string; kind: DiscoveryQuery['kind'] },
	options: {
		fetchImpl?: typeof fetch
		allowAi?: boolean
		rateLimitKey?: string
		now?: number
	} = {},
): Promise<TipOfTongueResults> {
	const memory = input.memory.trim().slice(0, 500)
	const kind = discoveryKinds.includes(input.kind) ? input.kind : 'all'
	const apiKey = process.env.OPENAI_API_KEY?.trim()
	const fallback = async (
		fallbackReason: TipOfTongueResults['fallbackReason'],
	) => {
		const candidates = await candidatesFor(memory, kind)
		return {
			matches: localMatches(memory, candidates).slice(0, MAX_MATCHES),
			source: 'catalog-match' as const,
			fallbackReason,
		}
	}
	if (!apiKey) return fallback('not-configured')
	if (options.allowAi !== true) return fallback('sign-in-required')
	if (
		options.rateLimitKey &&
		!consumeAiRequest(options.rateLimitKey, options.now ?? Date.now())
	) {
		return fallback('rate-limited')
	}
	try {
		const plan = await aiCluePlan(
			memory,
			kind,
			options.fetchImpl ?? fetch,
			apiKey,
		)
		if (!plan.searchTerms.length) return fallback('ai-empty')
		const candidates = await candidatesFor(memory, kind, plan.searchTerms)
		if (!candidates.length) {
			return { matches: [], source: 'ai', fallbackReason: null }
		}
		return {
			matches: localMatches(memory, candidates, MAX_MATCHES, plan.searchTerms),
			source: 'ai',
			fallbackReason: null,
		}
	} catch (error) {
		console.error(
			'[tip-of-tongue] AI clue expansion failed; using catalog match',
			error,
		)
	}
	return fallback('ai-error')
}
