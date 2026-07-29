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

/**
 * Public activity must have immutable public-list provenance and must have
 * been safe to disclose when created. Historical or private-created rows stay
 * owner-only even if a related list is later made public.
 */
export const publicActivityEventWhere = {
	isPublic: true,
	publicEligible: true,
	AND: [
		{
			OR: [
				{ statusWatchlist: { isPublic: true } },
				{ statusWatchlistId: null, statusLabel: null },
			],
		},
		{
			OR: [
				{ previousStatusWatchlist: { isPublic: true } },
				{ previousStatusWatchlistId: null, previousStatusLabel: null },
			],
		},
	],
} satisfies Prisma.ActivityEventWhereInput

export function visibleActivityEventWhere(viewerId: string | null) {
	return viewerId
		? ({
				OR: [publicActivityEventWhere, { actorId: viewerId }],
			} satisfies Prisma.ActivityEventWhereInput)
		: publicActivityEventWhere
}
