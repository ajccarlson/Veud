import { Link } from "@remix-run/react"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuPortal,
	DropdownMenuTrigger,
} from '#app/components/ui/dropdown-menu.tsx'
import { refreshGrid } from '#app/routes/lists+/.$username+/.$list-type+/$watchlist_grid.jsx'

function columnsDifferent(source, destination, listType) {
  const sourceLength = source.displayedColumns.split(", ").length
  const destinationLength = destination.displayedColumns.split(", ").length

  console.log(sourceLength)
  console.log(destinationLength)

  // if (sourceLength != destinationLength)
  //   refreshGrid(undefined, {watchlistName: destination.name, listType: listType, watchlistId: destination.watchlistId});
}

function formatType(listType) {
  if (listType == 'liveaction')
    return "Live Action"
  else if (listType == 'anime')
    return "Anime"
  else if (listType == 'manga')
    return "Manga"
}

export function listNavButtons(watchLists, username, listType, watchListData) {
  let listTypes = []
  let currentType = {}
  
  for (let list of watchLists) {
    if (list.type == listType) {
      currentType = {
        name: list.type,
        formatted: formatType(list.type)
      }
    }
    else if (!listTypes.some(e => e.name === list.type)) {
      listTypes.push({
        name: list.type,
        formatted: formatType(list.type)
      })
    }
  }

  if (listTypes && listTypes.length > 0) {
    return (
      <div class="font-family: arial bg-[#464646] text-[#FFEFCC] border-t-8 border-t-[#54806C] pt-3 pb-1 shadow-[inset_0_-6px_8px_rgba(0,0,0,0.6)]" id="list-nav">
        <div class="flex flex-col bg-[#6F6F6F] fixed float-left font-bold rounded" id="list-type-nav">
          <div class="content-center text-center justify-center rounded">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <div class="bg-[#6F6F6F] hover:bg-[#8CA99D] cursor-pointer text-base font-bold py-[0.1rem] px-[0.5rem] rounded"> 
                  {currentType.formatted}
                </div>
              </DropdownMenuTrigger>
              <DropdownMenuPortal>
                <DropdownMenuContent sideOffset={8} align="start">
                  {listTypes.map( typeMap =>
                    <DropdownMenuItem>
                      <Link to={"../lists/" + username + "/" + typeMap.name + "/"}
                        class="bg-[#6F6F6F] hover:bg-[#8CA99D] text-base font-bold py-[0.1rem] px-[0.5rem] rounded"> 
                          {typeMap.formatted}
                      </Link>
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenuPortal>
            </DropdownMenu>
          </div>
        </div>
        <div class="flex flex-row gap-4 justify-center">
          {watchLists.map( list =>
            <Link to={"../lists/" + username + "/" + listType + "/" + list.name} /*onClick={columnsDifferent(watchListData, list, listType)}*/
            class="bg-[#6F6F6F] hover:bg-[#8CA99D] text-base font-bold py-5 px-16 border-b-4 border-[#A2FFD5] hover:border-[#80FFC6] rounded"> 
              {list.header}
            </Link>
          )}
        </div>
      </div>
    )
  }
  else {
    return (
      <div class="font-family: arial bg-[#464646] text-[#FFEFCC] border-t-8 border-t-[#54806C] pt-3 pb-1 shadow-[inset_0_-6px_8px_rgba(0,0,0,0.6)]" id="list-nav">
        <div class="flex flex-row gap-4 justify-center">
          {watchLists.map( list =>
            <Link to={"../lists/" + username + "/" + listType + "/" + list.name} /*onClick={columnsDifferent(watchListData, list, listType)}*/
            class="bg-[#6F6F6F] hover:bg-[#8CA99D] text-base font-bold py-5 px-16 border-b-4 border-[#A2FFD5] hover:border-[#80FFC6] rounded"> 
              {list.header}
            </Link>
          )}
        </div>
      </div>
    )
  }
}
