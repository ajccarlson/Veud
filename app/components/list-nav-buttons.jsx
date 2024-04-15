import { Link } from "@remix-run/react"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuPortal,
	DropdownMenuTrigger,
} from '#app/components/ui/dropdown-menu.tsx'

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
  let typedWatchlists = []
  
  for (let list of watchLists) {
    if (list.type == listType) {
      typedWatchlists.push(list)

      currentType = {
        name: list.type,
        formatted: formatType(list.type)
      }
    }
    else if (!listTypes.some(e => e.name === list.type) && list.position == 1) {
      listTypes.push({
        name: list.type,
        formatted: formatType(list.type),
        url: ("../lists/" + username + "/" + list.type + "/" + list.name)
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
                      <Link to={typeMap.url}
                        class="bg-[#6F6F6F] hover:bg-[#8CA99D] transition ease-out duration-100 text-base font-bold py-[0.1rem] px-[0.5rem] rounded"> 
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
          {typedWatchlists.map( list =>
            <Link to={"../lists/" + username + "/" + listType + "/" + list.name}
            class="bg-[#6F6F6F] hover:bg-[#8CA99D] transition ease-out duration-100 text-base font-bold py-5 px-16 border-b-4 border-[#A2FFD5] hover:border-[#80FFC6] rounded"> 
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
          {typedWatchlists.map( list =>
            <Link to={"../lists/" + username + "/" + listType + "/" + list.name}
            class="bg-[#6F6F6F] hover:bg-[#8CA99D] text-base font-bold py-5 px-16 border-b-4 border-[#A2FFD5] hover:border-[#80FFC6] rounded"> 
              {list.header}
            </Link>
          )}
        </div>
      </div>
    )
  }
}
