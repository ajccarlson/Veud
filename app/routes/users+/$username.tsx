import { invariantResponse } from '@epic-web/invariant'
import {
	data as json,
	type LoaderFunctionArgs,
	type MetaFunction,
	Link,
	NavLink,
	Outlet,
	useLoaderData,
	useRevalidator,
} from 'react-router'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { Button } from '#app/components/ui/button.tsx'
import {
	activityEventLabel,
	activityListTypeName,
	diaryActivityLabel,
} from '#app/utils/activity.ts'
import { getUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { getLastActiveLabel } from '#app/utils/last-active.ts'
import { cn, getUserBannerSrc, getUserImgSrc } from '#app/utils/misc.tsx'
import { buildProfileHistory } from '#app/utils/profile-history.ts'
import { buildProfileTrackingSummaries } from '#app/utils/profile-tracking.ts'
import { useOptionalUser } from '#app/utils/user.ts'
import '#app/styles/user-landing.scss'

export async function loader(params: LoaderFunctionArgs) {
	const viewerId = await getUserId(params.request)
	const user = await prisma.user.findFirst({
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
		where: {
			username: params.params['username'],
		},
	})

	invariantResponse(user, 'User not found', { status: 404 })
	const lastActiveDisplay = getLastActiveLabel(user.lastActiveAt)
	const profileUser = {
		id: user.id,
		name: user.name,
		username: user.username,
		bio: user.bio,
		createdAt: user.createdAt,
		image: user.image,
		banner: user.banner,
	}

	const isFollowing =
		viewerId && viewerId !== user.id
			? Boolean(
					await prisma.follow.findUnique({
						where: { followerId_followingId: { followerId: viewerId, followingId: user.id } },
					}),
				)
			: false

	const listTypes = await prisma.listType.findMany()

	const [watchLists, activityRows, firstActivity, reviewRows, diaryRows] = await Promise.all([
		prisma.watchlist.findMany({
			where: { ownerId: user.id },
		}),
		prisma.activityEvent.findMany({
			where: { actorId: user.id },
			orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
			take: 100,
			select: {
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
			},
		}),
		prisma.activityEvent.findFirst({
			where: { actorId: user.id },
			orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
			select: { createdAt: true },
		}),
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
		prisma.diaryEntry.findMany({
			where: { ownerId: user.id },
			orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
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
	])
	const listTypeIdByName = new Map(
		listTypes.map(listType => [listType.name, listType.id]),
	)
	const mediaItem = (media: {
		id: string
		kind: string
		title: string | null
		thumbnail: string | null
	}) => ({
		id: media.id,
		kind: media.kind,
		title: media.title?.trim() || `Untitled ${media.kind}`,
		thumbnail: media.thumbnail,
	})
	const typeIdForKind = (kind: string) => {
		const listTypeName = activityListTypeName(kind)
		return listTypeName ? (listTypeIdByName.get(listTypeName) ?? null) : null
	}
	const trackingActivity = activityRows.map(event => {
		const listTypeName = activityListTypeName(event.media.kind)
		return {
			id: `tracking:${event.id}`,
			action: activityEventLabel(event),
			time: event.createdAt,
			typeId: listTypeName
				? (listTypeIdByName.get(listTypeName) ?? null)
				: null,
			media: mediaItem(event.media),
		}
	})
	const reviews = reviewRows.map(review => ({
		...review,
		rating: review.rating === null ? null : Number(review.rating),
		typeId: typeIdForKind(review.media.kind),
		media: mediaItem(review.media),
	}))
	const diaryEntries = diaryRows.map(entry => ({
		...entry,
		rating: entry.rating === null ? null : Number(entry.rating),
		typeId: typeIdForKind(entry.media.kind),
		media: mediaItem(entry.media),
	}))
	const activityEvents = [
		...trackingActivity,
		...reviews.map(review => ({
			id: `review:${review.id}`,
			action: 'Published a review',
			time: review.createdAt,
			typeId: review.typeId,
			media: review.media,
		})),
		...diaryEntries.map(entry => {
			return {
				id: `diary:${entry.id}`,
				action: diaryActivityLabel(entry.media.kind, entry.isRepeat),
				time: entry.createdAt,
				typeId: entry.typeId,
				media: entry.media,
			}
		}),
	]
		.sort(
			(a, b) =>
				new Date(b.time).getTime() - new Date(a.time).getTime() ||
				b.id.localeCompare(a.id),
		)
		.slice(0, 100)

	const typedWatchlists = watchLists.reduce<Record<string, typeof watchLists>>((x, y) => {
    (x[y.typeId] = x[y.typeId] || []).push(y);
     return x;
  },{});

  // One batched query for all of the user's entries, grouped by their watchlist's type in
  // memory — instead of a query per watchlist (N+1).
  const allEntries = watchLists.length >= 1
    ? await prisma.entry.findMany({
        where: { watchlistId: { in: watchLists.map(w => w.id) } },
				include: {
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
				},
      })
    : []
	const trackingSummaries = buildProfileTrackingSummaries({
		listTypes,
		watchlists: watchLists,
		entries: allEntries,
	})
	const historyEntries = allEntries.map(({ media, trackingState, ...entry }) => entry)

	const { typedEntries, typedHistory } = buildProfileHistory({
		listTypes,
		watchlists: watchLists,
		entries: historyEntries,
	})

	const favorites = await prisma.userFavorite.findMany({
    where: {
      ownerId: user.id, 
    },
  })
  
	
	const favoritesSorted = favorites?.sort(function(a, b) {
		if (a.position < b.position) return -1;
		if (a.position > b.position) return 1;
		return 0;
	});

	return json({ user: profileUser, userJoinedDisplay: user.createdAt.toLocaleDateString('en-us', { year:"numeric", month:"short", day:"numeric"}), lastActiveDisplay, listTypes, watchLists, typedWatchlists, typedEntries, typedHistory, activityEvents, activityStartedAt: firstActivity?.createdAt ?? null, reviews, diaryEntries, trackingSummaries, favorites: favoritesSorted, followerCount: user._count.followers, followingCount: user._count.following, isFollowing })
}

const PROFILE_TABS = [
	{ to: '.', end: true, label: 'Overview' },
	{ to: 'reviews', end: false, label: 'Reviews' },
	{ to: 'diary', end: false, label: 'Diary' },
	{ to: 'stats', end: false, label: 'Stats' },
	{ to: 'favorites', end: false, label: 'Favorites' },
	{ to: 'activity', end: false, label: 'Activity' },
	{ to: 'social', end: false, label: 'Social' },
]

export default function ProfileRoute() {
	const loaderData = useLoaderData<typeof loader>()
	const user = loaderData.user
	const loggedInUser = useOptionalUser()
	const isLoggedInUser = user.id === loggedInUser?.id
	const bannerSrc = getUserBannerSrc(user.banner?.id)
	const revalidator = useRevalidator()

	async function toggleFollow() {
		await fetch(
			'/resources/follow/' +
				encodeURIComponent(
					new URLSearchParams({
						userId: user.id,
						intent: loaderData.isFollowing ? 'unfollow' : 'follow',
					}).toString(),
				),
			{ method: 'POST' },
		)
		revalidator.revalidate()
	}

	return (
		<main
			className={cn('user-landing')}
			style={{ width: '100%', minHeight: '100%', backgroundColor: 'var(--veud-bg)' }}
		>
			{/* Hero — banner + avatar + identity, with an edit action on your own profile. */}
			<div className="user-landing-hero">
				<div
					className="user-landing-hero-banner"
					style={bannerSrc ? { backgroundImage: `url("${bannerSrc}")` } : undefined}
				>
					{isLoggedInUser ? (
						<div className="user-landing-hero-actions">
							<Button asChild variant="outline">
								<Link to="/settings/profile" prefetch="intent">
									Edit profile
								</Link>
							</Button>
						</div>
					) : null}
				</div>
				<div className="user-landing-hero-body">
					<img
						src={getUserImgSrc(user.image?.id)}
						alt={user.username}
						className="user-landing-hero-avatar"
					/>
					<div className="user-landing-hero-info">
						<h1 className="user-landing-hero-name">{user.name ?? user.username}</h1>
						<span className="user-landing-hero-username">@{user.username}</span>
						<span className="user-landing-hero-joined">
							Joined {loaderData.userJoinedDisplay}
						</span>
						<span className="user-landing-hero-last-active">
							{loaderData.lastActiveDisplay ?? 'Last active unavailable'}
						</span>
						<div className="user-landing-hero-stats">
							<span>
								<strong>{loaderData.followerCount}</strong>{' '}
								{loaderData.followerCount === 1 ? 'follower' : 'followers'}
							</span>
							<span>
								<strong>{loaderData.followingCount}</strong> following
							</span>
						</div>
					</div>
					<div className="user-landing-hero-side">
						{loggedInUser && !isLoggedInUser ? (
							<Button
								variant={loaderData.isFollowing ? 'outline' : 'default'}
								onClick={toggleFollow}
							>
								{loaderData.isFollowing ? 'Unfollow' : 'Follow'}
							</Button>
						) : null}
						<Button asChild>
							<Link to={`../../lists/${user.username}`} prefetch="intent">
								Watchlists
							</Link>
						</Button>
					</div>
				</div>
			</div>

			<nav
				className="mx-auto mt-6 flex flex-wrap justify-center gap-2 px-4"
				style={{ borderBottom: '1px solid var(--veud-surface)' }}
			>
				{PROFILE_TABS.map(tab => (
					<NavLink
						key={tab.label}
						to={tab.to}
						end={tab.end}
						prefetch="intent"
						className="px-4 py-2 font-semibold transition-colors"
						style={({ isActive }) => ({
							borderBottom: isActive
								? '4px solid var(--veud-teal)'
								: '4px solid transparent',
							color: isActive ? 'var(--veud-highlight)' : 'var(--veud-cream)',
						})}
					>
						{tab.label}
					</NavLink>
				))}
			</nav>

			<div style={{ padding: '1rem' }}>
				<Outlet context={loaderData} />
			</div>
		</main>
	)
}

export const meta: MetaFunction<typeof loader> = ({ params }) => {
	const displayName = params['username']
	return [
		{ title: `${displayName} | Veud` },
		{
			name: 'description',
			content: `Profile of ${displayName} on Veud`,
		},
	]
}

export function ErrorBoundary() {
	return (
		<GeneralErrorBoundary
			statusHandlers={{
				404: ({ params }) => (
					<p>No user with the username "{params['username']}" exists</p>
				),
			}}
		/>
	)
}
