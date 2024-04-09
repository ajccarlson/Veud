import { invariantResponse } from '@epic-web/invariant'
import { json } from "@remix-run/node"
import { useLoaderData } from '@remix-run/react'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { listNavButtons } from "#app/components/list-nav-buttons.jsx"
import { prisma } from '#app/utils/db.server.ts'
import { watchlistGrid } from '#app/routes/lists+/.$username+/.$list-type+/$watchlist_grid.jsx'

async function getListByName(listName, listType) {
  const listID = await prisma.watchlist.findFirst({
		where: {
			name: listName.toLowerCase(),
		},
	})

  const entries = await prisma[listType].findMany({
		where: {
			watchlistId: listID.id,
		},
	})

  return {listEntries: entries, watchlistId: listID.id};
}

export async function loader(params) {
  const currentUser = await prisma.User.findUnique({
    where: {
      username: params['params']['username'],
    },
  })

  invariantResponse(currentUser, 'User not found', { status: 404 }) 

  const watchLists = await prisma.watchlist.findMany({
		where: {
			ownerId: currentUser.id,
		},
	})

  let watchListData
  let listFound = false

  const watchListsSorted = watchLists.sort((a, b) => a.position - b.position)

  for (let watchList of watchLists) {
    if (watchList.name == params['params']['watchlist']) {
      listFound = true
      watchListData = watchList;
      break
    }
  }

  invariantResponse(listFound, 'Watchlist not found', { status: 404 }) 

  const listType = params['params']['list-type']
  let typeFormatted = null;

  if (listType == 'liveaction')
    typeFormatted = "LiveActionEntry"
  else if (listType == 'anime')
    typeFormatted = "AnimeEntry"
  else if (listType == 'manga')
    typeFormatted = "MangaEntry"

  invariantResponse(typeFormatted, 'List type not found', { status: 404 }) 

  const {listEntries, watchlistId} = await getListByName(params['params']['watchlist'], typeFormatted);

  return json({ "watchList": params['params']['watchlist'], "username": params['params']['username'], "listType": params['params']['list-type'], "typeFormatted": typeFormatted, listEntries, watchLists, watchListsSorted, watchListData, watchlistId });
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
  return (
    <main style={{ width: '100%', height: '100%' }}>
      {watchlistGrid(useLoaderData()['listEntries'], useLoaderData()['watchListData'], useLoaderData()['typeFormatted'], useLoaderData()['watchlistId'] )}
      {listNavButtons(useLoaderData()['watchListsSorted'], useLoaderData()['username'], useLoaderData()['listType'], useLoaderData()['watchListData'])}
    </main>
  )
}
