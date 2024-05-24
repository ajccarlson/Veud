import { json } from "@remix-run/node"
import { useLoaderData } from '@remix-run/react'
import { useOptionalUser } from '#app/utils/user.ts'
import { Link } from '@remix-run/react'
import { useState, useEffect } from 'react'
import { prisma } from '#app/utils/db.server.ts'
import { timeSince, getStartYear, getThumbnailInfo } from "#app/utils/lists/column-functions.jsx"
import { Icon } from '#app/components/ui/icon.tsx'
import { Spacer } from '#app/components/spacer.tsx'
import { invariantResponse } from '@epic-web/invariant'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { GetWatchlistSettings } from "#app/routes/lists+/.$username+/.$list-type+/_settings.jsx"
import "#app/styles/list-landing.scss"

async function createNewList(listParams) {
  const typeId = listParams.listTypeData.id

  let lastPosition = 1
  if (listParams && listParams.sameType.length > 0) {
    lastPosition = listParams.sameType.slice(-1)[0].watchlist.position + 1
  }

  const emptyList = {
    position: {value: lastPosition, type: "int"},
    name: {value: " ", type: "string"},
    header: {value: " ", type: "string"},
    typeId: {value: typeId, type: "string"},
    displayedColumns: {value: Object.keys(JSON.parse(listParams.listTypeData.columns)).filter(entry => entry !== "id" && entry !== "watchlistId"  && entry !== "watchlist").join(", "), type: "string"},
    createdAt: {value: Date.now(), type: "date"},
    updatedAt: {value: Date.now(), type: "date"},
    ownerId: {value: listParams.listOwner.id, type: "string"},
    description: {value: " ", type: "string"}
  }

  const addResponse = await fetch('/lists/fetch/create-watchlist/' + encodeURIComponent(new URLSearchParams({
    list: JSON.stringify(emptyList)
  })))
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
            {entryData.listEntries? 
              <div class="list-landing-nav-entry-preview-container">
                {entryData.watchlist.description.length > 30? 
                  <hr class="list-landing-nav-entry-preview-separator"></hr>
                : null}
                <div class="list-landing-nav-thumbnail-container">
                  {entryData.listEntries.slice(0, 5).map(listEntry => 
                    <div class="list-landing-nav-thumbnail-item">
                      <Link to={getThumbnailInfo(listEntry.thumbnail).url} className="list-landing-body-thumbnail-image" style={{backgroundImage: `url("${getThumbnailInfo(listEntry.thumbnail).content}")`}}>
                        <span className="list-landing-thumbnail-header">
                          <div className="list-landing-thumbnail-start-year">
                            {getStartYear(listEntry, listParams.listTypeData,  listParams.listTypes)}
                          </div>
                          <div className="list-landing-thumbnail-media-type">
                            {listEntry.type}
                          </div>
                        </span>
                        <span className="list-landing-thumbnail-footer">
                          {listEntry.title.length > 20 ? `${listEntry.title.substring(0, 20)}...` : listEntry.title}
                        </span>
                      </Link>
                    </div>
                  )}
                </div>
              </div>
            : null}
            <div class="list-landing-nav-last-updated-container">
              Last Updated:
              <span class="list-landing-nav-last-updated-span">
                {`${timeSince(new Date(entryData.watchlist.updatedAt))} ago`}
              </span>
            </div>
          </div>
        </div>
      </div>
      {listParams.currentUserId == listParams.listOwner.id ? 
        <div class="list-landing-nav-link-container">
          <a href={"/lists/" + listParams.username + "/" + listParams.listTypeData.name + "/" + entryData.watchlist.name} id="list-landing-nav-link-item-button" class="list-landing-nav-link-item">
            Open
          </a>
          <button id="list-landing-nav-link-end-button" class="list-landing-nav-link-end" onClick={() => {listParams.setShownSettings([...listParams.shownSettings, entryData.watchlist.id])}}>
            Settings
          </button>
        </div>
      :
        <div class="list-landing-nav-link-container">
          <a href={"/lists/" + listParams.username + "/" + listParams.listTypeData.name + "/" + entryData.watchlist.name} id="list-landing-nav-link-end-button" class="list-landing-nav-link-end">
            Open
          </a>
        </div>
      }
      <Spacer size="xs"/>
    </div>
  )
}

export function listNavigationDisplayer(listParams) {
  let navigationItems = []

  for (const entryData of listParams.watchListData) {
    if (listParams.shownSettings.includes(entryData.watchlist.id)) {
      navigationItems.push(GetWatchlistSettings(entryData, listParams))
    }
    else {
      navigationItems.push(getWatchlistNav(entryData, listParams))
    }
  }

  return navigationItems
}

export async function loader(params) {
  const listOwner = await prisma.User.findUnique({
    where: {
      username: params['params']['username'],
    },
  })

  invariantResponse(listOwner, 'User not found', { status: 404 }) 

  const listTypes = await prisma.listType.findMany()
  const listType = params['params']['list-type']
  const listTypeData = listTypes.find(type => type.name === listType)

  const typeFormatted = listTypeData.header.replace(/\W/g, '') + "Entry"

  invariantResponse(typeFormatted, 'List type not found', { status: 404 })

  const watchLists = await prisma.watchlist.findMany({
    where: {
      typeId: listTypeData.id,
      ownerId: listOwner.id,
    },
  })

  let watchListData = []
  let watchListNavs = []
  let watchListSettings = []

  const watchListsSorted = watchLists.sort((a, b) => a.position - b.position)
  
  for (const watchlist of watchListsSorted) {
    const listEntries = await prisma[typeFormatted].findMany({
      where: {
        watchlistId: watchlist.id,
      },
    })

    const entryData = {
      watchlist: watchlist,
      listEntries: listEntries.sort((a, b) => a.position - b.position)
    }

    watchListData.push(entryData)
  }

  if (watchListNavs.length < 1) {
    watchListNavs = [`<h1">No lists found</h1>`]
  }
  return json({ watchListData, watchListNavs, watchListSettings, listOwner, username: params['params']['username'], listTypes, listTypeData });
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

export default function Lists() {
  const [shownSettings, setShownSettings] = useState([])
  const [settingsErrors, setSettingsErrors] = useState([])
  const [navItems, setNavItems] = useState([])
  const loaderData = useLoaderData()
  const currentUser = useOptionalUser()
  const currentUserId = currentUser ? currentUser.id : null

  const sameType = loaderData.watchListData.filter(item => item.watchlist.typeId === loaderData.listTypeData.id)
  const listParams = {watchListData: loaderData.watchListData, sameType, listOwner: loaderData.listOwner, username: loaderData.username, currentUser, currentUserId, listTypes: loaderData.listTypes, listTypeData: loaderData.listTypeData, shownSettings, setShownSettings, navItems, setNavItems, settingsErrors, setSettingsErrors}

  useEffect(() => {
  	setSettingsErrors(settingsErrors)
  }, [settingsErrors])

  useEffect(() => {
  	setNavItems(listNavigationDisplayer(listParams))
  }, [shownSettings]);

  let firstListMessage
  if (!sameType || sameType.length < 1) {
    if (listParams.currentUserId == listParams.listOwner.id) {
      firstListMessage = "Create your first list"
    }
    else {
      firstListMessage = "User has no lists"
    }
  }

  return (
    <main class="list-landing" style={{ width: '100%', height: '100%' }}>
      <div class="list-landing-nav-main">
        <div class="list-landing-nav-container">
          { navItems }
          <div class="list-landing-starting-message"> { firstListMessage } </div>
          {listParams.currentUserId == listParams.listOwner.id ? 
            <span className='list-landing-nav-insert' onClick={(e) => {createNewList(listParams)}}>
              <Icon name="plus"></Icon>
            </span>
          :
            null
          }
        </div>
      </div>
      <div class="list-landing-sidebar-container">
        <Link prefetch="intent" to={`/lists/${loaderData.username}/liveaction`} className="list-landing-sidebar-item" reloadDocument>
          Live Action
        </Link>
        <Link prefetch="intent" to={`/lists/${loaderData.username}/anime`} className="list-landing-sidebar-item" reloadDocument>
          Anime
        </Link>
        <Link prefetch="intent" to={`/lists/${loaderData.username}/manga`} className="list-landing-sidebar-item list-landing-sidebar-item-bottom" reloadDocument>
          Manga
        </Link>
      </div>
    </main>
  )
}
