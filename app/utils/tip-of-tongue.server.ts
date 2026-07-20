import { z } from 'zod'
import { normalizeCatalogTitle } from './catalog-sync.server.ts'
import { prisma } from './db.server.ts'
import { discoveryKinds, type DiscoveryQuery } from './discovery.server.ts'

const MAX_CANDIDATES = 72
const MAX_MATCHES = 5
const DESCRIPTION_LENGTH = 700
const STOP_WORDS = new Set([
	'about',
	'after',
	'again',
	'also',
	'because',
	'before',
	'could',
	'didn',
	'does',
	'from',
	'have',
	'into',
	'just',
	'like',
	'movie',
	'remember',
	'scene',
	'show',
	'some',
	'something',
	'than',
	'that',
	'there',
	'they',
	'this',
	'what',
	'where',
	'which',
	'with',
	'woman',
	'would',
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
}

export type TipOfTongueMatch = z.infer<
	typeof AiMatchesSchema
>['matches'][number]

export type TipOfTongueResults = {
	matches: TipOfTongueMatch[]
	source: 'ai' | 'catalog-match'
}

function memoryTerms(memory: string) {
	const counts = new Map<string, number>()
	for (const word of normalizeCatalogTitle(memory).match(/[a-z0-9]+/g) ?? []) {
		if (word.length < 4 || STOP_WORDS.has(word)) continue
		counts.set(word, (counts.get(word) ?? 0) + 1)
	}
	return [...counts.entries()]
		.sort(
			(left, right) => right[1] - left[1] || right[0].length - left[0].length,
		)
		.slice(0, 12)
		.map(([word]) => word)
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
	} as const
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
	].slice(0, MAX_CANDIDATES)
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

function localMatches(memory: string, candidates: Candidate[]) {
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
		.slice(0, MAX_MATCHES)
		.map(({ candidate, matchedClues }) => ({
			mediaId: candidate.id,
			summary:
				(candidate.description ?? '').trim().slice(0, 240) ||
				`${candidate.title ?? 'This title'} is a catalog match for your description.`,
			matchedClues: matchedClues.slice(0, 5),
		}))
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
) {
	const apiKey = process.env.OPENAI_API_KEY?.trim()
	if (!apiKey) return null
	const allowedIds = new Set(candidates.map(candidate => candidate.id))
	const response = await fetchImpl('https://api.openai.com/v1/responses', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${apiKey}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
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
	options: { fetchImpl?: typeof fetch } = {},
): Promise<TipOfTongueResults> {
	const memory = input.memory.trim().slice(0, 500)
	const kind = discoveryKinds.includes(input.kind) ? input.kind : 'all'
	const candidates = await candidatesFor(memory, kind)
	if (!candidates.length) return { matches: [], source: 'catalog-match' }
	try {
		const matches = await aiMatches(
			memory,
			candidates,
			options.fetchImpl ?? fetch,
		)
		if (matches?.length) return { matches, source: 'ai' }
	} catch (error) {
		console.error(
			'[tip-of-tongue] AI ranking failed; using catalog match',
			error,
		)
	}
	return { matches: localMatches(memory, candidates), source: 'catalog-match' }
}
