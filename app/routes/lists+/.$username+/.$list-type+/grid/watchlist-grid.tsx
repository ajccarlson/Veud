// The watchlistGrid component — renders the AG Grid for a watchlist (Phase 3.2, increment 4).
// Extracted from $watchlist_grid.jsx. Registers the AG Grid row-model module and loads the grid
// CSS here (this is the module that actually renders <AgGridReact>). Writes the shared
// columnParams via setColumnParams on each render; reads flow to the column defs / action helpers
// through grid-state's live bindings.
import { AgGridReact } from '@ag-grid-community/react'
import { useEffect } from 'react'
import { ClientSideRowModelModule } from '@ag-grid-community/client-side-row-model'
import {
	ModuleRegistry,
	type ColDef,
	type GridOptions,
} from '@ag-grid-community/core'
import '@ag-grid-community/styles/ag-grid.css'
import '#app/styles/watchlist-grid.scss'
import { type WatchlistRow, type WatchlistViewProps } from './grid-state.ts'
import { registerListDropZones, rowDragText } from './grid-actions.ts'
import { gridOptions } from './grid-options.ts'
import { columnDefs } from './columns.tsx'
import { useWatchlistState } from './use-watchlist-state.ts'

ModuleRegistry.registerModules([ClientSideRowModelModule])

export function getWatchlistRowId(params: { data: WatchlistRow }) {
	const row = params.data
	return row.id ?? `__new_entry__:${row.watchlistId}:${row.position}`
}

export function WatchlistGrid(props: WatchlistViewProps) {
	const { defaultSort, defaultSortModel, listEntries } =
		useWatchlistState(props)
	useEffect(() => {
		const frame = requestAnimationFrame(registerListDropZones)
		return () => cancelAnimationFrame(frame)
	}, [props.watchlistId, props.typedWatchlists])

	return (
		<div className="watchlist-grid-shell">
			<div className="ag-theme-custom-react">
				<AgGridReact
					key={`${props.watchlistId}:${defaultSort?.colId ?? 'manual'}:${defaultSort?.sort ?? 'none'}`}
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
