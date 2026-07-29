import { type Prisma } from '@prisma/client'
import {
	getTrackingActivityState,
	recordTrackingActivityDiff,
} from './activity.server.ts'
import { claimWatchlistRevisions } from './lists/watchlist-revision.server.ts'
import {
	legacyProgressUpdate,
	progressUnitsForMediaKind,
	type SupportedProgressUnit,
} from './media-detail.ts'
import { serializeUserLibraryMutation } from './watchlist-limits.ts'

function catalogTotal(
	media: {
		episodeCount: number | null
		chapterCount: number | null
		volumeCount: number | null
	},
	unit: SupportedProgressUnit,
) {
	if (unit === 'episode') return media.episodeCount
	if (unit === 'chapter') return media.chapterCount
	return media.volumeCount
}

export async function recordInstallmentConsumption(
	tx: Prisma.TransactionClient,
	input: {
		ownerId: string
		mediaId: string
		unit: SupportedProgressUnit
		number: number
		seasonNumber?: number
		absoluteNumber?: number | null
		consumedAt?: Date
		source?: string
	},
) {
	await serializeUserLibraryMutation(tx, input.ownerId)
	const before = await getTrackingActivityState(
		tx,
		input.ownerId,
		input.mediaId,
	)
	const state = await tx.trackingState.findUnique({
		where: {
			ownerId_mediaId: {
				ownerId: input.ownerId,
				mediaId: input.mediaId,
			},
		},
		include: {
			media: {
				select: {
					kind: true,
					episodeCount: true,
					chapterCount: true,
					volumeCount: true,
				},
			},
			progress: true,
			entries: {
				orderBy: [{ position: 'asc' }, { id: 'asc' }],
				include: {
					watchlist: {
						select: { id: true, mutationVersion: true },
					},
				},
			},
		},
	})
	if (!state) {
		throw new Response('Track this title before recording progress', {
			status: 409,
		})
	}
	if (!progressUnitsForMediaKind(state.media.kind).includes(input.unit)) {
		throw new Response('Progress unit does not match this media', {
			status: 400,
		})
	}

	const seasonNumber = input.seasonNumber ?? 0
	const progressPosition = input.absoluteNumber ?? input.number
	const total = catalogTotal(state.media, input.unit)
	if (total !== null && progressPosition > total) {
		throw new Response('Progress cannot exceed the known total', {
			status: 400,
		})
	}

	const installment = await tx.mediaInstallment.upsert({
		where: {
			mediaId_kind_seasonNumber_number: {
				mediaId: input.mediaId,
				kind: input.unit,
				seasonNumber,
				number: input.number,
			},
		},
		update: {
			...(input.absoluteNumber ? { absoluteNumber: input.absoluteNumber } : {}),
		},
		create: {
			mediaId: input.mediaId,
			kind: input.unit,
			seasonNumber,
			number: input.number,
			absoluteNumber: input.absoluteNumber ?? null,
		},
	})
	const repeatNumber = await tx.consumptionEvent.count({
		where: {
			ownerId: input.ownerId,
			installmentId: installment.id,
			eventType: { in: ['installment', 'repeat'] },
		},
	})
	const savedProgress = state.progress.find(item => item.unit === input.unit)
	const previousCurrent = savedProgress?.current ?? 0
	const nextCurrent = Math.max(previousCurrent, progressPosition)

	await tx.trackingProgress.upsert({
		where: {
			trackingStateId_unit: {
				trackingStateId: state.id,
				unit: input.unit,
			},
		},
		update: { current: nextCurrent, total },
		create: {
			trackingStateId: state.id,
			unit: input.unit,
			current: nextCurrent,
			total,
		},
	})
	await tx.trackingState.update({
		where: { id: state.id },
		data: { repeatCount: state.repeatCount },
	})
	await tx.consumptionEvent.create({
		data: {
			ownerId: input.ownerId,
			mediaId: input.mediaId,
			trackingStateId: state.id,
			installmentId: installment.id,
			unit: input.unit,
			eventType: repeatNumber > 0 ? 'repeat' : 'installment',
			progressFrom: previousCurrent,
			progressTo: nextCurrent,
			repeatNumber,
			source: input.source ?? 'manual',
			consumedAt: input.consumedAt ?? new Date(),
		},
	})

	const entry =
		state.entries.find(
			candidate => candidate.watchlistId === state.statusWatchlistId,
		) ?? state.entries[0]
	if (entry) {
		await tx.entry.update({
			where: { id: entry.id },
			data: legacyProgressUpdate(entry, {
				unit: input.unit,
				current: nextCurrent,
				previousCurrent,
				total,
				now: (input.consumedAt ?? new Date()).getTime(),
			}),
		})
		await claimWatchlistRevisions(tx, [entry.watchlist])
	}

	const after = await getTrackingActivityState(tx, input.ownerId, input.mediaId)
	if (!after) throw new Error('Tracking state disappeared during check-in')
	await recordTrackingActivityDiff(tx, {
		actorId: input.ownerId,
		mediaId: input.mediaId,
		before,
		after,
	})

	return {
		installment,
		progress: after.progress.find(progress => progress.unit === input.unit),
		repeatNumber,
	}
}
