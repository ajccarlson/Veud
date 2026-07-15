// Row/cell action helpers for the watchlist grid, extracted from $watchlist_grid.jsx
// (Phase 3.2, increment 2). These talk to the /lists/fetch/* endpoints and drive ag-grid
// mutations. They read the shared gridAPI/columnParams from grid-state (and gridReady
// writes gridAPI via setGridAPI); refreshGrid keeps its own columnParams parameter, which
// shadows the import inside its body exactly as it did when this lived in the monolith.
import { gridAPI, columnParams, setGridAPI } from './grid-state.ts'
import { mediaProgressParser } from '#app/utils/lists/column-functions.tsx'

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

        const listEntriesResponse = await fetch('/lists/fetch/get-list-entries/' + encodeURIComponent(new URLSearchParams({
          authorization: columnParams.VEUD_API_KEY,
          watchlistId: navButtonContainer.getAttribute('id'),
          listTypeData: JSON.stringify(columnParams.listTypeData),
        } as any).toString()))
        const listEntriesData = await listEntriesResponse.json() as any[]

        let addRow = structuredClone(e.node.data)
        addRow.watchlistId = navButtonContainer.getAttribute('id')
        addRow.position = listEntriesData.length + 1
        delete addRow.id

        const addResponse = await fetch('/lists/fetch/add-row/' + encodeURIComponent(new URLSearchParams({
          authorization: columnParams.VEUD_API_KEY,
          listTypeData: JSON.stringify(columnParams.listTypeData),
          row: JSON.stringify(addRow)
        } as any).toString()), { method: 'POST' })

        const updateResponseAdd = await fetch('/lists/fetch/now-updated/' + encodeURIComponent(new URLSearchParams({
          authorization: columnParams.VEUD_API_KEY,
          watchlistId: addRow.watchlistId
        } as any).toString()), { method: 'POST' })
        
        const deleteResponse = await fetch('/lists/fetch/delete-row/' + encodeURIComponent(new URLSearchParams({
          authorization: columnParams.VEUD_API_KEY,
          listTypeData: JSON.stringify(columnParams.listTypeData),
          id: e.node.data.id,
        } as any).toString()), { method: 'POST' })
        
        const updateResponseRemove = await fetch('/lists/fetch/now-updated/' + encodeURIComponent(new URLSearchParams({
          authorization: columnParams.VEUD_API_KEY,
          watchlistId: e.node.data.watchlistId
        } as any).toString()), { method: 'POST' })

        updatePositions()
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
  const listEntriesData = await listEntriesResponse.json() as any[];

  columnParams.setListEntries(listEntriesData.sort(function(a: any, b: any) {
		if (a.position < b.position) return -1;
		if (a.position > b.position) return 1;
		return 0;
	}))

  let emptyRow = columnParams.emptyRow
  if (!emptyRow && columnParams.watchlistId) {
    emptyRow = createEmptyRow(columnParams.watchlistId, listEntriesData.length + 1, columnParams.listTypeData)
  }
  
  if (listEntriesData.slice(-1)[0] &&
  ((listEntriesData.slice(-1)[0].title && listEntriesData.slice(-1)[0].title.replace(/\W/g, '') !== "") && (listEntriesData.slice(-1)[0].type && listEntriesData.slice(-1)[0].type.replace(/\W/g, '') !== ""))) {
    listEntriesData.push(emptyRow)
    columnParams.setListEntries(listEntriesData)
  }
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

export function rowDragEnd(params: any) {
  const rowNode = gridAPI.getRowNode(params.node.id)
  rowNode.setDataValue("position", params.overIndex + 1)
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
  gridAPI.forEachNode(async (rowNode: any, index: number) => {
    rowNode.data.position = index + 1

    const updateCellResponse = await fetch('/lists/fetch/update-cell/' + encodeURIComponent(new URLSearchParams({
      authorization: columnParams.VEUD_API_KEY,
      listTypeData: JSON.stringify(columnParams.listTypeData),
      colId: "position",
      type: "num",
      filter: "num",
      rowIndex: rowNode.data.id,
      newValue: index + 1,
    } as any).toString()), { method: 'POST' })
  })

  const updateResponse = await fetch('/lists/fetch/now-updated/' + encodeURIComponent(new URLSearchParams({
    authorization: columnParams.VEUD_API_KEY,
    watchlistId: columnParams.watchlistId
  } as any).toString()), { method: 'POST' })

  refreshGrid(columnParams)
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
