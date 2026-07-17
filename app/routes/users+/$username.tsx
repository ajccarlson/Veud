import { invariantResponse } from '@epic-web/invariant'
import { json, type LoaderFunctionArgs, type MetaFunction } from '@remix-run/node'
import { Link, NavLink, Outlet, useLoaderData } from '@remix-run/react'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { prisma } from '#app/utils/db.server.ts'
import { cn, getUserImgSrc } from '#app/utils/misc.tsx'
// import { useOptionalUser } from '#app/utils/user.ts'
import "#app/styles/user-landing.scss"

function toTitleCase(inputString: string) {
  return inputString.replace(/([a-z])([A-Z])/g, '$1 $2').split(' ').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ')
}

export async function loader(params: LoaderFunctionArgs) {
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

	const typedWatchlists = watchLists.reduce<Record<string, typeof watchLists>>((x, y) => {
    (x[y.typeId] = x[y.typeId] || []).push(y);
     return x;
  },{});

	let typedEntries: Record<string, any[]> = {}
  let typedHistory: Record<string, any[]> = {}

  // One batched query for all of the user's entries, grouped by their watchlist's type in
  // memory — instead of a query per watchlist (N+1).
  const allEntries = watchLists.length >= 1
    ? await prisma.entry.findMany({
        where: { watchlistId: { in: watchLists.map(w => w.id) } },
      })
    : []
  const typeByWatchlist = new Map(watchLists.map(w => [w.id, w.typeId]))

  if (watchLists.length >= 1) {
    for (const type of listTypes) {
      typedEntries[type.id] = allEntries.filter(
        (entry: any) => typeByWatchlist.get(entry.watchlistId) === type.id,
      )
      typedHistory[type.id] = []
  
      for (const [index, entry] of typedEntries[type.id].entries()) {
        if (entry.history && entry.history != null && entry.history != "null") {
          entry.history = JSON.parse(entry.history)
  
          for (const [historyKey, historyValue] of Object.entries(entry.history) as [string, any][]) {
            if (historyValue != null && historyValue != "null") {
              if (historyKey == "lastUpdated") {
                continue
              }
              else if (historyKey == "progress") {
                (JSON.parse(type.mediaType) as any[]).forEach((mediaType: any) => {
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
  
                  const dayGroups = (Object.entries(progressObject) as [string, any][]).reduce<Record<string, any[]>>((dayAccumulator, [progressKey, progressValue]) => {
                    if (!progressValue.finishDate) {
                      return dayAccumulator
                    }
  
                    const dateArray = progressValue.finishDate
    
                    dateArray.forEach((dateCompleted: any) => {
                      const dateRaw = new Date(dateCompleted);
                      const dateFull = `${dateRaw.getFullYear()}-${dateRaw.getMonth() + 1}-${dateRaw.getDate()}`
    
                      if (!dayAccumulator[dateFull]) {
                        dayAccumulator[dateFull] = [];
                      }
                      else if (dayAccumulator[dateFull].some((e: any) => e[mediaType] === progressKey)) {
                        try {
                          const duplicateEpIndex = dayAccumulator[dateFull].findIndex((e: any) => e[mediaType] === progressKey)
    
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
    
                  (Object.entries(dayGroups) as [string, any][]).forEach(([groupedKey, groupedValue]) => {
                    if (Object.entries(groupedValue).length > 1) {
                      const latestMedia = groupedValue.reduce((max: any, day: any) => max.date > day.date ? max : day);
                      const oldestMedia = groupedValue.reduce((max: any, day: any) => max.date < day.date ? max : day);
    
                      typedHistory[type.id].push({
                        type: `${toTitleCase((JSON.parse(type.completionType) as any).past)} ${toTitleCase(mediaType)}s ${oldestMedia[mediaType]} - ${latestMedia[mediaType]}`,
                        time: new Date(latestMedia.date),
                        index: index
                      })
                    }
                    else {
                      typedHistory[type.id].push({
                        type: `${toTitleCase((JSON.parse(type.completionType) as any).past)} ${toTitleCase(mediaType)} ${groupedValue[0][mediaType]}`,
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
                    type: `Added to ${watchLists.find(e => e.id === entry.watchlistId)!.header}`,
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
  
      typedHistory[type.id].sort(function (a: any, b: any) {
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

const PROFILE_TABS = [
	{ to: '.', end: true, label: 'Overview' },
	{ to: 'stats', end: false, label: 'Stats' },
	{ to: 'favorites', end: false, label: 'Favorites' },
	{ to: 'activity', end: false, label: 'Activity' },
	{ to: 'social', end: false, label: 'Social' },
]

export default function ProfileRoute() {
	const loaderData = useLoaderData<typeof loader>()
	const user = loaderData.user
	// const loggedInUser = useOptionalUser()
	// const isLoggedInUser = loaderData.user.id === loggedInUser?.id

	return (
		<main
			className={cn('user-landing')}
			style={{ width: '100%', minHeight: '100%', backgroundColor: 'var(--veud-bg)' }}
		>
			{/* Temporary header — the full hero (banner + avatar + edit) lands in the next sub-batch. */}
			<div className="user-landing-personal-container" style={{ paddingTop: '2rem' }}>
				<img
					src={getUserImgSrc(user.image?.id)}
					alt={user.username}
					className="user-landing-profile-image"
				/>
				<h1 className="user-landing-username">{user.username}</h1>
				<div className="user-landing-join-container">
					<span className="user-landing-join-label">Joined</span>
					<span className="user-landing-join-date">{loaderData.userJoinedDisplay}</span>
				</div>
				<Button asChild>
					<Link to={`../../lists/${user.username}`} prefetch="intent">
						Watchlists
					</Link>
				</Button>
			</div>

			<nav
				className="mx-auto mt-6 flex flex-wrap justify-center gap-2 px-4"
				style={{ borderBottom: '1px solid var(--veud-surface)' }}
			>
				{PROFILE_TABS.map(tab => (
					<NavLink
						key={tab.label}
						to={tab.to}
						end={tab.end}
						prefetch="intent"
						className="px-4 py-2 font-semibold transition-colors"
						style={({ isActive }) => ({
							borderBottom: isActive
								? '4px solid var(--veud-teal)'
								: '4px solid transparent',
							color: isActive ? 'var(--veud-highlight)' : 'var(--veud-cream)',
						})}
					>
						{tab.label}
					</NavLink>
				))}
			</nav>

			<div style={{ padding: '1rem' }}>
				<Outlet context={loaderData} />
			</div>
		</main>
	)
}

export const meta: MetaFunction<typeof loader> = ({ data, params }) => {
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
					<p>No user with the username "{params['username']}" exists</p>
				),
			}}
		/>
	)
}
