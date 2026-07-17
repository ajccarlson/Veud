import { Link } from '@remix-run/react'
import { useState, useEffect } from 'react'
import { Spacer } from '#app/components/spacer.tsx'
import { TypeSwitcher } from '#app/components/type-switcher.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { timeSince, getThumbnailInfo } from "#app/utils/lists/column-functions.tsx"
import { type ProfileData, type FavoriteItem } from '#app/utils/profile.ts'

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
  const [selectedFavorite, setSelectedFavorite] = useState(loaderData.listTypes[typeIndex]);
  const [displayAll, setDisplayAll] = useState(0);

  useEffect(() => {
  	setSelectedFavorite(loaderData.listTypes[typeIndex])
  }, [typeIndex, loaderData.listTypes]);

  const typedFavorites = (loaderData.favorites ?? []).reduce((x: Record<string, FavoriteItem[]>, y) => {
    (x[y.typeId] = x[y.typeId] || []).push(y);
     return x;
  }, {} as Record<string, FavoriteItem[]>);

  return (
    <div className="user-landing-favorites-container">
      <h1 className="user-landing-body-header">Favorites</h1>
      {loaderData.favorites && loaderData.favorites.length > 0 ?
        <div className="user-landing-favorites">
          <div className="user-landing-favorites-content">
          { displayAll == 1 ?
            <div className="user-landing-body-list-container">
              {loaderData.listTypes.map((mappedType) => {return(
                <div className="user-landing-body-list-full-display-container" key={mappedType.id}>
                  <div className="user-landing-list-type-header-container">
                    <h1 className="user-landing-list-type-header">{mappedType.header}</h1>
                    <h1 className="user-landing-favorites-count">{`(${typedFavorites[mappedType.id]?.length ?? 0})`}</h1>
                  </div>
                  <div className="user-landing-body-item-container">
                    {(typedFavorites[mappedType.id] ?? []).map((entry) =>
                      <div className="user-landing-favorites-body-item" key={entry.id}>
                        <Link to={getThumbnailInfo(entry.thumbnail!).url} className="user-landing-body-thumbnail-image" style={{backgroundImage: `url("${getThumbnailInfo(entry.thumbnail!).content}")`}}>
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
                    {typedFavorites[selectedFavorite.id].map((entry) =>
                      <div className="user-landing-favorites-body-item" key={entry.id}>
                        <Link to={getThumbnailInfo(entry.thumbnail!).url} className="user-landing-body-thumbnail-image" style={{backgroundImage: `url("${getThumbnailInfo(entry.thumbnail!).content}")`}}>
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
            <TypeSwitcher
              variant="primary"
              options={loaderData.listTypes.map(listType => ({ key: listType.id, label: listType.header }))}
              index={typeIndex}
              onIndexChange={setTypeIndex}
            />
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
