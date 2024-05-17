import "#app/styles/home.scss"
import { json } from "@remix-run/node"
import { useLoaderData } from '@remix-run/react'
import { TrendingData } from '#app/routes/_home+/_trending.jsx'
import { UpcomingData } from '#app/routes/_home+/_upcoming.jsx'
import { prisma } from '#app/utils/db.server.ts'
import { useOptionalUser } from '#app/utils/user.ts'

export async function loader() {
	const listTypes = await prisma.listType.findMany()

	const watchLists = await prisma.watchlist.findMany()

  const userWatchLists = watchLists?.reduce((x, y) => {
    (x[y.ownerId] = x[y.ownerId] || []).push(y);
     return x;
  },{});

  const typedWatchlists = watchLists?.reduce((x, y) => {
    (x[y.typeId] = x[y.typeId] || []).push(y);
     return x;
  },{});

	let typedEntries = {}

	for (const type of listTypes) {
		const typeFormatted = type.header.replace(/\W/g, '') + "Entry"
		let perWatchlistEntries = []

		for (const typedList of typedWatchlists[type.id]) {
			perWatchlistEntries.push(await prisma[typeFormatted].findMany({
				where: {
					watchlistId: typedList.id,
				},
			}))
		}

		typedEntries[type.id] = perWatchlistEntries.flat(2)
  }

	return json({ listTypes, watchLists, userWatchLists, typedWatchlists, typedEntries })
}

export default function Index() {
  const user = useOptionalUser()
  const loaderData = useLoaderData()
  loaderData["userTypedEntries"] = {}
  
  if (user) {
    const watchListIds = loaderData.userWatchLists[user.id].map(userWatchList => userWatchList.id)

    Object.entries(loaderData.typedEntries).forEach(([typedEntryKey, typedEntryValue]) => {
      if (!loaderData["userTypedEntries"][typedEntryKey]) {
        loaderData["userTypedEntries"][typedEntryKey] = []
      }

      loaderData["userTypedEntries"][typedEntryKey] = typedEntryValue.map(entryValue => {
        if (watchListIds.includes(entryValue.watchlistId)) {
          return entryValue
        }
      })
    }) 
  }

  return (
    <div class="home">
      <main class="home-main">
        <div class="home-container">
          {TrendingData()}
          {UpcomingData(loaderData)}
        </div>
      </main>
    </div>
  )
}
