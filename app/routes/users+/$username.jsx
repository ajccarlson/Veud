import { invariantResponse } from '@epic-web/invariant'
import { json } from '@remix-run/node'
import { useLoaderData } from '@remix-run/react'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { BodyData } from '#app/routes/users+/$username_/body.jsx'
import { SideData } from '#app/routes/users+/$username_/side.jsx'
import { prisma } from '#app/utils/db.server.ts'
import { useOptionalUser } from '#app/utils/user.ts'
import "#app/styles/user-landing.scss"

function toTitleCase(inputString) {
  return inputString.replace(/([a-z])([A-Z])/g, '$1 $2').split(' ').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ')
}

export async function loader(params) {
	const user = await prisma.user.findFirst({
		select: {
			id: true,
			name: true,
			username: true,
			createdAt: true,
			image: { select: { id: true } },
		},
		where: {
			username: params.params['username'],
		},
	})

	invariantResponse(user, 'User not found', { status: 404 })

	const listTypes = await prisma.listType.findMany()

	const watchLists = await prisma.watchlist.findMany({
    where: {
      ownerId: user.id,
    },
  })

	const typedWatchlists = watchLists?.reduce((x, y) => {
    (x[y.typeId] = x[y.typeId] || []).push(y);
     return x;
  },{});

	let typedEntries = {}
  let typedHistory = {}

  if (watchLists.length >= 1) {
    for (const type of listTypes) {
      const typeFormatted = type.header.replace(/\W/g, '') + "Entry"
      let perWatchlistEntries = []
  
      if (typedWatchlists[type.id] && typedWatchlists[type.id].length > 0) {
        for (const typedList of typedWatchlists[type.id]) {
          perWatchlistEntries.push(await prisma[typeFormatted].findMany({
            where: {
              watchlistId: typedList.id,
            },
          }))
        }
      }
  
      typedEntries[type.id] = perWatchlistEntries.flat(2)
      typedHistory[type.id] = []
  
      for (const [index, entry] of typedEntries[type.id].entries()) {
        if (entry.history && entry.history != null && entry.history != "null") {
          entry.history = JSON.parse(entry.history)
  
          for (const [historyKey, historyValue] of Object.entries(entry.history)) {
            if (historyValue != null && historyValue != "null") {
              if (historyKey == "lastUpdated") {
                continue
              }
              else if (historyKey == "progress") {
                JSON.parse(type.mediaType).forEach(mediaType => {
                  let progressObject
                  if (type.columns.includes("length")) {
                    progressObject = historyValue
                  }
                  else {
                    progressObject = historyValue[mediaType]
                  }
  
                  if (!progressObject) {
                    return
                  }
  
                  const dayGroups = Object.entries(progressObject).reduce((dayAccumulator, [progressKey, progressValue]) => {
                    if (!progressValue.finishDate) {
                      return dayAccumulator
                    }
  
                    const dateArray = progressValue.finishDate
    
                    dateArray.forEach((dateCompleted) => {
                      const dateRaw = new Date(dateCompleted);
                      const dateFull = `${dateRaw.getFullYear()}-${dateRaw.getMonth() + 1}-${dateRaw.getDate()}`
    
                      if (!dayAccumulator[dateFull]) {
                        dayAccumulator[dateFull] = [];
                      }
                      else if (dayAccumulator[dateFull].some(e => e[mediaType] === progressKey)) {
                        try {
                          const duplicateEpIndex = dayAccumulator[dateFull].findIndex(e => e[mediaType] === progressKey)
    
                          if (duplicateEpIndex != -1) {
                            const dupeDay = dayAccumulator[dateFull][duplicateEpIndex]
    
                            if (dupeDay.date < dateRaw) {
                              dupeDay.date = dateRaw
                              return dayAccumulator
                            }
                          }
                        }
                        catch(e) {}
                      }
    
                      dayAccumulator[dateFull].push({
                        date: dateRaw,
                        [mediaType]: progressKey
                      });
                    })
                    
                    return dayAccumulator
                  }, {});
    
                  Object.entries(dayGroups).forEach(([groupedKey, groupedValue]) => {
                    if (Object.entries(groupedValue).length > 1) {
                      const latestMedia = groupedValue.reduce((max, day) => max.date > day.date ? max : day);
                      const oldestMedia = groupedValue.reduce((max, day) => max.date < day.date ? max : day);
    
                      typedHistory[type.id].push({
                        type: `${toTitleCase(JSON.parse(type.completionType).past)} ${toTitleCase(mediaType)}s ${oldestMedia[mediaType]} - ${latestMedia[mediaType]}`,
                        time: new Date(latestMedia.date),
                        index: index
                      })
                    }
                    else {
                      typedHistory[type.id].push({
                        type: `${toTitleCase(JSON.parse(type.completionType).past)} ${toTitleCase(mediaType)} ${groupedValue[0][mediaType]}`,
                        time: new Date(groupedValue[0].date),
                        index: index
                      })
                    }
                  })
                })
              }
              else {
                if (historyKey == "added") {
                  typedHistory[type.id].push({
                    type: `Added to ${watchLists.find(e => e.id === entry.watchlistId).header}`,
                    time: new Date(historyValue),
                    index: index
                  })
                }
                else {
                  typedHistory[type.id].push({
                    type: toTitleCase(historyKey),
                    time: new Date(historyValue),
                    index: index
                  })
                }
              }
            }
          }
        }
        else {
          entry.history = {
            added: null,
            started: null,
            finished: null,
            progress: null,
            lastUpdated: null,
          }
        }
      }
  
      typedHistory[type.id].sort(function(a, b) {
        if (!a.time || a.time == null)
          a.time = 0
        if (!b.time || b.time == null)
          b.time = 0
  
        if (a.time > b.time) return -1;
        if (a.time < b.time) return 1;
        return 0;
      });
    }
  }

	const favorites = await prisma.userFavorite.findMany({
    where: {
      ownerId: user.id, 
    },
  })
  
	
	const favoritesSorted = favorites?.sort(function(a, b) {
		if (a.position < b.position) return -1;
		if (a.position > b.position) return 1;
		return 0;
	});

	return json({ user, userJoinedDisplay: user.createdAt.toLocaleDateString('en-us', { year:"numeric", month:"short", day:"numeric"}), listTypes, watchLists, typedWatchlists, typedEntries, typedHistory, favorites: favoritesSorted })
}

export default function ProfileRoute() {
	const loaderData = useLoaderData()
	// const user = loaderData.user
	// const loggedInUser = useOptionalUser()
	// const isLoggedInUser = loaderData.user.id === loggedInUser?.id

	return (
		<main className="user-landing" style={{ width: '100%', height: '100%' }}>
			<div className="user-landing-main">
				{SideData(loaderData)}
				{BodyData(loaderData)}
			</div>
		</main>
	)
}

export const meta = ({ data, params }) => {
	const displayName = params['username']
	return [
		{ title: `${displayName} | Veud` },
		{
			name: 'description',
			content: `Profile of ${displayName} on Veud`,
		},
	]
}

export function ErrorBoundary() {
	return (
		<GeneralErrorBoundary
			statusHandlers={{
				404: ({ params }) => (
					<p>No user with the username "{params.params['username']}" exists</p>
				),
			}}
		/>
	)
}
