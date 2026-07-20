import { type Prisma } from '@prisma/client'

export const catalogSyncModes = [
	'inventory',
	'hydrate',
	'refresh',
	'reconcile',
	'repair',
] as const

export type CatalogSyncMode = (typeof catalogSyncModes)[number]

export class CatalogSyncLeaseError extends Error {
	constructor(message = 'Catalog sync lease is not available') {
		super(message)
		this.name = 'CatalogSyncLeaseError'
	}
}

type CatalogIdentity = {
	provider: string
	kind: string
	externalId: string
}

export type CatalogTitleInput = {
	language?: string | null
	titleType: string
	value: string
	isPrimary?: boolean
}

export type CatalogSyncProgress = {
	cursor: string | null
	recordsSeen: number
	recordsHandled: number
	recordsFailed: number
}

function requireNonEmpty(value: string, label: string) {
	const normalized = value.trim()
	if (!normalized) throw new Error(`${label} is required`)
	return normalized
}

function requireProgress(progress: CatalogSyncProgress) {
	for (const [label, value] of Object.entries(progress)) {
		if (label === 'cursor') continue
		if (!Number.isSafeInteger(value) || Number(value) < 0) {
			throw new Error(`${label} must be a non-negative safe integer`)
		}
	}
	if (progress.recordsHandled + progress.recordsFailed > progress.recordsSeen) {
		throw new Error('handled and failed records cannot exceed records seen')
	}
	return progress
}

function requireProgressNotRegressed(
	previous: Pick<
		CatalogSyncProgress,
		'recordsSeen' | 'recordsHandled' | 'recordsFailed'
	>,
	next: CatalogSyncProgress,
) {
	for (const field of [
		'recordsSeen',
		'recordsHandled',
		'recordsFailed',
	] as const) {
		if (next[field] < previous[field]) {
			throw new Error(`${field} cannot move backward`)
		}
	}
	return next
}

function boundedError(error: unknown) {
	const message = error instanceof Error ? error.message : String(error)
	return message.slice(0, 2_000)
}

export function normalizeCatalogTitle(value: string) {
	return value
		.normalize('NFKD')
		.replace(/\p{Mark}/gu, '')
		.toLowerCase()
		.replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
		.trim()
}

export async function upsertCatalogIdentity(
	tx: Prisma.TransactionClient,
	input: CatalogIdentity & {
		sourceUpdatedAt?: Date | null
		seenAt?: Date
	},
) {
	const provider = requireNonEmpty(input.provider, 'provider')
	const kind = requireNonEmpty(input.kind, 'kind')
	const externalId = requireNonEmpty(input.externalId, 'externalId')
	const seenAt = input.seenAt ?? new Date()
	return tx.mediaExternalId.upsert({
		where: {
			provider_kind_externalId: { provider, kind, externalId },
		},
		update: {
			lastSeenAt: seenAt,
			tombstonedAt: null,
			...(input.sourceUpdatedAt === undefined
				? {}
				: { sourceUpdatedAt: input.sourceUpdatedAt }),
		},
		create: {
			provider,
			kind,
			externalId,
			firstSeenAt: seenAt,
			lastSeenAt: seenAt,
			sourceUpdatedAt: input.sourceUpdatedAt,
			media: { create: { kind } },
		},
		include: { media: true },
	})
}

export async function replaceCatalogTitles(
	tx: Prisma.TransactionClient,
	input: { mediaId: string; provider: string; titles: CatalogTitleInput[] },
) {
	const provider = requireNonEmpty(input.provider, 'provider')
	const unique = new Map<string, Prisma.MediaTitleCreateManyInput>()
	for (const title of input.titles) {
		const value = title.value.trim()
		const titleType = title.titleType.trim()
		if (!value || !titleType) continue
		const language = title.language?.trim() ?? ''
		const key = JSON.stringify([language, titleType, value])
		const existing = unique.get(key)
		unique.set(key, {
			mediaId: input.mediaId,
			provider,
			language,
			titleType,
			value,
			normalized: normalizeCatalogTitle(value),
			isPrimary: Boolean(existing?.isPrimary || title.isPrimary),
		})
	}

	await tx.mediaTitle.deleteMany({
		where: { mediaId: input.mediaId, provider },
	})
	if (unique.size) {
		await tx.mediaTitle.createMany({ data: [...unique.values()] })
	}
	return [...unique.values()]
}

export function catalogSourceNeedsFetch(
	source: {
		fetchStatus?: string
		sourceUpdatedAt: Date | null
		lastFetchedAt: Date | null
		refreshAfter: Date | null
		tombstonedAt: Date | null
	},
	now = new Date(),
) {
	if (source.tombstonedAt) return false
	if (
		source.fetchStatus === 'failed' &&
		source.refreshAfter &&
		source.refreshAfter > now
	) {
		return false
	}
	if (
		source.sourceUpdatedAt &&
		(!source.lastFetchedAt || source.sourceUpdatedAt > source.lastFetchedAt)
	) {
		return true
	}
	if (source.refreshAfter && source.refreshAfter > now) return false
	if (!source.lastFetchedAt) return true
	return Boolean(source.refreshAfter && source.refreshAfter <= now)
}

export async function recordCatalogFetchSuccess(
	tx: Prisma.TransactionClient,
	input: CatalogIdentity & { fetchedAt?: Date; refreshAfter: Date },
) {
	const fetchedAt = input.fetchedAt ?? new Date()
	return tx.mediaExternalId.update({
		where: {
			provider_kind_externalId: {
				provider: input.provider,
				kind: input.kind,
				externalId: input.externalId,
			},
		},
		data: {
			lastFetchedAt: fetchedAt,
			refreshAfter: input.refreshAfter,
			fetchStatus: 'fresh',
			failureCount: 0,
			lastError: null,
		},
	})
}

export async function recordCatalogFetchFailure(
	tx: Prisma.TransactionClient,
	input: CatalogIdentity & { error: unknown; retryAfter: Date },
) {
	return tx.mediaExternalId.update({
		where: {
			provider_kind_externalId: {
				provider: input.provider,
				kind: input.kind,
				externalId: input.externalId,
			},
		},
		data: {
			fetchStatus: 'failed',
			failureCount: { increment: 1 },
			lastError: boundedError(input.error),
			refreshAfter: input.retryAfter,
		},
	})
}

export async function tombstoneCatalogSourcesNotSeenSince(
	tx: Prisma.TransactionClient,
	input: { provider: string; kind: string; missingBefore: Date; now?: Date },
) {
	// Only call this after a complete, successful inventory pass. A partial pass
	// cannot prove that an identity disappeared from the upstream provider.
	const now = input.now ?? new Date()
	return tx.mediaExternalId.updateMany({
		where: {
			provider: input.provider,
			kind: input.kind,
			lastSeenAt: { lt: input.missingBefore },
			tombstonedAt: null,
		},
		data: { tombstonedAt: now, fetchStatus: 'tombstoned' },
	})
}

function leaseExpiration(now: Date, leaseDurationMs: number) {
	if (!Number.isSafeInteger(leaseDurationMs) || leaseDurationMs <= 0) {
		throw new Error('leaseDurationMs must be a positive safe integer')
	}
	return new Date(now.getTime() + leaseDurationMs)
}

async function requireActiveRun(
	tx: Prisma.TransactionClient,
	input: { runId: string; leaseOwner: string },
) {
	const run = await tx.catalogSyncRun.findUnique({ where: { id: input.runId } })
	if (!run || run.status !== 'running' || run.leaseOwner !== input.leaseOwner) {
		throw new CatalogSyncLeaseError('Catalog sync run is no longer active')
	}
	return run
}

export async function acquireCatalogSyncLease(
	tx: Prisma.TransactionClient,
	input: {
		provider: string
		kind: string
		mode: CatalogSyncMode
		leaseOwner: string
		leaseDurationMs: number
		now?: Date
	},
) {
	const provider = requireNonEmpty(input.provider, 'provider')
	const kind = requireNonEmpty(input.kind, 'kind')
	const leaseOwner = requireNonEmpty(input.leaseOwner, 'leaseOwner')
	const now = input.now ?? new Date()
	const leaseExpiresAt = leaseExpiration(now, input.leaseDurationMs)
	const key = { provider, kind, mode: input.mode }
	const cursor = await tx.catalogSyncCursor.upsert({
		where: { provider_kind_mode: key },
		update: {},
		create: key,
	})
	const claim = await tx.catalogSyncCursor.updateMany({
		where: {
			id: cursor.id,
			OR: [{ leaseOwner: null }, { leaseExpiresAt: { lte: now } }],
		},
		data: { leaseOwner, leaseExpiresAt },
	})
	if (claim.count !== 1) throw new CatalogSyncLeaseError()
	await tx.catalogSyncRun.updateMany({
		where: { ...key, status: 'running' },
		data: {
			status: 'abandoned',
			lastError: 'Lease expired before the run completed',
			heartbeatAt: now,
			completedAt: now,
		},
	})

	const run = await tx.catalogSyncRun.create({
		data: {
			...key,
			leaseOwner,
			cursor: cursor.cursor,
			startedAt: now,
			heartbeatAt: now,
		},
	})
	return {
		run,
		cursor: await tx.catalogSyncCursor.findUniqueOrThrow({
			where: { id: cursor.id },
		}),
	}
}

export async function checkpointCatalogSyncRun(
	tx: Prisma.TransactionClient,
	input: {
		runId: string
		leaseOwner: string
		progress: CatalogSyncProgress
		leaseDurationMs: number
		now?: Date
	},
) {
	const progress = requireProgress(input.progress)
	const now = input.now ?? new Date()
	const run = await requireActiveRun(tx, input)
	requireProgressNotRegressed(run, progress)
	const renewed = await tx.catalogSyncCursor.updateMany({
		where: {
			provider: run.provider,
			kind: run.kind,
			mode: run.mode,
			leaseOwner: input.leaseOwner,
			leaseExpiresAt: { gt: now },
		},
		data: {
			cursor: progress.cursor,
			leaseExpiresAt: leaseExpiration(now, input.leaseDurationMs),
		},
	})
	if (renewed.count !== 1) {
		throw new CatalogSyncLeaseError('Catalog sync lease expired')
	}
	return tx.catalogSyncRun.update({
		where: { id: run.id },
		data: { ...progress, heartbeatAt: now },
	})
}

export async function completeCatalogSyncRun(
	tx: Prisma.TransactionClient,
	input: {
		runId: string
		leaseOwner: string
		progress: CatalogSyncProgress
		now?: Date
	},
) {
	const progress = requireProgress(input.progress)
	const now = input.now ?? new Date()
	const run = await requireActiveRun(tx, input)
	requireProgressNotRegressed(run, progress)
	const released = await tx.catalogSyncCursor.updateMany({
		where: {
			provider: run.provider,
			kind: run.kind,
			mode: run.mode,
			leaseOwner: input.leaseOwner,
			leaseExpiresAt: { gt: now },
		},
		data: {
			cursor: progress.cursor,
			leaseOwner: null,
			leaseExpiresAt: null,
			lastSuccessfulAt: now,
		},
	})
	if (released.count !== 1) {
		throw new CatalogSyncLeaseError('Catalog sync lease expired')
	}
	return tx.catalogSyncRun.update({
		where: { id: run.id },
		data: {
			...progress,
			status: 'completed',
			heartbeatAt: now,
			completedAt: now,
		},
	})
}

export async function failCatalogSyncRun(
	tx: Prisma.TransactionClient,
	input: {
		runId: string
		leaseOwner: string
		error: unknown
		now?: Date
	},
) {
	const now = input.now ?? new Date()
	const run = await requireActiveRun(tx, input)
	await tx.catalogSyncCursor.updateMany({
		where: {
			provider: run.provider,
			kind: run.kind,
			mode: run.mode,
			leaseOwner: input.leaseOwner,
		},
		data: { leaseOwner: null, leaseExpiresAt: null },
	})
	return tx.catalogSyncRun.update({
		where: { id: run.id },
		data: {
			status: 'failed',
			lastError: boundedError(input.error),
			heartbeatAt: now,
			completedAt: now,
		},
	})
}
