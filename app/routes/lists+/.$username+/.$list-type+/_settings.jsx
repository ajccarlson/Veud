import { Form } from '@remix-run/react'
import { timeSince } from "#app/utils/lists/column-functions.jsx"
import { Icon } from '#app/components/ui/icon.tsx'
import { Spacer } from '#app/components/spacer.tsx'
import { listNavigationDisplayer } from '#app/routes/lists+/.$username+/.$list-type+/index.jsx'

function checkDisplayedColumns(columns, displayedColumns) {
  let checkedColumns = []
  let displayedIndex = 0

  for (let column of columns) {
    if (column == "id" || column == "watchlistId" || column == "watchlist")
      continue

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

  let errorArray = []

  if (!settingsObject["header"] || settingsObject["header"].length < 3) {
    errorArray.push("header")
  }

  if (!foundColumns || foundColumns.length < 1) {
    errorArray.push("displayedColumns")
  }

  if (errorArray.length > 0) {
    listParams.setSettingsErrors({...listParams.settingsErrors,  [watchlist.id]: errorArray})
  }
  else {
    listParams.setSettingsErrors({...listParams.settingsErrors,  [watchlist.id]: null})

    const updateSettingsResponse = await fetch('/lists/fetch/update-settings/' + encodeURIComponent(new URLSearchParams({
      settings: JSON.stringify(Object.keys(settingsObject).map((key) => [key, settingsObject[key]])),
      listId: watchlist.id,
      listTypeData: JSON.stringify(listParams.listTypeData),
      ownerId: listParams.listOwner.id
    })))
    const updateSettingsData = await updateSettingsResponse.json()
    
    const updateResponse = await fetch('/lists/fetch/now-updated/' + encodeURIComponent(new URLSearchParams({
      watchlistId: watchlist.id
    })))
  
    listParams.watchListData.find((object, index) => {
      if (object.watchlist.id === watchlist.id) {
        listParams.watchListData[index].watchlist = updateSettingsData.slice(-1)[0]
        return true;
      }
    })
  
    listParams.setShownSettings(oldValues => { return oldValues.filter(setting => setting !== watchlist.id) })
    listParams.setNavItems(listNavigationDisplayer(listParams))
  }
}

export function GetWatchlistSettings(entryData, listParams) {
  const columns = Object.keys(JSON.parse(listParams.listTypeData.columns))
  const displayedColumns = entryData.watchlist.displayedColumns.split(', ')
  const checkedColumns = checkDisplayedColumns(columns, displayedColumns)

  return(
    <Form method="post" onSubmit={(e) => {handleSubmit(e, columns, entryData.watchlist, listParams)}}>
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
                    Name *
                  </div>
                  <input class="list-landing-settings-input-item" id="name-input" name="name-input" defaultValue={entryData.watchlist.header} maxlength="150"/>
                  {listParams.settingsErrors[entryData.watchlist.id]?.includes("header") ? (
                    <em>Name must be at least 3 characters long</em>
                  ) : null}
                </div>
                <div class="list-landing-settings-input-row"> 
                  <div> 
                    Description
                  </div>
                  <textarea class="list-landing-settings-input-item" id="description-input" name="description-input" cols="50" rows="5" defaultValue={entryData.watchlist.description}  maxlength="1000"></textarea>
                </div>
                <div class="list-landing-settings-input-row"> 
                  <div>
                    Columns *
                  </div>
                  <div class="list-landing-settings-checkbox-container"> 
                    {checkedColumns} 
                  </div> 
                  {listParams.settingsErrors[entryData.watchlist.id]?.includes("displayedColumns") ? (
                    <em>Must display at least one column</em>
                  ) : null}
                </div>
                <button type="button" class="list-landing-settings-delete-button"
                  onClick={async () => {
                    await fetch('/lists/fetch/delete-watchlist/' + encodeURIComponent(new URLSearchParams({
                      id: entryData.watchlist.id,
                      listTypeData: JSON.stringify(listParams.listTypeData),
                      ownerId: listParams.listOwner.id
                    })))

                    listParams.watchListData = listParams.watchListData.filter(item => item.watchlist.id !== entryData.watchlist.id)
                    listParams.setNavItems(listNavigationDisplayer(listParams))
                  }}>
                  <div class="list-landing-settings-delete-icon">
                    <Icon name="trash"></Icon>
                  </div>
                  <span class="list-landing-settings-delete-text">
                    Delete
                  </span>
                </button>
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
      <Spacer size="xs" />
    </Form>
  )
}