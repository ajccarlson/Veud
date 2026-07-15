import { Link } from '@remix-run/react'
import { getAnilistSchedule } from "#app/routes/media+/mal.ts"
import { getTMDBInfo } from "#app/routes/media+/tmdb.ts"
import { getThumbnailInfo, getSiteIdSafe } from "#app/utils/lists/column-functions.tsx"

export function UpcomingData(params: any) {
  if (params.user) {
    let upcomingReleases: Record<string, any[]> = {}

    Object.entries(params.userTypedEntries).forEach(([typedEntryKey, typedEntryValue]: [string, any]) => {
      typedEntryValue.forEach(async (listEntry: any) => {
        if (listEntry?.nextRelease) {
          let parsedNext = JSON.parse(listEntry.nextRelease) as any
          const formattedEndDate = new Date(listEntry.releaseEnd).setHours(0,0,0,0)
          const formattedCurrentDate = new Date().setHours(0,0,0,0)

          if (parsedNext && parsedNext.releaseDate && (!listEntry.releaseEnd || formattedEndDate <= formattedCurrentDate)) {
            const formattedReleaseDate = new Date(parsedNext.releaseDate).setHours(0,0,0,0)
            
            if (formattedCurrentDate > formattedReleaseDate) {
              const siteId = await getSiteIdSafe(getThumbnailInfo(listEntry.thumbnail).url)?.id
              let nextRelease: any

              if (typedEntryKey == "yducsgix") {
                nextRelease = (await getTMDBInfo(siteId, listEntry.type) as any)?.nextRelease
              }
              else if (typedEntryKey == "lx727mrc") {
                nextRelease = await getAnilistSchedule(siteId)
              }

              if (nextRelease) {
                const updateCellResponse = await fetch('/lists/fetch/update-cell/' + encodeURIComponent(new URLSearchParams({
                  authorization: params.VEUD_API_KEY,
                  listTypeData: JSON.stringify(params.listTypes.find((listType: any) => listType.id == typedEntryKey)),
                  colId: "nextRelease",
                  type: "string",
                  filter: "agTextColumnFilter",
                  rowIndex: listEntry.id,
                  newValue: JSON.stringify(nextRelease),
                } as any).toString()), { method: 'POST' })
                const updateCellData = await updateCellResponse.json()

                listEntry.nextRelease = JSON.stringify(nextRelease)
                parsedNext = nextRelease
              }
            }

            const dateObject = new Date(parsedNext.releaseDate)

            let nextEntry: any, nextSet: any
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

    const sortedDays = Object.keys(upcomingReleases).sort().reduce((obj, key) => { 
        obj[key] = upcomingReleases[key]; 
        return obj;
    }, {} as Record<string, any[]>)

    return (
      <div className="upcoming-main">
        <h1 className="upcoming-header">Upcoming Releases</h1>
        <div className="upcoming-container">
          {Object.entries(sortedDays).length >= 1 ?
            Object.entries(sortedDays).slice(0, 7).map(([upcomingDateKey, upcomingDateValue]: [string, any], index) => {
              const dateObject = new Date(upcomingDateKey)
              const sortedReleases = upcomingDateValue.sort((a: any, b: any) => {
                return new Date(a.nextRelease.releaseDate).getTime() - new Date(b.nextRelease.releaseDate).getTime()
              })
  
              return (
                <div className="upcoming-date-container animate-slide-top [animation-fill-mode:backwards]" key={index} style={{ animationDelay: `${index * 0.07}s` }}> 
                  <div className="upcoming-date-header-container">
                    <h1 className="upcoming-date-weekday">{dateObject.toLocaleString('en-US', {month: "long", day: "numeric"})}</h1>
                    <h1 className="upcoming-date-number">{dateObject.toLocaleString('en-US', {weekday: "long"})}</h1>
                  </div>
                  <div className="upcoming-array-container">
                    {sortedReleases.map((upcomingItem: any) => {
                      return (
                        <div className="upcoming-item-container"  key={index}>
                          <h1 className="upcoming-time">{String(upcomingItem.releaseTime)}</h1>
                          <div className="upcoming-item-thumbnail">
                            <Link to={getThumbnailInfo(upcomingItem.listEntry.thumbnail).url} className="upcoming-item-thumbnail-image" style={{backgroundImage: `url("${getThumbnailInfo(upcomingItem.listEntry.thumbnail).content}")`}}>
                              <span className="upcoming-thumbnail-footer">
                                {upcomingItem.listEntry.title.length > 20 ? `${upcomingItem.listEntry.title.substring(0, 20)}...` : upcomingItem.listEntry.title}
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
          :
            <div className="upcoming-message">
              {"You're all caught up!"}
            </div>
          }
        </div>
      </div>
    )
  }
  else {
    // return (
    //   <div class="upcoming-main">
    //     <h1 class="upcoming-header">Upcoming Releases</h1>
    //     <div class="upcoming-container">
    //       <div class="upcoming-message">
    //         {"Log in to gain access"}
    //       </div>
    //     </div>
    //   </div>
    // )
  }
}