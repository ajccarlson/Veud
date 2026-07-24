import { type PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { requestStructuredAi } from './ai-gateway.server.ts'
import { normalizeCatalogTitle } from './catalog-sync.server.ts'
import { parseStoredLibraryImportItem } from './library-import-commit.server.ts'
import { reconcileLibraryImport } from './library-import-reconciliation.server.ts'

const MAX_ASSISTED_ROWS = 25
const PROMPT_VERSION = 'import-reconciliation-v1'

const HypothesisSchema = z
	.object({
		title: z.string().trim().min(1).max(500),
		uncertainty: z.enum(['low', 'medium', 'high']),
	})
	.strict()

const ResponseSchema = z
	.object({
		rows: z
			.array(
				z
					.object({
						itemKey: z.string().regex(/^row-[0-9]+$/),
						hypotheses: z.array(HypothesisSchema).min(1).max(3),
					})
					.strict(),
			)
			.max(MAX_ASSISTED_ROWS),
	})
	.strict()

const responseJsonSchema = {
	type: 'object',
	additionalProperties: false,
	required: ['rows'],
	properties: {
		rows: {
			type: 'array',
			maxItems: MAX_ASSISTED_ROWS,
			items: {
				type: 'object',
				additionalProperties: false,
				required: ['itemKey', 'hypotheses'],
				properties: {
					itemKey: { type: 'string', pattern: '^row-[0-9]+$' },
					hypotheses: {
						type: 'array',
						minItems: 1,
						maxItems: 3,
						items: {
							type: 'object',
							additionalProperties: false,
							required: ['title', 'uncertainty'],
							properties: {
								title: { type: 'string' },
								uncertainty: {
									type: 'string',
									enum: ['low', 'medium', 'high'],
								},
							},
						},
					},
				},
			},
		},
	},
}

function parsedCandidates(value: string) {
	try {
		const parsed = z
			.array(
				z.object({
					mediaId: z.string(),
					title: z.string(),
					thumbnail: z.string().nullable(),
				}),
			)
			.safeParse(JSON.parse(value) as unknown)
		return parsed.success ? parsed.data : []
	} catch {
		return []
	}
}

export async function assistLibraryImportReconciliation(
	prisma: PrismaClient,
	input: {
		ownerId: string
		batchId: string
		rateLimitKey: string
		fetchImpl?: typeof fetch
	},
) {
	const batch = await prisma.libraryImportBatch.findFirst({
		where: { id: input.batchId, ownerId: input.ownerId, status: 'previewed' },
		select: {
			id: true,
			provider: true,
			items: {
				where: { matchState: { in: ['ambiguous', 'unmatched'] } },
				orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
				take: MAX_ASSISTED_ROWS,
				select: {
					id: true,
					payload: true,
					candidates: true,
					matchState: true,
				},
			},
		},
	})
	if (!batch) throw new Response('Import preview not found.', { status: 404 })
	if (!batch.items.length) {
		throw new Response('This preview has no unresolved rows to assist.', {
			status: 409,
		})
	}

	const uniqueRows = new Map<
		string,
		{
			itemKey: string
			title: string
			mediaKind: 'anime' | 'manga' | 'movie' | 'tv'
			provider: string
			items: typeof batch.items
		}
	>()
	for (const item of batch.items) {
		const source = parseStoredLibraryImportItem(item.payload)
		const cacheKey = `${source.mediaKind}\0${normalizeCatalogTitle(source.title)}`
		const existing = uniqueRows.get(cacheKey)
		if (existing) {
			existing.items.push(item)
		} else {
			uniqueRows.set(cacheKey, {
				itemKey: `row-${uniqueRows.size + 1}`,
				title: source.title,
				mediaKind: source.mediaKind,
				provider: batch.provider,
				items: [item],
			})
		}
	}
	const safeRows = [...uniqueRows.values()].map(
		({ itemKey, title, mediaKind, provider }) => ({
			itemKey,
			title,
			mediaKind,
			provider,
		}),
	)
	const response = await requestStructuredAi({
		capability: 'import-reconciliation',
		promptVersion: PROMPT_VERSION,
		instructions:
			'Normalize noisy member-provided library export titles. For each row, return one to three plausible canonical or translated title hypotheses. Remove filename cruft, release groups, codecs, and episode suffixes when present. Do not identify users, invent database IDs, decide a match, or return catalog facts. Mark uncertainty honestly.',
		input: { rows: safeRows },
		outputSchema: ResponseSchema,
		jsonSchemaName: 'library_import_title_hypotheses',
		jsonSchema: responseJsonSchema,
		assertSafeInput(value) {
			const parsed = z
				.object({
					rows: z
						.array(
							z
								.object({
									itemKey: z.string().regex(/^row-[0-9]+$/),
									title: z.string().max(500),
									mediaKind: z.enum(['anime', 'manga', 'movie', 'tv']),
									provider: z.string().max(40),
								})
								.strict(),
						)
						.max(MAX_ASSISTED_ROWS),
				})
				.strict()
				.safeParse(value)
			if (!parsed.success)
				throw new Error('Unsafe import reconciliation payload')
		},
		rateLimitKey: input.rateLimitKey,
		rateLimit: 3,
		rateLimitWindowMs: 10 * 60 * 1_000,
		timeoutMs: 16_000,
		fetchImpl: input.fetchImpl,
	})
	const byItemKey = new Map(response.rows.map(row => [row.itemKey, row]))
	const preparedUpdates: Array<{
		itemId: string
		aiHypotheses: string
		candidates: string
		matchState: 'ambiguous' | 'unmatched'
		matchMethod: 'ai-title-hypothesis' | null
	}> = []
	for (const row of uniqueRows.values()) {
		const suggestions = byItemKey.get(row.itemKey)?.hypotheses ?? []
		if (!suggestions.length) continue
		const source = parseStoredLibraryImportItem(row.items[0]!.payload)
		const localInputs = suggestions.map((hypothesis, index) => ({
			...source,
			sourceKey: `${row.itemKey}:${index}`,
			title: hypothesis.title,
			externalId: null,
			externalProvider: undefined,
		}))
		const locallyResolved = await reconcileLibraryImport(
			prisma,
			input.ownerId,
			localInputs,
		)
		const candidateIds = new Set<string>()
		for (const resolution of locallyResolved) {
			if (resolution.match.state === 'matched') {
				candidateIds.add(resolution.match.mediaId)
			} else if (resolution.match.state === 'ambiguous') {
				for (const candidate of resolution.match.candidates) {
					candidateIds.add(candidate.mediaId)
				}
			}
		}
		const media = candidateIds.size
			? await prisma.media.findMany({
					where: { id: { in: [...candidateIds] }, kind: source.mediaKind },
					select: { id: true, title: true, thumbnail: true },
				})
			: []
		for (const item of row.items) {
			const existingCandidates = parsedCandidates(item.candidates)
			const combined = [
				...new Map(
					[
						...existingCandidates,
						...media.map(work => ({
							mediaId: work.id,
							title: work.title ?? source.title,
							thumbnail: work.thumbnail,
						})),
					].map(candidate => [candidate.mediaId, candidate]),
				).values(),
			].slice(0, 6)
			preparedUpdates.push({
				itemId: item.id,
				aiHypotheses: JSON.stringify(suggestions),
				candidates: JSON.stringify(combined),
				matchState: combined.length ? 'ambiguous' : 'unmatched',
				matchMethod: combined.length ? 'ai-title-hypothesis' : null,
			})
		}
	}
	return await prisma.$transaction(async tx => {
		let assistedCount = 0
		for (const update of preparedUpdates) {
			const result = await tx.libraryImportItem.updateMany({
				where: {
					id: update.itemId,
					batch: { ownerId: input.ownerId, status: 'previewed' },
					matchState: { in: ['ambiguous', 'unmatched'] },
				},
				data: {
					aiHypotheses: update.aiHypotheses,
					aiPromptVersion: PROMPT_VERSION,
					candidates: update.candidates,
					matchState: update.matchState,
					matchMethod: update.matchMethod,
					mediaId: null,
					resolution: 'skip',
				},
			})
			assistedCount += result.count
		}
		const [ambiguousCount, unmatchedCount] = await Promise.all([
			tx.libraryImportItem.count({
				where: { batchId: batch.id, matchState: 'ambiguous' },
			}),
			tx.libraryImportItem.count({
				where: { batchId: batch.id, matchState: 'unmatched' },
			}),
		])
		const updatedBatch = await tx.libraryImportBatch.updateMany({
			where: { id: batch.id, ownerId: input.ownerId, status: 'previewed' },
			data: { ambiguousCount, unmatchedCount },
		})
		if (updatedBatch.count !== 1) {
			throw new Response(
				'Import preview changed while assistance was running.',
				{
					status: 409,
				},
			)
		}
		return { assistedCount, promptVersion: PROMPT_VERSION }
	})
}
