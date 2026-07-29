import { type Prisma } from '@prisma/client'

export const publicWatchlistWhere = {
	isPublic: true,
} satisfies Prisma.WatchlistWhereInput

export function visibleWatchlistWhere(viewerId: string | null) {
	return viewerId
		? ({
				OR: [{ isPublic: true }, { ownerId: viewerId }],
			} satisfies Prisma.WatchlistWhereInput)
		: publicWatchlistWhere
}

/** Tracking without a status list remains public; a private status list does not. */
export const publicTrackingStateWhere = {
	OR: [{ statusWatchlistId: null }, { statusWatchlist: { isPublic: true } }],
} satisfies Prisma.TrackingStateWhereInput

export function visibleTrackingStateWhere(viewerId: string | null) {
	return viewerId
		? ({
				OR: [
					{ ownerId: viewerId },
					{ statusWatchlistId: null },
					{ statusWatchlist: { isPublic: true } },
				],
			} satisfies Prisma.TrackingStateWhereInput)
		: publicTrackingStateWhere
}

export function visibleActivityEventWhere(viewerId: string | null) {
	return viewerId
		? ({
				OR: [{ isPublic: true }, { actorId: viewerId }],
			} satisfies Prisma.ActivityEventWhereInput)
		: ({ isPublic: true } satisfies Prisma.ActivityEventWhereInput)
}
