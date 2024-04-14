import { AgGridReact } from '@ag-grid-community/react'
import { useState } from 'react'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuPortal,
	DropdownMenuTrigger,
} from '#app/components/ui/dropdown-menu.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { dateFormatter, differenceFormatter, listThumbnailRenderer, titleCellRenderer, TypeCellRenderer } from "#app/utils/lists/column-functions.tsx"
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

export async function refreshGrid(refreshColumns, columnParams) {
  const listEntriesResponse = await fetch('../../fetch/get-list-entries/' + new URLSearchParams({
    listName: columnParams.watchListData.name,
    listType: columnParams.listType
  }))
  const listEntriesData = await listEntriesResponse.json();

  if (refreshColumns && (refreshColumns.length > 0)) {
    gridAPI.setGridOption('rowData', listEntriesData)
    gridAPI.refreshCells({columns: refreshColumns, force: true })
  }
  else {
    gridAPI.setGridOption('rowData', listEntriesData)
    gridAPI.refreshCells({ force: true })
  }

  let emptyRow = columnParams.emptyRow
  if (!emptyRow && columnParams.watchlistId) {
    if (columnParams.listType == 'LiveActionEntry') {
      emptyRow = {watchlistId: columnParams.watchlistId, position: listEntriesData.length + 1, thumbnail: null, title: " ", type: null, airYear: null, length: null, rating: null, finishedDate: new Date(0), genres: null , language: null, story: 0, character: 0, presentation: 0, sound: 0, performance: 0, enjoyment: 0, averaged: 0, personal: 0, differencePersonal: 0, tmdbScore: 0, differenceObjective: 0, description: null}
    }
    else if (columnParams.listType == 'AnimeEntry') {
      emptyRow = {watchlistId: columnParams.watchlistId, position: listEntriesData.length + 1, thumbnail: null, title: " ", type: null, startSeason: null, length: null, rating: null, startDate: new Date(0), finishedDate: new Date(0), genres: null , studio: null, demographics: null, priority: null, story: 0, character: 0, presentation: 0, sound: 0, performance: 0, enjoyment: 0, averaged: 0, personal: 0, differencePersonal: 0, malScore: 0, differenceObjective: 0, description: null}
    }
    else if (columnParams.listType == 'MangaEntry') {
      emptyRow = {watchlistId: columnParams.watchlistId, position: listEntriesData.length + 1, thumbnail: null, title: " ", type: null, startYear: null, chapters: null, volumes: null, rating: null, startDate: new Date(0), finishedDate: new Date(0), genres: null , magazine: null, demographics: null, author: null, priority: null, story: 0, character: 0, presentation: 0, sound: 0, performance: 0, enjoyment: 0, averaged: 0, personal: 0, differencePersonal: 0, malScore: 0, differenceObjective: 0, description: null}
    }
  }
  
  if (listEntriesData.slice(-1)[0] &&
  ((listEntriesData.slice(-1)[0].title && listEntriesData.slice(-1)[0].title.replace(/\W/g, '') !== "") && (listEntriesData.slice(-1)[0].type && listEntriesData.slice(-1)[0].type.replace(/\W/g, '') !== ""))) {
    listEntriesData.push(emptyRow)

    if (refreshColumns && (refreshColumns.length > 0)) {
      gridAPI.setGridOption('rowData', listEntriesData)
      gridAPI.refreshCells({columns: refreshColumns, force: true })
    }
    else {
      gridAPI.setGridOption('rowData', listEntriesData)
      gridAPI.refreshCells({ force: true })
    }
  }
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

  let emptyRow = {watchlistId: params.data.watchlistId, position: insertPosition + 1, thumbnail: null, title: " ", type: null, airYear: null, length: null, rating: null, finishedDate: new Date(0), genres: null , language: null, story: 0, character: 0, presentation: 0, sound: 0, performance: 0, enjoyment: 0, averaged: 0, personal: 0, differencePersonal: 0, tmdbScore: 0, differenceObjective: 0, description: null}

  gridAPI.applyTransaction({add: [emptyRow], addIndex: insertPosition})
  
  const addResponse = await fetch('../../fetch/add-row/' + new URLSearchParams({
    listType: columnParams.listType,
    row: JSON.stringify(emptyRow)
  }))

  const updateResponse = await fetch('../../fetch/now-updated/' + new URLSearchParams({
    watchlistId: params.data.watchlistId
  }))

  updatePositions(params, columnParams)
}

async function updatePositions(params, columnParams) {
  gridAPI.forEachNode(async (rowNode, index) => {
    if (rowNode.data.position != (index + 1)) {
      rowNode.data[params.column.colId] = index + 1
    }

    const updateCellResponse = await fetch('../../fetch/update-cell/' + new URLSearchParams({
      listType: columnParams.listType,
      colId: params.column.colId,
      type: params.colDef.cellDataType,
      filter: params.colDef.filter,
      rowIndex: rowNode.data.id,
      newValue: index + 1,
    }))
  });

  const updateResponse = await fetch('../../fetch/now-updated/' + new URLSearchParams({
    watchlistId: params.data.watchlistId
  }))

  refreshGrid(["position"], columnParams)
}

async function setterFunction(params, columnParams) {
  let returnValue = true

  if (params.column.colId == "position") {
    updatePositions(params, columnParams)
  }
  else if (params.data != params.newValue) {
    params.data[params.column.colId] = params.newValue

    const updateCellResponse = await fetch('../../fetch/update-cell/' + new URLSearchParams({
      listType: columnParams.listType,
      colId: params.column.colId,
      type: params.colDef.cellDataType,
      filter: params.colDef.filter,
      rowIndex: params.data.id,
      newValue: params.newValue,
    }))

    const updateResponse = await fetch('../../fetch/now-updated/' + new URLSearchParams({
      watchlistId: params.data.watchlistId
    }))

    console.log("value: " + params.oldValue + " has changed to " + params.newValue)
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
      sort: "asc",
      headerName: '#',
      valueSetter: params => {setterFunction(params, columnParams.watchListData.name, columnParams.listType)},
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
                    const deleteResponse = await fetch('../../fetch/delete-row/' + new URLSearchParams({
                      listType: columnParams.listType,
                      id: params.data.id,
                      watchlistId: params.data.watchlistId,
                      position: params.data.position,
                      change: 1
                    }))

                    const updateResponse = await fetch('../../fetch/now-updated/' + new URLSearchParams({
                      watchlistId: params.data.watchlistId
                    }))

                    refreshGrid(undefined, columnParams)
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
      valueSetter: params => {setterFunction(params, columnParams.watchListData.name, columnParams.listType)},
      flex: 1,
      sortable: false,
      resizable: false,
      minWidth: 80,
      maxWidth: 120,
      cellRenderer: params => listThumbnailRenderer(params.value),
      cellClass: "ag-thumbnail-cell",
      hide: !columnParams.displayedColumns['thumbnail'],
    },


    {
      field: 'title',
      headerName: 'Title',
      valueSetter: params => {setterFunction(params, columnParams.watchListData.name, columnParams.listType)},
      flex: 2,
      resizable: false,
      minWidth: 90,
      maxWidth: 200,
      cellRenderer: params => titleCellRenderer(params, columnParams.watchListData.name, columnParams.listType),
      filter: 'agTextColumnFilter',
      cellClass: "ag-title-cell",
      hide: !columnParams.displayedColumns['title'],
    },


    {
      field: 'type',
      headerName: 'Type',
      valueSetter: params => {setterFunction(params, columnParams.watchListData.name, columnParams.listType)},
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
      valueSetter: params => {setterFunction(params, columnParams.watchListData.name, columnParams.listType)},
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
      valueSetter: params => {setterFunction(params, columnParams.watchListData.name, columnParams.listType)},
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
      valueSetter: params => {setterFunction(params, columnParams.watchListData.name, columnParams.listType)},
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
      valueSetter: params => {setterFunction(params, columnParams.watchListData.name, columnParams.listType)},
      valueFormatter: params => {
        if (!params.value || params.value == "null" || params.value == "NULL" || params.value == 0) {
            return ""
        }
      },
      flex: 1,
      resizable: false,
      minWidth: 85,
      maxWidth: 110,
      filter: "agTextColumnFilter",
      hide: !columnParams.displayedColumns['length'],
    },


    {
      field: 'chapters',
      headerName: 'Chapters',
      valueSetter: params => {setterFunction(params, columnParams.watchListData.name, columnParams.listType)},
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
      valueSetter: params => {setterFunction(params, columnParams.watchListData.name, columnParams.listType)},
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
      valueSetter: params => {setterFunction(params, columnParams.watchListData.name, columnParams.listType)},
      flex: 1,
      resizable: false,
      minWidth: 80,
      maxWidth: 90,
      filter: "agSetColumnFilter",
      editable: true,
      hide: !columnParams.displayedColumns['rating'],
    },


    {
      field: 'startDate',
      headerName: 'Start Date',
      valueSetter: params => {setterFunction(params, columnParams.watchListData.name, columnParams.listType)},
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
      field: 'finishedDate',
      headerName: 'Finished Date',
      valueSetter: params => {setterFunction(params, columnParams.watchListData.name, columnParams.listType)},
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
      field: 'genres',
      headerName: 'Genre(s)',
      valueSetter: params => {setterFunction(params, columnParams.watchListData.name, columnParams.listType)},
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
                <span class="ag-genre-odd">
                  {genreText}
                </span>
              )
            }
            else {
              genreSpans.push(
                <span class="ag-genre-even">
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
      field: 'studio',
      headerName: 'Studio',
      valueSetter: params => {setterFunction(params, columnParams.watchListData.name, columnParams.listType)},
      flex: 1,
      resizable: false,
      minWidth: 65,
      maxWidth: 72,
      filter: "agTextColumnFilter",
      hide: !columnParams.displayedColumns['studio'],
    },


    {
      field: 'magazine',
      headerName: 'Magazine',
      valueSetter: params => {setterFunction(params, columnParams.watchListData.name, columnParams.listType)},
      flex: 1,
      resizable: false,
      minWidth: 65,
      maxWidth: 72,
      filter: "agTextColumnFilter",
      hide: !columnParams.displayedColumns['magazine'],
    },


    {
      field: 'demographics',
      headerName: 'Demographics',
      valueSetter: params => {setterFunction(params, columnParams.watchListData.name, columnParams.listType)},
      flex: 1,
      resizable: false,
      minWidth: 65,
      maxWidth: 72,
      filter: "agTextColumnFilter",
      hide: !columnParams.displayedColumns['demographics'],
    },


    {
      field: 'author',
      headerName: 'Author',
      valueSetter: params => {setterFunction(params, columnParams.watchListData.name, columnParams.listType)},
      flex: 1,
      resizable: false,
      minWidth: 65,
      maxWidth: 72,
      filter: "agTextColumnFilter",
      hide: !columnParams.displayedColumns['author'],
    },


    {
      field: 'language',
      headerName: 'Language',
      valueSetter: params => {setterFunction(params, columnParams.watchListData.name, columnParams.listType)},
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
      valueSetter: params => {setterFunction(params, columnParams.watchListData.name, columnParams.listType)},
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
      valueSetter: params => {setterFunction(params, columnParams.watchListData.name, columnParams.listType)},
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
      valueSetter: params => {setterFunction(params, columnParams.watchListData.name, columnParams.listType)},
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
      valueSetter: params => {setterFunction(params, columnParams.watchListData.name, columnParams.listType)},
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
      valueSetter: params => {setterFunction(params, columnParams.watchListData.name, columnParams.listType)},
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
      valueSetter: params => {setterFunction(params, columnParams.watchListData.name, columnParams.listType)},
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
      valueSetter: params => {setterFunction(params, columnParams.watchListData.name, columnParams.listType)},
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
      valueSetter: params => {setterFunction(params, columnParams.watchListData.name, columnParams.listType)},
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
      valueSetter: params => {setterFunction(params, columnParams.watchListData.name, columnParams.listType)},
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
      valueSetter: params => {setterFunction(params, columnParams.watchListData.name, columnParams.listType)},
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
      valueSetter: params => {setterFunction(params, columnParams.watchListData.name, columnParams.listType)},
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
      valueSetter: params => {setterFunction(params, columnParams.watchListData.name, columnParams.listType)},
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
      valueSetter: params => {setterFunction(params, columnParams.watchListData.name, columnParams.listType)},
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
      valueSetter: params => {setterFunction(params, columnParams.watchListData.name, columnParams.listType)},
      flex: 2,
      resizable: false,
      minWidth: 90,
      maxWidth: 500,
      filter: 'agTextColumnFilter',
      cellClass: "ag-description-cell",
      hide: !columnParams.displayedColumns['description'],
    }
  ]
}

export function watchlistGrid(listEntries, watchListData, listType, watchlistId) {
  const displayedArray = watchListData.displayedColumns.split(', ')
  const displayedColumns = displayedArray.reduce((key,value) => (key[value] = true, key),{});

  let emptyRow
  if (listType == 'LiveActionEntry') {
    emptyRow = {watchlistId: watchlistId, position: listEntries.length + 1, thumbnail: null, title: " ", type: null, airYear: null, length: null, rating: null, finishedDate: new Date(0), genres: null , language: null, story: 0, character: 0, presentation: 0, sound: 0, performance: 0, enjoyment: 0, averaged: 0, personal: 0, differencePersonal: 0, tmdbScore: 0, differenceObjective: 0, description: null}
  }
  else if (listType == 'AnimeEntry') {
    emptyRow = {watchlistId: watchlistId, position: listEntries.length + 1, thumbnail: null, title: " ", type: null, startSeason: null, length: null, rating: null, startDate: new Date(0), finishedDate: new Date(0), genres: null , studio: null, demographics: null, priority: null, story: 0, character: 0, presentation: 0, sound: 0, performance: 0, enjoyment: 0, averaged: 0, personal: 0, differencePersonal: 0, malScore: 0, differenceObjective: 0, description: null}
  }
  else if (listType == 'MangaEntry') {
    emptyRow = {watchlistId: watchlistId, position: listEntries.length + 1, thumbnail: null, title: " ", type: null, startYear: null, chapters: null, volumes: null, rating: null, startDate: new Date(0), finishedDate: new Date(0), genres: null , magazine: null, demographics: null, author: null, priority: null, story: 0, character: 0, presentation: 0, sound: 0, performance: 0, enjoyment: 0, averaged: 0, personal: 0, differencePersonal: 0, malScore: 0, differenceObjective: 0, description: null}
  }
  
  if (listEntries.slice(-1)[0] &&
  ((listEntries.slice(-1)[0].title && listEntries.slice(-1)[0].title.replace(/\W/g, '') !== "") && (listEntries.slice(-1)[0].type && listEntries.slice(-1)[0].type.replace(/\W/g, '') !== ""))) {
    listEntries.push(emptyRow)
  }

  const columnParams = {listEntries, watchListData, listType, watchlistId, displayedColumns, emptyRow}

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
