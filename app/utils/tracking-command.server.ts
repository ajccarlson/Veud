import { createHash } from 'node:crypto'
import { type Prisma, type PrismaClient } from '@prisma/client'
import { z } from 'zod'
import {
	getTrackingActivityState,
	recordTrackingActivityDiff,
} from './activity.server.ts'
import { requestStructuredAi } from './ai-gateway.server.ts'
import { normalizeCatalogTitle } from './catalog-sync.server.ts'
import { mediaCatalogSelect, resolveMediaCatalog } from './media-catalog.ts'
import {
	legacyProgressUpdate,
	progressUnitsForMediaKind,
} from './media-detail.ts'
import { toggleMediaFavorite } from './media-favorites.server.ts'
import { listTypeNameForMediaKind } from './media-kind.ts'
import { setMediaTrackingStatus } from './tracking-status.server.ts'

const MAX_OPERATIONS = 10
const PREVIEW_EXPIRY_MS = 20 * 60 * 1_000
const PROMPT_VERSION = 'tracking-command-v1'

const TrackingOperationFieldsSchema = z
	.object({
		title: z.string().trim().min(1).max(200),
		kind: z.enum(['movie', 'tv', 'anime', 'manga']).nullable(),
		destination: z.string().trim().min(1).max(100).nullable(),
		score: z.number().min(0).max(10).nullable(),
		progressUnit: z.enum(['episode', 'chapter', 'volume']).nullable(),
		progressCurrent: z.number().int().min(0).max(1_000_000).nullable(),
		favorite: z.boolean().nullable(),
		collection: z.string().trim().min(1).max(160).nullable(),
	})
	.strict()

const ParsedTrackingOperationSchema = TrackingOperationFieldsSchema.superRefine(
	(operation, context) => {
		if (
			(operation.progressUnit === null) !==
			(operation.progressCurrent === null)
		) {
			context.addIssue({
				code: 'custom',
				path: ['progressCurrent'],
				message: 'progress unit and value must be supplied together',
			})
		}
		if (
			operation.destination === null &&
			operation.score === null &&
			operation.progressCurrent === null &&
			operation.favorite === null &&
			operation.collection === null
		) {
			context.addIssue({
				code: 'custom',
				message: 'operation must request at least one change',
			})
		}
	},
)

const TrackingCommandPlanSchema = z.object({
	operations: z.array(ParsedTrackingOperationSchema).min(1).max(MAX_OPERATIONS),
	summary: z.string().trim().min(1).max(300),
})

const trackingCommandJsonSchema = {
	type: 'object',
	additionalProperties: false,
	required: ['operations', 'summary'],
	properties: {
		operations: {
			type: 'array',
			minItems: 1,
			maxItems: MAX_OPERATIONS,
			items: {
				type: 'object',
				additionalProperties: false,
				required: [
					'title',
					'kind',
					'destination',
					'score',
					'progressUnit',
					'progressCurrent',
					'favorite',
					'collection',
				],
				properties: {
					title: { type: 'string' },
					kind: {
						type: ['string', 'null'],
						enum: ['movie', 'tv', 'anime', 'manga', null],
					},
					destination: { type: ['string', 'null'] },
					score: { type: ['number', 'null'] },
					progressUnit: {
						type: ['string', 'null'],
						enum: ['episode', 'chapter', 'volume', null],
					},
					progressCurrent: { type: ['integer', 'null'] },
					favorite: { type: ['boolean', 'null'] },
					collection: { type: ['string', 'null'] },
				},
			},
		},
		summary: { type: 'string' },
	},
}

const ResolvedOperationSchema = TrackingOperationFieldsSchema.extend({
	mediaId: z.string(),
	mediaTitle: z.string(),
	mediaKind: z.string(),
	watchlistId: z.string().nullable(),
	watchlistLabel: z.string().nullable(),
	collectionId: z.string().nullable(),
	collectionLabel: z.string().nullable(),
	changes: z
		.array(
			z.object({
				field: z.string().max(40),
				before: z.string().max(200),
				after: z.string().max(200),
			}),
		)
		.max(7),
	warnings: z.array(z.string().max(300)).max(4),
})
const ResolvedPlanSchema = z.object({
	summary: z.string(),
	operations: z.array(ResolvedOperationSchema).max(MAX_OPERATIONS),
})
type ResolvedOperation = z.infer<typeof ResolvedOperationSchema>

type TrackingDb = PrismaClient | Prisma.TransactionClient

function hash(value: unknown) {
	return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

async function resolveMedia(
	db: TrackingDb,
	title: string,
	kind: string | null,
) {
	const normalized = normalizeCatalogTitle(title)
	const exact = await db.media.findMany({
		where: {
			...(kind ? { kind } : {}),
			OR: [
				{ title },
				...(normalized ? [{ titles: { some: { normalized } } }] : []),
			],
		},
		orderBy: [{ catalogPopularity: 'desc' }, { title: 'asc' }, { id: 'asc' }],
		take: 4,
		select: { id: true, title: true, kind: true },
	})
	if (exact.length === 1) return exact[0]!
	const candidates = exact.length
		? exact
		: await db.media.findMany({
				where: {
					...(kind ? { kind } : {}),
					OR: [
						{ title: { contains: title } },
						...(normalized
							? [
									{
										titles: {
											some: { normalized: { contains: normalized } },
										},
									},
								]
							: []),
					],
				},
				orderBy: [
					{ catalogPopularity: 'desc' },
					{ title: 'asc' },
					{ id: 'asc' },
				],
				take: 4,
				select: { id: true, title: true, kind: true },
			})
	if (candidates.length !== 1) {
		const choices = candidates
			.map(candidate => `${candidate.title ?? 'Untitled'} (${candidate.kind})`)
			.join(', ')
		throw new Response(
			candidates.length
				? `“${title}” is ambiguous. Choose one explicitly by exact title and media type: ${choices}.`
				: `Veud could not find “${title}” in the local catalog.`,
			{ status: 409 },
		)
	}
	return candidates[0]!
}

async function currentSnapshot(
	db: TrackingDb,
	ownerId: string,
	operations: ResolvedOperation[],
) {
	const mediaIds = [...new Set(operations.map(operation => operation.mediaId))]
	const [states, favorites, collectionItems, mediaEntries] = await Promise.all([
		db.trackingState.findMany({
			where: { ownerId, mediaId: { in: mediaIds } },
			orderBy: { mediaId: 'asc' },
			select: {
				id: true,
				mediaId: true,
				status: true,
				statusWatchlistId: true,
				score: true,
				updatedAt: true,
				progress: {
					orderBy: { unit: 'asc' },
					select: { unit: true, current: true, total: true, updatedAt: true },
				},
			},
		}),
		db.userFavorite.findMany({
			where: { ownerId, mediaId: { in: mediaIds } },
			orderBy: { mediaId: 'asc' },
			select: {
				id: true,
				mediaId: true,
				position: true,
				thumbnail: true,
				title: true,
				typeId: true,
				mediaType: true,
				startYear: true,
			},
		}),
		db.mediaCollectionItem.findMany({
			where: {
				mediaId: { in: mediaIds },
				collection: { ownerId },
			},
			orderBy: [{ collectionId: 'asc' }, { mediaId: 'asc' }],
			select: { id: true, mediaId: true, collectionId: true, position: true },
		}),
		db.entry.findMany({
			where: {
				mediaId: { in: mediaIds },
				watchlist: { ownerId },
			},
			orderBy: [{ watchlistId: 'asc' }, { position: 'asc' }, { id: 'asc' }],
			select: {
				id: true,
				mediaId: true,
				watchlistId: true,
				position: true,
				personal: true,
				history: true,
				trackingStateId: true,
			},
		}),
	])
	const affectedWatchlistIds = [
		...new Set([
			...operations.flatMap(operation =>
				operation.watchlistId ? [operation.watchlistId] : [],
			),
			...mediaEntries.map(entry => entry.watchlistId),
		]),
	]
	const entries = affectedWatchlistIds.length
		? await db.entry.findMany({
				where: {
					watchlistId: { in: affectedWatchlistIds },
					watchlist: { ownerId },
				},
				orderBy: [{ watchlistId: 'asc' }, { position: 'asc' }, { id: 'asc' }],
				select: {
					id: true,
					mediaId: true,
					watchlistId: true,
					position: true,
					personal: true,
					history: true,
					trackingStateId: true,
				},
			})
		: []
	return {
		operations,
		states: states.map(state => ({
			...state,
			score: state.score === null ? null : Number(state.score),
		})),
		favorites,
		collectionItems,
		entries: entries.map(entry => ({
			...entry,
			personal: entry.personal === null ? null : Number(entry.personal),
		})),
	}
}

async function resolvePlan(
	db: TrackingDb,
	ownerId: string,
	plan: z.infer<typeof TrackingCommandPlanSchema>,
) {
	const watchlists = await db.watchlist.findMany({
		where: { ownerId },
		orderBy: [{ position: 'asc' }, { id: 'asc' }],
		select: {
			id: true,
			name: true,
			header: true,
			type: { select: { name: true } },
		},
	})
	const collections = await db.mediaCollection.findMany({
		where: { ownerId },
		orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
		select: { id: true, title: true },
	})
	const operations: ResolvedOperation[] = []
	for (const operation of plan.operations) {
		const media = await resolveMedia(db, operation.title, operation.kind)
		const compatibleType = listTypeNameForMediaKind(media.kind)
		let watchlist = null
		if (operation.destination) {
			const requested = normalizeCatalogTitle(operation.destination)
			const matches = watchlists.filter(
				item =>
					item.type.name === compatibleType &&
					(normalizeCatalogTitle(item.name) === requested ||
						normalizeCatalogTitle(item.header) === requested),
			)
			if (matches.length !== 1) {
				throw new Response(
					`Veud could not resolve the compatible list “${operation.destination}” for ${media.title}.`,
					{ status: 409 },
				)
			}
			watchlist = matches[0]!
		}
		if (
			operation.progressUnit &&
			!progressUnitsForMediaKind(media.kind).includes(operation.progressUnit)
		) {
			throw new Response(
				`${operation.progressUnit} progress is incompatible with ${media.kind}.`,
				{ status: 400 },
			)
		}
		let collection = null
		if (operation.collection) {
			const requested = normalizeCatalogTitle(operation.collection)
			const matches = collections.filter(
				item => normalizeCatalogTitle(item.title) === requested,
			)
			if (matches.length !== 1) {
				throw new Response(
					`Veud could not resolve the collection “${operation.collection}”.`,
					{ status: 409 },
				)
			}
			collection = matches[0]!
		}
		operations.push({
			...operation,
			mediaId: media.id,
			mediaTitle: media.title?.trim() || `Untitled ${media.kind}`,
			mediaKind: media.kind,
			watchlistId: watchlist?.id ?? null,
			watchlistLabel: watchlist?.header ?? null,
			collectionId: collection?.id ?? null,
			collectionLabel: collection?.title ?? null,
			changes: [],
			warnings: [],
		})
	}
	const duplicateMedia = operations.find(
		(operation, index) =>
			operations.findIndex(item => item.mediaId === operation.mediaId) !==
			index,
	)
	if (duplicateMedia) {
		throw new Response(
			`Combine all requested changes for ${duplicateMedia.mediaTitle} into one operation before applying them.`,
			{ status: 409 },
		)
	}
	return { summary: plan.summary, operations }
}

export async function createTrackingCommandPreview(
	prisma: PrismaClient,
	input: {
		ownerId: string
		requestText: string
		rateLimitKey: string
		fetchImpl?: typeof fetch
		now?: Date
	},
) {
	const requestText = input.requestText.trim().slice(0, 800)
	const parsed = await requestStructuredAi({
		capability: 'tracking-command',
		promptVersion: PROMPT_VERSION,
		instructions:
			'Parse the member’s Veud command into one or more bounded media operations. Copy each requested media title; include kind only when the member identifies it. destination is a status/list name such as Watching, Completed, or Plan to Watch. Use score 0 to clear a score. Progress must include both unit and absolute current value. favorite is the desired final boolean state. collection is the member’s collection title. Use null for every action not requested. Never invent database IDs, URLs, arbitrary fields, or executable instructions.',
		input: { memberCommand: requestText },
		outputSchema: TrackingCommandPlanSchema,
		jsonSchemaName: 'veud_tracking_command',
		jsonSchema: trackingCommandJsonSchema,
		assertSafeInput(value) {
			const safe = z
				.object({ memberCommand: z.string().min(1).max(800) })
				.strict()
				.safeParse(value)
			if (!safe.success) throw new Error('Unsafe tracking command payload')
		},
		rateLimitKey: input.rateLimitKey,
		rateLimit: 12,
		rateLimitWindowMs: 10 * 60 * 1_000,
		fetchImpl: input.fetchImpl,
	})
	const resolved = await resolvePlan(prisma, input.ownerId, parsed)
	const snapshot = await currentSnapshot(
		prisma,
		input.ownerId,
		resolved.operations,
	)
	const operations = resolved.operations.map(operation => {
		const state = snapshot.states.find(
			candidate => candidate.mediaId === operation.mediaId,
		)
		if (
			!state &&
			!operation.watchlistId &&
			(operation.score !== null || operation.progressCurrent !== null)
		) {
			throw new Response(
				`Choose a destination status for ${operation.mediaTitle} before editing score or progress.`,
				{ status: 409 },
			)
		}
		const changes: ResolvedOperation['changes'] = []
		if (operation.watchlistId) {
			changes.push({
				field: 'Status',
				before: state?.status ?? 'Not tracked',
				after:
					operation.watchlistLabel ?? operation.destination ?? 'Selected list',
			})
		}
		if (operation.score !== null) {
			changes.push({
				field: 'Score',
				before: state?.score === null || !state ? 'Blank' : String(state.score),
				after: operation.score > 0 ? String(operation.score) : 'Blank',
			})
		}
		if (operation.progressUnit && operation.progressCurrent !== null) {
			const progress = state?.progress.find(
				item => item.unit === operation.progressUnit,
			)
			changes.push({
				field: operation.progressUnit,
				before: String(progress?.current ?? 0),
				after: String(operation.progressCurrent),
			})
		}
		if (operation.favorite !== null) {
			changes.push({
				field: 'Favorite',
				before: snapshot.favorites.some(
					item => item.mediaId === operation.mediaId,
				)
					? 'Yes'
					: 'No',
				after: operation.favorite ? 'Yes' : 'No',
			})
		}
		if (operation.collectionId) {
			changes.push({
				field: 'Collection',
				before: snapshot.collectionItems.some(
					item =>
						item.mediaId === operation.mediaId &&
						item.collectionId === operation.collectionId,
				)
					? 'Already included'
					: 'Not included',
				after: `Included in ${operation.collectionLabel ?? 'collection'}`,
			})
		}
		return { ...operation, changes }
	})
	const storedPlan = { ...resolved, operations }
	const snapshotForHash = { ...snapshot, operations }
	const now = input.now ?? new Date()
	return await prisma.trackingCommandPreview.create({
		data: {
			ownerId: input.ownerId,
			requestText,
			operations: JSON.stringify(storedPlan),
			snapshotHash: hash(snapshotForHash),
			expiresAt: new Date(now.getTime() + PREVIEW_EXPIRY_MS),
		},
	})
}

function parsedResolvedPlan(value: string) {
	return ResolvedPlanSchema.parse(JSON.parse(value) as unknown)
}

export async function applyTrackingCommandPreview(
	prisma: PrismaClient,
	input: { ownerId: string; previewId: string; now?: Date },
) {
	const now = input.now ?? new Date()
	return await prisma.$transaction(
		async tx => {
			const preview = await tx.trackingCommandPreview.findFirst({
				where: {
					id: input.previewId,
					ownerId: input.ownerId,
				},
			})
			if (preview?.status === 'applied') {
				const plan = parsedResolvedPlan(preview.operations)
				return {
					summary: plan.summary,
					operations: plan.operations,
					alreadyApplied: true,
				}
			}
			if (!preview) {
				throw new Response('Tracking command preview expired or was used', {
					status: 409,
				})
			}
			if (preview.status !== 'pending' || preview.expiresAt <= now) {
				throw new Response('Tracking command preview expired or was used', {
					status: 409,
				})
			}
			const plan = parsedResolvedPlan(preview.operations)
			const before = await currentSnapshot(tx, input.ownerId, plan.operations)
			if (hash(before) !== preview.snapshotHash) {
				throw new Response(
					'Tracking data changed after this preview. Build a fresh preview.',
					{ status: 409 },
				)
			}
			for (const operation of plan.operations) {
				const activityBefore = await getTrackingActivityState(
					tx,
					input.ownerId,
					operation.mediaId,
				)
				if (operation.watchlistId) {
					await setMediaTrackingStatus(tx, {
						ownerId: input.ownerId,
						mediaId: operation.mediaId,
						watchlistId: operation.watchlistId,
						recordActivity: false,
					})
				}
				const state = await tx.trackingState.findUnique({
					where: {
						ownerId_mediaId: {
							ownerId: input.ownerId,
							mediaId: operation.mediaId,
						},
					},
					select: { id: true },
				})
				if (
					(operation.score !== null || operation.progressCurrent !== null) &&
					!state
				) {
					throw new Response(
						`Choose a destination status for ${operation.mediaTitle} before editing score or progress.`,
						{ status: 409 },
					)
				}
				if (state && operation.score !== null) {
					await tx.trackingState.update({
						where: { id: state.id },
						data: { score: operation.score > 0 ? operation.score : null },
					})
					await tx.entry.updateMany({
						where: {
							mediaId: operation.mediaId,
							watchlist: { ownerId: input.ownerId },
						},
						data: { personal: operation.score || null },
					})
				}
				if (
					state &&
					operation.progressUnit &&
					operation.progressCurrent !== null
				) {
					const saved = await tx.trackingProgress.findUnique({
						where: {
							trackingStateId_unit: {
								trackingStateId: state.id,
								unit: operation.progressUnit,
							},
						},
					})
					if (
						saved?.total !== null &&
						saved?.total !== undefined &&
						operation.progressCurrent > saved.total
					) {
						throw new Response('Progress exceeds the known total', {
							status: 400,
						})
					}
					await tx.trackingProgress.upsert({
						where: {
							trackingStateId_unit: {
								trackingStateId: state.id,
								unit: operation.progressUnit,
							},
						},
						update: { current: operation.progressCurrent },
						create: {
							trackingStateId: state.id,
							unit: operation.progressUnit,
							current: operation.progressCurrent,
						},
					})
					const entry = await tx.entry.findFirst({
						where: {
							trackingStateId: state.id,
							watchlist: { ownerId: input.ownerId },
						},
						orderBy: [{ position: 'asc' }, { id: 'asc' }],
					})
					if (entry) {
						await tx.entry.update({
							where: { id: entry.id },
							data: legacyProgressUpdate(entry, {
								unit: operation.progressUnit,
								current: operation.progressCurrent,
								previousCurrent: saved?.current ?? 0,
								total: saved?.total ?? null,
								now: now.getTime(),
							}) as Prisma.EntryUpdateInput,
						})
					}
				}
				if (operation.favorite !== null) {
					const existing = await tx.userFavorite.findFirst({
						where: { ownerId: input.ownerId, mediaId: operation.mediaId },
						select: { id: true },
					})
					if (Boolean(existing) !== operation.favorite) {
						const media = await tx.media.findUniqueOrThrow({
							where: { id: operation.mediaId },
							select: mediaCatalogSelect,
						})
						await toggleMediaFavorite(tx, {
							ownerId: input.ownerId,
							mediaId: operation.mediaId,
							kind: operation.mediaKind,
							catalog: resolveMediaCatalog(media, undefined),
						})
					}
				}
				if (operation.collectionId) {
					const existing = await tx.mediaCollectionItem.findUnique({
						where: {
							collectionId_mediaId: {
								collectionId: operation.collectionId,
								mediaId: operation.mediaId,
							},
						},
					})
					if (!existing) {
						const highest = await tx.mediaCollectionItem.aggregate({
							where: { collectionId: operation.collectionId },
							_max: { position: true },
						})
						await tx.mediaCollectionItem.create({
							data: {
								collectionId: operation.collectionId,
								mediaId: operation.mediaId,
								position: (highest._max.position ?? 0) + 1,
							},
						})
					}
				}
				const activityAfter = await getTrackingActivityState(
					tx,
					input.ownerId,
					operation.mediaId,
				)
				if (activityAfter) {
					await recordTrackingActivityDiff(tx, {
						actorId: input.ownerId,
						mediaId: operation.mediaId,
						before: activityBefore,
						after: activityAfter,
					})
				}
			}
			const after = await currentSnapshot(tx, input.ownerId, plan.operations)
			await tx.trackingCommandPreview.update({
				where: { id: preview.id },
				data: {
					status: 'applied',
					appliedAt: now,
					journal: JSON.stringify({ before, after }),
				},
			})
			return {
				summary: plan.summary,
				operations: plan.operations,
				alreadyApplied: false,
			}
		},
		{ isolationLevel: 'Serializable' },
	)
}

const JournalSnapshotSchema = z.object({
	operations: z.array(ResolvedOperationSchema),
	states: z.array(
		z.object({
			id: z.string(),
			mediaId: z.string(),
			status: z.string(),
			statusWatchlistId: z.string().nullable(),
			score: z.number().nullable(),
			updatedAt: z.coerce.date(),
			progress: z.array(
				z.object({
					unit: z.string(),
					current: z.number().int(),
					total: z.number().int().nullable(),
					updatedAt: z.coerce.date(),
				}),
			),
		}),
	),
	favorites: z.array(
		z.object({
			id: z.string(),
			mediaId: z.string().nullable(),
			position: z.number().int(),
			thumbnail: z.string().nullable(),
			title: z.string(),
			typeId: z.string(),
			mediaType: z.string().nullable(),
			startYear: z.string().nullable(),
		}),
	),
	collectionItems: z.array(
		z.object({
			id: z.string(),
			mediaId: z.string(),
			collectionId: z.string(),
			position: z.number().int(),
		}),
	),
	entries: z.array(
		z.object({
			id: z.string(),
			mediaId: z.string(),
			watchlistId: z.string(),
			position: z.number().int(),
			personal: z.number().nullable(),
			history: z.string().nullable(),
			trackingStateId: z.string().nullable(),
		}),
	),
})

const TrackingJournalSchema = z.object({
	before: JournalSnapshotSchema,
	after: JournalSnapshotSchema,
})

export async function undoTrackingCommandPreview(
	prisma: PrismaClient,
	input: { ownerId: string; previewId: string; now?: Date },
) {
	const now = input.now ?? new Date()
	return await prisma.$transaction(
		async tx => {
			const preview = await tx.trackingCommandPreview.findFirst({
				where: {
					id: input.previewId,
					ownerId: input.ownerId,
					status: 'applied',
					revertedAt: null,
				},
			})
			if (!preview?.journal || !preview.appliedAt) {
				throw new Response('This command cannot be undone.', { status: 409 })
			}
			if (now.getTime() - preview.appliedAt.getTime() > 24 * 60 * 60 * 1_000) {
				throw new Response('The 24-hour undo window has expired.', {
					status: 409,
				})
			}
			const journal = TrackingJournalSchema.parse(
				JSON.parse(preview.journal) as unknown,
			)
			const current = await currentSnapshot(
				tx,
				input.ownerId,
				journal.after.operations,
			)
			if (hash(current) !== hash(journal.after)) {
				throw new Response(
					'Tracking data changed after this command, so it cannot be safely undone.',
					{ status: 409 },
				)
			}
			const mediaIds = [
				...new Set(journal.before.operations.map(item => item.mediaId)),
			]
			const beforeStateByMedia = new Map(
				journal.before.states.map(state => [state.mediaId, state]),
			)
			for (const mediaId of mediaIds) {
				const beforeState = beforeStateByMedia.get(mediaId)
				if (!beforeState) {
					await tx.trackingState.deleteMany({
						where: { ownerId: input.ownerId, mediaId },
					})
					continue
				}
				const state = await tx.trackingState.upsert({
					where: {
						ownerId_mediaId: { ownerId: input.ownerId, mediaId },
					},
					create: {
						id: beforeState.id,
						ownerId: input.ownerId,
						mediaId,
						status: beforeState.status,
						statusWatchlistId: beforeState.statusWatchlistId,
						score: beforeState.score,
						updatedAt: beforeState.updatedAt,
					},
					update: {
						status: beforeState.status,
						statusWatchlistId: beforeState.statusWatchlistId,
						score: beforeState.score,
						updatedAt: beforeState.updatedAt,
					},
				})
				await tx.trackingProgress.deleteMany({
					where: { trackingStateId: state.id },
				})
				if (beforeState.progress.length) {
					await tx.trackingProgress.createMany({
						data: beforeState.progress.map(progress => ({
							trackingStateId: state.id,
							unit: progress.unit,
							current: progress.current,
							total: progress.total,
							updatedAt: progress.updatedAt,
						})),
					})
				}
			}

			const beforeEntryIds = new Set(
				journal.before.entries.map(entry => entry.id),
			)
			await tx.entry.deleteMany({
				where: {
					id: {
						in: journal.after.entries
							.filter(entry => !beforeEntryIds.has(entry.id))
							.map(entry => entry.id),
					},
					watchlist: { ownerId: input.ownerId },
				},
			})
			for (const entry of journal.before.entries) {
				await tx.entry.updateMany({
					where: { id: entry.id, watchlist: { ownerId: input.ownerId } },
					data: {
						watchlistId: entry.watchlistId,
						position: entry.position,
						personal: entry.personal,
						history: entry.history,
						trackingStateId: entry.trackingStateId,
					},
				})
			}

			await tx.userFavorite.deleteMany({
				where: { ownerId: input.ownerId, mediaId: { in: mediaIds } },
			})
			if (journal.before.favorites.length) {
				await tx.userFavorite.createMany({
					data: journal.before.favorites.map(favorite => ({
						id: favorite.id,
						ownerId: input.ownerId,
						mediaId: favorite.mediaId,
						position: favorite.position,
						thumbnail: favorite.thumbnail,
						title: favorite.title,
						typeId: favorite.typeId,
						mediaType: favorite.mediaType,
						startYear: favorite.startYear,
					})),
				})
			}
			const touchedCollectionPairs = journal.after.collectionItems.map(
				item => ({
					collectionId: item.collectionId,
					mediaId: item.mediaId,
				}),
			)
			if (touchedCollectionPairs.length) {
				await tx.mediaCollectionItem.deleteMany({
					where: {
						OR: touchedCollectionPairs,
						collection: { ownerId: input.ownerId },
					},
				})
			}
			for (const item of journal.before.collectionItems) {
				await tx.mediaCollectionItem.create({
					data: {
						id: item.id,
						collectionId: item.collectionId,
						mediaId: item.mediaId,
						position: item.position,
					},
				})
			}
			await tx.trackingCommandPreview.update({
				where: { id: preview.id },
				data: { status: 'reverted', revertedAt: now },
			})
			return { summary: parsedResolvedPlan(preview.operations).summary }
		},
		{ isolationLevel: 'Serializable' },
	)
}

export async function getTrackingCommandPreviews(
	prisma: PrismaClient,
	ownerId: string,
) {
	const now = new Date()
	await prisma.trackingCommandPreview.deleteMany({
		where: {
			ownerId,
			OR: [
				{ status: 'pending', expiresAt: { lte: now } },
				{
					status: { in: ['applied', 'reverted'] },
					updatedAt: {
						lte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1_000),
					},
				},
			],
		},
	})
	const previews = await prisma.trackingCommandPreview.findMany({
		where: { ownerId },
		orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
		take: 10,
	})
	return previews.map(preview => ({
		...preview,
		plan: parsedResolvedPlan(preview.operations),
		canUndo:
			preview.status === 'applied' &&
			preview.revertedAt === null &&
			Boolean(
				preview.appliedAt &&
				Date.now() - preview.appliedAt.getTime() < 24 * 60 * 60 * 1_000,
			),
	}))
}
