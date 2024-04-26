import { Link } from '@remix-run/react'
import { useState, useEffect } from 'react'
import { Spacer } from '#app/components/spacer.tsx'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuPortal,
	DropdownMenuTrigger,
} from '#app/components/ui/dropdown-menu.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { StatsData } from '#app/routes/users+/$username_/stats_/index.jsx'
import { timeSince } from "#app/utils/lists/column-functions.jsx"

function getThumbnailInfo(thumbnail) {
  const separatorIndex = thumbnail.indexOf("|")

  return {
    content: thumbnail.slice(0, separatorIndex),
    url: thumbnail.slice(separatorIndex + 1)
  }
}

function getStartYear(entry, listHeader, listTypes) {
  const typeData = listTypes.find((listType) => listType.header == listHeader)

  if (Object.keys(JSON.parse(typeData.columns)).includes("airYear")) {
    return entry.airYear
  }
  else if (Object.keys(JSON.parse(typeData.columns)).includes("startSeason")) {
    return entry.startSeason
  }
  else if (Object.keys(JSON.parse(typeData.columns)).includes("startYear")) {
    return entry.startYear
  }
  else {
    return false
  }
}

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
      <div className="user-landing-recent-activity-content">
        <h1 className="user-landing-body-header">Recent Activity</h1>
        { displayAll == 1 ?
          <div className="user-landing-body-list-container">
            {listHeaders.map(listHeader => {return(
              <div className="user-landing-body-list-full-display-container">
                <h1 className="user-landing-list-type-header">{listHeader}</h1>
                <div className="user-landing-body-item-container">
                  {loaderData.typedEntries[listHeader].slice(0, 12).map(entry =>
                    <div className="user-landing-recent-activity-body-item">
                    <Link to={getThumbnailInfo(entry.thumbnail).url} className="user-landing-body-thumbnail-image" style={{backgroundImage: `url("${getThumbnailInfo(entry.thumbnail).content}")`}}>
                      <span className="user-landing-thumbnail-header">
                        {getStartYear(entry, listHeader, loaderData.listTypes)}
                      </span>
                      <span className="user-landing-activity-thumbnail-footer">
                        {entry.title.length > 20 ? `${entry.title.substring(0, 20)}...` : entry.title}
                      </span>
                    </Link>
                    <div className="user-landing-body-text-container">
                      <span className="user-landing-body-latest-type">
                        {entry.history.mostRecent.type}
                      </span>
                      <div className="user-landing-body-latest-time-container">
                        <span className="user-landing-body-latest-time">
                          {`${timeSince(new Date(entry.history.mostRecent.time))} ago`}
                        </span>
                      </div>
                    </div>
                  </div>
                  )}
                </div>
                <Spacer size="2xs"/>
              </div>
            )})}
          </div>
        : <div className="user-landing-body-list-container">
          <div className="user-landing-body-item-container">
            {loaderData.typedEntries[selectedLatestUpdate.header].slice(0, 12).map(entry =>
              <div className="user-landing-recent-activity-body-item">
                <Link to={getThumbnailInfo(entry.thumbnail).url} className="user-landing-body-thumbnail-image" style={{backgroundImage: `url("${getThumbnailInfo(entry.thumbnail).content}")`}}>
                  <span className="user-landing-thumbnail-header">
                    {getStartYear(entry, selectedLatestUpdate.header, loaderData.listTypes)}
                  </span>
                  <span className="user-landing-activity-thumbnail-footer">
                    {entry.title.length > 20 ? `${entry.title.substring(0, 20)}...` : entry.title}
                  </span>
                </Link>
                <div className="user-landing-body-text-container">
                  <span className="user-landing-body-latest-type">
                    {entry.history.mostRecent.type}
                  </span>
                  <div className="user-landing-body-latest-time-container">
                    <span className="user-landing-body-latest-time">
                      {`${timeSince(new Date(entry.history.mostRecent.time))} ago`}
                    </span>
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
            <Icon name="caret-up" className="user-landing-nav-arrow user-landing-up-arrow"></Icon>
          </button>
        </div>
      :<div className="user-landing-nav-button-container">
        <div className="user-landing-selection-nav-container">
          <button onClick={() => {setHeaderIndex(headerIndex == 0 ? listHeaders.length - 1 : headerIndex - 1)}}>
            <Icon name="triangle-left" className="user-landing-nav-arrow user-landing-left-arrow"></Icon>
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
            <Icon name="triangle-right" className="user-landing-nav-arrow user-landing-right-arrow"></Icon>
          </button>
        </div>
        <button className="user-landing-reveal-button" onClick={() => {setDisplayAll(1 - displayAll)}}>
          <Icon name="caret-down" className="user-landing-nav-arrow user-landing-down-arrow"></Icon>
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
			<div className="user-landing-favorites-content">
        <h1 className="user-landing-body-header">Favorites</h1>
        { displayAll == 1 ?
          <div className="user-landing-body-list-container">
            {listHeaders.map(listHeader => {return(
              <div className="user-landing-body-list-full-display-container">
                <h1 className="user-landing-list-type-header">{listHeader}</h1>
                <div className="user-landing-body-item-container">
                  {typedFavorites[loaderData.listTypes.find((listType) => listType.header == listHeader).id].slice(0, 12).map(entry =>
                    <div className="user-landing-favorites-body-item">
                      <Link to={getThumbnailInfo(entry.thumbnail).url} className="user-landing-body-thumbnail-image" style={{backgroundImage: `url("${getThumbnailInfo(entry.thumbnail).content}")`}}>
                        <span className="user-landing-thumbnail-header">
                          <div className="user-landing-thumbnail-start-year">
                            {entry.startYear}
                          </div>
                          <div className="user-landing-thumbnail-media-type">
                            {entry.mediaType}
                          </div>
                        </span>
                        <span className="user-landing-thumbnail-footer">
                          {entry.title.length > 20 ? `${entry.title.substring(0, 20)}...` : entry.title}
                        </span>
                      </Link>
                    </div>
                  )}
                  <span className='user-landing-favorite-insert'>
                    <Icon name="plus"></Icon>
                  </span>
                  <Spacer size="2xs"/>
                </div>
                <Spacer size="2xs"/>
              </div>
            )})}
          </div>
        : <div className="user-landing-body-list-container">
          <div className="user-landing-body-item-container">  
            {typedFavorites[selectedFavorite.id].slice(0, 12).map(entry =>
              <div className="user-landing-favorites-body-item">
                <Link to={getThumbnailInfo(entry.thumbnail).url} className="user-landing-body-thumbnail-image" style={{backgroundImage: `url("${getThumbnailInfo(entry.thumbnail).content}")`}}>
                  <span className="user-landing-thumbnail-header">
                    <div className="user-landing-thumbnail-start-year">
                      {entry.startYear}
                    </div>
                    <div className="user-landing-thumbnail-media-type">
                      {entry.mediaType}
                    </div>
                  </span>
                  <span className="user-landing-thumbnail-footer">
                    {entry.title.length > 20 ? `${entry.title.substring(0, 20)}...` : entry.title}
                  </span>
                </Link>
              </div>
            )}
            <span className='user-landing-favorite-insert'>
              <Icon name="plus"></Icon>
            </span>
          </div>
        </div> }
			</div>
      { displayAll == 1 ? 
        <div className="user-landing-nav-button-container">
          <button className="user-landing-reveal-button" onClick={() => {setDisplayAll(1 - displayAll)}}>
            <Icon name="caret-up" className="user-landing-nav-arrow user-landing-up-arrow"></Icon>
          </button>
        </div>
      :<div className="user-landing-nav-button-container">
        <div className="user-landing-selection-nav-container">
          <button onClick={() => {setHeaderIndex(headerIndex == 0 ? listHeaders.length - 1 : headerIndex - 1)}}>
            <Icon name="triangle-left" className="user-landing-nav-arrow user-landing-left-arrow"></Icon>
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
            <Icon name="triangle-right" className="user-landing-nav-arrow user-landing-right-arrow"></Icon>
          </button>
        </div>
        <button className="user-landing-reveal-button" onClick={() => {setDisplayAll(1 - displayAll)}}>
          <Icon name="caret-down" className="user-landing-nav-arrow user-landing-down-arrow"></Icon>
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
