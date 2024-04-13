import { json } from "@remix-run/node"
import { Form, useLoaderData } from '@remix-run/react'
import { useState } from 'react'
import { prisma } from '#app/utils/db.server.ts'
import { timeSince } from "#app/utils/lists/column-functions.tsx"
import { invariantResponse } from '@epic-web/invariant'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import "#app/styles/list-landing.scss"

function getWatchlistNav(entryData, username, listType, shownSettings, setShownSettings) {
  return(
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
        <button id="list-landing-nav-link-settings-button" class="list-landing-nav-link-settings" onClick={() => {setShownSettings([...shownSettings, entryData.watchlist.id])}}>
          Settings
        </button>
      </div>
      <br></br>
      <br></br>
    </div>
  )
}

function checkDisplayedColumns(columns, displayedColumns) {
  let checkedColumns = []
  let displayedIndex = 0

  for (let column of columns) {
    if (displayedColumns[displayedIndex]) {
      if (column == displayedColumns[displayedIndex]) {
        checkedColumns.push(
          <label class="list-landing-settings-checkbox-item">
            <input id={`${column}-checkbox`} name={`${column}-checkbox`} type="checkbox" defaultChecked="true"/>
            {(column.charAt(0).toUpperCase() + column.substr(1)).split(/(?=[A-Z])/).join(" ")}
          </label>
        )

        displayedIndex++
      }
      else {
        checkedColumns.push(
          <label class="list-landing-settings-checkbox-item">
            <input type="checkbox" id={`${column}-checkbox`} name={`${column}-checkbox`}/>
            {(column.charAt(0).toUpperCase() + column.substr(1)).split(/(?=[A-Z])/).join(" ")}
          </label>
        )
      }
    }
    else {
      checkedColumns.push(
        <label class="list-landing-settings-checkbox-item">
            <input type="checkbox" id={`${column}-checkbox`} name={`${column}-checkbox`}/>
          {(column.charAt(0).toUpperCase() + column.substr(1)).split(/(?=[A-Z])/).join(" ")}
        </label>
      )
    }
  }

  return checkedColumns
}

async function handleSubmit(e, columns, watchlist) {
  e.preventDefault()

  let columnsFormatted = columns.map(column => `${column}-checkbox`)
  let columnArray = []

  const formRaw = new FormData(e.target)
  const data = formRaw.entries();
  let settingsObject = {}

  for (const entry of data) {
    if (columnsFormatted.includes(entry[0])) {
      let tailIndex = entry[0].lastIndexOf("-checkbox")
      columnArray.push(entry[0].slice(0, tailIndex))
    }
    else {
      let tailIndex = entry[0].lastIndexOf("-input")
      let settingType = entry[0].slice(0, tailIndex)

      if (settingType == "name") {
        settingsObject["header"] = entry[1]
        settingsObject["name"] = entry[1].replace(/\W/g, '').toLowerCase()
      }
      else {
        settingsObject[settingType] = entry[1]
      }
    }
  }

  const foundColumns = columnArray.join(", ")
  settingsObject["displayedColumns"] = foundColumns

  const updateSettingsResponse = await fetch('/lists/fetch/update-settings/' + new URLSearchParams({
    settings: JSON.stringify(Object.keys(settingsObject).map((key) => [key, settingsObject[key]])),
    listId: watchlist.id
  }))
  const updateSettingsData = await updateSettingsResponse.json();
  
  const updateResponse = await fetch('/lists/fetch/now-updated/' + new URLSearchParams({
    watchlistId: watchlist.id
  }))

  window.location.reload();
}

function getWatchlistSettings(entryData, shownSettings, setShownSettings) {
  const columns = entryData.watchlist.columns.split(', ')
  const displayedColumns = entryData.watchlist.displayedColumns.split(', ')
  const checkedColumns = checkDisplayedColumns(columns, displayedColumns)

  return(
    <Form onSubmit={(e) => {handleSubmit(e, columns, entryData.watchlist)}}>
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
                  <input class="list-landing-settings-input-item" id="name-input" name="name-input" defaultValue={entryData.watchlist.header}/>
                </div>
                <div class="list-landing-settings-input-row"> 
                  <div> 
                    Description
                  </div>
                  <textarea class="list-landing-settings-input-item" id="description-input" name="description-input" cols="50" rows="5" defaultValue={entryData.watchlist.description}></textarea>
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
          <button type="submit" id="list-landing-settings-submit-button" name="list-landing-settings-submit-button" class="list-landing-settings-submit">
            Submit 
          </button> 
          <button id="list-landing-settings-cancel-button" name="list-landing-settings-cancel-button" class="list-landing-settings-cancel" onClick={() => {setShownSettings(oldValues => { return oldValues.filter(setting => setting !== entryData.watchlist.id) })}}>
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

function listNavigationDisplayer(watchListData, username, listType, shownSettings, setShownSettings) {
  let navigationItems = []

  for (const entryData of watchListData) {
    if (shownSettings.includes(entryData.watchlist.id)) {
      navigationItems.push(getWatchlistSettings(entryData, shownSettings, setShownSettings))
    }
    else {
      navigationItems.push(getWatchlistNav(entryData, username, listType, shownSettings, setShownSettings))
    }
  }

  return navigationItems
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
  const [shownSettings, setShownSettings] = useState([])

  return (
    <main class="list-landing" style={{ width: '100%', height: '100%' }}>
      <div class="list-landing-sidebar-container">
        <a href={"/lists/" + useLoaderData()['username'] + "/liveaction"} className="list-landing-sidebar-item">Live Action</a>
        <a href={"/lists/" + useLoaderData()['username'] + "/anime"} className="list-landing-sidebar-item">Anime</a>
        <a href={"/lists/" + useLoaderData()['username'] + "/manga"} class="list-landing-sidebar-item list-landing-sidebar-item-bottom">Manga</a>
      </div>
      <div class="list-landing-main">
        <div class="list-landing-nav-container">
          { listNavigationDisplayer(useLoaderData()['watchListData'], useLoaderData()['username'], useLoaderData()['listType'], shownSettings, setShownSettings) }
        </div>
      </div>
    </main>
  )
}
