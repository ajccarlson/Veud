import '#app/styles/home.scss'
<<<<<<< HEAD
import { json, type LoaderFunctionArgs } from '@remix-run/node'
import { useLoaderData } from '@remix-run/react'
import { TrendingData } from '#app/routes/_home+/_trending.tsx'
import { UpcomingData } from '#app/routes/_home+/_upcoming.tsx'
import { prisma } from '#app/utils/db.server.ts'
import { getUserId } from '#app/utils/auth.server.ts'
=======
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
>>>>>>> develop
import { useOptionalUser } from '#app/utils/user.ts'

export async function loader({ request }: LoaderFunctionArgs) {
  const listTypes = await prisma.listType.findMany()

  const userId = await getUserId(request)

  // The home page only renders the signed-in user's upcoming releases, so scope everything to
  // them. Anonymous visitors (who just see client-fetched trending) need none of this. This
  // replaces a loader that fetched *every* user's watchlists and then ran one entry query per
  // watchlist — an N+1 over the whole table plus a large over-fetch.
  const [watchLists, followingRows] = userId
    ? await Promise.all([
        prisma.watchlist.findMany({ where: { ownerId: userId } }),
        prisma.follow.findMany({
          where: { followerId: userId },
          select: { followingId: true },
        }),
      ])
    : [[], []]
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

  const userWatchLists = watchLists.reduce<Record<string, typeof watchLists>>(
    (x, y) => {
      (x[y.ownerId] = x[y.ownerId] || []).push(y)
      return x
    },
    {},
  )

  const typedWatchlists = watchLists.reduce<Record<string, typeof watchLists>>(
    (x, y) => {
      (x[y.typeId] = x[y.typeId] || []).push(y)
      return x
    },
    {},
  )

  // One batched query for all of this user's entries, then grouped by their watchlist's type
  // in memory — instead of one query per watchlist.
  const entries = watchLists.length
    ? await prisma.entry.findMany({
        where: { watchlistId: { in: watchLists.map(w => w.id) } },
      })
    : []

  const typeByWatchlist = new Map(watchLists.map(w => [w.id, w.typeId]))
  const typedEntries: Record<string, any[]> = {}
  for (const type of listTypes) {
    typedEntries[type.id] = []
  }
  for (const entry of entries) {
    const typeId = typeByWatchlist.get(entry.watchlistId)
    if (typeId && typedEntries[typeId]) {
      typedEntries[typeId].push(entry)
    }
  }

  return json({
    listTypes,
    watchLists,
    userWatchLists,
    typedWatchlists,
    typedEntries,
    followingFeed,
    followingCount: followedUserIds.length,
    suggestedMembers,
  })
}

export default function Index() {
  // This component mutates the loader data in place (adding `user`/`userTypedEntries`),
  // so `loaderData` is treated as `any`. Reworking that mutation is a separate cleanup.
  const loaderData: any = useLoaderData<typeof loader>()
  const currentUser = useOptionalUser()
  loaderData['user'] = currentUser
  loaderData['userTypedEntries'] = {}

  if (
    currentUser &&
    loaderData.typedEntries &&
    Object.entries(loaderData.typedEntries).length > 0 &&
    loaderData.userWatchLists[currentUser.id] &&
    loaderData.userWatchLists[currentUser.id].length > 0
  ) {
    const watchListIds = loaderData.userWatchLists[currentUser.id].map(
      (userWatchList: any) => userWatchList.id,
    )

    Object.entries(loaderData.typedEntries).forEach(
      ([typedEntryKey, typedEntryValue]) => {
        if (!loaderData['userTypedEntries'][typedEntryKey]) {
          loaderData['userTypedEntries'][typedEntryKey] = []
        }

        loaderData['userTypedEntries'][typedEntryKey] = (
          typedEntryValue as any[]
        ).map((entryValue: any) => {
            if (watchListIds.includes(entryValue.watchlistId)) {
              return entryValue
            }

            return null
          },
        )
      },
    )
  }

  return (
    <div className="home">
      <main className="home-main">
        <div className="home-container">
          {currentUser ? (
            <FollowingFeed
              items={loaderData.followingFeed}
              followingCount={loaderData.followingCount}
              suggestedMembers={loaderData.suggestedMembers}
            />
          ) : null}
          <UpcomingData
            user={currentUser}
            userTypedEntries={loaderData.userTypedEntries}
            listTypes={loaderData.listTypes}
          />
          <TrendingData currentUser={currentUser} />
        </div>
      </main>
    </div>
  )
}
