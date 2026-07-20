import '#app/styles/home.scss'
import {
	data as json,
	type LoaderFunctionArgs,
	useLoaderData,
} from 'react-router'
import { FollowingFeed } from '#app/routes/_home+/_following.tsx'
import { TrendingData } from '#app/routes/_home+/_trending.tsx'
import { UpcomingData } from '#app/routes/_home+/_upcoming.tsx'
import { getFollowingActivityFeed } from '#app/utils/activity-feed.server.ts'
import { getUserId } from '#app/utils/auth.server.ts'
import { getHints } from '#app/utils/client-hints.tsx'
import { prisma } from '#app/utils/db.server.ts'
import { getHomeTrending } from '#app/utils/home-trending.server.ts'
import {
	dateKeyInTimeZone,
	getReleaseCalendar,
} from '#app/utils/release-calendar.server.ts'
import { useOptionalUser } from '#app/utils/user.ts'

export async function loader({ request }: LoaderFunctionArgs) {
	const userId = await getUserId(request)
	const timeZone = getHints(request).timeZone
	const trendingPromise = getHomeTrending(userId)
	const watchlistsPromise = userId
		? prisma.watchlist.findMany({
				where: { ownerId: userId },
				select: {
					id: true,
					name: true,
					header: true,
					position: true,
					type: { select: { name: true } },
				},
				orderBy: [{ position: 'asc' }, { header: 'asc' }],
			})
		: Promise.resolve([])
	const [followingRows, upcomingCalendar] = userId
		? await Promise.all([
				prisma.follow.findMany({
					where: { followerId: userId },
					select: { followingId: true },
				}),
				getReleaseCalendar(
					{
						start: dateKeyInTimeZone(new Date(), timeZone),
						kind: 'all',
						scope: 'mine',
					},
					userId,
					timeZone,
				),
			])
		: [[], null]
	const followedUserIds = followingRows.map(follow => follow.followingId)
	const followingFeed = await getFollowingActivityFeed(followedUserIds, 60)
	const suggestedMembers =
		userId && (!followedUserIds.length || !followingFeed.length)
			? await prisma.user.findMany({
					where: { id: { notIn: [userId, ...followedUserIds] } },
					orderBy: [{ lastActiveAt: 'desc' }, { createdAt: 'desc' }],
					take: 6,
					select: {
						id: true,
						username: true,
						name: true,
						image: { select: { id: true } },
					},
				})
			: []
	const [trendingRails, watchlists] = await Promise.all([
		trendingPromise,
		watchlistsPromise,
	])

	return json({
		trendingRails,
		watchlists,
		isSignedIn: Boolean(userId),
		upcomingCalendar,
		followingFeed,
		followingCount: followedUserIds.length,
		suggestedMembers,
	})
}

export default function Index() {
	const data = useLoaderData<typeof loader>()
	const currentUser = useOptionalUser()

	return (
		<div className="home">
			<main className="home-main">
				<div className="home-container">
					<TrendingData
						rails={data.trendingRails}
						watchlists={data.watchlists}
						isSignedIn={data.isSignedIn}
					/>
					{currentUser ? (
						<div className="home-dashboard">
							<FollowingFeed
								items={data.followingFeed}
								followingCount={data.followingCount}
								suggestedMembers={data.suggestedMembers}
							/>
							<UpcomingData calendar={data.upcomingCalendar} />
						</div>
					) : null}
				</div>
			</main>
		</div>
	)
}
