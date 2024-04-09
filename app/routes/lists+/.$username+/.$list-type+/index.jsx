import { json } from "@remix-run/node"
import { useLoaderData } from '@remix-run/react'
import { useState } from 'react'
import { prisma } from '#app/utils/db.server.ts'
import { timeSince } from "#app/utils/lists/column-functions.tsx"
import { invariantResponse } from '@epic-web/invariant'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import "#app/styles/list-landing.scss"

function getWatchlistNav(watchListData, username, listType) {
  return (
    `<div class="list-landing-nav-item-container">` + 
      `<div class="list-landing-nav-top">` +
        `<h1 class="list-landing-nav-header">` + 
          `${watchListData.watchlist.header}` +
        `</h1>` + 
        `<div class="list-landing-nav-length">` + 
          `${watchListData.listEntries.length}` +
        `</div>` + 
      `</div>` + 
      `<div class="list-landing-nav-bottom-container">` + 
        `<div class="list-landing-nav-bottom">` + 
          `<div>` + 
            `<p class="list-landing-nav-description">` + 
              `${watchListData.watchlist.description}` +
            `</p>` +
            `<div class="list-landing-nav-last-updated-container">` + 
              `Last Updated: ` + `<span class="list-landing-nav-last-updated-span">` + `${timeSince(watchListData.watchlist.updatedAt)}` + `</span>` +
            `</div>` + 
          `</div>` + 
        `</div>` + 
      `</div>` + 
      `<div class="list-landing-nav-link-container">` + 
        `<a href=${"/lists/" + username + "/" + listType + "/" + watchListData.watchlist.name} class="list-landing-nav-link-open">` + 
          `Open` + 
        `</a>` +  
        `<a href=${"/lists/" + username + "/" + listType + "/" + watchListData.watchlist.name + "/settings"} class="list-landing-nav-link-settings">` + 
          `Settings` + 
        `</a>` + 
      `</div>` + 
    `</div>` + 
    `<br></<br>` +
    `<br></<br>` 
  )
}

function checkDisplayedColumns(columns, displayedColumns) {
  let checkedColumns = ""
  let displayedIndex = 0

  for (let column of columns) {
    if (displayedColumns[displayedIndex]) {
      if (column == displayedColumns[displayedIndex]) {
        checkedColumns += (
          `<label>` +
            `<Input class="list-landing-settings-input-item" type="checkbox" checked="true"/>` +
            `${column}` +
          `</label>`
        )

        displayedIndex++
      }
      else {
        checkedColumns += (
          `<label>` +
            `<Input class="list-landing-settings-input-item" type="checkbox"/>` +
            `${column}` +
          `</label>`
        )
      }
    }
    else {
      checkedColumns += (
        `<label>` +
          `<Input class="list-landing-settings-input-item" type="checkbox"/>` +
          `${column}` +
        `</label>`
      )
    }
  }

  return checkedColumns
}

function getWatchlistSettings(watchListData, username, checkedColumns, listType) {
  return (
    `<div class="list-landing-nav-item-container">` + 
      `<div class="list-landing-nav-top">` +
        `<h1 class="list-landing-nav-header">` + 
          `${watchListData.watchlist.header}` +
        `</h1>` + 
        `<div class="list-landing-nav-length">` + 
          `${watchListData.listEntries.length}` +
        `</div>` + 
      `</div>` + 
      `<div class="list-landing-nav-bottom-container">` + 
        `<div class="list-landing-nav-bottom">` + 
          `<div>` + 
            `<div class="list-landing-settings-container">` +
              `<div class="list-landing-settings-input-row">` + 
                `<div>` + 
                  `Name` +
                `</div>` + 
                `<Input class="list-landing-settings-input-item"/>` +
              `</div>` + 
              `<div class="list-landing-settings-input-row">` + 
                `<div>` + 
                  `Description` +
                `</div>` + 
                `<textarea class="list-landing-settings-input-item" cols="50" rows="5"></textarea>` +
              `</div>` +
              `<div class="list-landing-settings-input-row">` + 
                `<div>` + 
                  `Columns` +
                `</div>` + 
                `<div class="list-landing-settings-checkbox-container">` + 
                  `${checkedColumns}` + 
                `</div>` + 
              `</div>` +
            `</div>` +
            `<div class="list-landing-nav-last-updated-container">` + 
              `Last Updated: ` + `<span class="list-landing-nav-last-updated-span">` + `${timeSince(watchListData.watchlist.updatedAt)}` + `</span>` +
            `</div>` + 
          `</div>` + 
        `</div>` + 
      `</div>` + 
      `<div class="list-landing-nav-link-container">` + 
        `<a href=${"/lists/" + username + "/" + listType + "/" + watchListData.watchlist.name} class="list-landing-nav-link-open">` + 
          `Open` + 
        `</a>` +  
        `<Button class="list-landing-nav-link-settings-close">` + 
          `Settings` + `<span class="list-landing-settings-close-span"> ⓧ </span>` + 
        `</Button>` + 
      `</div>` + 
    `</div>` + 
    `<br></<br>` +
    `<br></<br>` 
  )
}

export async function loader(params) {
  //const [showSettings, showSettingsDropdown] = useState(false);

  const currentUser = await prisma.User.findUnique({
    where: {
      username: params['params']['username'],
    },
  })

  invariantResponse(currentUser, 'User not found', { status: 404 }) 

  const listType = params['params']['list-type']
  let typeFormatted = null;

  if (listType == 'liveaction')
    typeFormatted = "LiveActionEntry"
  else if (listType == 'anime')
    typeFormatted = "AnimeEntry"
  else if (listType == 'manga')
    typeFormatted = "MangaEntry"

  invariantResponse(typeFormatted, 'List type not found', { status: 404 }) 

  const watchLists = await prisma.watchlist.findMany({
    where: {
      type: listType,
      ownerId: currentUser.id,
    },
  })

  let watchListData = []
  let watchListNavs = []

  const watchListsSorted = watchLists.sort((a, b) => a.position - b.position)
  
  for (let watchlist of watchListsSorted) {
    const listEntries = await prisma[typeFormatted].findMany({
      where: {
        watchlistId: watchlist.id,
      },
    })

    const entryData = {
      watchlist: watchlist,
      listEntries: listEntries
    }

    watchListData.push(entryData)

    let columnStatus = []
    const columns = watchlist.columns.split(', ')
    const displayedColumns = watchlist.displayedColumns.split(', ')

    const checkedColumns = checkDisplayedColumns(columns, displayedColumns)

    watchListNavs.push(getWatchlistSettings(entryData, params['params']['username'], checkedColumns, listType))
  }

  if (watchListNavs.length < 1) {
    watchListNavs = [`<h1">No lists found</h1>`]
  }

  return json({ watchListData, watchListNavs, username: params['params']['username'], listType });
};

export function ErrorBoundary() {
	return (
		<GeneralErrorBoundary
			statusHandlers={{
				404: ({ params }) => (
					<p>No list type with the the name "{params.listType}" exists</p>
				),
			}}
		/>
	)
}

export default function lists() {
  return (
    <main class="list-landing" style={{ width: '100%', height: '100%' }}>
      <div class="list-landing-sidebar-container">
        <a href={"/lists/" + useLoaderData()['username'] + "/liveaction"} className="list-landing-sidebar-item">Live Action</a>
        <a href={"/lists/" + useLoaderData()['username'] + "/anime"} className="list-landing-sidebar-item">Anime</a>
        <a href={"/lists/" + useLoaderData()['username'] + "/manga"} class="list-landing-sidebar-item list-landing-sidebar-item-bottom">Manga</a>
      </div>
      <div class="list-landing-main">
        <div class="list-landing-nav-container" dangerouslySetInnerHTML={{__html: useLoaderData()['watchListNavs'].join("")}} />
      </div>
    </main>
  )
}
