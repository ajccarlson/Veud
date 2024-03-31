import { ClientSideRowModelModule } from '@ag-grid-community/client-side-row-model'
import { ModuleRegistry } from '@ag-grid-community/core'
import { invariantResponse } from '@epic-web/invariant'
import { json } from "@remix-run/node"
import { useLoaderData } from '@remix-run/react'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { listNavButtons } from "#app/components/list-nav-buttons.jsx"
import { watchlistGrid } from "#app/routes/lists+/$watchlist_grid.jsx"
import { prisma } from '#app/utils/db.server.ts'
import '@ag-grid-community/styles/ag-grid.css'
import "#app/styles/watchlist.scss"

ModuleRegistry.registerModules([ ClientSideRowModelModule ]);

async function getListByName(listName) {
  const listID = await prisma.watchlist.findFirst({
		where: {
			name: listName.toLowerCase(),
		},
	})

  const entries = await prisma.LiveActionEntry.findMany({
		where: {
			watchlistId: listID.id,
		},
	})

  return entries;
}

export async function loader(params) {
  let listFound = false

  const watchlistSchema = await prisma.watchlist.findMany()

  let watchLists = [];
  watchlistSchema.map(a => watchLists.push({
    name: a.name,
    header: a.header,
    type: a.type,
    columns: a.columns,
  }))
  
  let watchListData;

  for (let watchList of watchLists) {
    if (watchList.name == params['params']['watchlist']) {
      listFound = true
      watchListData = watchList;
      break
    }
  }

  invariantResponse(listFound, 'Watchlist not found', { status: 404 }) 

  const listEntries = await getListByName(params['params']['watchlist']);

  return json({ "watchList": params['params']['watchlist'], listEntries, watchLists, watchListData });
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
      {watchlistGrid(useLoaderData()['listEntries'], useLoaderData()['watchListData'])}
      {listNavButtons(useLoaderData()['watchLists'])}
    </main>
  )
}
