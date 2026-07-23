import { type Prisma } from '@prisma/client'
import {
	type LibraryImportItem as NormalizedImportItem,
	libraryImportProviders,
} from './library-import.ts'
import { listTypeNameForMediaKind } from './media-kind.ts'
import { setMediaTrackingStatus } from './tracking-status.server.ts'

export const libraryImportResolutions = [
	'add',
	'merge',
	'replace',
	'skip',
] as const
export type LibraryImportResolutionChoice =
	(typeof libraryImportResolutions)[number]

type ImportProgress = {
	unit: string
	current: number
	total: number | null
}

type TrackingSnapshot = {
	id: string
	status: string
	statusWatchlistId: string | null
	score: number | null
	startedAt: string | null
	completedAt: string | null
	repeatCount: number
	progress: ImportProgress[]
} | null

type EntrySnapshot = {
	id: string
	watchlistId: string
	position: number
	trackingStateId: string | null
	personal: number | null
	history: string | null
}

type MemberMediaSnapshot = {
	tracking: TrackingSnapshot
	entries: EntrySnapshot[]
}

type ImportJournal = {
	before: MemberMediaSnapshot
	after: MemberMediaSnapshot
	createdWatchlistId: string | null
}

export class LibraryImportError extends Error {
	constructor(
		message: string,
		public readonly status = 400,
	) {
		super(message)
	}
}

function parsedJson<T>(value: string, fallback: T): T {
	try {
		return JSON.parse(value) as T
	} catch {
		return fallback
	}
}

export function parseStoredLibraryImportItem(value: string) {
	const parsed = parsedJson<NormalizedImportItem | null>(value, null)
	if (
		!parsed ||
		!libraryImportProviders.includes(parsed.provider) ||
		!['anime', 'manga', 'movie', 'tv'].includes(parsed.mediaKind) ||
		typeof parsed.title !== 'string' ||
		typeof parsed.sourceKey !== 'string'
	) {
		throw new LibraryImportError('The stored import row is invalid.')
	}
	return parsed
}

function importedStatus(item: NormalizedImportItem) {
	if (item.status === 'current')
		return item.mediaKind === 'manga' ? 'reading' : 'watching'
	if (item.status === 'paused') return 'onhold'
	if (['completed', 'planning', 'dropped'].includes(item.status))
		return item.status
	return 'planning'
}

function statusHeader(status: string) {
	return (
		{
			watching: 'Watching',
			reading: 'Reading',
			completed: 'Completed',
			planning: 'Planning',
			onhold: 'On hold',
			dropped: 'Dropped',
		}[status] ?? status
	)
}

function importedProgress(item: NormalizedImportItem): ImportProgress[] {
	const result: ImportProgress[] = []
	if (item.progress.episodes !== undefined) {
		result.push({
			unit: 'episode',
			current: item.progress.episodes,
			total: null,
		})
	}
	if (item.progress.chapters !== undefined) {
		result.push({
			unit: 'chapter',
			current: item.progress.chapters,
			total: null,
		})
	}
	if (item.progress.volumes !== undefined) {
		result.push({
			unit: 'volume',
			current: item.progress.volumes,
			total: null,
		})
	}
	return result
}

async function memberMediaSnapshot(
	tx: Prisma.TransactionClient,
	ownerId: string,
	mediaId: string,
): Promise<MemberMediaSnapshot> {
	const [tracking, entries] = await Promise.all([
		tx.trackingState.findUnique({
			where: { ownerId_mediaId: { ownerId, mediaId } },
			select: {
				id: true,
				status: true,
				statusWatchlistId: true,
				score: true,
				startedAt: true,
				completedAt: true,
				repeatCount: true,
				progress: {
					orderBy: [{ unit: 'asc' }, { id: 'asc' }],
					select: { unit: true, current: true, total: true },
				},
			},
		}),
		tx.entry.findMany({
			where: { mediaId, watchlist: { ownerId } },
			orderBy: [{ id: 'asc' }],
			select: {
				id: true,
				watchlistId: true,
				position: true,
				trackingStateId: true,
				personal: true,
				history: true,
			},
		}),
	])
	return {
		tracking: tracking
			? {
					...tracking,
					score: tracking.score === null ? null : Number(tracking.score),
					startedAt: tracking.startedAt?.toISOString() ?? null,
					completedAt: tracking.completedAt?.toISOString() ?? null,
				}
			: null,
		entries: entries.map(entry => ({
			...entry,
			personal: entry.personal === null ? null : Number(entry.personal),
		})),
	}
}

function stableSnapshot(value: MemberMediaSnapshot) {
	return JSON.stringify(value)
}

async function ensureStatusWatchlist(
	tx: Prisma.TransactionClient,
	input: {
		ownerId: string
		mediaKind: string
		status: string
	},
) {
	const typeName = listTypeNameForMediaKind(input.mediaKind)
	if (!typeName) throw new LibraryImportError('Unsupported media type.')
	const listType = await tx.listType.findUnique({
		where: { name: typeName },
		select: { id: true, columns: true },
	})
	if (!listType) {
		throw new LibraryImportError(
			`The ${typeName} list type has not been configured.`,
			409,
		)
	}
	const existing = await tx.watchlist.findFirst({
		where: {
			ownerId: input.ownerId,
			typeId: listType.id,
			name: input.status,
		},
		orderBy: [{ position: 'asc' }, { id: 'asc' }],
		select: { id: true },
	})
	if (existing) return { id: existing.id, created: false }
	const aggregate = await tx.watchlist.aggregate({
		where: { ownerId: input.ownerId, typeId: listType.id },
		_max: { position: true },
	})
	const visibleColumns = Object.keys(
		parsedJson<Record<string, string>>(listType.columns, {}),
	)
		.filter(column =>
			['position', 'thumbnail', 'title', 'personal', 'length'].includes(column),
		)
		.join(',')
	const created = await tx.watchlist.create({
		data: {
			ownerId: input.ownerId,
			typeId: listType.id,
			name: input.status,
			header: statusHeader(input.status),
			position: (aggregate._max.position ?? 0) + 1,
			displayedColumns: visibleColumns || 'position,thumbnail,title',
			// An import must not silently publish a newly created collection.
			isPublic: false,
		},
		select: { id: true },
	})
	return { id: created.id, created: true }
}

function mergedProgress(
	current: ImportProgress[],
	incoming: ImportProgress[],
	choice: LibraryImportResolutionChoice,
) {
	if (choice !== 'merge') return incoming
	const merged = new Map(current.map(progress => [progress.unit, progress]))
	for (const progress of incoming) {
		const previous = merged.get(progress.unit)
		merged.set(progress.unit, {
			unit: progress.unit,
			current: Math.max(previous?.current ?? 0, progress.current),
			total: previous?.total ?? progress.total,
		})
	}
	return [...merged.values()]
}

async function applyImportedValues(
	tx: Prisma.TransactionClient,
	input: {
		ownerId: string
		mediaId: string
		item: NormalizedImportItem
		choice: LibraryImportResolutionChoice
		trackingStateId: string
	},
) {
	const current = await tx.trackingState.findUniqueOrThrow({
		where: { id: input.trackingStateId },
		select: {
			score: true,
			startedAt: true,
			completedAt: true,
			repeatCount: true,
			progress: {
				select: { unit: true, current: true, total: true },
			},
		},
	})
	const merge = input.choice === 'merge'
	const score =
		merge && input.item.score === null ? current.score : input.item.score
	const startedAt =
		merge && input.item.startedAt === null
			? current.startedAt
			: input.item.startedAt
				? new Date(input.item.startedAt)
				: null
	const completedAt =
		merge && input.item.completedAt === null
			? current.completedAt
			: input.item.completedAt
				? new Date(input.item.completedAt)
				: null
	const repeatCount = merge
		? Math.max(current.repeatCount, input.item.repeatCount)
		: input.item.repeatCount
	const progress = mergedProgress(
		current.progress,
		importedProgress(input.item),
		input.choice,
	)

	await tx.trackingState.update({
		where: { id: input.trackingStateId },
		data: { score, startedAt, completedAt, repeatCount },
	})
	await tx.trackingProgress.deleteMany({
		where: { trackingStateId: input.trackingStateId },
	})
	if (progress.length) {
		await tx.trackingProgress.createMany({
			data: progress.map(value => ({
				trackingStateId: input.trackingStateId,
				...value,
			})),
		})
	}
	const now = Date.now()
	const primaryProgress =
		progress.find(value => value.unit === 'episode') ??
		progress.find(value => value.unit === 'chapter') ??
		progress[0]
	await tx.entry.updateMany({
		where: {
			mediaId: input.mediaId,
			watchlist: { ownerId: input.ownerId },
		},
		data: {
			trackingStateId: input.trackingStateId,
			personal: score,
			history: JSON.stringify({
				added: now,
				started: startedAt?.getTime() ?? null,
				finished: completedAt?.getTime() ?? null,
				progress: primaryProgress?.current ?? null,
				repeatCount,
				lastUpdated: now,
			}),
		},
	})
}

export async function applyLibraryImportBatch(
	tx: Prisma.TransactionClient,
	input: { ownerId: string; batchId: string },
) {
	const claim = await tx.libraryImportBatch.updateMany({
		where: {
			id: input.batchId,
			ownerId: input.ownerId,
			status: 'previewed',
		},
		data: { status: 'applying' },
	})
	if (claim.count !== 1) {
		throw new LibraryImportError(
			'This import preview is no longer editable.',
			409,
		)
	}
	const batch = await tx.libraryImportBatch.findFirst({
		where: { id: input.batchId, ownerId: input.ownerId },
		include: { items: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
	})
	if (!batch) throw new LibraryImportError('Import preview not found.', 404)
	if (batch.status !== 'applying')
		throw new LibraryImportError('Import claim failed.', 409)
	const selected = batch.items.filter(item => item.resolution !== 'skip')
	if (!selected.length) {
		throw new LibraryImportError('Choose at least one matched item to import.')
	}
	const selectedMediaIds = selected.map(item => item.mediaId)
	if (
		selectedMediaIds.some(mediaId => !mediaId) ||
		new Set(selectedMediaIds).size !== selectedMediaIds.length
	) {
		throw new LibraryImportError(
			'Each selected row must resolve to a different catalog item.',
		)
	}
	for (const stored of selected) {
		if (
			!libraryImportResolutions.includes(
				stored.resolution as LibraryImportResolutionChoice,
			) ||
			!stored.mediaId
		) {
			throw new LibraryImportError('An import choice is invalid.')
		}
		const choice = stored.resolution as LibraryImportResolutionChoice
		const item = parseStoredLibraryImportItem(stored.payload)
		const before = await memberMediaSnapshot(tx, input.ownerId, stored.mediaId)
		if (choice === 'add' && before.tracking) {
			throw new LibraryImportError(
				`${item.title} is already tracked. Choose merge, replace, or skip.`,
				409,
			)
		}
		const destination = await ensureStatusWatchlist(tx, {
			ownerId: input.ownerId,
			mediaKind: item.mediaKind,
			status: importedStatus(item),
		})
		const tracking = await setMediaTrackingStatus(tx, {
			ownerId: input.ownerId,
			mediaId: stored.mediaId,
			watchlistId: destination.id,
			recordActivity: false,
		})
		await applyImportedValues(tx, {
			ownerId: input.ownerId,
			mediaId: stored.mediaId,
			item,
			choice,
			trackingStateId: tracking.trackingStateId,
		})
		const imported = await tx.trackingState.findUniqueOrThrow({
			where: { id: tracking.trackingStateId },
			select: {
				status: true,
				score: true,
				statusWatchlistId: true,
				progress: {
					orderBy: [{ unit: 'asc' }],
					take: 1,
					select: { unit: true, current: true, total: true },
				},
			},
		})
		await tx.activityEvent.create({
			data: {
				type: 'library_import',
				actorId: input.ownerId,
				mediaId: stored.mediaId,
				trackingStateId: tracking.trackingStateId,
				status: imported.status,
				score: imported.score,
				statusWatchlistId: imported.statusWatchlistId,
				progressUnit: imported.progress[0]?.unit,
				progressCurrent: imported.progress[0]?.current,
				progressTotal: imported.progress[0]?.total,
				isPublic: false,
			},
		})
		const after = await memberMediaSnapshot(tx, input.ownerId, stored.mediaId)
		const journal: ImportJournal = {
			before,
			after,
			createdWatchlistId: destination.created ? destination.id : null,
		}
		await tx.libraryImportItem.update({
			where: { id: stored.id },
			data: {
				journal: JSON.stringify(journal),
				appliedAt: new Date(),
			},
		})
	}
	const appliedAt = new Date()
	await tx.libraryImportBatch.update({
		where: { id: batch.id },
		data: { status: 'applied', appliedAt },
	})
	return { appliedCount: selected.length, appliedAt }
}

async function renumberWatchlist(
	tx: Prisma.TransactionClient,
	watchlistId: string,
) {
	const rows = await tx.entry.findMany({
		where: { watchlistId },
		orderBy: [{ position: 'asc' }, { id: 'asc' }],
		select: { id: true, position: true },
	})
	for (const [index, row] of rows.entries()) {
		if (row.position !== index + 1) {
			await tx.entry.update({
				where: { id: row.id },
				data: { position: index + 1 },
			})
		}
	}
}

async function restoreSnapshot(
	tx: Prisma.TransactionClient,
	input: {
		ownerId: string
		mediaId: string
		before: MemberMediaSnapshot
	},
) {
	const currentEntries = await tx.entry.findMany({
		where: { mediaId: input.mediaId, watchlist: { ownerId: input.ownerId } },
		select: { id: true, watchlistId: true },
	})
	const beforeIds = new Set(input.before.entries.map(entry => entry.id))
	const touchedWatchlists = new Set(
		currentEntries.map(entry => entry.watchlistId),
	)
	for (const entry of input.before.entries)
		touchedWatchlists.add(entry.watchlistId)
	await tx.entry.deleteMany({
		where: {
			id: {
				in: currentEntries
					.filter(row => !beforeIds.has(row.id))
					.map(row => row.id),
			},
		},
	})
	for (const entry of input.before.entries) {
		await tx.entry.update({
			where: { id: entry.id },
			data: {
				watchlistId: entry.watchlistId,
				position: entry.position,
				trackingStateId: null,
				personal: entry.personal,
				history: entry.history,
			},
		})
	}
	if (!input.before.tracking) {
		await tx.trackingState.deleteMany({
			where: { ownerId: input.ownerId, mediaId: input.mediaId },
		})
		await tx.activityEvent.create({
			data: {
				type: 'import_rollback',
				actorId: input.ownerId,
				mediaId: input.mediaId,
				isPublic: false,
			},
		})
	} else {
		const tracking = input.before.tracking
		const restored = await tx.trackingState.upsert({
			where: {
				ownerId_mediaId: {
					ownerId: input.ownerId,
					mediaId: input.mediaId,
				},
			},
			update: {
				status: tracking.status,
				statusWatchlistId: tracking.statusWatchlistId,
				score: tracking.score,
				startedAt: tracking.startedAt ? new Date(tracking.startedAt) : null,
				completedAt: tracking.completedAt
					? new Date(tracking.completedAt)
					: null,
				repeatCount: tracking.repeatCount,
			},
			create: {
				id: tracking.id,
				ownerId: input.ownerId,
				mediaId: input.mediaId,
				status: tracking.status,
				statusWatchlistId: tracking.statusWatchlistId,
				score: tracking.score,
				startedAt: tracking.startedAt ? new Date(tracking.startedAt) : null,
				completedAt: tracking.completedAt
					? new Date(tracking.completedAt)
					: null,
				repeatCount: tracking.repeatCount,
			},
			select: { id: true },
		})
		await tx.trackingProgress.deleteMany({
			where: { trackingStateId: restored.id },
		})
		if (tracking.progress.length) {
			await tx.trackingProgress.createMany({
				data: tracking.progress.map(progress => ({
					trackingStateId: restored.id,
					...progress,
				})),
			})
		}
		for (const entry of input.before.entries) {
			await tx.entry.update({
				where: { id: entry.id },
				data: {
					trackingStateId:
						entry.trackingStateId === tracking.id ? restored.id : null,
				},
			})
		}
		await tx.activityEvent.create({
			data: {
				type: 'import_rollback',
				actorId: input.ownerId,
				mediaId: input.mediaId,
				trackingStateId: restored.id,
				status: tracking.status,
				statusWatchlistId: tracking.statusWatchlistId,
				isPublic: false,
			},
		})
	}
	for (const watchlistId of touchedWatchlists)
		await renumberWatchlist(tx, watchlistId)
}

export async function rollbackLibraryImportBatch(
	tx: Prisma.TransactionClient,
	input: { ownerId: string; batchId: string },
) {
	const claim = await tx.libraryImportBatch.updateMany({
		where: {
			id: input.batchId,
			ownerId: input.ownerId,
			status: 'applied',
		},
		data: { status: 'rolling_back' },
	})
	if (claim.count !== 1) {
		throw new LibraryImportError(
			'Only an applied import can be rolled back.',
			409,
		)
	}
	const batch = await tx.libraryImportBatch.findFirst({
		where: { id: input.batchId, ownerId: input.ownerId },
		include: {
			items: {
				where: { journal: { not: null } },
				orderBy: [{ appliedAt: 'desc' }, { id: 'desc' }],
			},
		},
	})
	if (!batch) throw new LibraryImportError('Import batch not found.', 404)
	if (batch.status !== 'rolling_back')
		throw new LibraryImportError('Rollback claim failed.', 409)
	const journals = batch.items.map(item => ({
		item,
		journal: parsedJson<ImportJournal | null>(item.journal ?? '', null),
	}))
	if (journals.some(value => !value.journal || !value.item.mediaId)) {
		throw new LibraryImportError('The rollback journal is incomplete.', 409)
	}
	// Validate the whole batch first so rollback never partially overwrites newer
	// member changes.
	for (const { item, journal } of journals) {
		const current = await memberMediaSnapshot(tx, input.ownerId, item.mediaId!)
		if (stableSnapshot(current) !== stableSnapshot(journal!.after)) {
			throw new LibraryImportError(
				'This import cannot be rolled back because one or more items were edited afterward.',
				409,
			)
		}
	}
	const createdWatchlistIds = new Set<string>()
	for (const { item, journal } of journals) {
		if (journal!.createdWatchlistId)
			createdWatchlistIds.add(journal!.createdWatchlistId)
		await restoreSnapshot(tx, {
			ownerId: input.ownerId,
			mediaId: item.mediaId!,
			before: journal!.before,
		})
	}
	for (const id of createdWatchlistIds) {
		await tx.watchlist.deleteMany({
			where: { id, ownerId: input.ownerId, entries: { none: {} } },
		})
	}
	const rolledBackAt = new Date()
	await tx.libraryImportBatch.update({
		where: { id: batch.id },
		data: { status: 'rolled_back', rolledBackAt },
	})
	return { rolledBackCount: journals.length, rolledBackAt }
}
