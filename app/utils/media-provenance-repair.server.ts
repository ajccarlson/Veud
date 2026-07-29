import { randomUUID } from 'node:crypto'
import { Prisma, type PrismaClient } from '@prisma/client'
import {
	acquireCatalogSyncLease,
	catalogHydrationPriorities,
	checkpointCatalogSyncRun,
	completeCatalogSyncRun,
	failCatalogSyncRun,
} from './catalog-sync.server.ts'
import { TRUSTED_CATALOG_PROVENANCE_VERSION } from './media-catalog.ts'

export const CATALOG_PROVENANCE_REPAIR_CONFIRMATION =
	'QUARANTINE_UNTRUSTED_MEDIA_CATALOG'

export const CATALOG_PROVENANCE_REPAIR_CURSOR_KEY = {
	provider: 'veud',
	kind: 'provider-catalog',
	mode: 'repair',
} as const
export const CATALOG_PROVENANCE_REPAIR_COMPLETE_CURSOR = JSON.stringify({
	phase: 'complete',
	catalogProvenanceVersion: TRUSTED_CATALOG_PROVENANCE_VERSION,
	repairVersion: 2,
})
const REPAIR_LEASE_MS = 5 * 60 * 1_000
const QUARANTINED_CATALOG_PROVENANCE_VERSION = -1
const REPAIR_TRANSACTION_OPTIONS = {
	maxWait: 5_000,
	timeout: 60_000,
} as const
const REPAIRED_QUALITY_SUMMARY =
	'Catalog finding requires a fresh provider scan after the provenance reset.'
const REPAIRED_MERGE_FINGERPRINT = 'catalog-provenance-reset-required'
const PROVENANCE_RESET_DETAILS = JSON.stringify({
	reason: 'catalog-provenance-reset',
})

type CatalogProvenanceRepairOptions = {
	batchSize?: number
	commit?: boolean
	confirmation?: string
	now?: Date
}

type CatalogProvenanceInventory = {
	mediaToQuarantine: number
	untrustedRelations: number
	catalogQualitySnapshots: number
	catalogMergeSnapshots: number
	importCandidates: number
	trackingCommandPreviews: number
	activeIdentitiesToRequeue: number
}

function validBatchSize(value: number) {
	if (!Number.isSafeInteger(value) || value < 1 || value > 2_000) {
		throw new Error('batchSize must be an integer between 1 and 2000')
	}
	return value
}

const untrustedMediaWhere = {
	catalogProvenanceVersion: {
		not: TRUSTED_CATALOG_PROVENANCE_VERSION,
	},
} satisfies Prisma.MediaWhereInput

async function catalogProvenanceInventory(
	prisma: PrismaClient,
): Promise<CatalogProvenanceInventory> {
	const [
		mediaToQuarantine,
		untrustedRelations,
		catalogQualitySnapshots,
		catalogMergeSnapshots,
		importCandidates,
		trackingCommandPreviews,
		activeIdentitiesToRequeue,
	] = await Promise.all([
		prisma.media.count({ where: untrustedMediaWhere }),
		prisma.mediaRelation.count({
			where: {
				catalogProvenanceVersion: {
					not: TRUSTED_CATALOG_PROVENANCE_VERSION,
				},
			},
		}),
		prisma.catalogQualityIssue.count({
			where: {
				OR: [
					{ evidence: { not: null } },
					{
						summary: {
							not: REPAIRED_QUALITY_SUMMARY,
						},
					},
					{ status: { not: 'open' } },
				],
			},
		}),
		prisma.catalogMediaMerge.count({
			where: {
				catalogProvenanceVersion: {
					not: TRUSTED_CATALOG_PROVENANCE_VERSION,
				},
				OR: [
					{ preflight: { not: '{}' } },
					{
						preflightFingerprint: {
							not: REPAIRED_MERGE_FINGERPRINT,
						},
					},
					{ journal: { not: null } },
					{ status: { not: 'invalidated' } },
				],
			},
		}),
		prisma.libraryImportItem.count({
			where: { candidates: { not: '[]' } },
		}),
		prisma.trackingCommandPreview.count(),
		prisma.mediaExternalId.count({
			where: {
				tombstonedAt: null,
				provider: { in: ['mal', 'tmdb'] },
				media: untrustedMediaWhere,
			},
		}),
	])
	return {
		mediaToQuarantine,
		untrustedRelations,
		catalogQualitySnapshots,
		catalogMergeSnapshots,
		importCandidates,
		trackingCommandPreviews,
		activeIdentitiesToRequeue,
	}
}

export async function getCatalogProvenanceBoundaryState(prisma: PrismaClient) {
	const [cursor, untrustedMedia, untrustedRelation] = await Promise.all([
		prisma.catalogSyncCursor.findUnique({
			where: {
				provider_kind_mode: CATALOG_PROVENANCE_REPAIR_CURSOR_KEY,
			},
			select: {
				cursor: true,
				lastSuccessfulAt: true,
				leaseOwner: true,
				leaseExpiresAt: true,
			},
		}),
		prisma.media.findFirst({
			where: untrustedMediaWhere,
			orderBy: { id: 'asc' },
			select: { id: true },
		}),
		prisma.mediaRelation.findFirst({
			where: {
				catalogProvenanceVersion: {
					not: TRUSTED_CATALOG_PROVENANCE_VERSION,
				},
			},
			orderBy: { id: 'asc' },
			select: { id: true },
		}),
	])
	const completed = Boolean(
		cursor?.cursor === CATALOG_PROVENANCE_REPAIR_COMPLETE_CURSOR &&
		cursor.lastSuccessfulAt &&
		cursor.leaseOwner === null &&
		cursor.leaseExpiresAt === null,
	)
	return {
		completed,
		hasUntrustedMedia: Boolean(untrustedMedia),
		hasUntrustedRelations: Boolean(untrustedRelation),
	}
}

export async function assertCatalogProvenanceBoundaryReady(
	prisma: PrismaClient,
) {
	const state = await getCatalogProvenanceBoundaryState(prisma)
	if (!state.completed) {
		throw new Error(
			'Catalog provenance repair completion marker is missing or invalid',
		)
	}
	if (state.hasUntrustedMedia || state.hasUntrustedRelations) {
		throw new Error(
			'Catalog provenance changed after the completed repair boundary',
		)
	}
	return state
}

async function quarantineCatalogBatch(
	tx: Prisma.TransactionClient,
	mediaIds: string[],
) {
	if (!mediaIds.length) return
	const ids = Prisma.join(mediaIds)
	const updated = await tx.$executeRaw(Prisma.sql`
		UPDATE "Media"
		SET
			"thumbnail" = NULL,
			"title" = (
				SELECT trim("source"."sourceTitle")
				FROM "MediaExternalId" AS "source"
				WHERE "source"."mediaId" = "Media"."id"
					AND "source"."tombstonedAt" IS NULL
					AND "source"."provider" IN ('mal', 'tmdb')
					AND "source"."sourceTitle" IS NOT NULL
					AND trim("source"."sourceTitle") <> ''
				ORDER BY
					"source"."provider" ASC,
					"source"."kind" ASC,
					"source"."externalId" ASC
				LIMIT 1
			),
			"type" = NULL,
			"releaseStart" = NULL,
			"releaseEnd" = NULL,
			"nextRelease" = NULL,
			"nextReleaseAt" = NULL,
			"genres" = NULL,
			"description" = NULL,
			"airYear" = NULL,
			"startSeason" = NULL,
			"startYear" = NULL,
			"length" = NULL,
			"chapters" = NULL,
			"volumes" = NULL,
			"runtimeMinutes" = NULL,
			"episodeCount" = NULL,
			"chapterCount" = NULL,
			"volumeCount" = NULL,
			"rating" = NULL,
			"language" = NULL,
			"studios" = NULL,
			"serialization" = NULL,
			"authors" = NULL,
			"tmdbScore" = NULL,
			"malScore" = NULL,
			"catalogScore" = NULL,
			"catalogPopularity" = (
				SELECT "source"."sourcePopularity"
				FROM "MediaExternalId" AS "source"
				WHERE "source"."mediaId" = "Media"."id"
					AND "source"."tombstonedAt" IS NULL
					AND "source"."provider" IN ('mal', 'tmdb')
					AND "source"."sourcePopularity" IS NOT NULL
				ORDER BY
					"source"."provider" ASC,
					"source"."kind" ASC,
					"source"."externalId" ASC
				LIMIT 1
			),
			"releaseStatus" = NULL,
			"catalogProvenanceVersion" = ${QUARANTINED_CATALOG_PROVENANCE_VERSION}
		WHERE "id" IN (${ids})
			AND "catalogProvenanceVersion" <> ${TRUSTED_CATALOG_PROVENANCE_VERSION}
	`)
	if (updated !== mediaIds.length) {
		throw new Error('Catalog provenance batch changed during repair')
	}
}

async function resetEntryCatalogBatch(
	tx: Prisma.TransactionClient,
	entryIds: string[],
) {
	if (!entryIds.length) return
	await tx.$executeRaw(Prisma.sql`
		UPDATE "Entry"
		SET
			"title" = COALESCE(
				(
					SELECT "Media"."title"
					FROM "Media"
					WHERE "Media"."id" = "Entry"."mediaId"
				),
				'Untitled ' || COALESCE(
					(
						SELECT "Media"."kind"
						FROM "Media"
						WHERE "Media"."id" = "Entry"."mediaId"
					),
					'media'
				)
			),
			"thumbnail" = NULL,
			"type" = NULL,
			"releaseStart" = NULL,
			"releaseEnd" = NULL,
			"nextRelease" = NULL,
			"genres" = NULL,
			"description" = NULL,
			"airYear" = NULL,
			"startSeason" = NULL,
			"startYear" = NULL,
			"rating" = NULL,
			"language" = NULL,
			"studios" = NULL,
			"serialization" = NULL,
			"authors" = NULL,
			"tmdbScore" = NULL,
			"malScore" = NULL
		WHERE "id" IN (${Prisma.join(entryIds)})
			AND "mediaId" IN (
				SELECT "id"
				FROM "Media"
				WHERE "catalogProvenanceVersion" = ${QUARANTINED_CATALOG_PROVENANCE_VERSION}
			)
	`)
}

async function resetFavoriteCatalogBatch(
	tx: Prisma.TransactionClient,
	favoriteIds: string[],
) {
	if (!favoriteIds.length) return
	await tx.$executeRaw(Prisma.sql`
		UPDATE "UserFavorite"
		SET
			"title" = COALESCE(
				(
					SELECT "Media"."title"
					FROM "Media"
					WHERE "Media"."id" = "UserFavorite"."mediaId"
				),
				'Untitled ' || COALESCE(
					(
						SELECT "Media"."kind"
						FROM "Media"
						WHERE "Media"."id" = "UserFavorite"."mediaId"
					),
					'media'
				)
			),
			"thumbnail" = NULL,
			"mediaType" = NULL,
			"startYear" = NULL
		WHERE "id" IN (${Prisma.join(favoriteIds)})
			AND "mediaId" IN (
				SELECT "id"
				FROM "Media"
				WHERE "catalogProvenanceVersion" = ${QUARANTINED_CATALOG_PROVENANCE_VERSION}
			)
	`)
}

export async function repairMediaCatalogProvenance(
	prisma: PrismaClient,
	options: CatalogProvenanceRepairOptions = {},
) {
	const batchSize = validBatchSize(options.batchSize ?? 100)
	const commit = options.commit ?? false
	const now = options.now ?? new Date()
	if (!commit) {
		const [before, boundary] = await Promise.all([
			catalogProvenanceInventory(prisma),
			getCatalogProvenanceBoundaryState(prisma),
		])
		if (boundary.completed) {
			if (boundary.hasUntrustedMedia || boundary.hasUntrustedRelations) {
				throw new Error(
					'Catalog provenance changed after the completed repair boundary',
				)
			}
			return {
				dryRun: true,
				blocked: false,
				alreadyCompleted: true,
				completed: true,
				before,
				processedMedia: 0,
				after: before,
			}
		}
		return {
			dryRun: true,
			blocked: false,
			alreadyCompleted: false,
			completed: false,
			before,
			processedMedia: 0,
			after: before,
		}
	}
	if (options.confirmation !== CATALOG_PROVENANCE_REPAIR_CONFIRMATION) {
		throw new Error('Catalog provenance repair confirmation phrase is required')
	}
	const leaseOwner = `catalog-provenance-repair-${randomUUID()}`
	const lease = await prisma.$transaction(tx =>
		acquireCatalogSyncLease(tx, {
			provider: CATALOG_PROVENANCE_REPAIR_CURSOR_KEY.provider,
			kind: CATALOG_PROVENANCE_REPAIR_CURSOR_KEY.kind,
			mode: 'repair',
			leaseOwner,
			leaseDurationMs: REPAIR_LEASE_MS,
			now: new Date(),
		}),
	)
	let before: CatalogProvenanceInventory | undefined
	let processedMedia = 0
	let processedRecords = 0
	let cursor = JSON.stringify({ phase: 'starting' })
	try {
		const acquiredCompleteCursor =
			lease.cursor.cursor === CATALOG_PROVENANCE_REPAIR_COMPLETE_CURSOR
		if (acquiredCompleteCursor && !lease.cursor.lastSuccessfulAt) {
			throw new Error(
				'Catalog provenance repair completion marker is missing or invalid',
			)
		}
		before = await catalogProvenanceInventory(prisma)
		if (acquiredCompleteCursor) {
			if (before.mediaToQuarantine !== 0 || before.untrustedRelations !== 0) {
				throw new Error(
					'Catalog provenance changed after the completed repair boundary',
				)
			}
			await prisma.$transaction(tx =>
				completeCatalogSyncRun(tx, {
					runId: lease.run.id,
					leaseOwner,
					progress: {
						cursor: CATALOG_PROVENANCE_REPAIR_COMPLETE_CURSOR,
						recordsSeen: 0,
						recordsHandled: 0,
						recordsFailed: 0,
					},
					now: new Date(),
				}),
			)
			return {
				dryRun: false,
				blocked: false,
				alreadyCompleted: true,
				completed: true,
				before,
				processedMedia: 0,
				after: before,
			}
		}

		const applyCleanupBatch = async (
			phase: string,
			ids: string[],
			mutate: (tx: Prisma.TransactionClient) => Promise<unknown>,
		) => {
			const nextRecords = processedRecords + ids.length
			const nextCursor = JSON.stringify({
				phase,
				lastId: ids.at(-1) ?? null,
			})
			await prisma.$transaction(async tx => {
				await mutate(tx)
				await checkpointCatalogSyncRun(tx, {
					runId: lease.run.id,
					leaseOwner,
					progress: {
						cursor: nextCursor,
						recordsSeen: nextRecords,
						recordsHandled: nextRecords,
						recordsFailed: 0,
					},
					leaseDurationMs: REPAIR_LEASE_MS,
					now: new Date(),
				})
			}, REPAIR_TRANSACTION_OPTIONS)
			processedRecords = nextRecords
			cursor = nextCursor
		}

		let relationCursor: string | undefined
		for (;;) {
			const rows = await prisma.mediaRelation.findMany({
				where: {
					catalogProvenanceVersion: {
						not: TRUSTED_CATALOG_PROVENANCE_VERSION,
					},
					...(relationCursor ? { id: { gt: relationCursor } } : {}),
				},
				orderBy: { id: 'asc' },
				take: batchSize,
				select: { id: true },
			})
			if (!rows.length) break
			const ids = rows.map(row => row.id)
			await applyCleanupBatch('relations', ids, tx =>
				tx.mediaRelation.deleteMany({ where: { id: { in: ids } } }),
			)
			relationCursor = ids.at(-1)
		}

		let qualityCursor: string | undefined
		for (;;) {
			const rows = await prisma.catalogQualityIssue.findMany({
				where: {
					...(qualityCursor ? { id: { gt: qualityCursor } } : {}),
					OR: [
						{ evidence: { not: null } },
						{ summary: { not: REPAIRED_QUALITY_SUMMARY } },
						{ status: { not: 'open' } },
					],
				},
				orderBy: { id: 'asc' },
				take: batchSize,
				select: { id: true, status: true },
			})
			if (!rows.length) break
			const ids = rows.map(row => row.id)
			await applyCleanupBatch('quality-snapshots', ids, async tx => {
				await tx.catalogQualityIssue.updateMany({
					where: { id: { in: ids } },
					data: {
						summary: REPAIRED_QUALITY_SUMMARY,
						evidence: null,
						status: 'open',
						resolvedAt: null,
					},
				})
				await tx.catalogQualityEvent.createMany({
					data: rows.map(row => ({
						issueId: row.id,
						action: 'provenance-reset',
						previousStatus: row.status,
						nextStatus: 'open',
						details: PROVENANCE_RESET_DETAILS,
					})),
				})
			})
			qualityCursor = ids.at(-1)
		}

		let mergeCursor: string | undefined
		for (;;) {
			const rows = await prisma.catalogMediaMerge.findMany({
				where: {
					...(mergeCursor ? { id: { gt: mergeCursor } } : {}),
					catalogProvenanceVersion: {
						not: TRUSTED_CATALOG_PROVENANCE_VERSION,
					},
					OR: [
						{ preflight: { not: '{}' } },
						{
							preflightFingerprint: {
								not: REPAIRED_MERGE_FINGERPRINT,
							},
						},
						{ journal: { not: null } },
						{ status: { not: 'invalidated' } },
					],
				},
				orderBy: { id: 'asc' },
				take: batchSize,
				select: { id: true, status: true },
			})
			if (!rows.length) break
			const ids = rows.map(row => row.id)
			await applyCleanupBatch('merge-snapshots', ids, async tx => {
				await tx.catalogMediaMerge.updateMany({
					where: { id: { in: ids } },
					data: {
						status: 'invalidated',
						preflight: '{}',
						preflightFingerprint: REPAIRED_MERGE_FINGERPRINT,
						journal: null,
					},
				})
				await tx.catalogMediaMergeEvent.createMany({
					data: rows.map(row => ({
						mergeId: row.id,
						action: 'provenance-reset',
						previousStatus: row.status,
						nextStatus: 'invalidated',
						details: PROVENANCE_RESET_DETAILS,
					})),
				})
			})
			mergeCursor = ids.at(-1)
		}

		let importCursor: string | undefined
		for (;;) {
			const rows = await prisma.libraryImportItem.findMany({
				where: {
					candidates: { not: '[]' },
					...(importCursor ? { id: { gt: importCursor } } : {}),
				},
				orderBy: { id: 'asc' },
				take: batchSize,
				select: { id: true },
			})
			if (!rows.length) break
			const ids = rows.map(row => row.id)
			await applyCleanupBatch('import-candidates', ids, tx =>
				tx.libraryImportItem.updateMany({
					where: { id: { in: ids } },
					data: { candidates: '[]' },
				}),
			)
			importCursor = ids.at(-1)
		}

		let previewCursor: string | undefined
		for (;;) {
			const rows = await prisma.trackingCommandPreview.findMany({
				where: previewCursor ? { id: { gt: previewCursor } } : undefined,
				orderBy: { id: 'asc' },
				take: batchSize,
				select: { id: true },
			})
			if (!rows.length) break
			const ids = rows.map(row => row.id)
			await applyCleanupBatch('tracking-previews', ids, tx =>
				tx.trackingCommandPreview.deleteMany({
					where: { id: { in: ids } },
				}),
			)
			previewCursor = ids.at(-1)
		}

		let mediaCursor: string | undefined
		for (;;) {
			const media = await prisma.media.findMany({
				where: {
					...untrustedMediaWhere,
					...(mediaCursor ? { id: { gt: mediaCursor } } : {}),
				},
				orderBy: { id: 'asc' },
				take: batchSize,
				select: { id: true },
			})
			if (!media.length) break
			const mediaIds = media.map(row => row.id)
			const nextRecords = processedRecords + mediaIds.length
			const nextMediaId = mediaIds.at(-1) ?? null
			const nextCursor = JSON.stringify({
				phase: 'media',
				lastId: nextMediaId,
			})
			await prisma.$transaction(async tx => {
				await quarantineCatalogBatch(tx, mediaIds)
				await checkpointCatalogSyncRun(tx, {
					runId: lease.run.id,
					leaseOwner,
					progress: {
						cursor: nextCursor,
						recordsSeen: nextRecords,
						recordsHandled: nextRecords,
						recordsFailed: 0,
					},
					leaseDurationMs: REPAIR_LEASE_MS,
					now: new Date(),
				})
			}, REPAIR_TRANSACTION_OPTIONS)
			processedMedia += mediaIds.length
			processedRecords = nextRecords
			cursor = nextCursor
			mediaCursor = nextMediaId ?? undefined
		}

		let entryCursor: string | undefined
		for (;;) {
			const rows = await prisma.entry.findMany({
				where: {
					media: {
						catalogProvenanceVersion: QUARANTINED_CATALOG_PROVENANCE_VERSION,
					},
					...(entryCursor ? { id: { gt: entryCursor } } : {}),
				},
				orderBy: { id: 'asc' },
				take: batchSize,
				select: { id: true },
			})
			if (!rows.length) break
			const ids = rows.map(row => row.id)
			await applyCleanupBatch('entry-snapshots', ids, tx =>
				resetEntryCatalogBatch(tx, ids),
			)
			entryCursor = ids.at(-1)
		}

		let favoriteCursor: string | undefined
		for (;;) {
			const rows = await prisma.userFavorite.findMany({
				where: {
					media: {
						catalogProvenanceVersion: QUARANTINED_CATALOG_PROVENANCE_VERSION,
					},
					...(favoriteCursor ? { id: { gt: favoriteCursor } } : {}),
				},
				orderBy: { id: 'asc' },
				take: batchSize,
				select: { id: true },
			})
			if (!rows.length) break
			const ids = rows.map(row => row.id)
			await applyCleanupBatch('favorite-snapshots', ids, tx =>
				resetFavoriteCatalogBatch(tx, ids),
			)
			favoriteCursor = ids.at(-1)
		}

		let occurrenceCursor: string | undefined
		for (;;) {
			const rows = await prisma.releaseOccurrence.findMany({
				where: {
					sourceKey: 'next',
					media: {
						catalogProvenanceVersion: QUARANTINED_CATALOG_PROVENANCE_VERSION,
					},
					...(occurrenceCursor ? { id: { gt: occurrenceCursor } } : {}),
				},
				orderBy: { id: 'asc' },
				take: batchSize,
				select: { id: true },
			})
			if (!rows.length) break
			const ids = rows.map(row => row.id)
			await applyCleanupBatch('release-occurrences', ids, tx =>
				tx.releaseOccurrence.deleteMany({
					where: {
						id: { in: ids },
						media: {
							catalogProvenanceVersion: QUARANTINED_CATALOG_PROVENANCE_VERSION,
						},
					},
				}),
			)
			occurrenceCursor = ids.at(-1)
		}

		let notificationCursor: string | undefined
		for (;;) {
			const rows = await prisma.notification.findMany({
				where: {
					releaseReminder: {
						media: {
							catalogProvenanceVersion: QUARANTINED_CATALOG_PROVENANCE_VERSION,
						},
					},
					...(notificationCursor ? { id: { gt: notificationCursor } } : {}),
				},
				orderBy: { id: 'asc' },
				take: batchSize,
				select: { id: true },
			})
			if (!rows.length) break
			const ids = rows.map(row => row.id)
			await applyCleanupBatch('release-notifications', ids, tx =>
				tx.notification.deleteMany({ where: { id: { in: ids } } }),
			)
			notificationCursor = ids.at(-1)
		}

		let identityCursor: string | undefined
		for (;;) {
			const rows = await prisma.mediaExternalId.findMany({
				where: {
					tombstonedAt: null,
					provider: { in: ['mal', 'tmdb'] },
					media: {
						catalogProvenanceVersion: QUARANTINED_CATALOG_PROVENANCE_VERSION,
					},
					...(identityCursor ? { id: { gt: identityCursor } } : {}),
				},
				orderBy: { id: 'asc' },
				take: batchSize,
				select: { id: true },
			})
			if (!rows.length) break
			const ids = rows.map(row => row.id)
			await applyCleanupBatch('provider-identities', ids, tx =>
				tx.mediaExternalId.updateMany({
					where: {
						id: { in: ids },
						tombstonedAt: null,
						provider: { in: ['mal', 'tmdb'] },
						media: {
							catalogProvenanceVersion: QUARANTINED_CATALOG_PROVENANCE_VERSION,
						},
					},
					data: {
						fetchStatus: 'pending',
						lastFetchedAt: null,
						refreshAfter: now,
						hydrationPriority: catalogHydrationPriorities.provenanceRepair,
						hydrationReason: 'catalog-provenance-repair',
						hydrationRequestedAt: now,
						failureCount: 0,
						lastError: null,
					},
				}),
			)
			identityCursor = ids.at(-1)
		}

		for (;;) {
			const rows = await prisma.media.findMany({
				where: {
					catalogProvenanceVersion: QUARANTINED_CATALOG_PROVENANCE_VERSION,
				},
				orderBy: { id: 'asc' },
				take: batchSize,
				select: { id: true },
			})
			if (!rows.length) break
			const ids = rows.map(row => row.id)
			await applyCleanupBatch('finalize-media', ids, async tx => {
				const finalized = await tx.media.updateMany({
					where: {
						id: { in: ids },
						catalogProvenanceVersion: QUARANTINED_CATALOG_PROVENANCE_VERSION,
					},
					data: {
						catalogProvenanceVersion: TRUSTED_CATALOG_PROVENANCE_VERSION,
					},
				})
				if (finalized.count !== ids.length) {
					throw new Error(
						'Catalog provenance finalization changed concurrently',
					)
				}
			})
		}

		const after = await catalogProvenanceInventory(prisma)
		if (
			after.mediaToQuarantine !== 0 ||
			after.untrustedRelations !== 0 ||
			after.catalogQualitySnapshots !== 0 ||
			after.catalogMergeSnapshots !== 0 ||
			after.importCandidates !== 0 ||
			after.trackingCommandPreviews !== 0
		) {
			throw new Error(
				'Catalog provenance repair did not reach a clean baseline',
			)
		}
		await prisma.$transaction(tx =>
			completeCatalogSyncRun(tx, {
				runId: lease.run.id,
				leaseOwner,
				progress: {
					cursor: CATALOG_PROVENANCE_REPAIR_COMPLETE_CURSOR,
					recordsSeen: processedRecords,
					recordsHandled: processedRecords,
					recordsFailed: 0,
				},
				now: new Date(),
			}),
		)
		return {
			dryRun: false,
			blocked: false,
			alreadyCompleted: false,
			completed: true,
			before,
			processedMedia,
			after,
		}
	} catch (error) {
		await prisma
			.$transaction(tx =>
				failCatalogSyncRun(tx, {
					runId: lease.run.id,
					leaseOwner,
					error,
					progress: {
						cursor,
						recordsSeen: processedRecords,
						recordsHandled: processedRecords,
						recordsFailed: 0,
					},
					now: new Date(),
				}),
			)
			.catch(() => {})
		throw error
	}
}
