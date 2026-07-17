import { Link } from '@remix-run/react'
import { useState, useEffect } from 'react'
import { Spacer } from '#app/components/spacer.tsx'
import { TypeSwitcher } from '#app/components/type-switcher.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { timeSince, getThumbnailInfo, getStartYear } from "#app/utils/lists/column-functions.tsx"
import { type ProfileData, type FavoriteItem } from '#app/utils/profile.ts'

export function RecentActivityData({ data: loaderData }: { data: ProfileData }) {
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
                {loaderData.listTypes.map((listType) => {return(
                  <div className="user-landing-body-list-full-display-container" key={listType.id}>
                    <h1 className="user-landing-list-type-header">{listType.header}</h1>
                    <div className="user-landing-body-item-container">
                      {loaderData.typedHistory[listType.id] && loaderData.typedHistory[listType.id].length > 0 ?
                        loaderData.typedHistory[listType.id].slice(0, 12).map((entry, entryIndex) =>
                          <div className="user-landing-recent-activity-body-item" key={`${listType.id}-${entryIndex}`}>
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
                    loaderData.typedHistory[selectedLatestUpdate.id].slice(0, 12).map((entry, entryIndex) =>
                      <div className="user-landing-recent-activity-body-item" key={`${selectedLatestUpdate.id}-${entryIndex}`}>
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
        <div className="user-landing-empty-message">No updates yet</div>
      }
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
