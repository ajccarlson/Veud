import { type ListType, type UserFavorite, type Watchlist } from '@prisma/client'
import { type ProfileTrackingSummary } from './profile-tracking.ts'

export const PROFILE_COMMENT_MAX_LENGTH = 1000
export const PROFILE_BIO_MAX_LENGTH = 5000

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

/** The watchlist (status list) metadata the profile reads for status breakdowns. */
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

/** A user's public profile header data. */
export type ProfileUser = {
	id: string
	name: string | null
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
		name: string | null
		username: string
		image: { id: string } | null
	}
}

/**
 * The full loader payload the profile container passes down to its sections.
 *
 * `typedEntries` holds the raw per-type entries with their `history` parsed from
 * JSON into dynamic, per-media-type shapes. Its legacy chart consumers still
 * read dynamic columns, so the payload remains loose here; parsing and activity
 * construction are typed and tested in `profile-history.ts`.
 */
export type ProfileData = {
	user: ProfileUser
	userJoinedDisplay: string
	lastActiveDisplay: string | null
	listTypes: ListTypeMeta[]
	watchLists: WatchlistMeta[]
	typedWatchlists: Record<string, WatchlistMeta[]>
	typedEntries: Record<string, any[]>
	typedHistory: Record<string, ActivityItem[]>
	activityEvents: ProfileActivityEvent[]
	activityStartedAt: Date | string | null
	trackingSummaries: Record<string, ProfileTrackingSummary>
	favorites: FavoriteItem[]
	followerCount: number
	followingCount: number
	isFollowing: boolean
}
