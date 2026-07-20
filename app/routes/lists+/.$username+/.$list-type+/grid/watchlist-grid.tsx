// The watchlistGrid component — renders the AG Grid for a watchlist (Phase 3.2, increment 4).
// Extracted from $watchlist_grid.jsx. Registers the AG Grid row-model module and loads the grid
// CSS here (this is the module that actually renders <AgGridReact>). Writes the shared
// columnParams via setColumnParams on each render; reads flow to the column defs / action helpers
// through grid-state's live bindings.
import { AgGridReact } from '@ag-grid-community/react'
import { useState, useEffect } from 'react'
import { ClientSideRowModelModule } from '@ag-grid-community/client-side-row-model'
<<<<<<< HEAD
import { ModuleRegistry } from '@ag-grid-community/core'
=======
import {
  ModuleRegistry,
  type ColDef,
  type GridOptions,
} from '@ag-grid-community/core'
>>>>>>> develop
import '@ag-grid-community/styles/ag-grid.css'
import "#app/styles/watchlist.scss"
import { getSiteIdSafe, getThumbnailInfo } from '#app/utils/lists/column-functions.tsx'
import { setColumnParams } from './grid-state.ts'
import { createEmptyRow, rowDragText } from './grid-actions.ts'
import { gridOptions } from './grid-options.ts'
import { columnDefs } from './columns.tsx'

ModuleRegistry.registerModules([ ClientSideRowModelModule ]);

export function watchlistGrid(listEntriesPass: any, watchListData: any, listTypeData: any, watchlistId: any, typedWatchlists: any, typedFavorites: any, listOwner: any, currentUser: any, currentUserId: any, VEUD_API_KEY: any) {
  const [listEntries, setListEntries] = useState(listEntriesPass)
  const [selectedSearchType, setSelectedSearchType] = useState("Type")

  if (!typedFavorites[listTypeData.id]) {
    typedFavorites[listTypeData.id] = []
  }

  const [favoriteIds, setFavoriteIds] =  useState(
    typedFavorites[listTypeData.id].map((typedFavorite: any) => {
      return getSiteIdSafe(getThumbnailInfo(typedFavorite.thumbnail).url)?.id
    })
  )

  const displayedArray = watchListData.displayedColumns.split(', ')
  const displayedColumns = displayedArray.reduce((key: any, value: any) => (key[value] = true, key),{});

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
  
  setColumnParams({listEntries, setListEntries, selectedSearchType, setSelectedSearchType, favoriteIds, setFavoriteIds, watchListData, listTypeData, watchlistId, typedWatchlists, typedFavorites, listOwner, currentUser, currentUserId, displayedColumns, emptyRow, VEUD_API_KEY})

  return (
    <div className='ag-theme-custom-react'>
        <AgGridReact
<<<<<<< HEAD
          gridOptions={gridOptions}
          columnDefs={columnDefs()}
          rowData={listEntries}
=======
          gridOptions={gridOptions as GridOptions}
          columnDefs={columnDefs() as ColDef[]}
          rowData={listEntries}
          getRowId={(params: any) => params.data.id ?? '__new_entry__'}
>>>>>>> develop
          rowDragText={rowDragText}
        ></AgGridReact>
    </div>
  )
}
