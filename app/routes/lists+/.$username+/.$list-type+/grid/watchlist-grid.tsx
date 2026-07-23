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
import {
	getSortableWatchlistColumns,
	getWatchlistDefaultSortModel,
} from '#app/utils/lists/default-sort.ts'
import {
	setColumnParams,
	type FavoriteSummary,
	type GridUser,
	type ListTypeSummary,
	type TrackingSummary,
	type WatchlistRow,
	type WatchlistSummary,
} from './grid-state.ts'
import { registerListDropZones, rowDragText } from './grid-actions.ts'
import { gridOptions } from './grid-options.ts'
import { columnDefs } from './columns.tsx'
import { MobileWatchlistCards } from './mobile-watchlist-cards.tsx'

ModuleRegistry.registerModules([ClientSideRowModelModule])

export function getWatchlistRowId(params: { data: WatchlistRow }) {
	const row = params.data
	return row.id ?? `__new_entry__:${row.watchlistId}:${row.position}`
}

export function watchlistGrid(
	listEntriesPass: WatchlistRow[],
	watchListData: WatchlistSummary,
	listTypeData: ListTypeSummary,
	watchlistId: string,
	typedWatchlists: Record<string, WatchlistSummary[]>,
	typedFavorites: Record<string, FavoriteSummary[]>,
	trackingByIdentity: Record<string, TrackingSummary>,
	listOwner: GridUser,
	currentUser: GridUser | null | undefined,
	currentUserId: string | null,
	navigate: (path: string) => void,
) {
	const [listEntries, setListEntries] = useState<WatchlistRow[]>(() => [
		...listEntriesPass,
	])
	const [selectedSearchType, setSelectedSearchType] = useState('Type')

	if (!typedFavorites[listTypeData.id]) {
		typedFavorites[listTypeData.id] = []
	}

	const [favoriteIds, setFavoriteIds] = useState(
		typedFavorites[listTypeData.id].map(typedFavorite => {
			return getSiteIdSafe(getThumbnailInfo(typedFavorite.thumbnail).url)?.id
		}),
	)

	const displayedArray = (watchListData.displayedColumns ?? '').split(', ')
	const displayedColumns = displayedArray.reduce<Record<string, boolean>>(
		(key, value) => {
			key[value] = true
			return key
		},
		{},
	)
	const sortableColumns = getSortableWatchlistColumns(listTypeData.columns)
	const defaultSortModel = getWatchlistDefaultSortModel(
		watchListData,
		sortableColumns,
	)
	const defaultSort = defaultSortModel[0]

	useEffect(() => {
		setListEntries([...listEntriesPass])
	}, [listEntriesPass])

	useEffect(() => {
		const frame = requestAnimationFrame(registerListDropZones)
		return () => cancelAnimationFrame(frame)
	}, [watchlistId, typedWatchlists])

	const currentColumnParams = {
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
		trackingByIdentity,
		listOwner,
		currentUser,
		currentUserId,
		displayedColumns,
		navigate,
	}
	setColumnParams(currentColumnParams)

	return (
		<div className="watchlist-grid-shell">
			<MobileWatchlistCards
				entries={listEntries}
				columnParams={currentColumnParams}
				sortableColumns={sortableColumns}
				defaultSort={defaultSort}
			/>
			<div className="ag-theme-custom-react">
				<AgGridReact
					key={`${watchlistId}:${defaultSort?.colId ?? 'manual'}:${defaultSort?.sort ?? 'none'}`}
					gridOptions={gridOptions as GridOptions<WatchlistRow>}
					columnDefs={columnDefs() as ColDef<WatchlistRow>[]}
					rowData={listEntries}
					initialState={
						defaultSort
							? {
									sort: { sortModel: defaultSortModel },
									partialColumnState: true,
								}
							: undefined
					}
					getRowId={getWatchlistRowId}
					rowDragText={rowDragText}
				></AgGridReact>
			</div>
		</div>
	)
}
