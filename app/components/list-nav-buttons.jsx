import { Link } from "@remix-run/react"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuPortal,
	DropdownMenuTrigger,
} from '#app/components/ui/dropdown-menu.tsx'
import "#app/styles/list-nav-buttons.scss"

export function listNavButtons(watchLists, username, listTypes, listTypeData, watchListData) {
  const typedWatchlists = watchLists.filter(watchlist => watchlist.typeId === listTypeData.id)

  if (listTypes && listTypes.length > 0) {
    return (
      <main class="list-nav-buttons">
        <div class="list-nav-buttons-main" id="list-nav">
          <div class="list-type-nav-container" id="list-type-nav">
            <div class="list-type-dropdown-container">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <div class="list-type-dropdown-trigger"> 
                    {listTypeData.header}
                  </div>
                </DropdownMenuTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuContent sideOffset={8} align="start">
                    {listTypes.map( typeMap =>
                      <DropdownMenuItem>
                        <Link to={"../lists/" + username + "/" + typeMap.name + "/" + watchListData.name}
                          class="list-type-dropdown-button"> 
                            {typeMap.header}
                        </Link>
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenuPortal>
              </DropdownMenu>
            </div>
          </div>
          <div class="list-nav-buttons-container">
            {typedWatchlists.map( list =>
              <Link to={"../lists/" + username + "/" + listTypeData.name + "/" + list.name}
              class="list-nav-button"> 
                {list.header}
              </Link>
            )}
          </div>
        </div>
      </main>
    )
  }
  else {
    return (
      <main class="list-nav-buttons">
        <div class="list-nav-buttons-main" id="list-nav">
          <div class="list-nav-buttons-container">
            {typedWatchlists.map( list =>
              <Link to={"../lists/" + username + "/" + listTypeData.name + "/" + list.name}
              class="list-nav-button"> 
                {list.header}
              </Link>
            )}
          </div>
        </div>
      </main>
    )
  }
}
