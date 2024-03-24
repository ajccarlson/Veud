import { invariantResponse } from '@epic-web/invariant'
import { json } from "@remix-run/node";
import { useLoaderData } from '@remix-run/react'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { listNavButtons } from "#app/components/list-nav-buttons.jsx"
import { getWatchlist } from "#app/utils/lists/get-watchlist.jsx"
import { watchLists } from "#app/utils/lists/watchlists"

export async function loader(params) {
  let listFound = false
  for (let watchList of watchLists) {
    if (Object.values(watchList).indexOf(params['params']['watchlist']) > -1) {
      listFound = true
    }
  }

  invariantResponse(!listFound, 'Watchlist not found', { status: 404 })

  return json({ "watchList": params['params']['watchlist'] });
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
      {getWatchlist(useLoaderData()['watchList'])}
      {listNavButtons}
    </main>
  )
}
