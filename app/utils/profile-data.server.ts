import { invariantResponse } from '@epic-web/invariant'
import { type Prisma } from '@prisma/client'
import {
	activityEventLabel,
	activityListTypeName,
	diaryActivityLabel,
} from '#app/utils/activity.ts'
import { getUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import {
	visibleActivityEventWhere,
	visibleWatchlistWhere,
} from '#app/utils/lists/visibility.server.ts'
import { buildProfileHistory } from '#app/utils/profile-history.ts'
import { buildProfileTrackingSummaries } from '#app/utils/profile-tracking.ts'
import { type Timings, time } from '#app/utils/timing.server.ts'

const LEGACY_ACTIVITY_GRACE_MS = 60_000

const listTypeSelect = {
	id: true,
	name: true,
	header: true,
	columns: true,
	mediaType: true,
	completionType: true,
} satisfies Prisma.ListTypeSelect

const watchlistSelect = {
	id: true,
	name: true,
	header: true,
	typeId: true,
	position: true,
} satisfies Prisma.WatchlistSelect

const analyticsEntrySelect = {
	id: true,
	watchlistId: true,
	mediaId: true,
	type: true,
	releaseStart: true,
	history: true,
	genres: true,
	story: true,
	character: true,
	presentation: true,
	sound: true,
	performance: true,
	enjoyment: true,
	averaged: true,
	personal: true,
	airYear: true,
	startSeason: true,
	startYear: true,
	length: true,
	chapters: true,
	volumes: true,
	tmdbScore: true,
	malScore: true,
	media: { select: { kind: true } },
	trackingState: {
		select: {
			id: true,
			status: true,
			statusWatchlistId: true,
			score: true,
			repeatCount: true,
			progress: { select: { unit: true, current: true } },
		},
	},
} satisfies Prisma.EntrySelect

const activityEventSelect = {
	id: true,
	type: true,
	status: true,
	statusLabel: true,
	previousStatus: true,
	previousStatusLabel: true,
	score: true,
	previousScore: true,
	progressUnit: true,
	progressCurrent: true,
	progressPrevious: true,
	progressTotal: true,
	createdAt: true,
	media: {
		select: { id: true, kind: true, title: true, thumbnail: true },
	},
} satisfies Prisma.ActivityEventSelect

async function requireProfileUser(username: string | undefined) {
	const user = await prisma.user.findUnique({
		where: { username },
		select: { id: true },
	})
	invariantResponse(user, 'User not found', { status: 404 })
	return user
}

function mediaItem(media: {
	id: string
	kind: string
	title: string | null
	thumbnail: string | null
}) {
	return {
		id: media.id,
		kind: media.kind,
		title: media.title?.trim() || `Untitled ${media.kind}`,
		thumbnail: media.thumbnail,
	}
}

function typeIdForKind(
	kind: string,
	listTypeIdByName: ReadonlyMap<string, string>,
) {
	const listTypeName = activityListTypeName(kind)
	return listTypeName ? (listTypeIdByName.get(listTypeName) ?? null) : null
}

export async function loadProfileShell(
	request: Request,
	username: string | undefined,
	timings?: Timings,
) {
	const [viewerId, user] = await time(
		Promise.all([
			getUserId(request),
			prisma.user.findUnique({
				where: { username },
				select: {
					id: true,
					name: true,
					username: true,
					bio: true,
					createdAt: true,
					lastActiveAt: true,
					image: { select: { id: true } },
					banner: { select: { id: true } },
					_count: { select: { followers: true, following: true } },
				},
			}),
		]),
		{ type: 'profile_db', desc: 'viewer and profile identity', timings },
	)

	invariantResponse(user, 'User not found', { status: 404 })

	const [isFollowing, listTypes, watchLists] = await time(
		Promise.all([
			viewerId && viewerId !== user.id
				? prisma.follow
						.findUnique({
							where: {
								followerId_followingId: {
									followerId: viewerId,
									followingId: user.id,
								},
							},
							select: { followerId: true },
						})
						.then(Boolean)
				: false,
			prisma.listType.findMany({ select: listTypeSelect }),
			prisma.watchlist.findMany({
				where: {
					ownerId: user.id,
					AND: [visibleWatchlistWhere(viewerId)],
				},
				orderBy: [{ typeId: 'asc' }, { position: 'asc' }, { id: 'asc' }],
				select: watchlistSelect,
			}),
		]),
		{ type: 'profile_db', desc: 'profile shell relations', timings },
	)

	return {
		user: {
			id: user.id,
			name: user.name,
			username: user.username,
			bio: user.bio,
			createdAt: user.createdAt,
			image: user.image,
			banner: user.banner,
		},
		userJoinedDisplay: user.createdAt.toLocaleDateString('en-US', {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
		}),
		lastActiveAt: user.lastActiveAt,
		listTypes,
		watchLists,
		followerCount: user._count.followers,
		followingCount: user._count.following,
		isFollowing,
	}
}

export async function loadProfileAnalytics(
	request: Request,
	username: string | undefined,
	timings?: Timings,
) {
	const [viewerId, user] = await time(
		Promise.all([getUserId(request), requireProfileUser(username)]),
		{ type: 'profile_db', desc: 'analytics visibility scope', timings },
	)

	const [listTypes, watchLists, entries] = await time(
		Promise.all([
			prisma.listType.findMany({ select: listTypeSelect }),
			prisma.watchlist.findMany({
				where: {
					ownerId: user.id,
					AND: [visibleWatchlistWhere(viewerId)],
				},
				orderBy: [{ typeId: 'asc' }, { position: 'asc' }, { id: 'asc' }],
				select: watchlistSelect,
			}),
			prisma.entry.findMany({
				where: {
					watchlist: {
						ownerId: user.id,
						AND: [visibleWatchlistWhere(viewerId)],
					},
				},
				select: analyticsEntrySelect,
			}),
		]),
		{ type: 'profile_db', desc: 'visible profile analytics rows', timings },
	)

	return time(
		() => {
			// Prisma Decimal instances render numerically on the server but do not
			// hydrate as equivalent browser values. Normalize the analytics boundary
			// so chart calculations are deterministic on both sides.
			const normalizedEntries = entries.map(entry => ({
				...entry,
				averaged: entry.averaged === null ? null : Number(entry.averaged),
				personal: entry.personal === null ? null : Number(entry.personal),
				tmdbScore: entry.tmdbScore === null ? null : Number(entry.tmdbScore),
				malScore: entry.malScore === null ? null : Number(entry.malScore),
				trackingState: entry.trackingState
					? {
							...entry.trackingState,
							score:
								entry.trackingState.score === null
									? null
									: Number(entry.trackingState.score),
						}
					: null,
			}))
			const trackingSummaries = buildProfileTrackingSummaries({
				listTypes,
				watchlists: watchLists,
				entries: normalizedEntries,
			})
			const historyEntries = normalizedEntries.map(
				({ media: _media, trackingState: _trackingState, ...entry }) => entry,
			)
			const { typedEntries } = buildProfileHistory({
				listTypes,
				watchlists: watchLists,
				entries: historyEntries,
			})

			return { typedEntries, trackingSummaries }
		},
		{ type: 'profile_compute', desc: 'analytics aggregation', timings },
	)
}

export async function loadProfileActivity(
	request: Request,
	username: string | undefined,
	timings?: Timings,
) {
	const [viewerId, user] = await time(
		Promise.all([getUserId(request), requireProfileUser(username)]),
		{ type: 'profile_db', desc: 'activity visibility scope', timings },
	)

	const [
		listTypes,
		watchLists,
		activityRows,
		firstActivity,
		reviewRows,
		diaryRows,
		legacyEntries,
	] = await time(
		Promise.all([
			prisma.listType.findMany({ select: listTypeSelect }),
			prisma.watchlist.findMany({
				where: {
					ownerId: user.id,
					AND: [visibleWatchlistWhere(viewerId)],
				},
				select: watchlistSelect,
			}),
			prisma.activityEvent.findMany({
				where: {
					actorId: user.id,
					AND: [visibleActivityEventWhere(viewerId)],
				},
				orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
				take: 100,
				select: activityEventSelect,
			}),
			prisma.activityEvent.findFirst({
				where: {
					actorId: user.id,
					AND: [visibleActivityEventWhere(viewerId)],
				},
				orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
				select: { createdAt: true },
			}),
			prisma.review.findMany({
				where: { authorId: user.id },
				orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
				take: 100,
				select: {
					id: true,
					createdAt: true,
					media: {
						select: { id: true, kind: true, title: true, thumbnail: true },
					},
				},
			}),
			prisma.diaryEntry.findMany({
				where: { ownerId: user.id },
				orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
				take: 100,
				select: {
					id: true,
					isRepeat: true,
					createdAt: true,
					media: {
						select: { id: true, kind: true, title: true, thumbnail: true },
					},
				},
			}),
			prisma.entry.findMany({
				where: {
					watchlist: {
						ownerId: user.id,
						AND: [visibleWatchlistWhere(viewerId)],
					},
				},
				select: {
					id: true,
					watchlistId: true,
					mediaId: true,
					title: true,
					thumbnail: true,
					history: true,
				},
			}),
		]),
		{ type: 'profile_db', desc: 'bounded activity and legacy rows', timings },
	)

	return time(
		() => {
			const listTypeIdByName = new Map(
				listTypes.map(listType => [listType.name, listType.id]),
			)
			const trackingActivity = activityRows.map(event => ({
				id: `tracking:${event.id}`,
				action: activityEventLabel(event),
				time: event.createdAt,
				typeId: typeIdForKind(event.media.kind, listTypeIdByName),
				media: mediaItem(event.media),
			}))
			const normalizedActivity = [
				...trackingActivity,
				...reviewRows.map(review => ({
					id: `review:${review.id}`,
					action: 'Published a review',
					time: review.createdAt,
					typeId: typeIdForKind(review.media.kind, listTypeIdByName),
					media: mediaItem(review.media),
				})),
				...diaryRows.map(entry => ({
					id: `diary:${entry.id}`,
					action: diaryActivityLabel(entry.media.kind, entry.isRepeat),
					time: entry.createdAt,
					typeId: typeIdForKind(entry.media.kind, listTypeIdByName),
					media: mediaItem(entry.media),
				})),
			]
			const { typedEntries, typedHistory } = buildProfileHistory({
				listTypes,
				watchlists: watchLists,
				entries: legacyEntries,
			})
			const normalizedCutoff = firstActivity?.createdAt.getTime() ?? null
			const legacyActivity = Object.entries(typedHistory)
				.flatMap(([typeId, items]) =>
					items.flatMap((item, legacyIndex) => {
						const entry = typedEntries[typeId]?.[item.index]
						if (!entry) return []
						return {
							id: `legacy:${typeId}:${entry.id}:${legacyIndex}`,
							action: item.type,
							time: item.time,
							typeId,
							media: {
								id: entry.mediaId ?? '',
								title: entry.title.trim() || 'Untitled',
								thumbnail: entry.thumbnail,
							},
						}
					}),
				)
				.filter(
					item =>
						normalizedCutoff === null ||
						item.time.getTime() < normalizedCutoff - LEGACY_ACTIVITY_GRACE_MS,
				)
			const activityEvents = [...normalizedActivity, ...legacyActivity]
				.sort(
					(a, b) =>
						b.time.getTime() - a.time.getTime() || b.id.localeCompare(a.id),
				)
				.slice(0, 100)

			return { activityEvents }
		},
		{ type: 'profile_compute', desc: 'activity aggregation', timings },
	)
}

export async function loadProfileReviews(
	username: string | undefined,
	timings?: Timings,
) {
	const user = await time(requireProfileUser(username), {
		type: 'profile_db',
		desc: 'review profile identity',
		timings,
	})
	const [listTypes, reviewRows] = await time(
		Promise.all([
			prisma.listType.findMany({ select: { id: true, name: true } }),
			prisma.review.findMany({
				where: { authorId: user.id },
				orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
				take: 100,
				select: {
					id: true,
					body: true,
					containsSpoilers: true,
					rating: true,
					createdAt: true,
					updatedAt: true,
					media: {
						select: { id: true, kind: true, title: true, thumbnail: true },
					},
				},
			}),
		]),
		{ type: 'profile_db', desc: 'bounded profile reviews', timings },
	)
	const listTypeIdByName = new Map(
		listTypes.map(listType => [listType.name, listType.id]),
	)
	return {
		reviews: reviewRows.map(review => ({
			...review,
			rating: review.rating === null ? null : Number(review.rating),
			typeId: typeIdForKind(review.media.kind, listTypeIdByName),
			media: mediaItem(review.media),
		})),
	}
}

export async function loadProfileDiary(
	username: string | undefined,
	timings?: Timings,
) {
	const user = await time(requireProfileUser(username), {
		type: 'profile_db',
		desc: 'diary profile identity',
		timings,
	})
	const [listTypes, diaryRows] = await time(
		Promise.all([
			prisma.listType.findMany({ select: { id: true, name: true } }),
			prisma.diaryEntry.findMany({
				where: { ownerId: user.id },
				orderBy: [{ loggedOn: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
				take: 100,
				select: {
					id: true,
					loggedOn: true,
					isRepeat: true,
					rating: true,
					createdAt: true,
					media: {
						select: { id: true, kind: true, title: true, thumbnail: true },
					},
				},
			}),
		]),
		{ type: 'profile_db', desc: 'bounded profile diary', timings },
	)
	const listTypeIdByName = new Map(
		listTypes.map(listType => [listType.name, listType.id]),
	)
	return {
		diaryEntries: diaryRows.map(entry => ({
			...entry,
			rating: entry.rating === null ? null : Number(entry.rating),
			typeId: typeIdForKind(entry.media.kind, listTypeIdByName),
			media: mediaItem(entry.media),
		})),
	}
}

export async function loadProfileFavorites(
	username: string | undefined,
	timings?: Timings,
) {
	const user = await time(requireProfileUser(username), {
		type: 'profile_db',
		desc: 'favorites profile identity',
		timings,
	})
	const favorites = await time(
		prisma.userFavorite.findMany({
			where: { ownerId: user.id },
			orderBy: [{ typeId: 'asc' }, { position: 'asc' }, { id: 'asc' }],
			select: {
				id: true,
				position: true,
				thumbnail: true,
				title: true,
				typeId: true,
				mediaType: true,
				startYear: true,
				mediaId: true,
			},
		}),
		{ type: 'profile_db', desc: 'profile favorites', timings },
	)
	return { favorites }
}
