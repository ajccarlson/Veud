import { json } from "@remix-run/node"
import { useLoaderData } from '@remix-run/react'
import { prisma } from '#app/utils/db.server.ts'

function getWatchlistNav(watchListData) {
  return (
    `<div> <div> ` +
    `Name: ${watchListData.watchlist.header}` +
    ` </div> <div>` +
    `Description: ${watchListData.watchlist.description}` +
    `</div> <div> ` +
    `Last Updated: ${watchListData.watchlist.updatedAt}` +
    `</div> <div>` +
    `Length: ${watchListData.listEntries.length}` +
    ` </div> </div>`
  )
}

export async function loader() {
  const watchLists = await prisma.watchlist.findMany()

  let watchListData = []
  let watchListNavs = []
  
  for (let watchlist of watchLists) {
    const listEntries = await prisma.LiveActionEntry.findMany({
      where: {
        watchlistId: watchlist.id,
      },
    })

    const entryData = {
      watchlist: watchlist,
      listEntries: listEntries
    }

    watchListData.push(entryData)

    watchListNavs.push(getWatchlistNav(entryData))
  }

  return json({ watchListData, watchListNavs });
};

export default function lists() {
  return (
    <div dangerouslySetInnerHTML={{__html: useLoaderData()['watchListNavs']}} />
  )
}
