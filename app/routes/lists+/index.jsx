import { json } from "@remix-run/node"
import { useLoaderData } from '@remix-run/react'
import { prisma } from '#app/utils/db.server.ts'

function getWatchlistNav(watchListData) {
  return (
    // `<div> <div> ` +
    // `Name: ${watchListData.watchlist.header}` +
    // ` </div> <div>` +
    // `Description: ${watchListData.watchlist.description}` +
    // `</div> <div> ` +
    // `Last Updated: ${watchListData.watchlist.updatedAt}` +
    // `</div> <div>` +
    // `Length: ${watchListData.listEntries.length}` +
    // ` </div> </div>`


    `<div class="grid grid-cols-[85%_15%] font-sansp-6 bg-[#464646] w-[55rem] font-[arial] border-8 border-[#383040] rounded-lg">` + 
      `<div class="flex-auto">` + 
        `<div class="flex flex-wrap border-b-[4px] bg-[#121212] border-[#66563d] border-spacing-y px-3 pt-1">` +
          `<h1 class="flex-auto text-xl font-semibold text-[#ffffb1] pl-5">` + 
            `${watchListData.watchlist.header}` +
          `</h1>` + 
          `<div class="text-lg font-semibold text-[#ccedff] pb-1">` + 
            `${watchListData.listEntries.length}` +
          `</div>` + 
        `</div>` + 
        `<p class="text-m text-white font-['Playfair_Display'] px-3 py-3 shadow-[0_35px_60px_-15px_rgba(46,47,43,18)]">` + 
          `${watchListData.watchlist.description}` +
        `</p>` +
        `<div class="w-full flex-none text-xs font-semibold text-[#408063] mt-2 text-end px-3 pb-1">` + 
          `Last Updated: ` + `<span class="text-[#dbffcc]">` + `${watchListData.watchlist.updatedAt}` + `</span>` +
        `</div>` + 
      `</div>` + 
      `<div class="grid grid-rows-[85%_15%]">` + 
        `<button class="font-semibold bg-[#6F6F6F] hover:bg-[#8CA99D] text-[#FFEFCC] /*border-8 border-[#383040]*/" type="submit">` + 
            `Open` + 
        `</button>` + 
        `<button class="font-semibold bg-[#6F6F6F] hover:bg-[#8CA99D] text-[#FFEFCC] /*border-8 border-[#383040]*/" type="submit">` + 
            `Settings` + 
        `</button>` + 
      `</div>` + 
    `</div>` + 
    `<br></<br>` 
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
    <main class="bg-[#222222]" style={{ width: '100%', height: '100%' }}>
      <div dangerouslySetInnerHTML={{__html: useLoaderData()['watchListNavs'].join("")}} />
    </main>
  )
}
