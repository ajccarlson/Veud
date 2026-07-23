import '#app/styles/home.scss'
import {
	data as json,
	type LoaderFunctionArgs,
	useLoaderData,
} from 'react-router'
import { HomeDashboard } from '#app/components/home-dashboard.tsx'
import { HomeContinuation } from '#app/routes/_home+/_continuation.tsx'
import { FollowingFeed } from '#app/routes/_home+/_following.tsx'
import { HomeLibrary } from '#app/routes/_home+/_library.tsx'
import { HomeRecommendations } from '#app/routes/_home+/_recommendations.tsx'
import { TrendingData } from '#app/routes/_home+/_trending.tsx'
import { UpcomingData } from '#app/routes/_home+/_upcoming.tsx'
import { getFollowingActivityFeed } from '#app/utils/activity-feed.server.ts'
import { getUserId } from '#app/utils/auth.server.ts'
import { getHints } from '#app/utils/client-hints.tsx'
import { prisma } from '#app/utils/db.server.ts'
import {
	getContinuationQueue,
	getHomeDashboardConfig,
} from '#app/utils/home-dashboard.server.ts'
import { type HomeDashboardModule } from '#app/utils/home-dashboard.ts'
import { getHomeLibrarySummary } from '#app/utils/home-library.server.ts'
import { getHomeTrending } from '#app/utils/home-trending.server.ts'
import { getRecommendationGraph } from '#app/utils/recommendation-graph.server.ts'
import {
	dateKeyInTimeZone,
	getReleaseCalendar,
} from '#app/utils/release-calendar.server.ts'
import { useOptionalUser } from '#app/utils/user.ts'

export async function loader({ request }: LoaderFunctionArgs) {
	const userId = await getUserId(request)
	const timeZone = getHints(request).timeZone
	const dashboardConfig = await getHomeDashboardConfig(userId)
	const expanded = (module: HomeDashboardModule) =>
		!dashboardConfig.collapsedModules.includes(module)
	const trendingPromise =
		!userId || expanded('trending')
			? getHomeTrending(userId)
			: Promise.resolve([])
	const librarySummaryPromise = userId && expanded('library')
		? getHomeLibrarySummary(userId)
		: Promise.resolve(null)
	const watchlistsPromise =
		userId &&
		(expanded('trending') ||
			expanded('recommendations') ||
			expanded('library'))
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
	const [
		followingRows,
		upcomingCalendar,
		continuationQueue,
		recommendationGraph,
	] = userId
		? await Promise.all([
				expanded('following')
					? prisma.follow.findMany({
							where: { followerId: userId },
							select: { followingId: true },
						})
					: Promise.resolve([]),
				expanded('upcoming')
					? getReleaseCalendar(
							{
								start: dateKeyInTimeZone(new Date(), timeZone),
								kind: 'all',
								scope: 'mine',
							},
							userId,
							timeZone,
						)
					: Promise.resolve(null),
				expanded('continue') ? getContinuationQueue(userId) : Promise.resolve([]),
				expanded('recommendations')
					? getRecommendationGraph(userId)
					: Promise.resolve(null),
			])
		: [[], null, [], null]
	const followedUserIds = followingRows.map(follow => follow.followingId)
	const followingFeed = expanded('following')
		? await getFollowingActivityFeed(followedUserIds, 60)
		: []
	const suggestedMembers =
		userId &&
		expanded('following') &&
		(!followedUserIds.length || !followingFeed.length)
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
	const [trendingRails, watchlists, librarySummary] = await Promise.all([
		trendingPromise,
		watchlistsPromise,
		librarySummaryPromise,
	])

	return json({
		trendingRails,
		watchlists,
		librarySummary,
		isSignedIn: Boolean(userId),
		upcomingCalendar,
		followingFeed,
		followingCount: followedUserIds.length,
		suggestedMembers,
		dashboardConfig,
		continuationQueue,
		recommendationGraph,
	})
}

export default function Index() {
	const data = useLoaderData<typeof loader>()
	const currentUser = useOptionalUser()

	return (
		<div className="home">
			<main className="home-main">
				<h1 className="sr-only">
					Track movies, television, anime, and manga with Veud
				</h1>
				<div className="home-container">
					{currentUser ? (
						<HomeDashboard
							initialConfig={data.dashboardConfig}
							modules={{
								trending: (
									<TrendingData
										rails={data.trendingRails}
										watchlists={data.watchlists}
										isSignedIn
									/>
								),
								continue: (
									<HomeContinuation items={data.continuationQueue} />
								),
								recommendations: (
									<HomeRecommendations
										graph={data.recommendationGraph}
										watchlists={data.watchlists}
									/>
								),
								following: (
									<FollowingFeed
										items={data.followingFeed}
										followingCount={data.followingCount}
										suggestedMembers={data.suggestedMembers}
									/>
								),
								library: data.librarySummary ? (
									<HomeLibrary
										username={currentUser.username}
										summary={data.librarySummary}
										destinationCount={data.watchlists.length}
									/>
								) : null,
								upcoming: (
									<UpcomingData calendar={data.upcomingCalendar} />
								),
							}}
						/>
					) : (
						<TrendingData
							rails={data.trendingRails}
							watchlists={data.watchlists}
							isSignedIn={false}
						/>
					)}
				</div>
			</main>
		</div>
	)
}
