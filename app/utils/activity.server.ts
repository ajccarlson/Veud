import { type Prisma } from '@prisma/client'
import { serializeUserLibraryMutation } from './watchlist-limits.ts'

export const trackingActivityStateSelect = {
	id: true,
	status: true,
	statusWatchlistId: true,
	score: true,
	progress: {
		select: { unit: true, current: true, total: true },
	},
} satisfies Prisma.TrackingStateSelect

export type TrackingActivityState = Prisma.TrackingStateGetPayload<{
	select: typeof trackingActivityStateSelect
}>

export async function getTrackingActivityState(
	tx: Prisma.TransactionClient,
	ownerId: string,
	mediaId: string,
) {
	return tx.trackingState.findUnique({
		where: { ownerId_mediaId: { ownerId, mediaId } },
		select: trackingActivityStateSelect,
	})
}

function numberValue(value: Prisma.Decimal | number | null | undefined) {
	if (value === null || value === undefined) return null
	const number = Number(value)
	return Number.isFinite(number) ? number : null
}

export async function recordTrackingActivityDiff(
	tx: Prisma.TransactionClient,
	input: {
		actorId: string
		mediaId: string
		before: TrackingActivityState | null
		after: TrackingActivityState
	},
) {
	await serializeUserLibraryMutation(tx, input.actorId)
	const events: Prisma.ActivityEventUncheckedCreateInput[] = []
	const watchlistIds = [
		input.before?.statusWatchlistId,
		input.after.statusWatchlistId,
	]
		.filter((id): id is string => Boolean(id))
		.filter((id, index, ids) => ids.indexOf(id) === index)
		.sort()
	const watchlists = watchlistIds.length
		? await tx.watchlist.findMany({
				where: { id: { in: watchlistIds } },
				select: { id: true, ownerId: true, header: true, isPublic: true },
			})
		: []
	const watchlistById = new Map(
		watchlists.map(watchlist => [watchlist.id, watchlist]),
	)
	const currentWatchlist = input.after.statusWatchlistId
		? watchlistById.get(input.after.statusWatchlistId)
		: null
	const previousWatchlist = input.before?.statusWatchlistId
		? watchlistById.get(input.before.statusWatchlistId)
		: null
	const currentVisibility = input.after.statusWatchlistId
		? {
				verified: currentWatchlist?.ownerId === input.actorId,
				isPublic:
					currentWatchlist?.ownerId === input.actorId &&
					currentWatchlist.isPublic,
			}
		: { verified: true, isPublic: true }
	const previousVisibility = input.before?.statusWatchlistId
		? {
				verified: previousWatchlist?.ownerId === input.actorId,
				isPublic:
					previousWatchlist?.ownerId === input.actorId &&
					previousWatchlist.isPublic,
			}
		: { verified: true, isPublic: true }
	const statusChanged =
		!input.before ||
		input.before.status !== input.after.status ||
		input.before.statusWatchlistId !== input.after.statusWatchlistId

	if (statusChanged) {
		events.push({
			type: 'status',
			actorId: input.actorId,
			mediaId: input.mediaId,
			trackingStateId: input.after.id,
			status: input.after.status,
			statusLabel: input.after.statusWatchlistId
				? currentVisibility.verified
					? currentWatchlist?.header
					: null
				: null,
			statusWatchlistId: input.after.statusWatchlistId,
			previousStatus: input.before?.status ?? null,
			previousStatusLabel: input.before?.statusWatchlistId
				? previousVisibility.verified
					? previousWatchlist?.header
					: null
				: null,
			previousStatusWatchlistId: input.before?.statusWatchlistId ?? null,
			isPublic: currentVisibility.isPublic && previousVisibility.isPublic,
			publicEligible: currentVisibility.isPublic && previousVisibility.isPublic,
		})
	}

	const beforeScore = numberValue(input.before?.score)
	const afterScore = numberValue(input.after.score)
	if (beforeScore !== afterScore) {
		events.push({
			type: 'score',
			actorId: input.actorId,
			mediaId: input.mediaId,
			trackingStateId: input.after.id,
			score: afterScore,
			previousScore: beforeScore,
			statusLabel: input.after.statusWatchlistId
				? currentVisibility.verified
					? currentWatchlist?.header
					: null
				: null,
			statusWatchlistId: input.after.statusWatchlistId,
			isPublic: currentVisibility.isPublic,
			publicEligible: currentVisibility.isPublic,
		})
	}

	const beforeProgress = new Map(
		(input.before?.progress ?? []).map(progress => [progress.unit, progress]),
	)
	const afterProgress = new Map(
		input.after.progress.map(progress => [progress.unit, progress]),
	)
	const units = new Set([...beforeProgress.keys(), ...afterProgress.keys()])
	for (const unit of [...units].sort()) {
		const before = beforeProgress.get(unit)
		const after = afterProgress.get(unit)
		const previous = before?.current ?? 0
		const current = after?.current ?? 0
		if (previous === current) continue
		events.push({
			type: 'progress',
			actorId: input.actorId,
			mediaId: input.mediaId,
			trackingStateId: input.after.id,
			progressUnit: unit,
			progressCurrent: current,
			progressPrevious: previous,
			progressTotal: after?.total ?? before?.total ?? null,
			statusLabel: input.after.statusWatchlistId
				? currentVisibility.verified
					? currentWatchlist?.header
					: null
				: null,
			statusWatchlistId: input.after.statusWatchlistId,
			isPublic: currentVisibility.isPublic,
			publicEligible: currentVisibility.isPublic,
		})
	}

	for (const event of events) {
		await tx.activityEvent.create({ data: event })
	}
	return events.length
}
