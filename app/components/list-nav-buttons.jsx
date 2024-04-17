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
  const typedWatchlists = watchLists.reduce((x, y) => {
    (x[y.typeId] = x[y.typeId] || []).push(y);
     return x;
  },{});

  if (typedWatchlists && Object.keys(typedWatchlists).length > 1) {
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
                    {Object.entries(typedWatchlists).map(([key, value]) => 
                      <DropdownMenuItem>
                        <Link to={"../lists/" + username + "/" + listTypes.find(listType => listType.id == key).name + "/" + value.reduce((prev, curr) => prev.position < curr.position ? prev : curr).name}
                          class="list-type-dropdown-button"> 
                            {listTypes.find(listType => listType.id == key).header}
                        </Link>
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenuPortal>
              </DropdownMenu>
            </div>
          </div>
          <div class="list-nav-buttons-container">
            {typedWatchlists[listTypeData.id].map( list =>
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
            {typedWatchlists[listTypeData.id].map( list =>
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
