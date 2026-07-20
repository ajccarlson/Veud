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
import { prisma } from '#app/utils/db.server.ts'
import { getReleaseCalendar } from '#app/utils/release-calendar.server.ts'
import { useOptionalUser } from '#app/utils/user.ts'

function todayUtc() {
	return new Date().toISOString().slice(0, 10)
}

export async function loader({ request }: LoaderFunctionArgs) {
	const userId = await getUserId(request)
	const [followingRows, upcomingCalendar] = userId
		? await Promise.all([
				prisma.follow.findMany({
					where: { followerId: userId },
					select: { followingId: true },
				}),
				getReleaseCalendar(
					{ start: todayUtc(), kind: 'all', scope: 'mine' },
					userId,
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

	return json({
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
					{currentUser ? (
						<FollowingFeed
							items={data.followingFeed}
							followingCount={data.followingCount}
							suggestedMembers={data.suggestedMembers}
						/>
					) : null}
					<UpcomingData calendar={data.upcomingCalendar} />
					<TrendingData currentUser={currentUser} />
				</div>
			</main>
		</div>
	)
}
