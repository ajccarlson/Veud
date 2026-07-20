// Row/cell action helpers for the watchlist grid, extracted from $watchlist_grid.jsx
// (Phase 3.2, increment 2). These talk to the /lists/fetch/* endpoints and drive ag-grid
// mutations. They read the shared gridAPI/columnParams from grid-state (and gridReady
// writes gridAPI via setGridAPI); refreshGrid keeps its own columnParams parameter, which
// shadows the import inside its body exactly as it did when this lived in the monolith.
import { gridAPI, columnParams, setGridAPI } from './grid-state.ts'
import { mediaProgressParser } from '#app/utils/lists/column-functions.tsx'

async function requireSuccessfulResponse(response: Response) {
  if (response.ok) return response
  const message = await response.text().catch(() => '')
  throw new Error(message || `List request failed with ${response.status}`)
}

export async function moveEntry(
  entryId: string,
  destinationWatchlistId: string,
  position?: number,
) {
  const moveResponse = await fetch('/lists/fetch/move-row/' + encodeURIComponent(new URLSearchParams({
    entryId,
    destinationWatchlistId,
    ...(position === undefined ? {} : { position: String(position) }),
  }).toString()), { method: 'POST' })
  await requireSuccessfulResponse(moveResponse)
  return moveResponse.json()
}

export function gridReady(e: any) {
  setGridAPI(e.api)

  var navButtonContainers = document.querySelectorAll(".list-nav-button")

  navButtonContainers.forEach((navButtonContainer: any) => {
    var dropZone = {
      getContainer: () => {
        return navButtonContainer
      },
      onDragEnter: () => {
        navButtonContainer.style.outline = "0.25rem solid #FF9900"
        navButtonContainer.style.borderColor = "#FF5100";
        navButtonContainer.style.backgroundColor = "#AA7D39"
      },
      onDragLeave: () => {
        navButtonContainer.style = ""
      },
      onDragStop: async (e: any) => {
        navButtonContainer.style = ""
        const destinationWatchlistId = navButtonContainer.getAttribute('id')
        if (!e.node.data.id || !destinationWatchlistId) return

        try {
          await moveEntry(e.node.data.id, destinationWatchlistId)
          if (destinationWatchlistId !== columnParams.watchlistId) {
            gridAPI.applyTransaction({ remove: [e.node.data] })
          }
        } catch (error) {
          console.error('[watchlist] failed to move entry', error)
        } finally {
          await refreshGrid(columnParams)
        }
      },
    }
    gridAPI.addRowDropZone(dropZone)
  })
}

export function getAllRows() {
  let rowData: any[] = [];
  gridAPI.forEachNode((node: any) => rowData.push(node.data));
  return rowData;
}

export function createEmptyRow(watchlistId: any, position: any, listTypeData: any) {
  let emptyRow: Record<string, any> = {}

  for (const [key, value] of Object.entries(JSON.parse(listTypeData.columns) as Record<string, unknown>)) {
    if (key == "id") {
      continue
    }
    if (value == "string") {
      emptyRow[key] = " "
    }
    else if (value == "number") {
      emptyRow[key] = 0
    }
    else if (value == "date") {
      emptyRow[key] = null
    }
    else if (value == "history") {
      emptyRow["history"] = JSON.stringify({
        added: Date.now(),
        started: null,
        finished: null,
        progress: null,
        lastUpdated: Date.now(),
      })
    }
  }

  emptyRow["watchlistId"] = watchlistId
  emptyRow["position"] = position

  return emptyRow
}

export async function refreshGrid(columnParams: any) {
  const listEntriesResponse = await fetch('/lists/fetch/get-list-entries/' + encodeURIComponent(new URLSearchParams({
    authorization: columnParams.VEUD_API_KEY,
    watchlistId: columnParams.watchlistId,
    listTypeData: JSON.stringify(columnParams.listTypeData),
  } as any).toString()))
  await requireSuccessfulResponse(listEntriesResponse)
  const listEntriesData = (await listEntriesResponse.json() as any[])
    .sort((a: any, b: any) => a.position - b.position)

  const nextRows = [...listEntriesData]
  const emptyRow = createEmptyRow(
    columnParams.watchlistId,
    listEntriesData.length + 1,
    columnParams.listTypeData,
  )

  const lastEntry = listEntriesData.at(-1)
  const canEdit = columnParams.currentUserId === columnParams.listOwner.id
  if (canEdit && (!lastEntry ||
  ((lastEntry.title && lastEntry.title.replace(/\W/g, '') !== "") && (lastEntry.type && lastEntry.type.replace(/\W/g, '') !== "")))) {
    nextRows.push(emptyRow)
  }

  columnParams.setListEntries(nextRows)
  gridAPI?.setGridOption('rowData', nextRows)
}

export async function reformatHistory(params: any, newValue: any) {
  const updateCellResponse = await fetch('/lists/fetch/update-cell/' + encodeURIComponent(new URLSearchParams({
    authorization: columnParams.VEUD_API_KEY,
    listTypeData: JSON.stringify(columnParams.listTypeData),
    colId: params.column.colId,
    type: "history",
    filter: "agDateColumnFilter",
    rowIndex: params.node.data.id,
    newValue: newValue,
  } as any).toString()), { method: 'POST' })
  const updateCellData = await updateCellResponse.json()

  return updateCellData
}

export async function rowDragEnd(params: any) {
  if (!params.node.data.id) {
    await refreshGrid(columnParams)
    return
  }
  await updatePositions()
}

export const rowDragText = function (params: any) {
  return (params.rowNode.data.title + " (" + (params.rowNode.rowIndex + 1) + ")")
};

export async function createNewRow(location: any, params: any, position?: any) {
  let insertPosition = 0
  if (location == "Above") {
    if (params.data.position < 1) {
      insertPosition = 0
    }
    else {
      insertPosition = params.data.position - 1
    }
  }
  else
    insertPosition = params.data.position

  const emptyRow = createEmptyRow(params.data.watchlistId, insertPosition, columnParams.listTypeData)
  
  const addResponse = await fetch('/lists/fetch/add-row/' + encodeURIComponent(new URLSearchParams({
    authorization: columnParams.VEUD_API_KEY,
    listTypeData: JSON.stringify(columnParams.listTypeData),
    row: JSON.stringify(emptyRow)
  } as any).toString()), { method: 'POST' })
  const addData = await addResponse.json();

  gridAPI.applyTransaction({add: [addData], addIndex: insertPosition})

  const updateResponse = await fetch('/lists/fetch/now-updated/' + encodeURIComponent(new URLSearchParams({
    authorization: columnParams.VEUD_API_KEY,
    watchlistId: params.data.watchlistId
  } as any).toString()), { method: 'POST' })

  updatePositions()
}

export async function updatePositions() {
  const entryIds = getAllRows()
    .map(row => row.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
  try {
    const reorderResponse = await fetch('/lists/fetch/reorder-rows/' + encodeURIComponent(new URLSearchParams({
      watchlistId: columnParams.watchlistId,
      entryIds: JSON.stringify(entryIds),
    }).toString()), { method: 'POST' })
    await requireSuccessfulResponse(reorderResponse)
  } catch (error) {
    console.error('[watchlist] failed to reorder entries', error)
  } finally {
    await refreshGrid(columnParams)
  }
}

export async function setterFunction(params: any) {
  let returnValue = true

  if (params.column.colId == "position") {
    updatePositions()
  }
  else if (params.data != params.newValue) {
    let cellType = params.colDef.cellDataType
    if (params.column.colId.toLowerCase() == ("finished") || params.column.colId.toLowerCase() == ("started")) {
      cellType = "history"
    }
    else if (params.column.colId.toLowerCase() == ("length")) {
      const fullLengthRegex = /\d+\s*\/\s*\d+ eps/g
      const partialLengthRegex = /\d*\s*\/*\s*\d+ eps/g
      
      if (!isNaN(params.newValue)) {
        try {
          if (fullLengthRegex.test(params.oldValue)) {
            params.newValue = params.oldValue.replace(/[0-9]+/, params.newValue)
          }
          else {
            throw new Error
          }
        }
        catch(e) {
          if (partialLengthRegex.test(params.oldValue)) {
            const lengthData = mediaProgressParser(params, columnParams, params.oldValue, params.newValue) as any
            params.newValue = `${lengthData.progress} / ${lengthData.total} eps`
          }
        }
      }
    }
    else if (params.column.colId.toLowerCase() == ("chapters") || params.column.colId.toLowerCase() == ("volumes")) {
      const mediaData = mediaProgressParser(params, columnParams, params.oldValue, params.newValue) as any
      params.newValue = `${mediaData.progress} / ${mediaData.total}`
    }

    params.data[params.column.colId] = params.newValue

    const updateCellResponse = await fetch('/lists/fetch/update-cell/' + encodeURIComponent(new URLSearchParams({
      authorization: columnParams.VEUD_API_KEY,
      listTypeData: JSON.stringify(columnParams.listTypeData),
      colId: params.column.colId,
      type: cellType,
      filter: params.colDef.filter,
      rowIndex: params.data.id,
      newValue: params.newValue,
    } as any).toString()), { method: 'POST' })
    const updateCellData = await updateCellResponse.json()

    const updateResponse = await fetch('/lists/fetch/now-updated/' + encodeURIComponent(new URLSearchParams({
      authorization: columnParams.VEUD_API_KEY,
      watchlistId: params.data.watchlistId
    } as any).toString()), { method: 'POST' })


    if (["length", "chapters", "volumes", "date", "finished", "started"].includes(params.column.colId.toLowerCase())) {
      refreshGrid(columnParams)
    }
  }
  else {
    returnValue = false;
  }

  return returnValue
}
