import { Link } from '@remix-run/react'
import { getAnilistSchedule } from "#app/routes/media+/mal.jsx"
import { getTMDBInfo } from "#app/routes/media+/tmdb.jsx"
import { getThumbnailInfo, getSiteID } from "#app/utils/lists/column-functions.jsx"

export function UpcomingData(params) {
  let upcomingReleases = {}

  Object.entries(params.userTypedEntries).forEach(([typedEntryKey, typedEntryValue]) => {
    typedEntryValue.forEach(async (listEntry) => {
      if (listEntry.nextRelease) {
        let parsedNext = JSON.parse(listEntry.nextRelease)
        const formattedEndDate = new Date(listEntry.releaseEnd).setHours(0,0,0,0)
        const formattedCurrentDate = new Date().setHours(0,0,0,0)

        if (parsedNext && parsedNext.releaseDate && (!listEntry.releaseEnd || formattedEndDate <= formattedCurrentDate)) {
          const formattedReleaseDate = new Date(parsedNext.releaseDate).setHours(0,0,0,0)
          
          if (formattedCurrentDate > formattedReleaseDate) {
            const siteId = await getSiteID(getThumbnailInfo(listEntry.thumbnail).url).id
            let nextRelease

            if (typedEntryKey == "yducsgix") {
              nextRelease = await getTMDBInfo(siteId, listEntry.type).nextRelease
            }
            else if (typedEntryKey == "lx727mrc") {
              nextRelease = await getAnilistSchedule(siteId)
            }

            if (nextRelease) {
              const updateCellResponse = await fetch('/lists/fetch/update-cell/' + encodeURIComponent(new URLSearchParams({
                listTypeData: JSON.stringify(params.listTypes.find(listType => listType.id == typedEntryKey)),
                colId: "nextRelease",
                type: "string",
                filter: "agTextColumnFilter",
                rowIndex: listEntry.id,
                newValue: JSON.stringify(nextRelease),
              })))
              const updateCellData = await updateCellResponse.json()

              listEntry.nextRelease = JSON.stringify(nextRelease)
              parsedNext = nextRelease
            }
          }

          const dateObject = new Date(parsedNext.releaseDate)

          let nextEntry, nextSet
          if (Object.keys(parsedNext).includes("chapter")) {
            if (parsedNext.volume) {
              nextSet = `Volume ${parsedNext.volume} `
            }

            nextEntry = `Chapter ${parsedNext.chapter}`
          }
          else {
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
            releaseTime: `${dateObject.getHours()}:${String(dateObject.getMinutes()).padStart(2, "0")} ${dateObject.toLocaleTimeString('en-us',{timeZoneName:'short'}).split(' ')[2]}`
          })
        }
      }
    })
  })

  return (
    <div class="upcoming-main">
      <h1 class="upcoming-header">Upcoming Releases</h1>
      <div class="upcoming-container">
        {Object.entries(upcomingReleases).map(([upcomingDateKey, upcomingDateValue], index) => {
          const dateObject = new Date(upcomingDateKey)
          const sortedReleases = upcomingDateValue.sort((a, b) => {
            return new Date(a.nextRelease.releaseDate) - new Date(b.nextRelease.releaseDate)
          })

          return (
            <div class="upcoming-date-container animate-slide-top [animation-fill-mode:backwards]" style={{ animationDelay: `${index * 0.07}s` }}> 
              <div class="upcoming-date-header-container">
                <h1 class="upcoming-date-weekday">{dateObject.toLocaleString('en-US', {month: "long", day: "numeric"})}</h1>
                <h1 class="upcoming-date-number">{dateObject.toLocaleString('en-US', {weekday: "long"})}</h1>
              </div>
              <div class="upcoming-array-container">
                {sortedReleases.map((upcomingItem) => {
                  return (
                    <div class="upcoming-item-container">
                      <h1 class="upcoming-time">{String(upcomingItem.releaseTime)}</h1>
                      <div class="upcoming-item-thumbnail">
                        <Link to={getThumbnailInfo(upcomingItem.listEntry.thumbnail).url} className="upcoming-item-thumbnail-image" style={{backgroundImage: `url("${getThumbnailInfo(upcomingItem.listEntry.thumbnail).content}")`}}>
                          <span className="upcoming-thumbnail-footer">
                            {upcomingItem.listEntry.title.length > 20 ? `${upcomingItem.listEntry.title.substring(0, 20)}...` : upcomingItem.listEntry.title}
                          </span>
                        </Link>
                      </div>
                      <div class="upcoming-item-header-container">
                        <h1 class="upcoming-set-header">{upcomingItem.nextSet}</h1>
                        <h1 class="upcoming-entry-header">{upcomingItem.nextEntry}</h1>
                        <h1 class="upcoming-item-header">{upcomingItem.nextRelease.name}</h1>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}