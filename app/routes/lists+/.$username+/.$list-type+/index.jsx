import { json } from "@remix-run/node"
import { Form, useLoaderData } from '@remix-run/react'
import { useState, useEffect } from 'react'
import { prisma } from '#app/utils/db.server.ts'
import { timeSince } from "#app/utils/lists/column-functions.tsx"
import { Icon } from '#app/components/ui/icon.tsx'
import { invariantResponse } from '@epic-web/invariant'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import "#app/styles/list-landing.scss"

async function createNewList(listParams) {
  let columns
  if (listParams.listType == 'liveaction') {
    columns = "id, watchlist, watchlistId, position, thumbnail, title, type, airYear, length, rating, finishedDate, genres, language, story, character, presentation, sound, performance, enjoyment, averaged, personal, differencePersonal, tmdbScore, differenceObjective, description"
  }
  else if (listParams.listType == 'anime') {
    columns = "id, watchlist, watchlistId, position, thumbnail, title, type, startSeason, length, rating, startDate, finishedDate, genres, studio, demographics, priority, story, character, presentation, sound, performance, enjoyment, averaged, personal, differencePersonal, malScore, differenceObjective, description"
  }
  else if (listParams.listType == 'manga') {
    columns = "id, watchlist, watchlistId, position, thumbnail, title, type, startYear, chapters, volumes, rating, startDate, finishedDate, genres, magazine, demographics, author, priority, story, character, presentation, enjoyment, averaged, personal, differencePersonal, malScore, differenceObjective, description"
  }

  let lastPosition = 1
  if (listParams && listParams.sameType.length > 0) {
    lastPosition = listParams.sameType.slice(-1)[0].watchlist.position + 1
  }

  const emptyList = {
    position: {value: lastPosition, type: "int"},
    name: {value: " ", type: "string"},
    header: {value: " ", type: "string"},
    type: {value: listParams.listType, type: "string"},
    columns: {value: columns, type: "string"},
    displayedColumns: {value: columns, type: "string"},
    createdAt: {value: Date.now(), type: "date"},
    updatedAt: {value: Date.now(), type: "date"},
    ownerId: {value: listParams.currentUser.id, type: "string"},
  }

  const addResponse = await fetch('/lists/fetch/create-watchlist/' + new URLSearchParams({
    list: JSON.stringify(emptyList)
  }))
  const addData = await addResponse.json();

  listParams.watchListData.push({
    watchlist: addData,
    listEntries: []
  })

  listParams.setShownSettings([...listParams.shownSettings, addData.id])
  listParams.setNavItems(listNavigationDisplayer(listParams))
}

function getWatchlistNav(entryData, listParams) {
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
        <a href={"/lists/" + listParams.username + "/" + listParams.listType + "/" + entryData.watchlist.name} id="list-landing-nav-link-open-button" class="list-landing-nav-link-open">
          Open
        </a>
        <button id="list-landing-nav-link-settings-button" class="list-landing-nav-link-settings" onClick={() => {listParams.setShownSettings([...listParams.shownSettings, entryData.watchlist.id])}}>
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

async function handleSubmit(e, columns, watchlist, listParams) {
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

  listParams.watchListData.find((object, index) => {
    if (object.watchlist.id === watchlist.id) {
      listParams.watchListData[index].watchlist = updateSettingsData.slice(-1)[0]
      return true;
    }
  })

  listParams.setShownSettings(oldValues => { return oldValues.filter(setting => setting !== watchlist.id) })
  listParams.setNavItems(listNavigationDisplayer(listParams))
}

function getWatchlistSettings(entryData, listParams) {
  const columns = entryData.watchlist.columns.split(', ')
  const displayedColumns = entryData.watchlist.displayedColumns.split(', ')
  const checkedColumns = checkDisplayedColumns(columns, displayedColumns)

  return(
    <Form onSubmit={(e) => {handleSubmit(e, columns, entryData.watchlist, listParams)}}>
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
          <button type="button" id="list-landing-settings-cancel-button" name="list-landing-settings-cancel-button" class="list-landing-settings-cancel" onClick={() => {listParams.setShownSettings(oldValues => { return oldValues.filter(setting => setting !== entryData.watchlist.id) })}}>
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

function listNavigationDisplayer(listParams) {
  let navigationItems = []

  for (const entryData of listParams.watchListData) {
    if (listParams.shownSettings.includes(entryData.watchlist.id)) {
      navigationItems.push(getWatchlistSettings(entryData, listParams))
    }
    else {
      navigationItems.push(getWatchlistNav(entryData, listParams))
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

  return json({ watchListData, watchListNavs, watchListSettings, currentUser, username: params['params']['username'], listType });
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
  const [navItems, setNavItems] = useState([])

  const currentUser = useLoaderData()['currentUser']
  const username = useLoaderData()['username']
  const listType = useLoaderData()['listType']
  const watchListData = useLoaderData()['watchListData']

  const sameType = watchListData.filter(item => item.watchlist.type === listType)
  const listParams = {watchListData, sameType, currentUser, username, listType, shownSettings, setShownSettings, navItems, setNavItems}

  useEffect(() => {
  	setNavItems(listNavigationDisplayer(listParams))
  }, [shownSettings]);

  let firstListMessage
  if (!sameType || sameType.length < 1) {
    firstListMessage = "Create your first list"
  }

  return (
    <main class="list-landing" style={{ width: '100%', height: '100%' }}>
      <div class="list-landing-sidebar-container">
        <a href={"/lists/" + username + "/liveaction"} className="list-landing-sidebar-item">Live Action</a>
        <a href={"/lists/" + username + "/anime"} className="list-landing-sidebar-item">Anime</a>
        <a href={"/lists/" + username + "/manga"} class="list-landing-sidebar-item list-landing-sidebar-item-bottom">Manga</a>
      </div>
      <div class="list-landing-main">
        <div class="list-landing-nav-container">
          { navItems }
          <div class="list-landing-starting-message"> { firstListMessage } </div>
          <span className='list-landing-nav-insert' onClick={(e) => {createNewList(listParams)}}>
            <Icon name="plus"></Icon>
          </span>
        </div>
      </div>
    </main>
  )
}
