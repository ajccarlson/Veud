import { type Prisma } from '@prisma/client'

export type WatchlistRevision = {
	id: string
	mutationVersion: number
}

/**
 * Claim the watchlist revisions at the end of a transaction. If another
 * request committed against the same list after these revisions were read,
 * the stale transaction throws and Prisma rolls all of its entry writes back.
 */
export async function claimWatchlistRevisions(
	tx: Prisma.TransactionClient,
	revisions: WatchlistRevision[],
) {
	const unique = new Map(
		revisions.map(revision => [revision.id, revision.mutationVersion]),
	)
	const updatedAt = new Date()
	for (const [id, mutationVersion] of unique) {
		const claim = await tx.watchlist.updateMany({
			where: { id, mutationVersion },
			data: {
				mutationVersion: { increment: 1 },
				updatedAt,
			},
		})
		if (claim.count !== 1) {
			throw new Response(
				'This list changed in another request. Refresh and try again.',
				{ status: 409 },
			)
		}
	}
}
