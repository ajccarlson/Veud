import {
	type ListType,
	type UserFavorite,
	type Watchlist,
} from '@prisma/client'
import {
	type ProfileAnalyticsDiagnostic,
	type ProfileAnalyticsResult,
} from './profile-analytics.ts'
import { type CompletionHistory } from './profile-completion-history.ts'
import { type ProfileTrackingSummary } from './profile-tracking.ts'

export const PROFILE_COMMENT_MAX_LENGTH = 1000
export const PROFILE_BIO_MAX_LENGTH = 5000
export const PROFILE_STATUS_DISPLAY_LIMIT = 12

export function compactProfileStatuses(
	statuses: readonly { key: string; label: string; count: number }[],
) {
	const populated = statuses.filter(status => status.count > 0)
	if (populated.length <= PROFILE_STATUS_DISPLAY_LIMIT) return populated
	const ranked = populated
		.slice()
		.sort(
			(left, right) =>
				right.count - left.count || left.label.localeCompare(right.label),
		)
	return [
		...ranked.slice(0, PROFILE_STATUS_DISPLAY_LIMIT - 1),
		{
			key: '__other_statuses__',
			label: 'Other statuses',
			count: ranked
				.slice(PROFILE_STATUS_DISPLAY_LIMIT - 1)
				.reduce((sum, status) => sum + status.count, 0),
		},
	]
}

/**
 * Shared types for the profile page (`users+/$username`).
 *
 * These describe the payload the profile *components* consume after the loader
 * has run and the data has crossed the JSON boundary. Values produced as a
 * `Date` on the server arrive as strings on the client, so where a field is a
 * `Date` server-side but read client-side it is typed `Date | string`.
 */

/**
 * The list-type metadata the profile reads. `columns`, `mediaType`, and
 * `completionType` are JSON-encoded strings that are parsed at render time.
 */
export type ListTypeMeta = Pick<
	ListType,
	'id' | 'name' | 'header' | 'columns' | 'mediaType' | 'completionType'
>

/** A favorite as stored — a self-contained snapshot (no relation to `Entry`). */
export type FavoriteItem = Pick<
	UserFavorite,
	| 'id'
	| 'position'
	| 'thumbnail'
	| 'title'
	| 'typeId'
	| 'mediaType'
	| 'startYear'
	| 'mediaId'
>

/** The watchlist (status list) metadata used while building profile summaries. */
export type WatchlistMeta = Pick<
	Watchlist,
	'id' | 'name' | 'header' | 'typeId' | 'position'
>

/**
 * One computed activity row, built in the profile loader from an entry's parsed
 * `history`. `time` is a `Date` on the server and a string on the client.
 */
export type ActivityItem = {
	type: string
	time: Date | string
	index: number
}

/** A normalized append-only tracking event shown in public activity feeds. */
export type ProfileActivityEvent = {
	id: string
	action: string
	time: Date | string
	typeId: string | null
	media: {
		id: string
		title: string
		thumbnail: string | null
	}
}

export type ProfileReviewItem = {
	id: string
	body: string
	containsSpoilers: boolean
	rating: number | null
	createdAt: Date | string
	updatedAt: Date | string
	typeId: string | null
	media: {
		id: string
		kind: string
		title: string
		thumbnail: string | null
	}
}

export type ProfileDiaryItem = {
	id: string
	loggedOn: Date | string
	isRepeat: boolean
	rating: number | null
	createdAt: Date | string
	typeId: string | null
	media: {
		id: string
		kind: string
		title: string
		thumbnail: string | null
	}
}

/** A user's public profile header data. */
export type ProfileUser = {
	id: string
	username: string
	bio: string | null
	createdAt: Date | string
	image: { id: string } | null
	banner: { id: string } | null
}

/** A public guestbook entry shown on a user's Social tab. */
export type ProfileCommentItem = {
	id: string
	body: string
	createdAt: Date | string
	createdAtDisplay: string
	author: {
		id: string
		username: string
		image: { id: string } | null
	}
}

/** Stable identity and navigation data loaded once by the profile shell. */
export type ProfileShellData = {
	user: ProfileUser
	userJoinedDisplay: string
	lastActiveDisplay: string | null
	listTypes: ListTypeMeta[]
	followerCount: number
	followingCount: number
	isFollowing: boolean
	safetyState: {
		isMuted: boolean
		isBlocked: boolean
		isBlockedByTarget: boolean
	}
}

/** Compact Overview-only aggregates; no raw library rows cross this boundary. */
export type ProfileOverviewData = {
	trackingSummaries: Record<string, ProfileTrackingSummary>
	completionHistory: CompletionHistory
	diagnostic: ProfileAnalyticsDiagnostic
}

/** Compact Stats-only aggregates; all variable dimensions are server-bounded. */
export type ProfileStatsData = {
	trackingSummaries: Record<string, ProfileTrackingSummary>
} & Omit<ProfileAnalyticsResult, 'completionDays'>

/** Compatibility alias for components shared within the Stats route. */
export type ProfileAnalyticsData = ProfileStatsData

/** Bounded normalized activity with legacy history merged on the server. */
export type ProfileActivityData = Pick<ProfileShellData, 'listTypes'> & {
	activityEvents: ReadonlyArray<ProfileActivityEvent>
	activityLimited: boolean
}

export type ProfileReviewsData = Pick<
	ProfileShellData,
	'user' | 'listTypes'
> & {
	reviews: ProfileReviewItem[]
}

export type ProfileDiaryData = Pick<ProfileShellData, 'user' | 'listTypes'> & {
	diaryEntries: ProfileDiaryItem[]
}

export type ProfileFavoritesData = Pick<
	ProfileShellData,
	'user' | 'listTypes'
> & {
	favorites: FavoriteItem[]
	favoritesLimited: boolean
}

/** Compatibility shape for code that intentionally consumes every profile area. */
export type ProfileData = ProfileShellData &
	ProfileOverviewData &
	ProfileStatsData &
	ProfileActivityData &
	ProfileReviewsData &
	ProfileDiaryData &
	ProfileFavoritesData
