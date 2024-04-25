import { useState, useEffect } from 'react'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuPortal,
	DropdownMenuTrigger,
} from '#app/components/ui/dropdown-menu.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { StatsData } from '#app/routes/users+/$username_/stats_/index.jsx'
import { timeSince, hyperlinkRenderer } from "#app/utils/lists/column-functions.jsx"

function RecentActivityData(loaderData) {
  const [headerIndex, setHeaderIndex] = useState(0);
	const [selectedLatestUpdate, setSelectedLatestUpdate] = useState(loaderData.listTypes[headerIndex]);
  const [displayAll, setDisplayAll] = useState(0);

  useEffect(() => {
  	setSelectedLatestUpdate(loaderData.listTypes[headerIndex])
  }, [headerIndex, loaderData.listTypes]);

  const listHeaders = loaderData.listTypes.map(listType => listType.header)

	return (
		<div className="user-landing-recent-activity-container">
			<h1 className="user-landing-body-header">Recent Activity</h1>
      <div className="user-landing-recent-activity-content">
        { displayAll == 1 ?
          <div className="user-landing-body-list-container">
            {listHeaders.map(listHeader => {return(
              <div className="user-landing-body-list-full-display-container">
                <h1 className="user-landing-list-type-header">{listHeader}</h1>
                <div className="user-landing-body-item-container">
                  {loaderData.typedEntries[listHeader].slice(0, 10).map(entry =>
                    <div className="user-landing-body-item">
                      <div className="user-landing-body-thumbnail-container">
                        {hyperlinkRenderer(entry.thumbnail, "thumbnail")}
                      </div>
                      <div className="user-landing-body-text-container">
                        <span className="user-landing-body-title">
                          {entry.title}
                        </span>
                        <span className="user-landing-body-latest-type">
                          {entry.history.mostRecent.type}
                        </span>
                        <span className="user-landing-body-latest-time">
                          {`${timeSince(new Date(entry.history.mostRecent.time))} ago`}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )})}
          </div>
        : <div className="user-landing-body-list-container">
          <div className="user-landing-body-item-container">
            {loaderData.typedEntries[selectedLatestUpdate.header].slice(0, 10).map(entry =>
              <div className="user-landing-body-item">
                <div className="user-landing-body-thumbnail-container">
                  {hyperlinkRenderer(entry.thumbnail, "thumbnail")}
                </div>
                <div className="user-landing-body-text-container">
                  <span className="user-landing-body-title">
                    {entry.title}
                  </span>
                  <span className="user-landing-body-latest-type">
                    {entry.history.mostRecent.type}
                  </span>
                  <span className="user-landing-body-latest-time">
                    {`${timeSince(new Date(entry.history.mostRecent.time))} ago`}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div> }
      </div>
      { displayAll == 1 ? 
        <div className="user-landing-nav-button-container">
          <button className="user-landing-reveal-button" onClick={() => {setDisplayAll(1 - displayAll)}}>
            <Icon name="caret-up" className="user-landing-nav-arrow"></Icon>
          </button>
        </div>
      :<div className="user-landing-nav-button-container">
        <div className="user-landing-selection-nav-container">
          <button onClick={() => {setHeaderIndex(headerIndex == 0 ? listHeaders.length - 1 : headerIndex - 1)}}>
            <Icon name="triangle-left" className="user-landing-nav-arrow"></Icon>
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <div className="user-landing-dropdown-trigger"> 
                {selectedLatestUpdate.header}
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuPortal className="user-landing-dropdown-portal">
              <DropdownMenuContent sideOffset={8} align="start" className="user-landing-dropdown-item-container">
                {listHeaders.filter(function(e) { return e !== selectedLatestUpdate.header }).map(listType =>
                  <DropdownMenuItem className="user-landing-dropdown-item" onClick={() =>
                    {
                      setHeaderIndex(listHeaders.indexOf(listType))
                    }}>
                    {listType}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenuPortal>
          </DropdownMenu>
          <button onClick={() => {setHeaderIndex((headerIndex + 1) % (listHeaders.length))}}>
            <Icon name="triangle-right" className="user-landing-nav-arrow"></Icon>
          </button>
        </div>
        <button className="user-landing-reveal-button" onClick={() => {setDisplayAll(1 - displayAll)}}>
          <Icon name="caret-down" className="user-landing-nav-arrow"></Icon>
        </button>
      </div> }
		</div>
	)
}

function FavoritesData(loaderData) {
  const [headerIndex, setHeaderIndex] = useState(0);
	const [selectedFavorite, setSelectedFavorite] = useState(loaderData.listTypes[headerIndex]);
  const [displayAll, setDisplayAll] = useState(0);

  useEffect(() => {
  	setSelectedFavorite(loaderData.listTypes[headerIndex])
  }, [headerIndex, loaderData.listTypes]);

  const typedFavorites = loaderData.favorites?.reduce((x, y) => {
    (x[y.typeId] = x[y.typeId] || []).push(y);
     return x;
  },{});

  const listHeaders = loaderData.listTypes.map(listType => listType.header)

	return (
		<div className="user-landing-favorites-container">
			<h1 className="user-landing-body-header">Favorites</h1>
			<div className="user-landing-favorites-content">
        { displayAll == 1 ?
          <div className="user-landing-body-list-container">
            {listHeaders.map(listHeader => {return(
              <div className="user-landing-body-list-full-display-container">
                <h1 className="user-landing-list-type-header">{listHeader}</h1>
                <div className="user-landing-body-item-container">
                {typedFavorites[loaderData.listTypes.find((listType) => listType.header == listHeader).id].slice(0, 10).map(entry =>
                  <div className="user-landing-body-list-container">
                    <div className="user-landing-body-item">
                      <div className="user-landing-body-thumbnail-container">
                        {hyperlinkRenderer(entry.thumbnail, "thumbnail")}
                      </div>
                      <div className="user-landing-body-text-container">
                        <span className="user-landing-body-title">
                          {entry.title}
                        </span>
                        <span className="user-landing-body-media-type">
                          {entry.mediaType}
                        </span>
                        <span className="user-landing-start-year">
                          {new Date(entry.startYear).getFullYear()}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
                </div>
              </div>
            )})}
          </div>
        : <div className="user-landing-body-list-container">
          <div className="user-landing-body-item-container">  
            {typedFavorites[selectedFavorite.id].slice(0, 10).map(entry =>
              <div className="user-landing-body-list-container">
                <div className="user-landing-body-item-container">
                  <div className="user-landing-body-item">
                    <div className="user-landing-body-thumbnail-container">
                      {hyperlinkRenderer(entry.thumbnail, "thumbnail")}
                    </div>
                    <div className="user-landing-body-text-container">
                      <span className="user-landing-body-title">
                        {entry.title}
                      </span>
                      <span className="user-landing-body-media-type">
                        {entry.mediaType}
                      </span>
                      <span className="user-landing-start-year">
                        {new Date(entry.startYear).getFullYear()}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div> }
			</div>
      { displayAll == 1 ? 
        <div className="user-landing-nav-button-container">
          <button className="user-landing-reveal-button" onClick={() => {setDisplayAll(1 - displayAll)}}>
            <Icon name="caret-up" className="user-landing-nav-arrow"></Icon>
          </button>
        </div>
      :<div className="user-landing-nav-button-container">
        <div className="user-landing-selection-nav-container">
          <button onClick={() => {setHeaderIndex(headerIndex == 0 ? listHeaders.length - 1 : headerIndex - 1)}}>
            <Icon name="triangle-left" className="user-landing-nav-arrow"></Icon>
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <div className="user-landing-dropdown-trigger"> 
                {selectedFavorite.header}
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuPortal className="user-landing-dropdown-portal">
              <DropdownMenuContent sideOffset={8} align="start" className="user-landing-dropdown-item-container">
                {listHeaders.filter(function(e) { return e !== selectedFavorite.header }).map(listType =>
                  <DropdownMenuItem className="user-landing-dropdown-item" onClick={() =>
                    {
                      setHeaderIndex(listHeaders.indexOf(listType))
                    }}>
                    {listType}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenuPortal>
          </DropdownMenu>
          <button onClick={() => {setHeaderIndex((headerIndex + 1) % (listHeaders.length))}}>
            <Icon name="triangle-right" className="user-landing-nav-arrow"></Icon>
          </button>
        </div>
        <button className="user-landing-reveal-button" onClick={() => {setDisplayAll(1 - displayAll)}}>
          <Icon name="caret-down" className="user-landing-nav-arrow"></Icon>
        </button>
      </div> }
		</div>
	)
}

export function BodyData(loaderData) {
	return (
		<div className="user-landing-body-container">
			{StatsData(loaderData)}
			{RecentActivityData(loaderData)}
			{FavoritesData(loaderData)}
		</div>
	)
}
