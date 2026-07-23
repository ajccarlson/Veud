import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { normalizeCatalogTitle } from './catalog-sync.server.ts'
import { prisma } from './db.server.ts'
import { discoveryKinds, type DiscoveryQuery } from './discovery.server.ts'

const MAX_CANDIDATES = 72
const MAX_MATCHES = 5
const DESCRIPTION_LENGTH = 700
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

const AiMatchesSchema = z.object({
	matches: z
		.array(
			z.object({
				mediaId: z.string().min(1),
				summary: z.string().trim().min(1).max(280),
				matchedClues: z.array(z.string().trim().min(1).max(80)).max(5),
			}),
		)
		.max(MAX_MATCHES),
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
	isExternalAiRestricted: boolean
}

export type TipOfTongueMatch = z.infer<
	typeof AiMatchesSchema
>['matches'][number]

export type TipOfTongueResults = {
	matches: TipOfTongueMatch[]
	source: 'ai' | 'catalog-match'
	fallbackReason:
		| 'not-configured'
		| 'sign-in-required'
		| 'rate-limited'
		| 'ai-error'
		| 'ai-empty'
		| 'provider-restricted'
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
		description: { not: null },
		...(kind === 'all' ? {} : { kind }),
	}
}

async function candidatesFor(memory: string, kind: DiscoveryQuery['kind']) {
	const terms = memoryTerms(memory)
	const base = candidateWhere(kind)
	const lexicalWhere = terms.length
		? {
				AND: [
					base,
					{
						OR: terms.flatMap(term => [
							{ title: { contains: term } },
							{ description: { contains: term } },
							{ genres: { contains: term } },
						]),
					},
				],
			}
		: base
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
		externalIds: {
			where: { provider: { in: ['mal', 'tmdb'] }, tombstonedAt: null },
			select: { id: true },
			take: 1,
		},
	} satisfies Prisma.MediaSelect
	const [lexical, popular] = await Promise.all([
		prisma.media.findMany({
			where: lexicalWhere,
			select,
			orderBy: [{ catalogPopularity: 'desc' }, { title: 'asc' }],
			take: MAX_CANDIDATES,
		}),
		prisma.media.findMany({
			where: base,
			select,
			orderBy: [{ catalogPopularity: 'desc' }, { title: 'asc' }],
			take: 24,
		}),
	])
	return [
		...new Map([...lexical, ...popular].map(item => [item.id, item])).values(),
	]
		.slice(0, MAX_CANDIDATES)
		.map(({ externalIds, ...candidate }) => ({
			...candidate,
			isExternalAiRestricted: externalIds.length > 0,
		}))
}

function yearFor(candidate: Candidate) {
	return (
		(candidate.releaseStart
			? String(candidate.releaseStart.getUTCFullYear())
			: null) ??
		candidate.startYear ??
		candidate.airYear
	)
}

function localMatches(
	memory: string,
	candidates: Candidate[],
	limit = MAX_MATCHES,
) {
	const terms = memoryTerms(memory)
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
			const score = matchedClues.reduce(
				(total, term) =>
					total +
					(title.includes(term) ? 8 : 0) +
					(genres.includes(term) ? 3 : 0) +
					(description.includes(term) ? 2 : 0),
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

function clueRoot(term: string) {
	if (term.length > 5 && term.endsWith('ing')) return term.slice(0, -3)
	if (term.length > 4 && term.endsWith('ed')) return term.slice(0, -2)
	if (term.length > 4 && term.endsWith('es')) return term.slice(0, -2)
	if (term.length > 4 && term.endsWith('s')) return term.slice(0, -1)
	return term
}

function isMemoryBackedClue(memory: string, clue: string) {
	const memoryRoots = new Set(memoryTerms(memory).map(clueRoot))
	const clueRoots = memoryTerms(clue).map(clueRoot)
	return clueRoots.length > 0 && clueRoots.every(term => memoryRoots.has(term))
}

function mergeAiWithCatalogMatches(
	memory: string,
	ai: TipOfTongueMatch[],
	catalog: TipOfTongueMatch[],
) {
	const catalogByMediaId = new Map(catalog.map(match => [match.mediaId, match]))
	const merged: TipOfTongueMatch[] = []
	const seen = new Set<string>()
	for (const match of ai) {
		if (seen.has(match.mediaId)) continue
		seen.add(match.mediaId)
		const groundedClues = match.matchedClues.filter(clue =>
			isMemoryBackedClue(memory, clue),
		)
		merged.push({
			...match,
			matchedClues: groundedClues.length
				? groundedClues
				: (catalogByMediaId.get(match.mediaId)?.matchedClues ?? []),
		})
	}
	for (const match of catalog) {
		if (seen.has(match.mediaId)) continue
		seen.add(match.mediaId)
		merged.push(match)
		if (merged.length === MAX_MATCHES) break
	}
	return merged.slice(0, MAX_MATCHES)
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

async function aiMatches(
	memory: string,
	candidates: Candidate[],
	fetchImpl: typeof fetch,
	apiKey: string,
) {
	const allowedIds = new Set(candidates.map(candidate => candidate.id))
	const response = await fetchImpl('https://api.openai.com/v1/responses', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${apiKey}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			// This bounded ranking/extraction workload intentionally uses the
			// low-latency Luna tier unless an operator overrides it.
			model: process.env.OPENAI_TIP_OF_TONGUE_MODEL || 'gpt-5.6-luna',
			store: false,
			reasoning: { effort: 'low' },
			instructions:
				'Rank only the supplied Veud catalog candidates against the user memory. Never invent a title or ID. Return up to five strongest matches in descending confidence. Each summary must briefly connect the candidate to the memory. matchedClues must be short phrases copied or closely paraphrased from the user memory.',
			input: JSON.stringify({
				memory,
				candidates: candidates.map(candidate => ({
					id: candidate.id,
					title: candidate.title,
					kind: candidate.kind,
					type: candidate.type,
					year: yearFor(candidate),
					genres: candidate.genres,
					description: candidate.description?.slice(0, DESCRIPTION_LENGTH),
				})),
			}),
			text: {
				verbosity: 'low',
				format: {
					type: 'json_schema',
					name: 'tip_of_tongue_matches',
					strict: true,
					schema: {
						type: 'object',
						additionalProperties: false,
						required: ['matches'],
						properties: {
							matches: {
								type: 'array',
								maxItems: MAX_MATCHES,
								items: {
									type: 'object',
									additionalProperties: false,
									required: ['mediaId', 'summary', 'matchedClues'],
									properties: {
										mediaId: { type: 'string' },
										summary: { type: 'string' },
										matchedClues: {
											type: 'array',
											maxItems: 5,
											items: { type: 'string' },
										},
									},
								},
							},
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
	const parsed = AiMatchesSchema.parse(JSON.parse(text))
	return parsed.matches.filter(match => allowedIds.has(match.mediaId))
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
	const candidates = await candidatesFor(memory, kind)
	if (!candidates.length) {
		return { matches: [], source: 'catalog-match', fallbackReason: null }
	}
	const rankedCatalogMatches = localMatches(memory, candidates, MAX_CANDIDATES)
	const catalogMatches = rankedCatalogMatches.slice(0, MAX_MATCHES)
	const apiKey = process.env.OPENAI_API_KEY?.trim()
	if (!apiKey) {
		return {
			matches: catalogMatches,
			source: 'catalog-match',
			fallbackReason: 'not-configured',
		}
	}
	if (options.allowAi !== true) {
		return {
			matches: catalogMatches,
			source: 'catalog-match',
			fallbackReason: 'sign-in-required',
		}
	}
	const aiCandidates = candidates.filter(
		candidate => !candidate.isExternalAiRestricted,
	)
	if (!aiCandidates.length) {
		return {
			matches: catalogMatches,
			source: 'catalog-match',
			fallbackReason: 'provider-restricted',
		}
	}
	if (
		options.rateLimitKey &&
		!consumeAiRequest(options.rateLimitKey, options.now ?? Date.now())
	) {
		return {
			matches: catalogMatches,
			source: 'catalog-match',
			fallbackReason: 'rate-limited',
		}
	}
	try {
		const matches = await aiMatches(
			memory,
			aiCandidates,
			options.fetchImpl ?? fetch,
			apiKey,
		)
		if (matches.length) {
			return {
				matches: mergeAiWithCatalogMatches(
					memory,
					matches,
					rankedCatalogMatches,
				),
				source: 'ai',
				fallbackReason: null,
			}
		}
		return {
			matches: catalogMatches,
			source: 'catalog-match',
			fallbackReason: 'ai-empty',
		}
	} catch (error) {
		console.error(
			'[tip-of-tongue] AI ranking failed; using catalog match',
			error,
		)
	}
	return {
		matches: catalogMatches,
		source: 'catalog-match',
		fallbackReason: 'ai-error',
	}
}
