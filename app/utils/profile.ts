import { type ListType, type UserFavorite } from '@prisma/client'

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
	'id' | 'position' | 'thumbnail' | 'title' | 'typeId' | 'mediaType' | 'startYear'
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

/** A user's public profile header data. */
export type ProfileUser = {
	id: string
	name: string | null
	username: string
	createdAt: Date | string
	image: { id: string } | null
}

/**
 * The full loader payload the profile container passes down to its sections.
 *
 * `typedEntries` holds the raw per-type entries with their `history` parsed from
 * JSON into dynamic, per-media-type shapes. It is intentionally left loose
 * (`any[]`) until Phase 4 lifts the history computation out of the loader into a
 * typed helper; the getters that read it (`getStartYear`, `getThumbnailInfo`)
 * only touch a handful of string columns.
 */
export type ProfileData = {
	user: ProfileUser
	userJoinedDisplay: string
	listTypes: ListTypeMeta[]
	watchLists: unknown[]
	typedWatchlists: Record<string, unknown[]>
	typedEntries: Record<string, any[]>
	typedHistory: Record<string, ActivityItem[]>
	favorites: FavoriteItem[]
}
