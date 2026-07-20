// The watchlistGrid component — renders the AG Grid for a watchlist (Phase 3.2, increment 4).
// Extracted from $watchlist_grid.jsx. Registers the AG Grid row-model module and loads the grid
// CSS here (this is the module that actually renders <AgGridReact>). Writes the shared
// columnParams via setColumnParams on each render; reads flow to the column defs / action helpers
// through grid-state's live bindings.
import { AgGridReact } from '@ag-grid-community/react'
import { useState, useEffect } from 'react'
import { ClientSideRowModelModule } from '@ag-grid-community/client-side-row-model'
import {
	ModuleRegistry,
	type ColDef,
	type GridOptions,
} from '@ag-grid-community/core'
import '@ag-grid-community/styles/ag-grid.css'
import '#app/styles/watchlist.scss'
import {
	getSiteIdSafe,
	getThumbnailInfo,
} from '#app/utils/lists/column-functions.tsx'
import { setColumnParams } from './grid-state.ts'
import { createEmptyRow, rowDragText } from './grid-actions.ts'
import { gridOptions } from './grid-options.ts'
import { columnDefs } from './columns.tsx'

ModuleRegistry.registerModules([ClientSideRowModelModule])

export function getWatchlistRowId(params: any) {
	const row = params.data
	return row.id ?? `__new_entry__:${row.watchlistId}:${row.position}`
}

function withQuickAddRow(
	entries: any[],
	watchlistId: string,
	listTypeData: any,
	canEdit: boolean,
) {
	const rows = [...entries]
	const lastEntry = rows.at(-1)
	const lastEntryIsComplete =
		lastEntry?.title?.replace(/\W/g, '') && lastEntry?.type?.replace(/\W/g, '')
	if (canEdit && (!lastEntry || lastEntryIsComplete)) {
		rows.push(createEmptyRow(watchlistId, rows.length + 1, listTypeData))
	}
	return rows
}

export function watchlistGrid(
	listEntriesPass: any,
	watchListData: any,
	listTypeData: any,
	watchlistId: any,
	typedWatchlists: any,
	typedFavorites: any,
	listOwner: any,
	currentUser: any,
	currentUserId: any,
	VEUD_API_KEY: any,
) {
	const canEdit = currentUserId === listOwner.id
	const [listEntries, setListEntries] = useState(() =>
		withQuickAddRow(listEntriesPass, watchlistId, listTypeData, canEdit),
	)
	const [selectedSearchType, setSelectedSearchType] = useState('Type')

	if (!typedFavorites[listTypeData.id]) {
		typedFavorites[listTypeData.id] = []
	}

	const [favoriteIds, setFavoriteIds] = useState(
		typedFavorites[listTypeData.id].map((typedFavorite: any) => {
			return getSiteIdSafe(getThumbnailInfo(typedFavorite.thumbnail).url)?.id
		}),
	)

	const displayedArray = watchListData.displayedColumns.split(', ')
	const displayedColumns = displayedArray.reduce(
		(key: any, value: any) => ((key[value] = true), key),
		{},
	)

	const persistedEntryCount = listEntries.filter(
		(entry: any) => entry.id,
	).length
	const emptyRow = createEmptyRow(
		watchlistId,
		persistedEntryCount + 1,
		listTypeData,
	)

	useEffect(() => {
		setListEntries(
			withQuickAddRow(listEntriesPass, watchlistId, listTypeData, canEdit),
		)
	}, [listEntriesPass, watchlistId, listTypeData, canEdit])

	setColumnParams({
		listEntries,
		setListEntries,
		selectedSearchType,
		setSelectedSearchType,
		favoriteIds,
		setFavoriteIds,
		watchListData,
		listTypeData,
		watchlistId,
		typedWatchlists,
		typedFavorites,
		listOwner,
		currentUser,
		currentUserId,
		displayedColumns,
		emptyRow,
		VEUD_API_KEY,
	})

	return (
		<div className="ag-theme-custom-react">
			<AgGridReact
				gridOptions={gridOptions as GridOptions}
				columnDefs={columnDefs() as ColDef[]}
				rowData={listEntries}
				getRowId={getWatchlistRowId}
				rowDragText={rowDragText}
			></AgGridReact>
		</div>
	)
}
