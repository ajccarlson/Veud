import { json } from "@remix-run/node"
import { useLoaderData } from '@remix-run/react'
import { prisma } from '#app/utils/db.server.ts'
import { timeSince } from "#app/utils/lists/column-functions.tsx"
import { invariantResponse } from '@epic-web/invariant'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'

function getWatchlistNav(watchListData, listType) {
  return (
    `<div class="flex-auto font-sansp-6 bg-[#464646] w-[55rem] font-[arial] border-8 border-[#383040] rounded-lg">` + 
      `<div class="flex flex-wrap border-b-[4px] bg-[#121212] border-[#66563d] border-spacing-y pb-1 px-3 pt-1 sticky top-0">` +
        `<h1 class="flex-auto text-xl font-semibold text-[#ffffb1] pl-5">` + 
          `${watchListData.watchlist.header}` +
        `</h1>` + 
        `<div class="text-lg font-semibold text-[#FF9900] pl-4 border-l-[5px] border-[#7196aa] rounded-lg">` + 
          `${watchListData.listEntries.length}` +
        `</div>` + 
      `</div>` + 

      `<div class="grid grid-cols-[85%_15%] ">` + 
        `<div>` + 
          `<p class="text-m text-white font-['Playfair_Display'] px-3 py-3 shadow-[0_35px_60px_-15px_rgba(46,47,43,18)]">` + 
            `${watchListData.watchlist.description}` +
          `</p>` +
          `<div class="w-full flex-none text-xs font-semibold text-[#408063] mt-2 text-end px-3 pb-1 pr-8">` + 
            `Last Updated: ` + `<span class="text-[#dbffcc]">` + `${timeSince(watchListData.watchlist.updatedAt)}` + `</span>` +
          `</div>` + 
        `</div>` + 

        `<div class="grid grid-rows-[85%_15%] /*border-8 border-[#383040]*/">` + 
          `<a href=${"/lists/" + listType + "/" + watchListData.watchlist.name} class="flex justify-center items-center text-center font-semibold bg-[#6F6F6F] hover:bg-[#8CA99D] text-[#FFEFCC]">` + 
            `Open` + 
          `</a>` +  
          `<button class="font-semibold bg-[#6F6F6F] hover:bg-[#8CA99D] text-[#FFEFCC]" type="submit">` + 
              `Settings` + 
          `</button>` + 
        `</div>` + 
      `</div>` + 
    `</div>` + 
    `<br></<br>` 
  )
}

export async function loader(params) {
  const watchLists = await prisma.watchlist.findMany()

  let watchListData = []
  let watchListNavs = []

  const listType = params['params']['list-type']
  let typeFormatted = null;

  if (listType == 'liveaction')
    typeFormatted = "LiveActionEntry"
  else if (listType == 'anime')
    typeFormatted = "AnimeEntry"
  else if (listType == 'manga')
    typeFormatted = "MangaEntry"

  invariantResponse(typeFormatted, 'List type not found', { status: 404 }) 
  
  for (let watchlist of watchLists) {
    const listEntries = await prisma[typeFormatted].findMany({
      where: {
        watchlistId: watchlist.id,
      },
    })

    const entryData = {
      watchlist: watchlist,
      listEntries: listEntries
    }

    watchListData.push(entryData)

    watchListNavs.push(getWatchlistNav(entryData, listType))
  }

  return json({ watchListData, watchListNavs, listType });
};

export function ErrorBoundary() {
	return (
		<GeneralErrorBoundary
			statusHandlers={{
				404: ({ params }) => (
					<p>No list type with the the name "{params.listType}" exists</p>
				),
			}}
		/>
	)
}

export default function lists() {
  return (
    <main class="bg-[#222222]" style={{ width: '100%', height: '100%' }}>
      <div class="bg-[#6F6F6F] text-[#FFEFCC] flex flex-col w-[10rem] fixed top-1/3 float-left font-[arial] border-t-8 border-r-8 border-[#54806C] hover:border-[#507b68] rounded ">
        <a href="/lists/liveaction" class="] hover:bg-[#8CA99D] font-bold h-[5rem] content-center text-center justify-center rounded">Live Action</a>
        <a href="/lists/anime" class="hover:bg-[#8CA99D] font-bold h-[5rem] content-center text-center justify-center rounded">Anime</a>
        <a href="/lists/manga" class="hover:bg-[#8CA99D] font-bold h-[5rem] content-center text-center justify-center rounded shadow-[0px_4px_0px_rgba(0,0,0,0.6)]">Manga</a>
      </div>
      <div class="flex flex-col items-center" dangerouslySetInnerHTML={{__html: useLoaderData()['watchListNavs'].join("")}} />
    </main>
  )
}
