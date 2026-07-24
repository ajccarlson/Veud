import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { normalizeCatalogTitle } from './catalog-sync.server.ts'
import { prisma } from './db.server.ts'
import { discoveryKinds, type DiscoveryQuery } from './discovery.server.ts'

const MAX_CANDIDATES = 72
const MAX_MATCHES = 5
const AI_REQUEST_LIMIT = 5
const AI_REQUEST_WINDOW_MS = 10 * 60 * 1_000
const AI_UNAVAILABLE_COOLDOWN_MS = 10 * 60 * 1_000
const AI_QUOTA_COOLDOWN_MS = 60 * 60 * 1_000
const aiRequestHistory = new Map<string, number[]>()
const globalAiCircuit = { unavailableUntil: 0 }
const mediaKinds = ['movie', 'tv', 'anime', 'manga'] as const
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

const AiMediaSuggestionSchema = z.object({
	title: z.string().trim().min(1).max(200),
	alternateTitle: z.string().trim().min(1).max(200).nullable(),
	year: z.number().int().min(1870).max(2200).nullable(),
	kind: z.enum(mediaKinds),
	reason: z.string().trim().min(1).max(300),
	matchedClues: z.array(z.string().trim().min(2).max(80)).min(1).max(5),
})

const AiSuggestionPlanSchema = z.object({
	suggestions: z.array(AiMediaSuggestionSchema).length(MAX_MATCHES),
})

type AiMediaSuggestion = z.infer<typeof AiMediaSuggestionSchema>

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
	catalogPopularity: number | null
	titles: Array<{ value: string; normalized: string }>
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
		| 'ai-unavailable'
		| 'ai-error'
		| 'ai-empty'
		| null
}

type AiCircuit = {
	unavailableUntil: number
}

class AiServiceError extends Error {
	constructor(
		readonly status: number,
		readonly code: string | null,
	) {
		super(`AI search failed (${status})`)
		this.name = 'AiServiceError'
	}

	get opensCircuit() {
		return (
			this.status === 401 ||
			this.status === 403 ||
			this.status === 429 ||
			this.status >= 500
		)
	}

	get cooldownMs() {
		return this.code === 'insufficient_quota' ||
			this.code === 'billing_hard_limit_reached'
			? AI_QUOTA_COOLDOWN_MS
			: AI_UNAVAILABLE_COOLDOWN_MS
	}
}

const candidateSelect = {
	id: true,
	title: true,
	kind: true,
	type: true,
	genres: true,
	description: true,
	releaseStart: true,
	startYear: true,
	airYear: true,
	catalogPopularity: true,
	titles: {
		select: {
			value: true,
			normalized: true,
		},
	},
} satisfies Prisma.MediaSelect

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
				normalized.includes(normalizeCatalogTitle(clue)),
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
	const lexicalIds = terms.length
		? await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
				SELECT "Media"."id"
				FROM "Media"
				WHERE "Media"."title" IS NOT NULL
				${kind === 'all' ? Prisma.empty : Prisma.sql`AND "Media"."kind" = ${kind}`}
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
					select: candidateSelect,
				})
			: Promise.resolve([]),
		prisma.media.findMany({
			where: base,
			select: candidateSelect,
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
		.filter(result => result.score > 0)
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

function suggestionKind(
	suggestion: AiMediaSuggestion,
	requestedKind: DiscoveryQuery['kind'],
) {
	return requestedKind === 'all' ? suggestion.kind : requestedKind
}

function normalizedSuggestionTitles(suggestion: AiMediaSuggestion) {
	return [
		...new Set(
			[suggestion.title, suggestion.alternateTitle]
				.filter((title): title is string => Boolean(title))
				.map(normalizeCatalogTitle)
				.filter(Boolean),
		),
	]
}

async function candidatesForSuggestion(
	suggestion: AiMediaSuggestion,
	requestedKind: DiscoveryQuery['kind'],
) {
	const kind = suggestionKind(suggestion, requestedKind)
	const normalizedTitles = normalizedSuggestionTitles(suggestion)
	const titleTerms = [
		...new Set(normalizedTitles.flatMap(title => memoryTerms(title))),
	].slice(0, 8)
	const exactTitleRows = normalizedTitles.length
		? await prisma.mediaTitle.findMany({
				where: {
					normalized: { in: normalizedTitles },
					media: { kind },
				},
				select: { media: { select: candidateSelect } },
				orderBy: [{ isPrimary: 'desc' }, { updatedAt: 'desc' }],
				take: 16,
			})
		: []
	const titleConditions = [
		...normalizedTitles.map(
			title => Prisma.sql`
				LOWER(COALESCE("Media"."title", '')) = ${title}
				OR EXISTS (
					SELECT 1
					FROM "MediaTitle"
					WHERE "MediaTitle"."mediaId" = "Media"."id"
					AND "MediaTitle"."normalized" = ${title}
				)
			`,
		),
		...titleTerms.map(term => {
			const pattern = `%${term}%`
			return Prisma.sql`
				LOWER(COALESCE("Media"."title", '')) LIKE ${pattern}
				OR EXISTS (
					SELECT 1
					FROM "MediaTitle"
					WHERE "MediaTitle"."mediaId" = "Media"."id"
					AND "MediaTitle"."normalized" LIKE ${pattern}
				)
			`
		}),
	]
	const lexicalIds = titleConditions.length
		? await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
				SELECT "Media"."id"
				FROM "Media"
				WHERE "Media"."title" IS NOT NULL
				AND "Media"."kind" = ${kind}
				AND (
					${Prisma.join(titleConditions, ' OR ')}
				)
				ORDER BY COALESCE("Media"."catalogPopularity", 0) DESC, "Media"."title" ASC
				LIMIT 36
			`)
		: []
	const lexicalIdOrder = lexicalIds.map(item => item.id)
	const lexicalRows = lexicalIdOrder.length
		? await prisma.media.findMany({
				where: { id: { in: lexicalIdOrder } },
				select: candidateSelect,
			})
		: []
	const lexicalById = new Map(lexicalRows.map(item => [item.id, item]))
	const orderedLexical = lexicalIdOrder.flatMap(id => {
		const item = lexicalById.get(id)
		return item ? [item] : []
	})
	return [
		...new Map(
			[...exactTitleRows.map(row => row.media), ...orderedLexical].map(
				candidate => [candidate.id, candidate],
			),
		).values(),
	]
}

function candidateYear(candidate: Candidate) {
	const value =
		candidate.releaseStart?.getUTCFullYear() ??
		Number.parseInt(candidate.startYear ?? candidate.airYear ?? '', 10)
	return Number.isFinite(value) ? value : null
}

function titleSimilarity(left: string, right: string) {
	if (!left || !right) return 0
	if (left === right) return 1
	if (left.includes(right) || right.includes(left)) return 0.86
	const leftWords = new Set(left.split(' ').filter(Boolean))
	const rightWords = new Set(right.split(' ').filter(Boolean))
	const intersection = [...leftWords].filter(word =>
		rightWords.has(word),
	).length
	const union = new Set([...leftWords, ...rightWords]).size
	return union ? intersection / union : 0
}

function rankSuggestionCandidates(
	suggestion: AiMediaSuggestion,
	candidates: Candidate[],
) {
	const expectedTitles = normalizedSuggestionTitles(suggestion)
	const memoryClues = suggestion.matchedClues.map(normalizeCatalogTitle)
	return candidates
		.map(candidate => {
			const candidateTitles = [
				normalizeCatalogTitle(candidate.title ?? ''),
				...candidate.titles.map(title => title.normalized),
			].filter(Boolean)
			const similarity = Math.max(
				0,
				...expectedTitles.flatMap(expected =>
					candidateTitles.map(title => titleSimilarity(expected, title)),
				),
			)
			const releaseYear = candidateYear(candidate)
			const yearDistance =
				suggestion.year !== null && releaseYear !== null
					? Math.abs(suggestion.year - releaseYear)
					: null
			const normalizedDetails = normalizeCatalogTitle(
				`${candidate.genres ?? ''} ${candidate.description ?? ''}`,
			)
			const clueHits = memoryClues.filter(clue =>
				normalizedDetails.includes(clue),
			).length
			const score =
				similarity * 180 +
				(yearDistance === null ? 0 : Math.max(0, 22 - yearDistance * 7)) +
				clueHits * 3
			return { candidate, score, similarity }
		})
		.filter(result => result.similarity >= 0.34)
		.sort(
			(left, right) =>
				right.score - left.score ||
				(right.candidate.catalogPopularity ?? 0) -
					(left.candidate.catalogPopularity ?? 0),
		)
}

async function matchAiSuggestions(
	memory: string,
	kind: DiscoveryQuery['kind'],
	suggestions: AiMediaSuggestion[],
) {
	const rankedBySuggestion = await Promise.all(
		suggestions.map(async suggestion => ({
			suggestion,
			ranked: rankSuggestionCandidates(
				suggestion,
				await candidatesForSuggestion(suggestion, kind),
			),
		})),
	)
	const usedMediaIds = new Set<string>()
	const matches: TipOfTongueMatch[] = []
	for (const { suggestion, ranked } of rankedBySuggestion) {
		const resolved = ranked.find(item => !usedMediaIds.has(item.candidate.id))
		if (!resolved) continue
		usedMediaIds.add(resolved.candidate.id)
		matches.push({
			mediaId: resolved.candidate.id,
			summary: suggestion.reason,
			matchedClues: suggestion.matchedClues,
		})
	}
	if (matches.length >= MAX_MATCHES) return matches.slice(0, MAX_MATCHES)

	const suggestionTerms = suggestions.flatMap(suggestion => [
		suggestion.title,
		suggestion.alternateTitle ?? '',
		...suggestion.matchedClues,
	])
	const fallbackCandidates = await candidatesFor(memory, kind, suggestionTerms)
	const supplemental = localMatches(
		memory,
		fallbackCandidates.filter(candidate => !usedMediaIds.has(candidate.id)),
		MAX_MATCHES - matches.length,
		suggestionTerms,
	)
	return [...matches, ...supplemental].slice(0, MAX_MATCHES)
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

async function aiSuggestionPlan(
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
			model: process.env.OPENAI_TIP_OF_TONGUE_MODEL || 'gpt-5.6-luna',
			store: false,
			reasoning: { effort: 'none' },
			instructions:
				'Identify exactly five distinct existing pieces of media that most closely match the incomplete memory. Respect the requested media type: movie means non-anime films, tv means non-anime television, anime means Japanese animation including films and series, and manga means Japanese comics. For each hypothesis, give the canonical title, one useful alternate title when known, likely original release year, media kind, and a concise uncertainty-aware reason. The reason must explicitly repeat the strongest remembered details listed in matchedClues so the interface can highlight them. Never invent a title merely to fit the clues. Do not request or infer personal information.',
			input: JSON.stringify({
				memory,
				requestedMediaType: kind,
			}),
			text: {
				verbosity: 'low',
				format: {
					type: 'json_schema',
					name: 'tip_of_tongue_media_suggestions',
					strict: true,
					schema: {
						type: 'object',
						additionalProperties: false,
						required: ['suggestions'],
						properties: {
							suggestions: {
								type: 'array',
								minItems: MAX_MATCHES,
								maxItems: MAX_MATCHES,
								items: {
									type: 'object',
									additionalProperties: false,
									required: [
										'title',
										'alternateTitle',
										'year',
										'kind',
										'reason',
										'matchedClues',
									],
									properties: {
										title: { type: 'string' },
										alternateTitle: {
											type: ['string', 'null'],
										},
										year: { type: ['integer', 'null'] },
										kind: { type: 'string', enum: mediaKinds },
										reason: { type: 'string' },
										matchedClues: {
											type: 'array',
											minItems: 1,
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
		signal: AbortSignal.timeout(12_000),
	})
	const payload = await response.json().catch(() => null)
	if (!response.ok) {
		const parsedError = z
			.object({
				error: z.object({ code: z.string().nullable().optional() }).optional(),
			})
			.safeParse(payload)
		throw new AiServiceError(
			response.status,
			parsedError.success ? (parsedError.data.error?.code ?? null) : null,
		)
	}
	const text = responseText(payload)
	if (!text) throw new Error('AI search returned no structured text')
	return AiSuggestionPlanSchema.parse(JSON.parse(text))
}

export async function getTipOfTongueMatches(
	input: { memory: string; kind: DiscoveryQuery['kind'] },
	options: {
		fetchImpl?: typeof fetch
		allowAi?: boolean
		rateLimitKey?: string
		now?: number
		aiCircuit?: AiCircuit
	} = {},
): Promise<TipOfTongueResults> {
	const memory = input.memory.trim().slice(0, 500)
	const kind = discoveryKinds.includes(input.kind) ? input.kind : 'all'
	const apiKey = process.env.OPENAI_API_KEY?.trim()
	const now = options.now ?? Date.now()
	const aiCircuit = options.aiCircuit ?? globalAiCircuit
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
	if (aiCircuit.unavailableUntil > now) return fallback('ai-unavailable')
	if (options.rateLimitKey && !consumeAiRequest(options.rateLimitKey, now)) {
		return fallback('rate-limited')
	}
	try {
		const plan = await aiSuggestionPlan(
			memory,
			kind,
			options.fetchImpl ?? fetch,
			apiKey,
		)
		if (!plan.suggestions.length) return fallback('ai-empty')
		return {
			matches: await matchAiSuggestions(memory, kind, plan.suggestions),
			source: 'ai',
			fallbackReason: null,
		}
	} catch (error) {
		if (error instanceof AiServiceError && error.opensCircuit) {
			aiCircuit.unavailableUntil = Math.max(
				aiCircuit.unavailableUntil,
				now + error.cooldownMs,
			)
			console.error(
				`[tip-of-tongue] AI service unavailable (${error.status}, ${error.code ?? 'unknown'}); using catalog match`,
			)
			return fallback('ai-unavailable')
		}
		console.error(
			'[tip-of-tongue] AI media identification failed; using catalog match',
			error,
		)
	}
	return fallback('ai-error')
}
