import { Link } from '@remix-run/react'
import { getThumbnailInfo } from "#app/utils/lists/column-functions.jsx"

export function UpcomingData(params) {
  let upcomingReleases = {}

  Object.entries(params.userTypedEntries).forEach(([typedEntryKey, typedEntryValue]) => {
    typedEntryValue.forEach(listEntry => {
      if (listEntry.nextRelease) {
        const parsedNext = JSON.parse(listEntry.nextRelease)

        if (parsedNext && parsedNext.releaseDate) {
          const dateObject = new Date(parsedNext.releaseDate)

          let nextEntry
          if (Object.keys(parsedNext).includes("chapter")) {
            nextEntry = `Chapter ${parsedNext.chapter}`
          }
          else {
            nextEntry = `${parsedNext.season ? `Season ${parsedNext.season} ` : ``}Episode ${parsedNext.episode}`
          }

          const formattedDate = `${dateObject.getUTCFullYear()}/${dateObject.getUTCMonth() + 1}/${dateObject.getUTCDate()}`

          if (!upcomingReleases[formattedDate]) {
            upcomingReleases[formattedDate] = []
          }

          upcomingReleases[String(formattedDate)].push({
            listEntry: listEntry,
            nextEntry: nextEntry,
            nextRelease: parsedNext,
            releaseTime: `${dateObject.toLocaleDateString()} ${dateObject.getHours()}:${String(dateObject.getMinutes()).padStart(2, "0")}`
          })
        }
      }
    })
  })

  return (
    <div class="upcoming-main">
      {Object.entries(upcomingReleases).map(([upcomingDateKey, upcomingDateValue], index) => {
        return (
          <div class="upcoming-container animate-slide-top [animation-fill-mode:backwards]" style={{ animationDelay: `${index * 0.07}s` }}> 
            <h1 class="upcoming-date">{new Date(upcomingDateKey).toLocaleDateString()}</h1>
            {upcomingDateValue.map((upcomingItem) => {
              return (
                <div class="upcoming-item-container">
                  <h1 class="upcoming-time">{String(upcomingItem.releaseTime)}</h1>
                  <h1 class="upcoming-item-header">{upcomingItem.nextRelease.name}</h1>
                  <div class="upcoming-item-thumbnail">
                    <Link to={getThumbnailInfo(upcomingItem.listEntry.thumbnail).url} className="upcoming-item-thumbnail-image" style={{backgroundImage: `url("${getThumbnailInfo(upcomingItem.listEntry.thumbnail).content}")`}}>
                      <span className="upcoming-thumbnail-footer">
                        {upcomingItem.listEntry.title.length > 20 ? `${upcomingItem.listEntry.title.substring(0, 20)}...` : upcomingItem.listEntry.title}
                      </span>
                    </Link>
                  </div>
                  <h1 class="upcoming-entry-header">{upcomingItem.nextEntry}</h1>
                </div>
              )
            })} 
          </div>
        )
      })}
    </div>
  )
}