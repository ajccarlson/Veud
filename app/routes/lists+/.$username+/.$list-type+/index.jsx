import { json } from "@remix-run/node"
import { Form, useLoaderData } from '@remix-run/react'
import { useState } from 'react'
import { prisma } from '#app/utils/db.server.ts'
import { timeSince } from "#app/utils/lists/column-functions.tsx"
import { invariantResponse } from '@epic-web/invariant'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import "#app/styles/list-landing.scss"

function getWatchlistNav(watchListData, username, listType, setShowSettings) {
  let watchListNavs = []

  for (const entryData of watchListData) {
    watchListNavs.push(
      <div class="list-landing-nav-item-container">
        <div class="list-landing-nav-top">
          <h1 class="list-landing-nav-header">
            {entryData.watchlist.header}
          </h1>
          <div class="list-landing-nav-length">
            {entryData.listEntries.length}
          </div> 
        </div> 
        <div class="list-landing-nav-bottom-container">
          <div class="list-landing-nav-bottom">
            <div>
              <p class="list-landing-nav-description">
                {entryData.watchlist.description}
              </p>
              <div class="list-landing-nav-last-updated-container">
                Last Updated:
                <span class="list-landing-nav-last-updated-span">
                  {timeSince(new Date(entryData.watchlist.updatedAt))}
                </span>
              </div>
            </div>
          </div>
        </div>
        <div class="list-landing-nav-link-container">
          <a href={"/lists/" + username + "/" + listType + "/" + entryData.watchlist.name} id="list-landing-nav-link-open-button" class="list-landing-nav-link-open">
            Open
          </a>
          <button id="list-landing-nav-link-settings-button" class="list-landing-nav-link-settings" onClick={() => {setShowSettings(true)}}>
            Settings
          </button>
        </div>
        <br></br>
        <br></br>
      </div>
    )
  }

  return watchListNavs
}

function checkDisplayedColumns(columns, displayedColumns) {
  let checkedColumns = []
  let displayedIndex = 0

  for (let column of columns) {
    if (displayedColumns[displayedIndex]) {
      if (column == displayedColumns[displayedIndex]) {
        checkedColumns.push(
          <label class="list-landing-settings-checkbox-item">
            <input id={`${column}-checkbox`} type="checkbox" defaultChecked="true"/>
            {(column.charAt(0).toUpperCase() + column.substr(1)).split(/(?=[A-Z])/).join(" ")}
          </label>
        )

        displayedIndex++
      }
      else {
        checkedColumns.push(
          <label class="list-landing-settings-checkbox-item">
            <input type="checkbox" id={`${column}-checkbox`}/>
            {(column.charAt(0).toUpperCase() + column.substr(1)).split(/(?=[A-Z])/).join(" ")}
          </label>
        )
      }
    }
    else {
      checkedColumns.push(
        <label class="list-landing-settings-checkbox-item">
            <input type="checkbox" id="${column}-checkbox"/>
          {(column.charAt(0).toUpperCase() + column.substr(1)).split(/(?=[A-Z])/).join(" ")}
        </label>
      )
    }
  }

  return checkedColumns
}

function getWatchlistSettings(watchListData, setShowSettings) {
  let watchListSettings = []

  for (const entryData of watchListData) {
    const columns = entryData.watchlist.columns.split(', ')
    const displayedColumns = entryData.watchlist.displayedColumns.split(', ')
    const checkedColumns = checkDisplayedColumns(columns, displayedColumns)

    watchListSettings.push(
      <Form>
        <div class="list-landing-nav-item-container">
          <div class="list-landing-nav-top">
            <h1 class="list-landing-nav-header">
             {entryData.watchlist.header}
            </h1> 
            <div class="list-landing-nav-length">
              {entryData.listEntries.length}
            </div>
          </div> 
          <div class="list-landing-nav-bottom-container"> 
            <div class="list-landing-nav-bottom"> 
              <div>
                <div class="list-landing-settings-container">
                  <div class="list-landing-settings-input-row"> 
                    <div>
                      Name
                    </div>
                    <input class="list-landing-settings-input-item" defaultValue={entryData.watchlist.header}/>
                  </div>
                  <div class="list-landing-settings-input-row"> 
                    <div> 
                      Description
                    </div>
                    <textarea class="list-landing-settings-input-item" cols="50" rows="5" defaultValue={entryData.watchlist.description}></textarea>
                  </div>
                  <div class="list-landing-settings-input-row"> 
                    <div>
                      Columns
                    </div>
                    <div class="list-landing-settings-checkbox-container"> 
                      {checkedColumns} 
                    </div> 
                  </div>
                </div>
                <div class="list-landing-nav-last-updated-container">
                  Last Updated:
                    <span class="list-landing-nav-last-updated-span">
                      {timeSince(new Date(entryData.watchlist.updatedAt))}
                    </span>
                </div>
              </div> 
            </div>
          </div>
          <div class="list-landing-nav-link-container"> 
            <button class="list-landing-settings-submit">
              Submit 
            </button> 
            <button id="list-landing-settings-cancel-button" class="list-landing-settings-cancel" onClick={() => {setShowSettings(false)}}>
              Cancel
              <span class="list-landing-settings-close-span">
                ⓧ
              </span>
            </button>
          </div>
        </div> 
        <br></br>
        <br></br>
      </Form>
    )
  }

  return watchListSettings
}

export async function loader(params) {
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
  let watchListSettings = []

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

    // watchListNavs.push(getWatchlistNav(entryData, params['params']['username'], listType))
    // watchListSettings.push(getWatchlistSettings(entryData, params['params']['username'], checkedColumns, listType))
  }

  if (watchListNavs.length < 1) {
    watchListNavs = [`<h1">No lists found</h1>`]
  }

  return json({ watchListData, watchListNavs, watchListSettings, username: params['params']['username'], listType });
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
  const [showSettings, setShowSettings] = useState(false);

  return (
    <main class="list-landing" style={{ width: '100%', height: '100%' }}>
      <div class="list-landing-sidebar-container">
        <a href={"/lists/" + useLoaderData()['username'] + "/liveaction"} className="list-landing-sidebar-item">Live Action</a>
        <a href={"/lists/" + useLoaderData()['username'] + "/anime"} className="list-landing-sidebar-item">Anime</a>
        <a href={"/lists/" + useLoaderData()['username'] + "/manga"} class="list-landing-sidebar-item list-landing-sidebar-item-bottom">Manga</a>
      </div>
      { showSettings ? 
        <div class="list-landing-main">
          <div class="list-landing-nav-container">
            {getWatchlistSettings(useLoaderData()['watchListData'], setShowSettings)}
          </div>
        </div>
      :
      <div class="list-landing-main">
        <div class="list-landing-nav-container">
          {getWatchlistNav(useLoaderData()['watchListData'], useLoaderData()['username'], useLoaderData()['listType'], setShowSettings)}
        </div>
      </div>
      }
    </main>
  )
}
