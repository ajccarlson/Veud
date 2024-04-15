import { Link } from "@remix-run/react"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuPortal,
	DropdownMenuTrigger,
} from '#app/components/ui/dropdown-menu.tsx'
import "#app/styles/list-nav-buttons.scss"

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
      <main class="list-nav-buttons">
        <div class="list-nav-buttons-main" id="list-nav">
          <div class="list-type-nav-container" id="list-type-nav">
            <div class="list-type-dropdown-container">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <div class="list-type-dropdown-trigger"> 
                    {currentType.formatted}
                  </div>
                </DropdownMenuTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuContent sideOffset={8} align="start">
                    {listTypes.map( typeMap =>
                      <DropdownMenuItem>
                        <Link to={typeMap.url}
                          class="list-type-dropdown-button"> 
                            {typeMap.formatted}
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
              <Link to={"../lists/" + username + "/" + listType + "/" + list.name}
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
              <Link to={"../lists/" + username + "/" + listType + "/" + list.name}
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
