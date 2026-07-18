/**
 * Create an imported entry, its canonical provider identity, and the user's
 * normalized tracking state atomically.
 *
 * Importers run as plain Node scripts, so this small ESM helper mirrors the
 * application's TypeScript ensureMediaForIdentity function without coupling the
 * import command to the app build.
 */
export async function createEntryWithMediaIdentity(prisma, row, identity) {
	return prisma.$transaction(async tx => {
		const externalId = await tx.mediaExternalId.upsert({
			where: { provider_kind_externalId: identity },
			update: {},
			create: {
				...identity,
				media: { create: { kind: identity.kind } },
			},
			select: { mediaId: true },
		})
		const watchlist = await tx.watchlist.findUnique({
			where: { id: row.watchlistId },
			select: { id: true, name: true, ownerId: true },
		})
		if (!watchlist)
			throw new Error('Import destination watchlist was not found')

		let history = {}
		try {
			history = JSON.parse(row.history ?? '{}') ?? {}
		} catch {}
		const asDate = value => {
			if (!value) return null
			const date = new Date(value)
			return Number.isNaN(date.getTime()) ? null : date
		}
		const rawScore = Number(row.personal)
		const score = Number.isFinite(rawScore) && rawScore > 0 ? rawScore : null
		const trackingState = await tx.trackingState.upsert({
			where: {
				ownerId_mediaId: {
					ownerId: watchlist.ownerId,
					mediaId: externalId.mediaId,
				},
			},
			update: {
				status: watchlist.name,
				statusWatchlistId: watchlist.id,
			},
			create: {
				ownerId: watchlist.ownerId,
				mediaId: externalId.mediaId,
				status: watchlist.name,
				statusWatchlistId: watchlist.id,
				score,
				startedAt: asDate(history.started),
				completedAt: asDate(history.finished),
				repeatCount: 0,
			},
			select: { id: true },
		})

		return tx.entry.create({
			data: {
				...row,
				mediaId: externalId.mediaId,
				trackingStateId: trackingState.id,
			},
		})
	})
}
