import { type Prisma } from '@prisma/client'
import { serializeUserLibraryMutation } from '#app/utils/watchlist-limits.ts'

/**
 * Keep verified tracking activity aligned with a list's visibility. This
 * module deliberately has no request/session dependencies so imports,
 * background jobs, and database smoke checks can use it without application
 * credentials.
 */
export async function syncWatchlistActivityVisibility(
	tx: Prisma.TransactionClient,
	watchlist: { id: string; ownerId: string; header: string; isPublic: boolean },
	previousHeader?: string,
) {
	await serializeUserLibraryMutation(tx, watchlist.ownerId)
	const labels = [...new Set([watchlist.header, previousHeader])].filter(
		(label): label is string => Boolean(label),
	)
	const linkedToWatchlist = {
		OR: [
			{ statusWatchlistId: watchlist.id },
			{ previousStatusWatchlistId: watchlist.id },
		],
	} satisfies Prisma.ActivityEventWhereInput

	if (labels.length) {
		await tx.activityEvent.updateMany({
			where: {
				actorId: watchlist.ownerId,
				publicEligible: false,
				OR: labels.flatMap(label => [
					{ statusWatchlistId: null, statusLabel: label },
					{
						previousStatusWatchlistId: null,
						previousStatusLabel: label,
					},
				]),
			},
			data: { isPublic: false },
		})
	}

	if (!watchlist.isPublic) {
		await tx.activityEvent.updateMany({
			where: linkedToWatchlist,
			data: { isPublic: false },
		})
		return
	}

	// Recompute all linked rows fail-closed in two statements. Historical and
	// private-created rows remain private; eligible rows are public only when
	// both immutable list relations are currently public or genuinely absent.
	await tx.activityEvent.updateMany({
		where: linkedToWatchlist,
		data: { isPublic: false },
	})
	await tx.activityEvent.updateMany({
		where: {
			...linkedToWatchlist,
			publicEligible: true,
			AND: [
				{
					OR: [
						{ statusWatchlistId: null, statusLabel: null },
						{ statusWatchlist: { isPublic: true } },
					],
				},
				{
					OR: [
						{
							previousStatusWatchlistId: null,
							previousStatusLabel: null,
						},
						{ previousStatusWatchlist: { isPublic: true } },
					],
				},
			],
		},
		data: { isPublic: true },
	})
}
