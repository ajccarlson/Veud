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
import { timeSince, getThumbnailInfo, getStartYear } from "#app/utils/lists/column-functions.jsx"

function RecentActivityData(loaderData) {
  const [typeIndex, setTypeIndex] = useState(0);
	const [selectedLatestUpdate, setSelectedLatestUpdate] = useState(loaderData.listTypes[typeIndex]);
  const [displayAll, setDisplayAll] = useState(0);

  useEffect(() => {
  	setSelectedLatestUpdate(loaderData.listTypes[typeIndex])
  }, [typeIndex, loaderData.listTypes]);

  function typedEntry(entry, selectedType) {
    return loaderData.typedEntries[selectedType.id][entry.index]
  }

	return (
		<div className="user-landing-recent-activity-container">
      <div className="user-landing-recent-activity-content">
        <h1 className="user-landing-body-header">Recent Activity</h1>
        { displayAll == 1 ?
          <div className="user-landing-body-list-container">
            {loaderData.listTypes.map(listType => {return(
              <div className="user-landing-body-list-full-display-container">
                <h1 className="user-landing-list-type-header">{listType.header}</h1>
                <div className="user-landing-body-item-container">
                  {loaderData.typedHistory[listType.id].slice(0, 12).map(entry =>
                    <div className="user-landing-recent-activity-body-item">
                    <Link to={getThumbnailInfo(typedEntry(entry, listType).thumbnail).url} className="user-landing-body-thumbnail-image" style={{backgroundImage: `url("${getThumbnailInfo(typedEntry(entry, listType).thumbnail).content}")`}}>
                      <span className="user-landing-thumbnail-header">
                        {getStartYear(typedEntry(entry, listType), listType, loaderData.listTypes)}
                      </span>
                      <span className="user-landing-activity-thumbnail-footer">
                        {typedEntry(entry, listType).title.length > 20 ? `${typedEntry(entry, listType).title.substring(0, 20)}...` : typedEntry(entry, listType).title}
                      </span>
                    </Link>
                    <div className="user-landing-body-text-container">
                      <span className="user-landing-body-latest-type">
                        {entry.type}
                      </span>
                      <div className="user-landing-body-latest-time-container">
                        <span className="user-landing-body-latest-time">
                          {`${timeSince(new Date(entry.time))} ago`}
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
            {loaderData.typedHistory[selectedLatestUpdate.id].slice(0, 12).map(entry =>
              <div className="user-landing-recent-activity-body-item">
                <Link to={getThumbnailInfo(typedEntry(entry, selectedLatestUpdate).thumbnail).url} className="user-landing-body-thumbnail-image" style={{backgroundImage: `url("${getThumbnailInfo(typedEntry(entry, selectedLatestUpdate).thumbnail).content}")`}}>
                  <span className="user-landing-thumbnail-header">
                    {getStartYear(typedEntry(entry, selectedLatestUpdate), selectedLatestUpdate, loaderData.listTypes)}
                  </span>
                  <span className="user-landing-activity-thumbnail-footer">
                    {typedEntry(entry, selectedLatestUpdate).title.length > 20 ? `${typedEntry(entry, selectedLatestUpdate).title.substring(0, 20)}...` : typedEntry(entry, selectedLatestUpdate).title}
                  </span>
                </Link>
                <div className="user-landing-body-text-container">
                  <span className="user-landing-body-latest-type">
                    {entry.type}
                  </span>
                  <div className="user-landing-body-latest-time-container">
                    <span className="user-landing-body-latest-time">
                      {`${timeSince(new Date(entry.time))} ago`}
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
          <button onClick={() => {setTypeIndex(typeIndex == 0 ? loaderData.listTypes.length - 1 : typeIndex - 1)}}>
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
                {loaderData.listTypes.filter(function(e) { return e.id !== selectedLatestUpdate.id }).map(listType =>
                  <DropdownMenuItem className="user-landing-dropdown-item" onClick={() =>
                    {
                      setTypeIndex(loaderData.listTypes.indexOf(type => type.id == listType.id))
                    }}>
                    {listType.header}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenuPortal>
          </DropdownMenu>
          <button onClick={() => {setTypeIndex((typeIndex + 1) % (loaderData.listTypes.length))}}>
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
  const [typeIndex, setTypeIndex] = useState(0);
	const [selectedFavorite, setSelectedFavorite] = useState(loaderData.listTypes[typeIndex]);
  const [displayAll, setDisplayAll] = useState(0);

  useEffect(() => {
  	setSelectedFavorite(loaderData.listTypes[typeIndex])
  }, [typeIndex, loaderData.listTypes]);

  const typedFavorites = loaderData.favorites?.reduce((x, y) => {
    (x[y.typeId] = x[y.typeId] || []).push(y);
     return x;
  },{});

	return (
		<div className="user-landing-favorites-container">
			<div className="user-landing-favorites-content">
        <h1 className="user-landing-body-header">Favorites</h1>
        { displayAll == 1 ?
          <div className="user-landing-body-list-container">
            {loaderData.listTypes.map(mappedType => {return(
              <div className="user-landing-body-list-full-display-container">
                <div className="user-landing-list-type-header-container">
                  <h1 className="user-landing-list-type-header">{mappedType.header}</h1>
                  <h1 className="user-landing-favorites-count">{`(${typedFavorites[loaderData.listTypes.find((listType) => listType.id == mappedType.id).id].length})`}</h1>
                </div>
                <div className="user-landing-body-item-container">
                  {typedFavorites[loaderData.listTypes.find((listType) => listType.id == mappedType.id).id].map(entry =>
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
                  {/* <span className='user-landing-favorite-insert'>
                    <Icon name="plus"></Icon>
                  </span> */}
                  <Spacer size="2xs"/>
                </div>
                <Spacer size="2xs"/>
              </div>
            )})}
          </div>
        : <div>
          <h1 className="user-landing-favorites-count">{`(${typedFavorites[selectedFavorite.id].length})`}</h1>
          <div className="user-landing-body-list-container">
            <div className="user-landing-body-item-container">  
              {typedFavorites[selectedFavorite.id].map(entry =>
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
              {/* <span className='user-landing-favorite-insert'>
                <Icon name="plus"></Icon>
              </span> */}
            </div>
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
          <button onClick={() => {setTypeIndex(typeIndex == 0 ? loaderData.listTypes.length - 1 : typeIndex - 1)}}>
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
                {loaderData.listTypes.filter(function(e) { return e !== selectedFavorite.header }).map(listType =>
                  <DropdownMenuItem className="user-landing-dropdown-item" onClick={() =>
                    {
                      setTypeIndex(loaderData.listTypes.indexOf(type => type.id == listType.id))
                    }}>
                    {listType.header}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenuPortal>
          </DropdownMenu>
          <button onClick={() => {setTypeIndex((typeIndex + 1) % (loaderData.listTypes.length))}}>
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
