import { invariantResponse } from '@epic-web/invariant'
import { json } from "@remix-run/node"
import { useLoaderData } from '@remix-run/react'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { listNavButtons } from "#app/components/list-nav-buttons.jsx"
import { prisma } from '#app/utils/db.server.ts'
import { watchlistGrid } from '#app/routes/lists+/.$username+/.$list-type+/$watchlist_grid.jsx'

export async function loader(params) {
  const currentUser = await prisma.User.findUnique({
    where: {
      username: params['params']['username'],
    },
  })

  invariantResponse(currentUser, 'User not found', { status: 404 }) 

  const listType = params['params']['list-type']
  const listTypes = await prisma.ListType.findMany()
  const listTypeData = listTypes.find(type => type.name === listType)
  const typeFormatted = listTypeData.header.replace(/\W/g, '') + "Entry"

  invariantResponse(typeFormatted, 'List type not found', { status: 404 }) 

  const watchLists = await prisma.watchlist.findMany({
		where: {
			ownerId: currentUser.id,
		},
	})

  let watchListData
  let listFound = false

  const watchListsSorted = watchLists.sort((a, b) => a.position - b.position)

  for (let watchList of watchLists) {
    if (watchList.typeId == listTypeData.id) {
      if (watchList.name == params['params']['watchlist']) {
        listFound = true
        watchListData = watchList;
        break
      }
    }
  }

  invariantResponse(listFound, 'Watchlist not found', { status: 404 }) 

  const typedWatchlists = watchLists.reduce((x, y) => {
    (x[y.typeId] = x[y.typeId] || []).push(y);
     return x;
  },{});

  const listEntries = await prisma[typeFormatted].findMany({
		where: {
			watchlistId: watchListData.id,
		},
	})

  const listEntriesSorted = listEntries.sort((a, b) => a.position - b.position)

  const favorites = await prisma.userFavorite.findMany({
		where: {
			ownerId: currentUser.id,
		},
	})
  
  const typedFavorites = favorites.reduce((x, y) => {
    (x[y.typeId] = x[y.typeId] || []).push(y);
    return x;
  },{})

  return json({ "watchList": params['params']['watchlist'], "username": params['params']['username'], "listType": params['params']['list-type'], listTypes, listTypeData, listEntries: listEntriesSorted, watchLists, watchListsSorted, typedWatchlists, watchListData, watchlistId: watchListData.id, typedFavorites, currentUser });
};

export function ErrorBoundary() {
	return (
		<GeneralErrorBoundary
			statusHandlers={{
				404: ({ params }) => (
					<p>No watchlist with the the name "{params.watchlist}" exists</p>
				),
			}}
		/>
	)
}

export default function watchList() {
  const loaderData = useLoaderData()

  return (
    <main style={{ width: '100%', height: '100%' }}>
      {watchlistGrid(loaderData.listEntries, loaderData.watchListData, loaderData.listTypeData, loaderData.watchlistId, loaderData.typedWatchlists, loaderData.typedFavorites, loaderData.currentUser )}
      {listNavButtons(loaderData.typedWatchlists, loaderData.username, loaderData.listTypes, loaderData.listTypeData, loaderData.watchListData)}
    </main>
  )
}
