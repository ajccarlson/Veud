<<<<<<< HEAD
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
import { StatsData } from '#app/routes/users+/$username_/stats_/index.tsx'
import { timeSince, getThumbnailInfo, getStartYear } from "#app/utils/lists/column-functions.tsx"

function RecentActivityData(loaderData: any) {
  const [typeIndex, setTypeIndex] = useState(0);
	const [selectedLatestUpdate, setSelectedLatestUpdate] = useState(loaderData.listTypes[typeIndex]);
  const [displayAll, setDisplayAll] = useState(0);

  useEffect(() => {
  	setSelectedLatestUpdate(loaderData.listTypes[typeIndex])
  }, [typeIndex, loaderData.listTypes]);

  function typedEntry(entry: any, selectedType: any) {
    return loaderData.typedEntries[selectedType.id][entry.index]
  }

	return (
		<div className="user-landing-recent-activity-container">
      <h1 className="user-landing-body-header">Recent Activity</h1>
      {loaderData.typedHistory && Object.entries(loaderData.typedHistory).length > 0 ?
        <div className="user-landing-favorites">
          <div className="user-landing-recent-activity-content">
            { displayAll == 1 ?
              <div className="user-landing-body-list-container">
                {loaderData.listTypes.map((listType: any) => {return(
                  <div className="user-landing-body-list-full-display-container" key={listType.id}>
                    <h1 className="user-landing-list-type-header">{listType.header}</h1>
                    <div className="user-landing-body-item-container">
                      {loaderData.typedHistory[listType.id] && loaderData.typedHistory[listType.id].length > 0 ?
                        loaderData.typedHistory[listType.id].slice(0, 12).map((entry: any) =>
                          <div className="user-landing-recent-activity-body-item" key={listType.id}>
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
                        )
                      :
                        null
                      }
                    </div>
                    <Spacer size="2xs"/>
                  </div>
                )})}
              </div>
            : 
              <div className="user-landing-body-list-container">
                <div className="user-landing-body-item-container">
                  {loaderData.typedHistory[selectedLatestUpdate.id] && loaderData.typedHistory[selectedLatestUpdate.id].length > 0 ? 
                    loaderData.typedHistory[selectedLatestUpdate.id].slice(0, 12).map((entry: any) =>
                      <div className="user-landing-recent-activity-body-item" key={entry.id}>
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
                    )
                  :
                    null
                  }
                </div>
              </div>
            }
          </div>
          {displayAll == 1 ? 
            <div className="user-landing-nav-button-container">
              <button className="user-landing-reveal-button" onClick={() => {setDisplayAll(1 - displayAll)}}>
                <Icon name="caret-up" className="user-landing-nav-arrow user-landing-up-arrow"></Icon>
              </button>
            </div>
          :
            <div className="user-landing-nav-button-container">
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
                  <DropdownMenuPortal>
                    <DropdownMenuContent sideOffset={8} align="start" className="user-landing-dropdown-item-container">
                      {loaderData.listTypes.filter(function(e: any) { return e.id !== selectedLatestUpdate.id }).map((listType: any) =>
                        <DropdownMenuItem className="user-landing-dropdown-item" key={listType.id} onClick={() =>
                          {
                            setTypeIndex(loaderData.listTypes.findIndex((type: any) => type.id == listType.id))
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
            </div>
          }
        </div>
      :
        <div className="user-landing-empty-message">No updates yet</div>
      }
		</div>
	)
}

function FavoritesData(loaderData: any) {
  const [typeIndex, setTypeIndex] = useState(0);
	const [selectedFavorite, setSelectedFavorite] = useState(loaderData.listTypes[typeIndex]);
  const [displayAll, setDisplayAll] = useState(0);

  useEffect(() => {
  	setSelectedFavorite(loaderData.listTypes[typeIndex])
  }, [typeIndex, loaderData.listTypes]);

  const typedFavorites = loaderData.favorites?.reduce((x: any, y: any) => {
    (x[y.typeId] = x[y.typeId] || []).push(y);
     return x;
  },{});

	return (
		<div className="user-landing-favorites-container">
      <h1 className="user-landing-body-header">Favorites</h1>
      {loaderData.favorites && loaderData.favorites.length > 0 ? 
        <div className="user-landing-favorites">
          <div className="user-landing-favorites-content">
          { displayAll == 1 ?
            <div className="user-landing-body-list-container">
              {loaderData.listTypes.map((mappedType: any) => {return(
                <div className="user-landing-body-list-full-display-container" key={mappedType.id}>
                  <div className="user-landing-list-type-header-container">
                    <h1 className="user-landing-list-type-header">{mappedType.header}</h1>
                    <h1 className="user-landing-favorites-count">{`(${typedFavorites[loaderData.listTypes.find((listType: any) => listType.id == mappedType.id).id].length})`}</h1>
                  </div>
                  <div className="user-landing-body-item-container">
                    {typedFavorites[loaderData.listTypes.find((listType: any) => listType.id == mappedType.id).id].map((entry: any) =>
                      <div className="user-landing-favorites-body-item" key={entry.id}>
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
          : typedFavorites[selectedFavorite.id] && typedFavorites[selectedFavorite.id].length > 0 ?
              <div>
                <h1 className="user-landing-favorites-count">{`(${typedFavorites[selectedFavorite.id].length})`}</h1>
                <div className="user-landing-body-list-container">
                  <div className="user-landing-body-item-container">  
                    {typedFavorites[selectedFavorite.id].map((entry: any) =>
                      <div className="user-landing-favorites-body-item" key={entry.id}>
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
              </div>
            :
              null
          }
        </div>
        { displayAll == 1 ? 
          <div className="user-landing-nav-button-container">
            <button className="user-landing-reveal-button" onClick={() => {setDisplayAll(1 - displayAll)}}>
              <Icon name="caret-up" className="user-landing-nav-arrow user-landing-up-arrow"></Icon>
            </button>
          </div>
        :
          <div className="user-landing-nav-button-container">
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
                <DropdownMenuPortal>
                  <DropdownMenuContent sideOffset={8} align="start" className="user-landing-dropdown-item-container">
                    {loaderData.listTypes.filter(function(e: any) { return e.id !== selectedFavorite.id }).map((listType: any) =>
                      <DropdownMenuItem className="user-landing-dropdown-item" key={listType.id} onClick={() =>
                        {
                          setTypeIndex(loaderData.listTypes.findIndex((type: any) => type.id == listType.id))
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
          </div>
        }
        </div>
      :
        <div className="user-landing-empty-message">No favorites yet</div> 
      }
		</div>
	)
}

export function BodyData(loaderData: any) {
	return (
		<div className="user-landing-body-container">
			{StatsData(loaderData)}
			{RecentActivityData(loaderData)}
			{FavoritesData(loaderData)}
		</div>
	)
}
=======
import { useState, useEffect } from 'react'
import { Link, useRevalidator } from 'react-router'
import { FavoriteSearch } from '#app/components/favorite-search.tsx'
import { TypeSwitcher } from '#app/components/type-switcher.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import {
	timeSince,
	getThumbnailInfo,
} from '#app/utils/lists/column-functions.tsx'
import { type ProfileData, type FavoriteItem } from '#app/utils/profile.ts'
import { useOptionalUser } from '#app/utils/user.ts'

export function RecentActivityData({ data: loaderData }: { data: ProfileData }) {
  const PAGE_SIZE = 15
  const [filterIndex, setFilterIndex] = useState(0);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const filterOptions = [
    { key: 'all', label: 'All' },
    ...loaderData.listTypes.map(type => ({ key: type.id, label: type.header })),
  ]
  const selectedFilter = filterOptions[filterIndex] ?? filterOptions[0]

  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [filterIndex]);

  // Merge every list type's history into a single newest-first feed, tagging each
  // item with its type so we can look the entry (thumbnail/title) back up.
  const allActivity = Object.entries(loaderData.typedHistory)
    .flatMap(([typeId, items]) => items.map(item => ({ ...item, typeId })))
    .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())

  const filtered = selectedFilter.key === 'all'
    ? allActivity
    : allActivity.filter(item => item.typeId === selectedFilter.key)

  const visible = filtered.slice(0, visibleCount)

  return (
    <div className="user-landing-recent-activity-container">
      <h1 className="user-landing-body-header">Recent Activity</h1>
      {allActivity.length > 0 ? (
        <div className="user-landing-feed-wrapper">
          <div className="user-landing-feed-controls">
            <TypeSwitcher
              variant="primary"
              options={filterOptions}
              index={filterIndex}
              onIndexChange={setFilterIndex}
            />
          </div>
          {visible.length > 0 ? (
            <ul className="user-landing-feed">
              {visible.map((item, i) => {
                const entry = loaderData.typedEntries[item.typeId]?.[item.index]
                const thumb = entry?.thumbnail ? getThumbnailInfo(entry.thumbnail) : null
                return (
                  <li className="user-landing-feed-item" key={`${item.typeId}-${item.index}-${i}`}>
                    {thumb ? (
                      <Link
                        to={thumb.url}
                        className="user-landing-feed-thumbnail"
                        style={{ backgroundImage: `url("${thumb.content}")` }}
                        aria-label={entry?.title}
                      />
                    ) : (
                      <div className="user-landing-feed-thumbnail" />
                    )}
                    <div className="user-landing-feed-body">
                      {entry?.title ? (
                        <span className="user-landing-feed-title">{entry.title}</span>
                      ) : null}
                      <span className="user-landing-feed-action">{item.type}</span>
                    </div>
                    <span className="user-landing-feed-time">
                      {`${timeSince(new Date(item.time))} ago`}
                    </span>
                  </li>
                )
              })}
            </ul>
          ) : (
            <div className="user-landing-empty-message">No updates for this type</div>
          )}
          {visibleCount < filtered.length ? (
            <div className="user-landing-feed-more">
              <button
                type="button"
                className="user-landing-feed-more-button"
                onClick={() => setVisibleCount(count => count + PAGE_SIZE)}
              >
                Load more
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="user-landing-empty-message">No updates yet</div>
      )}
    </div>
  )
}

export function FavoritesData({ data: loaderData }: { data: ProfileData }) {
  const [typeIndex, setTypeIndex] = useState(0);
  const revalidator = useRevalidator()
  const isOwner = useOptionalUser()?.id === loaderData.user.id
  const [showAdd, setShowAdd] = useState(false)

  const selectedType = loaderData.listTypes[typeIndex]

  const typedFavorites = (loaderData.favorites ?? []).reduce((x: Record<string, FavoriteItem[]>, y) => {
    (x[y.typeId] = x[y.typeId] || []).push(y);
     return x;
  }, {} as Record<string, FavoriteItem[]>);

  const favorites = (typedFavorites[selectedType?.id ?? ''] ?? [])
    .slice()
    .sort((a, b) => a.position - b.position)

  async function removeFavorite(id: string) {
    await fetch(
      '/lists/fetch/remove-favorite/' +
        encodeURIComponent(new URLSearchParams({ id }).toString()),
      { method: 'POST' },
    )
    revalidator.revalidate()
  }

  async function moveFavorite(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= favorites.length) return
    // Rebuild the whole category's order and reassign contiguous 1..N positions, so a
    // move is robust even if the stored positions have gaps or ties.
    const reordered = favorites.slice()
    const [moved] = reordered.splice(index, 1)
    reordered.splice(target, 0, moved)
    const order = reordered.map((favorite, position) => ({
      id: favorite.id,
      position: position + 1,
    }))
    await fetch(
      '/lists/fetch/reorder-favorite/' +
        encodeURIComponent(new URLSearchParams({ order: JSON.stringify(order) }).toString()),
      { method: 'POST' },
    )
    revalidator.revalidate()
  }

  return (
    <div className="user-landing-favorites-container">
      <h1 className="user-landing-body-header">Favorites</h1>
      <div className="user-landing-favorites-controls">
        <TypeSwitcher
          variant="primary"
          options={loaderData.listTypes.map(type => ({ key: type.id, label: type.header }))}
          index={typeIndex}
          onIndexChange={setTypeIndex}
        />
        <span className="user-landing-favorites-count">{`(${favorites.length})`}</span>
        {isOwner && selectedType ? (
          <button
            type="button"
            className="user-landing-favorite-add-toggle"
            title={showAdd ? 'Close search' : 'Add to favorites'}
            onClick={() => setShowAdd(open => !open)}
          >
            <Icon name={showAdd ? 'cross-1' : 'plus'} />
          </button>
        ) : null}
      </div>
      {isOwner && showAdd && selectedType ? (
        <FavoriteSearch
          listType={selectedType}
          position={favorites.length + 1}
          onAdded={() => revalidator.revalidate()}
        />
      ) : null}
      {favorites.length > 0 ? (
        <div className="user-landing-favorites-grid">
          {favorites.map((favorite, index) => {
            const thumb = favorite.thumbnail ? getThumbnailInfo(favorite.thumbnail) : null
            return (
              <div className="user-landing-favorite-card" key={favorite.id}>
                <Link
                  to={thumb?.url ?? '#'}
                  className="user-landing-favorite-thumbnail"
                  style={thumb ? { backgroundImage: `url("${thumb.content}")` } : undefined}
                >
                  <span className="user-landing-favorite-meta">
                    <span className="user-landing-favorite-year">{favorite.startYear}</span>
                    <span className="user-landing-favorite-media-type">{favorite.mediaType}</span>
                  </span>
                  <span className="user-landing-favorite-title">
                    {favorite.title.length > 20 ? `${favorite.title.substring(0, 20)}...` : favorite.title}
                  </span>
                </Link>
                {isOwner ? (
                  <div className="user-landing-favorite-actions">
                    <button
                      type="button"
                      title="Move left"
                      onClick={() => moveFavorite(index, -1)}
                      disabled={index === 0}
                    >
                      <Icon name="chevron-left" />
                    </button>
                    <button
                      type="button"
                      title="Remove favorite"
                      className="user-landing-favorite-remove"
                      onClick={() => removeFavorite(favorite.id)}
                    >
                      <Icon name="cross-1" />
                    </button>
                    <button
                      type="button"
                      title="Move right"
                      onClick={() => moveFavorite(index, 1)}
                      disabled={index === favorites.length - 1}
                    >
                      <Icon name="chevron-right" />
                    </button>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="user-landing-empty-message">No favorites yet</div>
      )}
    </div>
  )
}
>>>>>>> develop
