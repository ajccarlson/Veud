import { Link } from 'react-router'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuPortal,
	DropdownMenuTrigger,
} from '#app/components/ui/dropdown-menu.tsx'
import '#app/styles/list-nav-buttons.scss'
import { Icon } from '#app/components/ui/icon.tsx'

export function listNavButtons(typedWatchlists: any, username: any, listTypes: any, listTypeData: any, watchListData: any) {
  if (typedWatchlists && Object.keys(typedWatchlists).length > 1) {
    return (
      <main className="list-nav-buttons">
        <div className="list-nav-buttons-main" id="list-nav">
        <div className="list-nav-buttons-container">
            {typedWatchlists[listTypeData.id].map( (list: any) =>
              <Link to={"/lists/" + username + "/" + listTypeData.name + "/" + list.name}
              className={`list-nav-button ${watchListData.id == list.id? 'list-nav-current' : ''}`} id={list.id}> 
                {list.header}
              </Link>
            )}
          </div>
          <div className="list-type-nav-container" id="list-type-nav">
            <div className="list-type-dropdown-container">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <div className="list-type-dropdown-trigger"> 
                  <span className='list-type-dropdown-icon'>
                    <Icon name="hamburger-menu"></Icon>
                  </span>
                    <span>
                      {listTypeData.header}
                    </span>
                  </div>
                </DropdownMenuTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuContent sideOffset={8} align="start">
                    {Object.entries(typedWatchlists).filter(function([eKey, eValue]: [string, any]) { return eKey !== listTypeData.id }).map(([key, value]: [string, any]) => 
                      <DropdownMenuItem>
                        <Link to={"/lists/" + username + "/" + listTypes.find((listType: any) => listType.id == key).name + "/" + value.reduce((prev: any, curr: any) => prev.position < curr.position ? prev : curr).name}
                          className="list-type-dropdown-button"> 
                            {listTypes.find((listType: any) => listType.id == key).header}
                        </Link>
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenuPortal>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </main>
    )
  }
  else {
    return (
      <main className="list-nav-buttons">
        <div className="list-nav-buttons-main" id="list-nav">
          <div className="list-nav-buttons-container">
            {typedWatchlists[listTypeData.id].map( (list: any) =>
              <Link to={"/lists/" + username + "/" + listTypeData.name + "/" + list.name}
              className={`list-nav-button ${watchListData.id == list.id? 'list-nav-current' : ''}`} id={list.id}> 
                {list.header}
              </Link>
            )}
          </div>
        </div>
      </main>
    )
  }
}
