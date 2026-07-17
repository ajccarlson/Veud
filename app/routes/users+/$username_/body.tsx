import { Link, useRevalidator } from '@remix-run/react'
import { useState, useEffect } from 'react'
import { TypeSwitcher } from '#app/components/type-switcher.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { timeSince, getThumbnailInfo } from "#app/utils/lists/column-functions.tsx"
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
      </div>
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
