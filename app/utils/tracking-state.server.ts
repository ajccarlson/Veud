import { type Prisma } from '@prisma/client'
import {
	getTrackingActivityState,
	recordTrackingActivityDiff,
} from './activity.server.ts'
import {
	trackingStateFromEntry,
	type TrackingEntryLike,
} from './tracking-state.ts'

export type TrackingStateWriteMode = 'none' | 'status' | 'all'

export async function ensureTrackingStateForEntry(
	tx: Prisma.TransactionClient,
	input: {
		ownerId: string
		mediaId: string
		mediaKind: string
		status: string
		statusWatchlistId?: string | null
		entry: TrackingEntryLike
		mode?: TrackingStateWriteMode
		recordActivity?: boolean
	},
) {
	const before = input.recordActivity
		? await getTrackingActivityState(tx, input.ownerId, input.mediaId)
		: null
	const mode = input.mode ?? 'status'
	const snapshot = trackingStateFromEntry(input.entry, {
		status: input.status,
		statusWatchlistId: input.statusWatchlistId,
		mediaKind: input.mediaKind,
	})
	const scalarState = {
		status: snapshot.status,
		statusWatchlistId: snapshot.statusWatchlistId,
		score: snapshot.score,
		startedAt: snapshot.startedAt,
		completedAt: snapshot.completedAt,
		repeatCount: snapshot.repeatCount,
	}
	const update =
		mode === 'none'
			? {}
			: mode === 'status'
				? {
						status: snapshot.status,
						statusWatchlistId: snapshot.statusWatchlistId,
					}
				: scalarState

	const state = await tx.trackingState.upsert({
		where: {
			ownerId_mediaId: {
				ownerId: input.ownerId,
				mediaId: input.mediaId,
			},
		},
		update,
		create: {
			...scalarState,
			ownerId: input.ownerId,
			mediaId: input.mediaId,
			progress: {
				create: snapshot.progress.map(progress => ({
					unit: progress.unit,
					current: progress.current,
					total: progress.total,
				})),
			},
		},
		select: { id: true },
	})

	if (mode === 'all') {
		const units = snapshot.progress.map(progress => progress.unit)
		await tx.trackingProgress.deleteMany({
			where: {
				trackingStateId: state.id,
				...(units.length ? { unit: { notIn: units } } : {}),
			},
		})
		for (const progress of snapshot.progress) {
			await tx.trackingProgress.upsert({
				where: {
					trackingStateId_unit: {
						trackingStateId: state.id,
						unit: progress.unit,
					},
				},
				update: {
					current: progress.current,
					total: progress.total,
				},
				create: {
					trackingStateId: state.id,
					unit: progress.unit,
					current: progress.current,
					total: progress.total,
				},
			})
		}
	}

	if (input.recordActivity) {
		const after = await getTrackingActivityState(
			tx,
			input.ownerId,
			input.mediaId,
		)
		if (!after) throw new Error('Tracking state was not available after sync')
		await recordTrackingActivityDiff(tx, {
			actorId: input.ownerId,
			mediaId: input.mediaId,
			before,
			after,
		})
	}

	return state.id
}

export async function syncTrackingStateForEntry(
	tx: Prisma.TransactionClient,
	entryId: string,
) {
	const entry = await tx.entry.findUnique({
		where: { id: entryId },
		include: {
			watchlist: { select: { id: true, name: true, ownerId: true } },
			media: { select: { kind: true } },
		},
	})
	if (!entry?.mediaId || !entry.media) return null

	const trackingStateId = await ensureTrackingStateForEntry(tx, {
		ownerId: entry.watchlist.ownerId,
		mediaId: entry.mediaId,
		mediaKind: entry.media.kind,
		status: entry.watchlist.name,
		statusWatchlistId: entry.watchlist.id,
		entry,
		mode: 'all',
		recordActivity: true,
	})
	if (entry.trackingStateId !== trackingStateId) {
		await tx.entry.update({
			where: { id: entry.id },
			data: { trackingStateId },
		})
	}
	return trackingStateId
}

export async function deleteTrackingStateIfOrphan(
	tx: Prisma.TransactionClient,
	trackingStateId: string | null | undefined,
) {
	if (!trackingStateId) return
	await tx.trackingState.deleteMany({
		where: {
			id: trackingStateId,
			entries: { none: {} },
		},
	})
}
