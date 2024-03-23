import { invariantResponse } from '@epic-web/invariant'
import { json } from "@remix-run/node";
import { useLoaderData } from '@remix-run/react'
import { Link } from "@remix-run/react"
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
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

let listNavButtons = watchLists.map( list =>
  <Link to={"../lists/" + list['name'].replace(/[^a-z0-9_]+/gi, '').toLowerCase()}
  class="bg-[#6F6F6F] hover:bg-[#8CA99D] text-[#FFEFCC] font-family: arial text-s font-bold py-5 px-16 border-b-4 border-[#A2FFD5] hover:border-[#80FFC6] rounded"> 
    {list['name']}
  </Link>
)

export default function watchList() {
  return (
    <main style={{ width: '100%', height: '100%' }}>
      {getWatchlist(useLoaderData()['watchList'])}
      <div class="flex flex-row gap-4 justify-center bg-[#464646]" id="list-nav">
        {listNavButtons}
      </div>
    </main>
  )
}
