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
} from '#app/components/ui/dropdown-menu.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { dateFormatter, episodeProgressParser, timeSince, differenceFormatter, hyperlinkRenderer, titleCellRenderer, TypeCellRenderer } from "#app/utils/lists/column-functions.jsx"
import { scoreColor, scoreRange } from "#app/utils/lists/score-colorer.tsx"
import '@ag-grid-community/styles/ag-grid.css'
import "#app/styles/watchlist.scss"
import { ClientSideRowModelModule } from '@ag-grid-community/client-side-row-model'
import { ModuleRegistry } from '@ag-grid-community/core'

ModuleRegistry.registerModules([ ClientSideRowModelModule ]);
let gridAPI

export const gridOptions = {
  autoSizeStrategy: {
    type: 'fitCellContents',
    defaultMinWidth: 70
  },
  defaultColDef: {
    editable: true,
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
}

function createEmptyRow(watchlistId, position, listTypeData) {
  let emptyRow = {}

  for (const [key, value] of Object.entries(JSON.parse(listTypeData.columns))) {
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
      emptyRow[key] = JSON.stringify({
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
  const listEntriesResponse = await fetch('../../fetch/get-list-entries/' + encodeURIComponent(new URLSearchParams({
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

export async function reformatHistory(params, columnParams, newValue) {
  const updateCellResponse = await fetch('../../fetch/update-cell/' + encodeURIComponent(new URLSearchParams({
    listTypeData: JSON.stringify(columnParams.listTypeData),
    colId: params.column.colId,
    type: "history",
    filter: "agDateColumnFilter",
    rowIndex: params.node.data.id,
    newValue: newValue,
  })))
  const updateCellData = await updateCellResponse.json();
  return updateCellData
}

function rowDragEnd(params) {
  const rowNode = gridAPI.getRowNode(params.node.id)
  rowNode.setDataValue("position", params.overIndex + 1)
}

const rowDragText = function (params) {
  return (params.rowNode.data.title + " (" + params.rowNode.rowIndex + ")")
};

async function createNewRow(location, params, columnParams) {
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

  const emptyRow = createEmptyRow(params.data.watchlistId, listEntries.length + 1, columnParams.listTypeData)

  gridAPI.applyTransaction({add: [emptyRow], addIndex: insertPosition})
  
  const addResponse = await fetch('../../fetch/add-row/' + encodeURIComponent(new URLSearchParams({
    listTypeData: JSON.stringify(columnParams.listTypeData),
    row: JSON.stringify(emptyRow)
  })))

  const updateResponse = await fetch('../../fetch/now-updated/' + encodeURIComponent(new URLSearchParams({
    watchlistId: params.data.watchlistId
  })))

  updatePositions(params, columnParams)
}

async function updatePositions(params, columnParams) {
  gridAPI.forEachNode(async (rowNode, index) => {
    if (rowNode.data.position != (index + 1)) {
      rowNode.data[params.column.colId] = index + 1
    }

    const updateCellResponse = await fetch('../../fetch/update-cell/' + encodeURIComponent(new URLSearchParams({
      listTypeData: JSON.stringify(columnParams.listTypeData),
      colId: params.column.colId,
      type: params.colDef.cellDataType,
      filter: params.colDef.filter,
      rowIndex: rowNode.data.id,
      newValue: index + 1,
    })))
  });

  const updateResponse = await fetch('../../fetch/now-updated/' + encodeURIComponent(new URLSearchParams({
    watchlistId: params.data.watchlistId
  })))

  refreshGrid(columnParams)
}

async function setterFunction(params, columnParams) {
  // console.log(params)
  let returnValue = true

  if (params.column.colId == "position") {
    updatePositions(params, columnParams)
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
            const lengthData = episodeProgressParser(params, params.oldValue, params.newValue)
            params.newValue = `${lengthData.progress} / ${lengthData.total} eps`
          }
        }
      }
    }

    params.data[params.column.colId] = params.newValue

    const updateCellResponse = await fetch('../../fetch/update-cell/' + encodeURIComponent(new URLSearchParams({
      listTypeData: JSON.stringify(columnParams.listTypeData),
      colId: params.column.colId,
      type: cellType,
      filter: params.colDef.filter,
      rowIndex: params.data.id,
      newValue: params.newValue,
    })))
    const updateCellData = await updateCellResponse.json();

    const updateResponse = await fetch('../../fetch/now-updated/' + encodeURIComponent(new URLSearchParams({
      watchlistId: params.data.watchlistId
    })))

    console.log("value: " + params.oldValue + " has changed to " + params.newValue)

    if (params.column.colId.toLowerCase() == ("length")) {
      refreshGrid(columnParams)
    }
  }
  else {
    console.log("value unchanged")
    returnValue = false;
  }

  return returnValue
}

export function columnDefs(columnParams) {
  return [
    {
      field: 'position',
      headerName: '#',
      valueSetter: params => {setterFunction(params, columnParams)},
      flex: 1,
      editable: false,
      resizable: false,
      minWidth: 35,
      maxWidth: 35,
      filter: 'agNumberColumnFilter',
      rowDrag: true,
      cellRenderer: params => {
        return (
          <div>
            {params.value}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <span className='ag-cell-insert'>
                  <Icon name="plus"></Icon>
                </span>
              </DropdownMenuTrigger>
              <DropdownMenuPortal>
                <DropdownMenuContent sideOffset={8} align="start">
                <DropdownMenuItem onSelect={event => {
                    createNewRow("Above", params, columnParams)
                  }}>
                    Insert 1 row above
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={event => {
                    createNewRow("Below", params, columnParams)
                  }}>
                    Insert 1 row below
                  </DropdownMenuItem>
                  {/* <DropdownMenuItem onSelect={event => {
                    createNewRow()
                  }}>
                    Move row
                  </DropdownMenuItem> */}
                  <DropdownMenuItem onSelect={async event => {
                    const deleteResponse = await fetch('../../fetch/delete-row/' + encodeURIComponent(new URLSearchParams({
                      listTypeData: JSON.stringify(columnParams.listTypeData),
                      id: params.data.id,
                      watchlistId: params.data.watchlistId,
                      position: params.data.position,
                      change: 1
                    })))

                    const updateResponse = await fetch('../../fetch/now-updated/' + encodeURIComponent(new URLSearchParams({
                      watchlistId: params.data.watchlistId
                    })))

                    refreshGrid(columnParams)
                  }}>
                    Delete row
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenuPortal>
            </DropdownMenu>
          </div>
        )
      },
      cellClass: "ag-position-cell",
      hide: !columnParams.displayedColumns['position'],
    },


    {
      field: 'thumbnail',
      headerName: 'Thumbnail',
      valueSetter: params => {setterFunction(params, columnParams)},
      flex: 1,
      sortable: false,
      resizable: false,
      minWidth: 80,
      maxWidth: 120,
      cellRenderer: params => hyperlinkRenderer(params.value, "thumbnail"),
      cellClass: "ag-thumbnail-cell",
      hide: !columnParams.displayedColumns['thumbnail'],
    },


    {
      field: 'title',
      headerName: 'Title',
      valueSetter: params => {setterFunction(params, columnParams)},
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
      valueSetter: params => {setterFunction(params, columnParams)},
      flex: 1,
      resizable: false,
      minWidth: 70,
      maxWidth: 125,
      cellRenderer: params => TypeCellRenderer(params.value),
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
      valueSetter: params => {setterFunction(params, columnParams)},
      flex: 1,
      resizable: false,
      minWidth: 65,
      maxWidth: 72,
      filter: 'agDateColumnFilter',
      hide: !columnParams.displayedColumns['airYear'],
    },


    {
      field: 'startSeason',
      headerName: 'Start Season',
      valueSetter: params => {setterFunction(params, columnParams)},
      flex: 1,
      resizable: false,
      minWidth: 65,
      maxWidth: 72,
      filter: "agTextColumnFilter",
      hide: !columnParams.displayedColumns['startSeason'],
    },


    {
      field: 'startYear',
      headerName: 'Start Year',
      valueSetter: params => {setterFunction(params, columnParams)},
      flex: 1,
      resizable: false,
      minWidth: 65,
      maxWidth: 72,
      filter: "agTextColumnFilter",
      hide: !columnParams.displayedColumns['startYear'],
    },


    {
      field: 'length',
      headerName: 'Length',
      editable: false,
      cellRenderer: params => {
        const totalLength = params.value
        
        if (!params.value || params.value == "null" || params.value == "NULL" || params.value == 0) {
          return ""
        }
        else if (params.value.includes("eps")) {
          const lengthData = episodeProgressParser(params, params.value, undefined)

          return (
            <div className="ag-length-cell">
              <Form
                method="GET"
                onSubmit={async (event) => {
                  event.preventDefault();

                  const newParams = {...params, newValue : event.target.lengthInput.value, oldValue : params.value}

                  setterFunction(newParams, columnParams)
                }}
                className="ag-length-cell-text-container"
              >
                <Input
                  name="lengthInput"
                  className="ag-length-cell-input"
                  id={`${params.rowIndex}-length-input`}
                  autoComplete='false'
                  defaultValue={lengthData.progress  ?? ''}
                  placeholder={lengthData.progress}
                />
                <span className='ag-length-increment-button' onClick={(event) => {
                  const newParams = {...params, newValue : lengthData.progress + 1, oldValue : params.value}
                  setterFunction(newParams, columnParams)
                }}>
                  <Icon name="plus"></Icon>
                </span>
                <span className="ag-length-cell-span">{`/`}</span>
                <span className="ag-length-cell-span">{`${lengthData.total}`}</span>
                <span className="ag-length-cell-span">{`eps`}</span>
              </Form>
            </div>
          )
        }
        else {
          return totalLength
        }
      },
      flex: 1,
      resizable: false,
      minWidth: 180,
      maxWidth: 190,
      filter: "agTextColumnFilter",
      hide: !columnParams.displayedColumns['length'],
    },


    {
      field: 'chapters',
      headerName: 'Chapters',
      valueSetter: params => {setterFunction(params, columnParams)},
      flex: 1,
      resizable: false,
      minWidth: 65,
      maxWidth: 72,
      filter: "agTextColumnFilter",
      hide: !columnParams.displayedColumns['chapters'],
    },


    {
      field: 'volumes',
      headerName: 'Volumes',
      valueSetter: params => {setterFunction(params, columnParams)},
      flex: 1,
      resizable: false,
      minWidth: 65,
      maxWidth: 72,
      filter: "agTextColumnFilter",
      hide: !columnParams.displayedColumns['volumes'],
    },


    {
      field: 'rating',
      headerName: 'Rating',
      valueSetter: params => {setterFunction(params, columnParams)},
      flex: 1,
      resizable: false,
      minWidth: 80,
      maxWidth: 90,
      filter: "agSetColumnFilter",
      editable: true,
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

            reformatHistory(params, columnParams, params.data.history).then(val => {
              // console.log(val);
            }).catch(e => {
              // console.log(e);
            })

            return parsedDate
          }
          catch(e) {}
        }
      },
      valueSetter: params => {setterFunction(params, columnParams)},
      valueFormatter: params => dateFormatter(params.value),
      flex: 1,
      resizable: false,
      minWidth: 85,
      maxWidth: 120,
      cellDataType: 'date',
      editable: true,
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

            reformatHistory(params, columnParams, params.data.history).then(val => {
              // console.log(val);
            }).catch(e => {
              // console.log(e);
            })

            return parsedDate
          }
          catch(e) {}
        }
      },
      valueSetter: params => {setterFunction(params, columnParams)},
      valueFormatter: params => dateFormatter(params.value),
      flex: 1,
      resizable: false,
      minWidth: 85,
      maxWidth: 120,
      cellDataType: 'date',
      editable: true,
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

            reformatHistory(params, columnParams, params.data.history).then(val => {
              // console.log(val);
            }).catch(e => {
              // console.log(e);
            })

            return parsedDate
          }
          catch(e) {}
        }
      },
      valueSetter: params => {setterFunction(params, columnParams)},
      valueFormatter: params => dateFormatter(params.value),
      flex: 1,
      resizable: false,
      minWidth: 85,
      maxWidth: 120,
      cellDataType: 'date',
      editable: true,
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

            reformatHistory(params, columnParams, params.data.history).then(val => {
              // console.log(val);
            }).catch(e => {
              // console.log(e);
            })

            return parsedDate
          }
          catch(e) {}
        }
      },
      valueSetter: params => {setterFunction(params, columnParams)},
      valueFormatter: params => timeSince(params.value),
      flex: 1,
      resizable: false,
      minWidth: 85,
      maxWidth: 120,
      cellDataType: 'date',
      editable: true,
      hide: !columnParams.displayedColumns['lastUpdated'],
    },


    {
      field: 'genres',
      headerName: 'Genre(s)',
      valueSetter: params => {setterFunction(params, columnParams)},
      flex: 1,
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
      valueSetter: params => {setterFunction(params, columnParams)},
      flex: 1,
      resizable: false,
      minWidth: 65,
      maxWidth: 72,
      cellRenderer: params => hyperlinkRenderer(params.value, undefined),
      filter: "agTextColumnFilter",
      hide: !columnParams.displayedColumns['studios'],
    },


    {
      field: 'serialization',
      headerName: 'Serialization',
      valueSetter: params => {setterFunction(params, columnParams)},
      flex: 1,
      resizable: false,
      minWidth: 65,
      maxWidth: 72,
      cellRenderer: params => hyperlinkRenderer(params.value, undefined),
      filter: "agTextColumnFilter",
      hide: !columnParams.displayedColumns['serialization'],
    },


    {
      field: 'authors',
      headerName: 'Authors',
      valueSetter: params => {setterFunction(params, columnParams)},
      flex: 1,
      resizable: false,
      minWidth: 65,
      maxWidth: 72,
      cellRenderer: params => hyperlinkRenderer(params.value, undefined),
      filter: "agTextColumnFilter",
      hide: !columnParams.displayedColumns['authors'],
    },


    {
      field: 'language',
      headerName: 'Language',
      valueSetter: params => {setterFunction(params, columnParams)},
      flex: 1,
      resizable: false,
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
      valueSetter: params => {setterFunction(params, columnParams)},
      flex: 1,
      resizable: false,
      minWidth: 65,
      maxWidth: 72,
      filter: "agTextColumnFilter",
      hide: !columnParams.displayedColumns['priority'],
    },


    {
      field: 'story',
      headerName: 'Story',
      valueSetter: params => {setterFunction(params, columnParams)},
      valueFormatter: params => {
        if (!params.value || params.value == "null" || params.value == "NULL" || params.value == 0) {
            return ""
        }
      },
      flex: 1,
      resizable: false,
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
      valueSetter: params => {setterFunction(params, columnParams)},
      valueFormatter: params => {
        if (!params.value || params.value == "null" || params.value == "NULL" || params.value == 0) {
          return ""
        }
      },
      flex: 1,
      resizable: false,
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
      valueSetter: params => {setterFunction(params, columnParams)},
      valueFormatter: params => {
        if (!params.value || params.value == "null" || params.value == "NULL" || params.value == 0) {
          return "" 
        }
      },
      flex: 1,
      resizable:
      false, minWidth: 52,
      maxWidth: 80, filter:
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
      valueSetter: params => {setterFunction(params, columnParams)},
      valueFormatter: params => {
        if (!params.value || params.value == "null" || params.value == "NULL" || params.value == 0) {
          return ""
        }
      },
      flex: 1,
      resizable: false,
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
      valueSetter: params => {setterFunction(params, columnParams)},
      valueFormatter: params => {
        if (!params.value || params.value == "null" || params.value == "NULL" || params.value == 0) {
          return ""
        }
      },
      flex: 1,
      resizable: false,
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
      valueSetter: params => {setterFunction(params, columnParams)},
      valueFormatter: params => {
        if (!params.value || params.value == "null" || params.value == "NULL" || params.value == 0) {
          return ""
        }
      },
      flex: 1,
      resizable: false,
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
      valueSetter: params => {setterFunction(params, columnParams)},
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
      flex: 1,
      resizable: false,
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
      valueSetter: params => {setterFunction(params, columnParams)},
      valueFormatter: params => {
        if (!params.value || params.value == "null" || params.value == "NULL" || params.value == 0) {
          return ""
        } else {
          return Number(params.value).toFixed(1)
        }
      },
      flex: 1,
      resizable: false,
      minWidth: 55,
      maxWidth: 80,
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
      valueSetter: params => {setterFunction(params, columnParams)},
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
      flex: 1,
      resizable: false,
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
      valueSetter: params => {setterFunction(params, columnParams)},
      valueFormatter: params => {
        if (!params.value || params.value == "null" || params.value == "NULL" || params.value == 0) {
          return ""
        } else {
          return Number(params.value).toFixed(1)
        }
      },
      flex: 1,
      resizable: false,
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
      valueSetter: params => {setterFunction(params, columnParams)},
      valueFormatter: params => {
        if (!params.value || params.value == "null" || params.value == "NULL" || params.value == 0) {
          return ""
        } else {
          return Number(params.value).toFixed(1)
        }
      },
      flex: 1,
      resizable: false,
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
      valueSetter: params => {setterFunction(params, columnParams)},
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
      flex: 1,
      resizable: false,
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
      valueSetter: params => {setterFunction(params, columnParams)},
      flex: 2,
      resizable: false,
      minWidth: 90,
      maxWidth: 500,
      filter: 'agTextColumnFilter',
      cellClass: "ag-description-cell",
      hide: !columnParams.displayedColumns['description'],
    },

    {
      field: 'notes',
      headerName: 'Notes',
      valueSetter: params => {setterFunction(params, columnParams)},
      flex: 2,
      resizable: false,
      minWidth: 90,
      maxWidth: 500,
      filter: 'agTextColumnFilter',
      cellClass: "ag-description-cell",
      hide: !columnParams.displayedColumns['notes'],
    }
  ]
}

export function watchlistGrid(listEntriesPass, watchListData, listTypeData, watchlistId) {
  const [listEntries, setListEntries] = useState(listEntriesPass)

  const displayedArray = watchListData.displayedColumns.split(', ')
  const displayedColumns = displayedArray.reduce((key,value) => (key[value] = true, key),{});

  const emptyRow = createEmptyRow(watchlistId, listEntries.length + 1, listTypeData)
  
  if (listEntries.slice(-1)[0] &&
  ((listEntries.slice(-1)[0].title && listEntries.slice(-1)[0].title.replace(/\W/g, '') !== "") && (listEntries.slice(-1)[0].type && listEntries.slice(-1)[0].type.replace(/\W/g, '') !== "")) ||
  listEntries.length < 1) {
    listEntries.push(emptyRow)
  }

  useEffect(() => {
  	setListEntries(listEntriesPass)
  }, [listEntriesPass]);
  
  const columnParams = {listEntries, setListEntries, watchListData, listTypeData, watchlistId, displayedColumns, emptyRow}

  return (
    <div style={{ width: '100%', height: '90%' }} className='ag-theme-custom-react'>
        <AgGridReact
          gridOptions={gridOptions}
          columnDefs={columnDefs(columnParams)}
          rowData={listEntries}
          rowDragText={rowDragText}
        ></AgGridReact>
    </div>
  )
}
