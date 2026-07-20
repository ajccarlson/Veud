import { type Prisma } from '@prisma/client'

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
	const events: Prisma.ActivityEventUncheckedCreateInput[] = []
	const watchlistIds = [
		input.before?.statusWatchlistId,
		input.after.statusWatchlistId,
	].filter((id): id is string => Boolean(id))
	const watchlists = watchlistIds.length
		? await tx.watchlist.findMany({
				where: { id: { in: watchlistIds } },
				select: { id: true, header: true, isPublic: true },
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
	const currentIsPublic = currentWatchlist?.isPublic ?? true
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
				? currentWatchlist?.header
				: null,
			statusWatchlistId: input.after.statusWatchlistId,
			previousStatus: input.before?.status ?? null,
			previousStatusLabel: input.before?.statusWatchlistId
				? previousWatchlist?.header
				: null,
			previousStatusWatchlistId:
				input.before?.statusWatchlistId ?? null,
			isPublic: currentIsPublic && (previousWatchlist?.isPublic ?? true),
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
			statusWatchlistId: input.after.statusWatchlistId,
			isPublic: currentIsPublic,
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
			statusWatchlistId: input.after.statusWatchlistId,
			isPublic: currentIsPublic,
		})
	}

	for (const event of events) {
		await tx.activityEvent.create({ data: event })
	}
	return events.length
}
