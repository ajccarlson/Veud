import { AgGridReact } from '@ag-grid-community/react'
import { Form } from '@remix-run/react'
import { Input } from '#app/components/ui/input.tsx'
import { useState, useEffect } from 'react'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuPortal,
	DropdownMenuTrigger,
  DropdownMenuSubTrigger,
  DropdownMenuSub
} from '#app/components/ui/dropdown-menu.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { dateFormatter, mediaProgressParser, timeSince, differenceFormatter, getSiteID, getThumbnailInfo, hyperlinkRenderer, titleCellRenderer, typeCellRenderer, updateRowInfo } from "#app/utils/lists/column-functions.jsx"
import { scoreColor, scoreRange } from "#app/utils/lists/score-colorer.tsx"
import '@ag-grid-community/styles/ag-grid.css'
import "#app/styles/watchlist.scss"
import { ClientSideRowModelModule } from '@ag-grid-community/client-side-row-model'
import { ModuleRegistry } from '@ag-grid-community/core'

ModuleRegistry.registerModules([ ClientSideRowModelModule ]);
let gridAPI, columnParams

export const gridOptions = {
  autoSizeStrategy: {
    type: 'fitCellContents',
    defaultMinWidth: 70
  },
  defaultColDef: {
    editable: false,
    resizable: false,
    flex: 1,
    suppressMovable: true,
    wrapHeaderText: true,
    autoHeaderHeight: true,
    cellStyle: {"wordBreak": "normal"},
    wrapText: true,
    autoHeight: true,
  },
  rowDragManaged: true,
  rowDragMultiRow: true,
  onRowDragEnd: rowDragEnd,
  rowSelection: 'multiple',
  onGridReady: gridReady,
}

function gridReady(e) {
  gridAPI = e.api

  var navButtonContainers = document.querySelectorAll(".list-nav-button")

  navButtonContainers.forEach(navButtonContainer => {
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
      onDragStop: async (e) => {
        navButtonContainer.style = ""

        const listEntriesResponse = await fetch('/lists/fetch/get-list-entries/' + encodeURIComponent(new URLSearchParams({
          authorization: columnParams.VEUD_API_KEY,
          watchlistId: navButtonContainer.getAttribute('id'),
          listTypeData: JSON.stringify(columnParams.listTypeData),
        })))
        const listEntriesData = await listEntriesResponse.json()

        let addRow = structuredClone(e.node.data)
        addRow.watchlistId = navButtonContainer.getAttribute('id')
        addRow.position = listEntriesData.length + 1
        delete addRow.id

        const addResponse = await fetch('/lists/fetch/add-row/' + encodeURIComponent(new URLSearchParams({
          authorization: columnParams.VEUD_API_KEY,
          listTypeData: JSON.stringify(columnParams.listTypeData),
          row: JSON.stringify(addRow)
        })))

        const updateResponseAdd = await fetch('/lists/fetch/now-updated/' + encodeURIComponent(new URLSearchParams({
          authorization: columnParams.VEUD_API_KEY,
          watchlistId: addRow.watchlistId
        })))
        
        const deleteResponse = await fetch('/lists/fetch/delete-row/' + encodeURIComponent(new URLSearchParams({
          authorization: columnParams.VEUD_API_KEY,
          listTypeData: JSON.stringify(columnParams.listTypeData),
          id: e.node.data.id,
        })))
        
        const updateResponseRemove = await fetch('/lists/fetch/now-updated/' + encodeURIComponent(new URLSearchParams({
          authorization: columnParams.VEUD_API_KEY,
          watchlistId: e.node.data.watchlistId
        })))

        updatePositions()
      },
    }
    gridAPI.addRowDropZone(dropZone)
  })
}

function getAllRows() {
  let rowData = [];
  gridAPI.forEachNode(node => rowData.push(node.data));
  return rowData;
}

export function createEmptyRow(watchlistId, position, listTypeData) {
  let emptyRow = {}

  for (const [key, value] of Object.entries(JSON.parse(listTypeData.columns))) {
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

export async function refreshGrid(columnParams) {
  const listEntriesResponse = await fetch('/lists/fetch/get-list-entries/' + encodeURIComponent(new URLSearchParams({
    authorization: columnParams.VEUD_API_KEY,
    watchlistId: columnParams.watchlistId,
    listTypeData: JSON.stringify(columnParams.listTypeData),
  })))
  const listEntriesData = await listEntriesResponse.json();

  columnParams.setListEntries(listEntriesData.sort(function(a, b) {
		if (a.position < b.position) return -1;
		if (a.position > b.position) return 1;
		return 0;
	}))

  let emptyRow = columnParams.emptyRow
  if (!emptyRow && columnParams.watchlistId) {
    emptyRow = createEmptyRow(columnParams.watchlistId, listEntries.length + 1, columnParams.listTypeData)
  }
  
  if (listEntriesData.slice(-1)[0] &&
  ((listEntriesData.slice(-1)[0].title && listEntriesData.slice(-1)[0].title.replace(/\W/g, '') !== "") && (listEntriesData.slice(-1)[0].type && listEntriesData.slice(-1)[0].type.replace(/\W/g, '') !== ""))) {
    listEntriesData.push(emptyRow)
    columnParams.setListEntries(listEntriesData)
  }
}

export async function reformatHistory(params, newValue) {
  const updateCellResponse = await fetch('/lists/fetch/update-cell/' + encodeURIComponent(new URLSearchParams({
    authorization: columnParams.VEUD_API_KEY,
    listTypeData: JSON.stringify(columnParams.listTypeData),
    colId: params.column.colId,
    type: "history",
    filter: "agDateColumnFilter",
    rowIndex: params.node.data.id,
    newValue: newValue,
  })))
  const updateCellData = await updateCellResponse.json()

  return updateCellData
}

function rowDragEnd(params) {
  const rowNode = gridAPI.getRowNode(params.node.id)
  rowNode.setDataValue("position", params.overIndex + 1)
}

const rowDragText = function (params) {
  return (params.rowNode.data.title + " (" + (params.rowNode.rowIndex + 1) + ")")
};

async function createNewRow(location, params, position) {
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
  })))
  const addData = await addResponse.json();

  gridAPI.applyTransaction({add: [addData], addIndex: insertPosition})

  const updateResponse = await fetch('/lists/fetch/now-updated/' + encodeURIComponent(new URLSearchParams({
    authorization: columnParams.VEUD_API_KEY,
    watchlistId: params.data.watchlistId
  })))

  updatePositions()
}

async function updatePositions() {
  gridAPI.forEachNode(async (rowNode, index) => {
    rowNode.data.position = index + 1

    const updateCellResponse = await fetch('/lists/fetch/update-cell/' + encodeURIComponent(new URLSearchParams({
      authorization: columnParams.VEUD_API_KEY,
      listTypeData: JSON.stringify(columnParams.listTypeData),
      colId: "position",
      type: "num",
      filter: "num",
      rowIndex: rowNode.data.id,
      newValue: index + 1,
    })))
  })

  const updateResponse = await fetch('/lists/fetch/now-updated/' + encodeURIComponent(new URLSearchParams({
    authorization: columnParams.VEUD_API_KEY,
    watchlistId: columnParams.watchlistId
  })))

  refreshGrid(columnParams)
}

async function setterFunction(params) {
  // console.log(params)
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
          if (lengthRegex.test(params.oldValue)) {
            params.newValue = params.oldValue.replace(/[0-9]+/, params.newValue)
          }
          else {
            throw new Error
          }
        }
        catch(e) {
          if (partialLengthRegex.test(params.oldValue)) {
            const lengthData = mediaProgressParser(params, columnParams, params.oldValue, params.newValue)
            params.newValue = `${lengthData.progress} / ${lengthData.total} eps`
          }
        }
      }
    }
    else if (params.column.colId.toLowerCase() == ("chapters") || params.column.colId.toLowerCase() == ("volumes")) {
      const mediaData = mediaProgressParser(params, columnParams, params.oldValue, params.newValue)
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
    })))
    const updateCellData = await updateCellResponse.json()

    const updateResponse = await fetch('/lists/fetch/now-updated/' + encodeURIComponent(new URLSearchParams({
      authorization: columnParams.VEUD_API_KEY,
      watchlistId: params.data.watchlistId
    })))

    console.log("value: " + params.oldValue + " has changed to " + params.newValue)

    if (["length", "chapters", "volumes", "date", "finished", "started"].includes(params.column.colId.toLowerCase())) {
      refreshGrid(columnParams)
    }
  }
  else {
    console.log("value unchanged")
    returnValue = false;
  }

  return returnValue
}

export function columnDefs() {
  return [
    {
      field: 'position',
      headerName: '#',
      valueSetter: params => {setterFunction(params)},
      editable: false,
      resizable: false,
      minWidth: 60,
      maxWidth: 60,
      filter: 'agNumberColumnFilter',
      rowDrag: columnParams.currentUserId == columnParams.listOwner.id,
      cellRenderer: params => {
        return (
          <div>
            {columnParams.currentUserId == columnParams.listOwner.id ?
              <div>
                <Form
                  method="GET"
                  onSubmit={async (event) => {
                    event.preventDefault();

                    let agRows = getAllRows()
                    const agRow = agRows[params.node.id]
                    console.log(agRow)
                    const deleteResponse = gridAPI.applyTransaction({ remove: [agRow] })
                    
                    let addPosition = event.target.moveRowIndex.value
                    if (addPosition > agRows.length - 1) {
                      addPosition = (agRows.length - 1)
                    }
                    else if (addPosition < 1) {
                      addPosition = 1
                    }

                    let addRow = params.node.data
                    addRow.position = addPosition

                    const addResponse = gridAPI.applyTransaction({
                      add: [addRow],
                      addIndex: addPosition - 1,
                    })

                    const rowNode = gridAPI.getRowNode(addPosition - 1)
                    rowNode.setDataValue("position", Number(addPosition))
                  }}
                >
                  <Input
                    name="moveRowIndex"
                    className="ag-row-index ag-move-row-input"
                    id="moveRowIndex"
                    autoComplete='false'
                    placeholder={params.value}
                  />
                </Form>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <span className='ag-cell-insert'>
                      <Icon name="plus"></Icon>
                    </span>
                  </DropdownMenuTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuContent sideOffset={8} align="start">
                      <DropdownMenuItem onSelect={event => {
                        createNewRow("Above", params)
                      }}>
                        Insert 1 row above
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={event => {
                        createNewRow("Below", params)
                      }}>
                        Insert 1 row below
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={async event => {
                        const deleteResponse = await fetch('/lists/fetch/delete-row/' + encodeURIComponent(new URLSearchParams({
                          authorization: columnParams.VEUD_API_KEY,
                          listTypeData: JSON.stringify(columnParams.listTypeData),
                          id: params.data.id,
                        })))

                        const updateResponse = await fetch('/lists/fetch/now-updated/' + encodeURIComponent(new URLSearchParams({
                          authorization: columnParams.VEUD_API_KEY,
                          watchlistId: params.data.watchlistId
                        })))

                        const deleteTransaction = gridAPI.applyTransaction({ remove: [params.data] })

                        updatePositions()
                      }}>
                        Delete row
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={async event => {
                        updateRowInfo(params, columnParams, false)
                      }}>
                        Update entry info
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={async event => {
                        gridAPI.forEachNode(async (rowNode, index) => {
                          await updateRowInfo(rowNode, columnParams, true)
                        });
                      
                        refreshGrid(columnParams)
                      }}>
                        Update all watchlist entries
                      </DropdownMenuItem>
                      {columnParams.favoriteIds?.includes(getSiteID(getThumbnailInfo(params.data.thumbnail).url).id) ? 
                        <DropdownMenuItem onSelect={async event => {
                          const deleteRow = columnParams.typedFavorites[columnParams.listTypeData.id].filter(favorite => {
                            return getSiteID(getThumbnailInfo(favorite.thumbnail).url).id === getSiteID(getThumbnailInfo(params.data.thumbnail).url).id
                          })

                          const deleteResponse = await fetch('/lists/fetch/remove-favorite/' + encodeURIComponent(new URLSearchParams({
                            authorization: columnParams.VEUD_API_KEY,
                            id: deleteRow[0].id,
                          })))

                          columnParams.setFavoriteIds(columnParams.favoriteIds.filter(favoriteId => favoriteId !== getSiteID(getThumbnailInfo(params.data.thumbnail).url).id))
                        }}>
                          Remove from favorites
                        </DropdownMenuItem>
                      :
                        <DropdownMenuItem onSelect={async event => {
                          const addPosition = Object.entries(columnParams.typedFavorites[columnParams.listTypeData.id]).length + 1
                          const typeColumns = JSON.parse(columnParams.listTypeData.columns)
                          const startTypes = ["airYear", "startYear", "startSeason"]
                          const startColumn = Object.keys(typeColumns).find((column) => startTypes.includes(column))

                          const addRow = {position: addPosition, thumbnail: params.data.thumbnail, title: params.data.title, typeId: columnParams.listTypeData.id, mediaType: params.data.type, startYear: params.data[startColumn], ownerId: columnParams.listOwner.id}

                          const addResponse = await fetch('/lists/fetch/add-favorite/' + encodeURIComponent(new URLSearchParams({
                            authorization: columnParams.VEUD_API_KEY,
                            favorite: JSON.stringify(addRow)
                          })))

                          columnParams.setFavoriteIds([...columnParams.favoriteIds, getSiteID(getThumbnailInfo(params.data.thumbnail).url).id])
                        }}>
                          Add to favorites
                        </DropdownMenuItem>
                      }
                    </DropdownMenuContent>
                  </DropdownMenuPortal>
                </DropdownMenu>
              </div>
            :
              <div className="ag-row-index">
                {params.value}
              </div>
            } 
          </div>
        )
      },
      cellClass: "ag-position-cell",
      hide: !columnParams.displayedColumns['position'],
    },


    {
      field: 'thumbnail',
      headerName: 'Thumbnail',
      valueSetter: params => {setterFunction(params)},
      sortable: false,
      minWidth: 80,
      maxWidth: 120,
      cellRenderer: params => hyperlinkRenderer(params.value, "thumbnail"),
      cellClass: "ag-thumbnail-cell",
      hide: !columnParams.displayedColumns['thumbnail'],
    },


    {
      field: 'title',
      headerName: 'Title',
      valueSetter: params => {setterFunction(params)},
      flex: 2,
      resizable: false,
      minWidth: 90,
      maxWidth: 200,
      cellRenderer: params => titleCellRenderer(params, columnParams),
      filter: 'agTextColumnFilter',
      cellClass: "ag-title-cell",
      hide: !columnParams.displayedColumns['title'],
    },


    {
      field: 'type',
      headerName: 'Type',
      valueSetter: params => {setterFunction(params)},
      minWidth: 70,
      maxWidth: 125,
      cellRenderer: params => typeCellRenderer(params, columnParams),
      filter: 'agSetColumnFilter',
      cellStyle: function(params) {
        if (params.value) {
          if (params.value.includes('Movie')) {
            return {color: '#408063'};
          } 
          else if (params.value.includes('TV Series*')) {
            return {color: '#A2FFD5'};
          } else {
            return {color: '#dbffcc'};
          }
        }
      },
      hide: !columnParams.displayedColumns['type'],
    },


    {
      field: 'airYear',
      headerName: 'Air Year',
      valueSetter: params => {setterFunction(params)},
      minWidth: 65,
      maxWidth: 72,
      filter: 'agDateColumnFilter',
      hide: !columnParams.displayedColumns['airYear'],
    },


    {
      field: 'startSeason',
      headerName: 'Start Season',
      valueSetter: params => {setterFunction(params)},
      minWidth: 65,
      maxWidth: 72,
      filter: "agTextColumnFilter",
      hide: !columnParams.displayedColumns['startSeason'],
    },


    {
      field: 'startYear',
      headerName: 'Start Year',
      valueSetter: params => {setterFunction(params)},
      minWidth: 65,
      maxWidth: 72,
      filter: "agTextColumnFilter",
      hide: !columnParams.displayedColumns['startYear'],
    },


    {
      field: 'releaseStart',
      headerName: 'Release Start',
      valueSetter: params => {setterFunction(params)},
      valueFormatter: params => dateFormatter(params.value),
      minWidth: 65,
      maxWidth: 72,
      filter: "agDateColumnFilter",
      hide: !columnParams.displayedColumns['releaseStart'],
    },


    {
      field: 'releaseEnd',
      headerName: 'Release End',
      valueSetter: params => {setterFunction(params)},
      valueFormatter: params => dateFormatter(params.value),
      minWidth: 65,
      maxWidth: 72,
      filter: "agDateColumnFilter",
      hide: !columnParams.displayedColumns['releaseEnd'],
    },


    {
      field: 'length',
      headerName: 'Length',
      cellRenderer: params => {
        const totalLength = params.value

        let finishedValue
        try {
          finishedValue = JSON.parse(params.data.history).finished
        }
        catch(e) {}
        
        /*if (!params.value || params.value == "null" || params.value == "NULL" || params.value == 0) {
          return ""
        }
        else */if (finishedValue && finishedValue != "null" && finishedValue != "NULL" && finishedValue != 0) {
          return totalLength
        }
        else if (totalLength.includes("eps")) {
          const lengthData = mediaProgressParser(params, columnParams, params.value, undefined)

          return (
            <div className="ag-progress-cell">
              {columnParams.currentUserId == columnParams.listOwner.id ?
                <Form
                  method="GET"
                  onSubmit={async (event) => {
                    event.preventDefault();

                    const newParams = {...params, newValue : event.target.lengthInput.value, oldValue : params.value}

                    setterFunction(newParams)
                  }}
                  className="ag-progress-cell-text-container"
                >
                  <Input
                    name="lengthInput"
                    className="ag-progress-cell-input"
                    id={`${params.rowIndex}-length-input`}
                    autoComplete='false'
                    defaultValue={lengthData.progress  ?? ''}
                    placeholder={lengthData.progress}
                  />
                  <span className='ag-progress-increment-button' onClick={(event) => {
                    const newParams = {...params, newValue : lengthData.progress + 1, oldValue : params.value}
                    setterFunction(newParams)
                  }}>
                    <Icon name="plus"></Icon>
                  </span>
                  <span className="ag-progress-cell-span">{`/`}</span>
                  <span className="ag-progress-cell-span">{`${lengthData.total}`}</span>
                  <span className="ag-progress-cell-span">{`eps`}</span>
                </Form>
              :
                <div className="ag-progress-cell-text-container">
                  <span className="ag-progress-cell-span">{`${lengthData.progress}`}</span>
                  <span className="ag-progress-cell-span">{`/`}</span>
                  <span className="ag-progress-cell-span">{`${lengthData.total}`}</span>
                  <span className="ag-progress-cell-span">{`eps`}</span>
                </div>
              }
            </div>
          )
        }
        else {
          return totalLength
        }
      },
      minWidth: 180,
      maxWidth: 190,
      filter: "agTextColumnFilter",
      hide: !columnParams.displayedColumns['length'],
    },


    {
      field: 'chapters',
      headerName: 'Chapters',
      cellRenderer: params => {
        const chapterData = mediaProgressParser(params, columnParams, params.value, undefined)
        const emptyCell = !(params.data.title.replace(/\W/g, '') && params.data.type.replace(/\W/g, ''))
        
        return (
          <div className="ag-progress-cell">
            {emptyCell ?
              <div className="ag-progress-cell-text-container">
              </div>
            :columnParams.currentUserId == columnParams.listOwner.id && params.data.title.replace(/\W/g, '') && params.data.type.replace(/\W/g, '') ?
              <Form
                method="GET"
                onSubmit={async (event) => {
                  event.preventDefault();

                  const newParams = {...params, newValue : event.target.chapterInput.value, oldValue : params.value}

                  setterFunction(newParams)
                }}
                className="ag-progress-cell-text-container"
              >
                <Input
                  name="chapterInput"
                  className="ag-progress-cell-input"
                  id={`${params.rowIndex}-chapter-input`}
                  autoComplete='false'
                  defaultValue={chapterData.progress  ?? ''}
                  placeholder={chapterData.progress}
                />
                <span className='ag-progress-increment-button' onClick={(event) => {
                  const newParams = {...params, newValue : chapterData.progress + 1, oldValue : params.value}
                  setterFunction(newParams)
                }}>
                  <Icon name="plus"></Icon>
                </span>
                <span className="ag-progress-cell-span">{`/`}</span>
                <span className="ag-progress-cell-span">{`${chapterData.total}`}</span>
              </Form>
            :
              <div className="ag-progress-cell-text-container">
                <span className="ag-progress-cell-span">{`${chapterData.progress}`}</span>
                <span className="ag-progress-cell-span">{`/`}</span>
                <span className="ag-progress-cell-span">{`${chapterData.total}`}</span>
              </div>
            }
          </div>
        )
      },
      minWidth: 150,
      maxWidth: 160,
      filter: "agTextColumnFilter",
      hide: !columnParams.displayedColumns['chapters'],
    },


    {
      field: 'volumes',
      headerName: 'Volumes',
      cellRenderer: params => {
        const volumeData = mediaProgressParser(params, columnParams, params.value, undefined)
        const emptyCell = !(params.data.title.replace(/\W/g, '') && params.data.type.replace(/\W/g, ''))
        
        return (
          <div className="ag-progress-cell">
            {emptyCell ?
              <div className="ag-progress-cell-text-container">
              </div>
            :
            columnParams.currentUserId == columnParams.listOwner.i && !emptyCell ?
              <Form
                method="GET"
                onSubmit={async (event) => {
                  event.preventDefault();

                  const newParams = {...params, newValue : event.target.volumeInput.value, oldValue : params.value}

                  setterFunction(newParams)
                }}
                className="ag-progress-cell-text-container"
              >
                <Input
                  name="volumeInput"
                  className="ag-progress-cell-input"
                  id={`${params.rowIndex}-volume-input`}
                  autoComplete='false'
                  defaultValue={volumeData.progress  ?? ''}
                  placeholder={volumeData.progress}
                />
                <span className='ag-progress-increment-button' onClick={(event) => {
                  const newParams = {...params, newValue : volumeData.progress + 1, oldValue : params.value}
                  setterFunction(newParams)
                }}>
                  <Icon name="plus"></Icon>
                </span>
                <span className="ag-progress-cell-span">{`/`}</span>
                <span className="ag-progress-cell-span">{`${volumeData.total}`}</span>
              </Form>
            :
              <div className="ag-progress-cell-text-container">
                <span className="ag-progress-cell-span">{`${volumeData.progress}`}</span>
                <span className="ag-progress-cell-span">{`/`}</span>
                <span className="ag-progress-cell-span">{`${volumeData.total}`}</span>
              </div>
            }
          </div>
        )
      },
      minWidth: 140,
      maxWidth: 150,
      filter: "agTextColumnFilter",
      hide: !columnParams.displayedColumns['volumes'],
    },


    {
      field: 'rating',
      headerName: 'Rating',
      valueSetter: params => {setterFunction(params)},
      minWidth: 80,
      maxWidth: 90,
      filter: "agSetColumnFilter",
      hide: !columnParams.displayedColumns['rating'],
    },


    {
      field: 'started',
      headerName: 'Start Date',
      valueGetter: (params) => {
        try {
          return JSON.parse(params.data.history).started
        }
        catch(e) {
          try {
            const parsedDate = Date.parse(params.data.history)

            reformatHistory(params, params.data.history).then(val => {
              // console.log(val);
            }).catch(e => {
              // console.log(e);
            })

            return parsedDate
          }
          catch(e) {}
        }
      },
      valueSetter: params => {setterFunction(params)},
      valueFormatter: params => dateFormatter(params.value),
      editable: columnParams.currentUserId == columnParams.listOwner.id,
      minWidth: 85,
      maxWidth: 120,
      cellDataType: 'date',
      filter: "agDateColumnFilter",
      hide: !columnParams.displayedColumns['startDate'],
    },


    {
      field: 'finished',
      headerName: 'Finished Date',
      valueGetter: (params) => {
        try {
          return JSON.parse(params.data.history).finished
        }
        catch(e) {
          try {
            const parsedDate = Date.parse(params.data.history)

            reformatHistory(params, params.data.history).then(val => {
              // console.log(val);
            }).catch(e => {
              // console.log(e);
            })

            return parsedDate
          }
          catch(e) {}
        }
      },
      valueSetter: params => {setterFunction(params)},
      valueFormatter: params => dateFormatter(params.value),
      editable: columnParams.currentUserId == columnParams.listOwner.id,
      minWidth: 85,
      maxWidth: 120,
      cellDataType: 'date',
      filter: "agDateColumnFilter",
      hide: !columnParams.displayedColumns['finishedDate'],
    },


    {
      field: 'added',
      headerName: 'Date Added',
      valueGetter: (params) => {
        try {
          return JSON.parse(params.data.history).added
        }
        catch(e) {
          try {
            const parsedDate = Date.parse(params.data.history)

            reformatHistory(params, params.data.history).then(val => {
              // console.log(val);
            }).catch(e => {
              // console.log(e);
            })

            return parsedDate
          }
          catch(e) {}
        }
      },
      valueSetter: params => {setterFunction(params)},
      valueFormatter: params => dateFormatter(params.value),
      minWidth: 85,
      maxWidth: 120,
      cellDataType: 'date',
      filter: "agDateColumnFilter",
      hide: !columnParams.displayedColumns['dateAdded'],
    },


    {
      field: 'lastUpdated',
      headerName: 'Last Updated',
      valueGetter: (params) => {
        try {
          return JSON.parse(params.data.history).lastUpdated
        }
        catch(e) {
          try {
            const parsedDate = Date.parse(params.data.history)

            reformatHistory(params, params.data.history).then(val => {
              // console.log(val);
            }).catch(e => {
              // console.log(e);
            })

            return parsedDate
          }
          catch(e) {}
        }
      },
      valueSetter: params => {setterFunction(params)},
      valueFormatter: params => timeSince(params.value),
      minWidth: 85,
      maxWidth: 120,
      cellDataType: 'date',
      filter: "agDateColumnFilter",
      hide: !columnParams.displayedColumns['lastUpdated'],
    },


    {
      field: 'genres',
      headerName: 'Genre(s)',
      valueSetter: params => {setterFunction(params)},
      resizable: false,
      minWidth: 100,
      maxWidth: 200,
      filter: "agSetColumnFilter",
      cellRenderer: params => {
        let genres = String(params.value).split(", ")
        let genreSpans = [], genreCount = 0
        
        if (genres.length > 0 && (!genres.includes("null"))) {
          for (let genre of genres) {
            let genreText = ""
  
            if (genreCount < genres.length - 1) {
              genreText = genre + ", "
            }
            else {
              genreText = genre
            }
  
            if (genreCount % 2 == 0) {
              genreSpans.push(
                <span class="ag-list-odd">
                  {genreText}
                </span>
              )
            }
            else {
              genreSpans.push(
                <span class="ag-list-even">
                  {genreText}
                </span>
              )
            }
  
            genreCount++
          }
  
          return (
            <div>
              {genreSpans}
            </div>
          )
        }
      },
      hide: !columnParams.displayedColumns['genres'],
    },


    {
      field: 'studios',
      headerName: 'Studios',
      valueSetter: params => {setterFunction(params)},
      minWidth: 65,
      maxWidth: 72,
      cellRenderer: params => hyperlinkRenderer(params.value, undefined),
      filter: "agTextColumnFilter",
      hide: !columnParams.displayedColumns['studios'],
    },


    {
      field: 'serialization',
      headerName: 'Serialization',
      valueSetter: params => {setterFunction(params)},
      minWidth: 65,
      maxWidth: 72,
      cellRenderer: params => hyperlinkRenderer(params.value, undefined),
      filter: "agTextColumnFilter",
      hide: !columnParams.displayedColumns['serialization'],
    },


    {
      field: 'authors',
      headerName: 'Authors',
      valueSetter: params => {setterFunction(params)},
      minWidth: 65,
      maxWidth: 72,
      cellRenderer: params => hyperlinkRenderer(params.value, undefined),
      filter: "agTextColumnFilter",
      hide: !columnParams.displayedColumns['authors'],
    },


    {
      field: 'language',
      headerName: 'Language',
      valueSetter: params => {setterFunction(params)},
      minWidth: 90,
      maxWidth: 135,
      filter: "agSetColumnFilter",
      cellStyle: function(params) {
        if (params.value) {
          if (params.value.includes('English')) {
            return {color: '#7196aa'};
          } else {
            return {color: '#ccedff'};
          }
        }
      },
      hide: !columnParams.displayedColumns['language'],
    },


    {
      field: 'priority',
      headerName: 'Priority',
      valueSetter: params => {setterFunction(params)},
      editable: columnParams.currentUserId == columnParams.listOwner.id,
      minWidth: 65,
      maxWidth: 72,
      filter: "agTextColumnFilter",
      hide: !columnParams.displayedColumns['priority'],
    },


    {
      field: 'story',
      headerName: 'Story',
      valueSetter: params => {setterFunction(params)},
      valueFormatter: params => {
        if (!params.value || params.value == "null" || params.value == "NULL" || params.value == 0) {
            return ""
        }
      },
      editable: columnParams.currentUserId == columnParams.listOwner.id,
      minWidth: 52,
      maxWidth: 80,
      filter: "agNumberColumnFilter",
      cellEditor: 'agNumberCellEditor',
      cellEditorParams: {
        min: 1,
        max: 10,
        precision: 1,
        step: 1,
        showStepperButtons: true
      },
      cellClass: params => {
        if (params.value && params.value != 0)
          return "ag-score-border-left-single ag-score-cell ag-score-present"
        else {
          return "ag-score-border-left-single ag-score-cell ag-score-empty"
        }
      },
      cellStyle: function(params) {
        let scoreType = "Default";
        return scoreColor( {
          range: scoreRange(),
          score: params.value,
          type: scoreType
        } )
      },
      hide: !columnParams.displayedColumns['story'],
    },


    {
      field: 'character',
      headerName: 'Character',
      valueSetter: params => {setterFunction(params)},
      valueFormatter: params => {
        if (!params.value || params.value == "null" || params.value == "NULL" || params.value == 0) {
          return ""
        }
      },
      editable: columnParams.currentUserId == columnParams.listOwner.id,
      minWidth: 52,
      maxWidth: 80,
      filter: "agNumberColumnFilter",
      cellEditor: 'agNumberCellEditor',
      cellEditorParams: {
        min: 1,
        max: 10,
        precision: 1,
        step: 1,
        showStepperButtons: true
      },
      cellClass: params => {
        if (params.value && params.value != 0)
          return "ag-score-cell ag-score-present"
        else {
          return "ag-score-cell ag-score-empty"
        }
      },
      cellStyle: function(params) {
        let scoreType = "Default";
        return scoreColor( {
          range: scoreRange(),
          score: params.value,
          type: scoreType
        } )
      },
      hide: !columnParams.displayedColumns['character'],
    },


    {
      field: 'presentation',
      headerName: 'Presentation',
      valueSetter: params => {setterFunction(params)},
      valueFormatter: params => {
        if (!params.value || params.value == "null" || params.value == "NULL" || params.value == 0) {
          return "" 
        }
      },
      editable: columnParams.currentUserId == columnParams.listOwner.id,
      minWidth: 52,
      maxWidth: 80,
      filter:
      'agNumberColumnFilter',
      cellEditor: 'agNumberCellEditor',
      cellEditorParams: {
        min: 1,
        max: 10,
        precision: 1,
        step: 1,
        showStepperButtons:
        true
      },
      cellClass: params => {
        if (params.value && params.value != 0)
          return "ag-score-cell ag-score-present"
        else {
          return "ag-score-cell ag-score-empty"
        }
      },
      cellStyle: function(params) {
        let scoreType = "Default";
        return scoreColor( {
          range: scoreRange(),
          score: params.value,
          type: scoreType
        } )
      },
      hide: !columnParams.displayedColumns['presentation'],
    },


    {
      field: 'sound',
      headerName: 'Sound',
      valueSetter: params => {setterFunction(params)},
      valueFormatter: params => {
        if (!params.value || params.value == "null" || params.value == "NULL" || params.value == 0) {
          return ""
        }
      },
      editable: columnParams.currentUserId == columnParams.listOwner.id,
      minWidth: 52,
      maxWidth: 80,
      filter: 'agNumberColumnFilter',
      cellEditor: 'agNumberCellEditor',
      cellEditorParams: {
        min: 1,
        max: 10,
        precision: 1,
        step: 1,
        showStepperButtons: true
      },
      cellClass: params => {
        if (params.value && params.value != 0)
          return "ag-score-cell ag-score-present"
        else {
          return "ag-score-cell ag-score-empty"
        }
      },
      cellStyle: function(params) {
        let scoreType = "Default";
        return scoreColor( {
          range: scoreRange(),
          score: params.value,
          type: scoreType
        } )
      },
      hide: !columnParams.displayedColumns['sound'],
    },


    {
      field: 'performance',
      headerName: 'Performance',
      valueSetter: params => {setterFunction(params)},
      valueFormatter: params => {
        if (!params.value || params.value == "null" || params.value == "NULL" || params.value == 0) {
          return ""
        }
      },
      editable: columnParams.currentUserId == columnParams.listOwner.id,
      minWidth: 52,
      maxWidth: 80,
      filter: 'agNumberColumnFilter',
      cellEditor: 'agNumberCellEditor',
      cellEditorParams: {
        min: 1,
        max: 10,
        precision: 1,
        step: 1,
        showStepperButtons: true
      },
      cellClass: params => {
        if (params.value && params.value != 0)
          return "ag-score-cell ag-score-present"
        else {
          return "ag-score-cell ag-score-empty"
        }
      },
      cellStyle: function(params) {
        let scoreType = "Default";
        return scoreColor( {
          range: scoreRange(),
          score: params.value,
          type: scoreType
        } )
      },
      hide: !columnParams.displayedColumns['performance'],
    },


    {
      field: 'enjoyment',
      headerName: 'Enjoyment',
      valueSetter: params => {setterFunction(params)},
      valueFormatter: params => {
        if (!params.value || params.value == "null" || params.value == "NULL" || params.value == 0) {
          return ""
        }
      },
      editable: columnParams.currentUserId == columnParams.listOwner.id,
      minWidth: 52,
      maxWidth: 80,
      filter: 'agNumberColumnFilter',
      cellEditor: 'agNumberCellEditor',
      cellEditorParams: {
        min: 1,
        max: 10,
        precision: 1,
        step: 1,
        showStepperButtons: true
      },
      cellClass: params => {
        if (params.value && params.value != 0)
          return "ag-score-cell ag-score-present"
        else {
          return "ag-score-cell ag-score-empty"
        }
      },
      cellStyle: function(params) {
        let scoreType = "Default";
        return scoreColor( {
          range: scoreRange(),
          score: params.value,
          type: scoreType
        } )
      },
      hide: !columnParams.displayedColumns['averaged'],
    },


    {
      field: 'averaged',
      headerName: 'Averaged',
      valueSetter: params => {setterFunction(params)},
      valueFormatter: params => {
        if (!params.value || params.value == "null" || params.value == "NULL" || params.value == 0) {
          return ""
        } else {
          return Number(params.value).toFixed(1)
        }
      },
      valueGetter: params => {
        let scoreCategories = [params.data.story, params.data.character, params.data.presentation, params.data.sound, params.data.performance, params.data.enjoyment];
        let foundScores = 0;
        let sum = 0;

        for (let category of scoreCategories) {
          if (category) {
            foundScores ++;
            sum += category;
          }
        }

        return (sum / foundScores)
      },
      minWidth: 62,
      maxWidth: 90,
      filter: 'agNumberColumnFilter',
      editable: false,
      cellClass: params => {
        if (params.value && params.value != 0)
          return "ag-score-border-left-double ag-score-cell ag-score-present"
        else {
          return "ag-score-border-left-double ag-score-cell ag-score-empty"
        }
      },
      cellStyle: function(params) {
        let scoreType = "Default";
        return scoreColor( {
          range: scoreRange(),
          score: params.value,
          type: scoreType
        } )
      },
      hide: !columnParams.displayedColumns['averaged'],
    },


    {
      field: 'personal',
      headerName: 'Personal',
      valueSetter: params => {setterFunction(params)},
      valueFormatter: params => {
        if (!params.value || params.value == "null" || params.value == "NULL" || params.value == 0) {
          return ""
        } else {
          return Number(params.value).toFixed(1)
        }
      },
      editable: columnParams.currentUserId == columnParams.listOwner.id,
      minWidth: 55,
      maxWidth: 80,
      cellDataType: 'number',
      filter: 'agNumberColumnFilter',
      cellEditor: 'agNumberCellEditor',
      cellEditorParams: {
        min: 1,
        max: 10,
        precision: 1,
        step: 0.1,
        showStepperButtons: true
      },
      cellClass: params => {
        if (params.value && params.value != 0)
          return "ag-score-cell ag-score-present"
        else {
          return "ag-score-cell ag-score-empty"
        }
      },
      cellStyle: function(params) {
        let scoreType = "Default";
        return scoreColor( {
          range: scoreRange(),
          score: params.value,
          type: scoreType
        } )
      },
      hide: !columnParams.displayedColumns['personal'],
    },


    {
      field: 'differencePersonal',
      headerName: 'Difference: Personal',
      valueSetter: params => {setterFunction(params)},
      valueGetter: params => {
        if (params.data.personal && params.data.personal != 0) {
          return (params.data.personal - ((params.data.story + params.data.character + params.data.presentation + params.data.sound + params.data.performance + params.data.enjoyment) / 6))
        } else {return ""}
      },
      valueFormatter: params => {
        if ((!params.value || params.value == "null" || params.value == "NULL" || params.value == 0) && (!params.data.personal || params.data.personal == "null" || params.data.personal == "NULL" || params.data.personal == 0)) {
          return ""
        } else {
          return differenceFormatter(params.value)
        }
      },
      minWidth: 70,
      maxWidth: 90,
      filter: 'agNumberColumnFilter',
      editable: false,
      cellClass: params => {
        if (params.value && params.value != 0)
          return "ag-score-cell ag-score-present"
        else {
          return "ag-score-cell ag-score-empty"
        }
      },
      cellStyle: function(params) {
        let scoreType = "Difference Personal";
        return  scoreColor( {
          range: scoreRange(scoreType),
          score: params.value,
          type: scoreType
        } )
      },
      hide: !columnParams.displayedColumns['differencePersonal'],
    },


    {
      field: 'tmdbScore',
      headerName: 'TMDB Score',
      valueSetter: params => {setterFunction(params)},
      valueFormatter: params => {
        if (!params.value || params.value == "null" || params.value == "NULL" || params.value == 0) {
          return ""
        } else {
          return Number(params.value).toFixed(1)
        }
      },
      minWidth: 55,
      maxWidth: 80,
      filter: 'agNumberColumnFilter',
      editable: false,
      cellClass: params => {
        if (params.value && params.value != 0)
          return "ag-score-border-left-double ag-score-cell ag-score-present"
        else {
          return "ag-score-border-left-double ag-score-cell ag-score-empty"
        }
      },
      cellStyle: function(params) {
        let scoreType = "TMDB Score";
        return  scoreColor( {
          range: scoreRange(scoreType),
          score: params.value,
          type: scoreType
        } )
      },
      hide: !columnParams.displayedColumns['tmdbScore'],
    },


    {
      field: 'malScore',
      headerName: 'MAL Score',
      valueSetter: params => {setterFunction(params)},
      valueFormatter: params => {
        if (!params.value || params.value == "null" || params.value == "NULL" || params.value == 0) {
          return ""
        } else {
          return Number(params.value).toFixed(1)
        }
      },
      minWidth: 55,
      maxWidth: 80,
      filter: 'agNumberColumnFilter',
      editable: false,
      cellClass: params => {
        if (params.value && params.value != 0)
          return "ag-score-border-left-double ag-score-cell ag-score-present"
        else {
          return "ag-score-border-left-double ag-score-cell ag-score-empty"
        }
      },
      cellStyle: function(params) {
        let scoreType = "MAL Score";
        return  scoreColor( {
          range: scoreRange(scoreType),
          score: params.value,
          type: scoreType
        } )
      },
      hide: !columnParams.displayedColumns['malScore'],
    },


    {
      field: 'differenceObjective',
      headerName: 'Difference: Objective',
      valueSetter: params => {setterFunction(params)},
      valueGetter: params => {
        if ((params.data.personal && params.data.personal != 0) && (params.data.tmdbScore && params.data.tmdbScore != 0)) {
          return (params.data.personal - params.data.tmdbScore)
        } 
        else if ((params.data.personal && params.data.personal != 0) && (params.data.malScore && params.data.malScore != 0)) {
          return (params.data.personal - params.data.malScore)
        } else {return ""}
      },
      valueFormatter: params => {
        if ((!params.value || params.value == "null" || params.value == "NULL" || params.value == 0) && (!params.data.tmdbScore || params.data.tmdbScore == "null" || params.data.tmdbScore == "NULL" || params.data.tmdbScore == 0)) {
          return ""
        } else {
          return differenceFormatter(params.value)
        }
      },
      minWidth: 70,
      maxWidth: 90,
      filter: 'agNumberColumnFilter',
      editable: false,
      cellClass: params => {
        if (params.value && params.value != 0)
          return "ag-score-cell ag-score-present"
        else {
          return "ag-score-cell ag-score-empty"
        }
      },
      cellStyle: function(params) {
        let scoreType = "Difference Objective";
        return  scoreColor( {
          range: scoreRange(scoreType),
          score: params.value,
          type: scoreType
        } )
      },
      hide: !columnParams.displayedColumns['differenceObjective'],
    },


    {
      field: 'description',
      headerName: 'Description',
      valueSetter: params => {setterFunction(params)},
      flex: 2,
      minWidth: 90,
      maxWidth: 500,
      filter: 'agTextColumnFilter',
      cellClass: "ag-description-cell",
      hide: !columnParams.displayedColumns['description'],
    },

    {
      field: 'notes',
      headerName: 'Notes',
      valueSetter: params => {setterFunction(params)},
      flex: 2,
      minWidth: 90,
      maxWidth: 500,
      filter: 'agTextColumnFilter',
      editable: true,
      cellClass: "ag-description-cell",
      cellEditorParams: { maxLength: 1000 },
      hide: !columnParams.displayedColumns['notes'],
    }
  ]
}

export function watchlistGrid(listEntriesPass, watchListData, listTypeData, watchlistId, typedWatchlists, typedFavorites, listOwner, currentUser, currentUserId, VEUD_API_KEY) {
  const [listEntries, setListEntries] = useState(listEntriesPass)
  const [selectedSearchType, setSelectedSearchType] = useState("Type")

  if (!typedFavorites[listTypeData.id]) {
    typedFavorites[listTypeData.id] = []
  }

  const [favoriteIds, setFavoriteIds] =  useState(
    typedFavorites[listTypeData.id].map(typedFavorite => {
      return getSiteID(getThumbnailInfo(typedFavorite.thumbnail).url).id
    })
  )

  const displayedArray = watchListData.displayedColumns.split(', ')
  const displayedColumns = displayedArray.reduce((key,value) => (key[value] = true, key),{});

  const emptyRow = createEmptyRow(watchlistId, listEntries.length + 1, listTypeData)
  
  if (currentUserId == listOwner.id &&
  listEntries.slice(-1)[0] &&
  ((listEntries.slice(-1)[0].title && listEntries.slice(-1)[0].title.replace(/\W/g, '') !== "") && (listEntries.slice(-1)[0].type && listEntries.slice(-1)[0].type.replace(/\W/g, '') !== "")) ||
  listEntries.length < 1) {
    listEntries.push(emptyRow)
  }

  useEffect(() => {
  	setListEntries(listEntriesPass)
  }, [listEntriesPass])

  useEffect(() => {
  	setSelectedSearchType(selectedSearchType)
  }, [selectedSearchType])

  useEffect(() => {
  	setFavoriteIds(favoriteIds)
  }, [favoriteIds])
  
  columnParams = {listEntries, setListEntries, selectedSearchType, setSelectedSearchType, favoriteIds, setFavoriteIds, watchListData, listTypeData, watchlistId, typedWatchlists, typedFavorites, listOwner, currentUser, currentUserId, displayedColumns, emptyRow, VEUD_API_KEY}

  return (
    <div className='ag-theme-custom-react'>
        <AgGridReact
          gridOptions={gridOptions}
          columnDefs={columnDefs()}
          rowData={listEntries}
          rowDragText={rowDragText}
        ></AgGridReact>
    </div>
  )
}
