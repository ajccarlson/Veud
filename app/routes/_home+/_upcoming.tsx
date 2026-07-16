import { Link } from '@remix-run/react'
import { useEffect, useState } from 'react'
import { getAnilistSchedule } from "#app/routes/media+/mal.ts"
import { getTMDBInfo } from "#app/routes/media+/tmdb.ts"
import { getThumbnailInfo, getSiteIdSafe } from "#app/utils/lists/column-functions.tsx"

// Only titles whose current run ended within this window (or that are ongoing / have no known
// end) are re-checked for a newly-scheduled release. This keeps the home page from re-fetching
// the entire library while still surfacing recently-active shows that are returning.
const RECENT_WINDOW_MS = 3 * 365 * 24 * 60 * 60 * 1000

export function UpcomingData(params: any) {
  // Releases are computed client-side inside a gated, abortable effect rather than in the
  // render body. The media lookups go through the relative `/media/fetch-data` proxy (which
  // only resolves in the browser), so running them here — not during render/SSR — fixes the
  // server-log `ERR_INVALID_URL` noise and stops the per-render refetch + render-time DB write.
  const [sortedDays, setSortedDays] = useState<Record<string, any[]>>({})

  useEffect(() => {
    if (!params.user || !params.userTypedEntries) return

    let cancelled = false
    const controller = new AbortController()
    const today = new Date().setHours(0, 0, 0, 0)
    const upcomingReleases: Record<string, any[]> = {}

    // Push a resolved (future) release into its day bucket.
    function bucket(listEntry: any, parsedNext: any) {
      const dateObject = new Date(parsedNext.releaseDate)

      let nextEntry: any, nextSet: any
      if (Object.keys(parsedNext).includes("chapter")) {
        if (parsedNext.volume) {
          nextSet = `Volume ${parsedNext.volume} `
        }

        nextEntry = `Chapter ${parsedNext.chapter}`
      } else {
        if (parsedNext.season) {
          nextSet = `Season ${parsedNext.season} `
        }

        nextEntry = `Episode ${parsedNext.episode}`
      }

      const formattedDate = `${dateObject.getUTCFullYear()}/${dateObject.getMonth() + 1}/${dateObject.getDate()}`

      if (!upcomingReleases[formattedDate]) {
        upcomingReleases[formattedDate] = []
      }

      upcomingReleases[String(formattedDate)].push({
        listEntry: listEntry,
        nextEntry: nextEntry,
        nextSet: nextSet,
        nextRelease: parsedNext,
        releaseTime: `${dateObject.getHours()}:${String(dateObject.getMinutes()).padStart(2, "0")} ${dateObject.toLocaleTimeString('en-us', { timeZoneName: 'short' }).split(' ')[2]}`,
      })
    }

    // Publish the current buckets (sorted chronologically). Called incrementally so newly
    // discovered releases appear as they resolve rather than only after every lookup finishes.
    function commit() {
      if (cancelled) return
      const sorted = Object.keys(upcomingReleases)
        .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())
        .reduce(
          (obj, key) => {
            obj[key] = upcomingReleases[key]
            return obj
          },
          {} as Record<string, any[]>,
        )
      setSortedDays(sorted)
    }

    async function buildUpcoming() {
      for (const [typedEntryKey, typedEntryValue] of Object.entries(
        params.userTypedEntries,
      ) as [string, any][]) {
        for (const listEntry of typedEntryValue as any[]) {
          if (cancelled) return
          if (!listEntry) continue

          // Parse any stored next release. The column often holds the string "null", which is
          // not the same as an absent value — treat it (and unparseable data) as "none".
          let parsedNext: any = null
          if (listEntry.nextRelease && listEntry.nextRelease !== 'null') {
            try {
              parsedNext = JSON.parse(listEntry.nextRelease)
            } catch {
              parsedNext = null
            }
          }

          const storedDate =
            parsedNext && parsedNext.releaseDate
              ? new Date(parsedNext.releaseDate).setHours(0, 0, 0, 0)
              : null
          const storedIsFuture = storedDate !== null && storedDate >= today

          // Refresh from the provider when we don't already have a future release, but only for
          // media that can actually gain one — TV series and anime — and only when the title is
          // recently active / ongoing (or previously had a tracked release). Movies and manga,
          // and long-dormant shows, are skipped so the home page doesn't re-fetch the library.
          if (!storedIsFuture) {
            const isTv =
              typedEntryKey === 'yducsgix' && /tv|series/i.test(String(listEntry.type ?? ''))
            const isAnime = typedEntryKey === 'lx727mrc'
            const endMs = listEntry.releaseEnd ? new Date(listEntry.releaseEnd).getTime() : null
            const recentlyActive = endMs === null || endMs >= Date.now() - RECENT_WINDOW_MS
            const hadTrackedRelease = parsedNext !== null

            if ((isTv || isAnime) && (recentlyActive || hadTrackedRelease)) {
              const siteId = getSiteIdSafe(getThumbnailInfo(listEntry.thumbnail).url)?.id
              let fresh: any = null

              if (isTv) {
                fresh = ((await getTMDBInfo(siteId, listEntry.type)) as any)?.nextRelease
              } else if (isAnime) {
                fresh = await getAnilistSchedule(siteId)
              }

              if (cancelled) return

              if (fresh && fresh.releaseDate) {
                // Persist the freshly-computed release so later views are accurate. update-cell
                // is session-authed (no api-key parameter) and the write aborts on unmount.
                try {
                  await fetch(
                    '/lists/fetch/update-cell/' +
                      encodeURIComponent(
                        new URLSearchParams({
                          listTypeData: JSON.stringify(
                            params.listTypes.find(
                              (listType: any) => listType.id == typedEntryKey,
                            ),
                          ),
                          colId: "nextRelease",
                          type: "string",
                          filter: "agTextColumnFilter",
                          rowIndex: listEntry.id,
                          newValue: JSON.stringify(fresh),
                        } as any).toString(),
                      ),
                    { method: 'POST', signal: controller.signal },
                  )
                } catch (e) {
                  if (controller.signal.aborted) return
                  console.error('Failed to persist nextRelease', e)
                }

                parsedNext = fresh
              }
            }
          }

          // Only show genuinely upcoming (today or later) releases. Anything still in the past
          // — including entries we couldn't refresh into the future — is skipped.
          if (!parsedNext || !parsedNext.releaseDate) continue
          if (new Date(parsedNext.releaseDate).setHours(0, 0, 0, 0) < today) continue

          bucket(listEntry, parsedNext)
          commit()
        }
      }

      commit()
    }

    void buildUpcoming()

    return () => {
      cancelled = true
      controller.abort()
    }
    // Re-run when the signed-in user or the content of their entries changes. The entries are
    // serialized so the effect keys off their content, not the fresh object identity the parent
    // recreates on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.user?.id, JSON.stringify(params.userTypedEntries ?? {})])

  if (!params.user) {
    return null
  }

  return (
    <div className="upcoming-main">
      <h1 className="upcoming-header">Upcoming Releases</h1>
      <div className="upcoming-container">
        {Object.entries(sortedDays).length >= 1 ? (
          Object.entries(sortedDays)
            .slice(0, 7)
            .map(([upcomingDateKey, upcomingDateValue]: [string, any], index) => {
              const dateObject = new Date(upcomingDateKey)
              const sortedReleases = upcomingDateValue.sort((a: any, b: any) => {
                return (
                  new Date(a.nextRelease.releaseDate).getTime() -
                  new Date(b.nextRelease.releaseDate).getTime()
                )
              })

              return (
                <div
                  className="upcoming-date-container animate-slide-top [animation-fill-mode:backwards]"
                  key={index}
                  style={{ animationDelay: `${index * 0.07}s` }}
                >
                  <div className="upcoming-date-header-container">
                    <h1 className="upcoming-date-weekday">
                      {dateObject.toLocaleString('en-US', { month: "long", day: "numeric" })}
                    </h1>
                    <h1 className="upcoming-date-number">
                      {dateObject.toLocaleString('en-US', { weekday: "long" })}
                    </h1>
                  </div>
                  <div className="upcoming-array-container">
                    {sortedReleases.map((upcomingItem: any) => {
                      return (
                        <div className="upcoming-item-container" key={index}>
                          <h1 className="upcoming-time">{String(upcomingItem.releaseTime)}</h1>
                          <div className="upcoming-item-thumbnail">
                            <Link
                              to={getThumbnailInfo(upcomingItem.listEntry.thumbnail).url}
                              className="upcoming-item-thumbnail-image"
                              style={{ backgroundImage: `url("${getThumbnailInfo(upcomingItem.listEntry.thumbnail).content}")` }}
                            >
                              <span className="upcoming-thumbnail-footer">
                                {upcomingItem.listEntry.title.length > 20
                                  ? `${upcomingItem.listEntry.title.substring(0, 20)}...`
                                  : upcomingItem.listEntry.title}
                              </span>
                            </Link>
                          </div>
                          <div className="upcoming-item-header-container">
                            <h1 className="upcoming-set-header">{upcomingItem.nextSet}</h1>
                            <h1 className="upcoming-entry-header">{upcomingItem.nextEntry}</h1>
                            <h1 className="upcoming-item-header">{upcomingItem.nextRelease.name}</h1>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })
        ) : (
          <div className="upcoming-message">{"You're all caught up!"}</div>
        )}
      </div>
    </div>
  )
}
