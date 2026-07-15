import '#app/styles/home.scss'
import { json } from '@remix-run/node'
import { useLoaderData } from '@remix-run/react'
import { TrendingData } from '#app/routes/_home+/_trending.tsx'
import { UpcomingData } from '#app/routes/_home+/_upcoming.tsx'
import { prisma } from '#app/utils/db.server.ts'
import { entryModelFromHeader } from '#app/utils/lists/authorization.server.ts'
import { useOptionalUser } from '#app/utils/user.ts'

export async function loader() {
  const listTypes = await prisma.listType.findMany()

  const watchLists = await prisma.watchlist.findMany()

  // Group the watchlists by owner and by list type. The reduce accumulators are typed via
  // the generic; `findMany` always returns an array, so the original `?.` is dropped (it
  // was redundant and left the result non-indexable).
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

  const typedEntries: Record<string, any[]> = {}

  for (const type of listTypes) {
    const typeFormatted = entryModelFromHeader(type.header)
    const perWatchlistEntries: any[] = []

    for (const typedList of typedWatchlists[type.id]) {
      // `typeFormatted` is allowlist-validated; the dynamic delegate access is intentional.
      perWatchlistEntries.push(
        await (prisma as any)[typeFormatted].findMany({
          where: {
            watchlistId: typedList.id,
          },
        }),
      )
    }

    typedEntries[type.id] = perWatchlistEntries.flat(2)
  }

  return json({ listTypes, watchLists, userWatchLists, typedWatchlists, typedEntries })
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
          {TrendingData(currentUser)}
          {UpcomingData(loaderData)}
        </div>
      </main>
    </div>
  )
}
