// The watchlistGrid component — renders the AG Grid for a watchlist (Phase 3.2, increment 4).
// Extracted from $watchlist_grid.jsx. Registers the AG Grid row-model module and loads the grid
// CSS here (this is the module that actually renders <AgGridReact>). Writes the shared
// columnParams via setColumnParams on each render; reads flow to the column defs / action helpers
// through grid-state's live bindings.
import { AgGridReact } from '@ag-grid-community/react'
import { useEffect, useRef, useState } from 'react'
import { ClientSideRowModelModule } from '@ag-grid-community/client-side-row-model'
import {
	ModuleRegistry,
	type ColDef,
	type GridApi,
	type GridOptions,
} from '@ag-grid-community/core'
import '@ag-grid-community/styles/ag-grid.css'
import '#app/styles/watchlist-grid.scss'
import { type WatchlistRow, type WatchlistViewProps } from './grid-state.ts'
import {
	refreshGrid,
	registerListDropZones,
	rowDragText,
} from './grid-actions.ts'
import { gridOptions } from './grid-options.ts'
import { columnDefs } from './columns.tsx'
import { useWatchlistState } from './use-watchlist-state.ts'
import { mutateList } from '#app/utils/lists/mutation-client.ts'

ModuleRegistry.registerModules([ClientSideRowModelModule])

export function getWatchlistRowId(params: { data: WatchlistRow }) {
	const row = params.data
	return row.id ?? `__new_entry__:${row.watchlistId}:${row.position}`
}

export function WatchlistGrid(props: WatchlistViewProps) {
	const { columnParams, defaultSort, defaultSortModel, listEntries } =
		useWatchlistState(props)
	const [selectedRows, setSelectedRows] = useState<WatchlistRow[]>([])
	const [bulkDestination, setBulkDestination] = useState('')
	const [bulkBusy, setBulkBusy] = useState(false)
	const [bulkError, setBulkError] = useState<string | null>(null)
	const gridApiRef = useRef<GridApi<WatchlistRow> | null>(null)
	const isOwner = props.currentUserId === props.listOwner.id
	const destinations = (
		props.typedWatchlists[props.listTypeData.id] ?? []
	).filter(watchlist => watchlist.id !== props.watchlistId)

	useEffect(() => {
		const frame = requestAnimationFrame(registerListDropZones)
		return () => cancelAnimationFrame(frame)
	}, [props.watchlistId, props.typedWatchlists])

	useEffect(() => {
		setSelectedRows([])
		setBulkDestination('')
		setBulkError(null)
		gridApiRef.current = null
	}, [props.watchlistId])

	function clearSelection() {
		gridApiRef.current?.deselectAll()
		setSelectedRows([])
		setBulkDestination('')
	}

	async function runBulkMove() {
		const entryIds = selectedRows
			.map(entry => entry.id)
			.filter((id): id is string => Boolean(id))
		if (!entryIds.length || !bulkDestination || bulkBusy) return
		setBulkBusy(true)
		setBulkError(null)
		try {
			await mutateList('bulk-move-entries', {
				entryIds,
				destinationWatchlistId: bulkDestination,
			})
			clearSelection()
			await refreshGrid(columnParams)
		} catch (error) {
			setBulkError(
				error instanceof Error ? error.message : 'Unable to move these titles.',
			)
		} finally {
			setBulkBusy(false)
		}
	}

	async function runBulkDelete() {
		const entryIds = selectedRows
			.map(entry => entry.id)
			.filter((id): id is string => Boolean(id))
		if (
			!entryIds.length ||
			bulkBusy ||
			!window.confirm(
				`Delete ${entryIds.length} selected ${entryIds.length === 1 ? 'entry' : 'entries'}? This cannot be undone.`,
			)
		) {
			return
		}
		setBulkBusy(true)
		setBulkError(null)
		try {
			await mutateList('bulk-delete-entries', { entryIds })
			clearSelection()
			await refreshGrid(columnParams)
		} catch (error) {
			setBulkError(
				error instanceof Error
					? error.message
					: 'Unable to delete these titles.',
			)
		} finally {
			setBulkBusy(false)
		}
	}

	return (
		<div className="watchlist-grid-shell">
			{isOwner && selectedRows.length ? (
				<div
					className="watchlist-bulk-toolbar"
					role="toolbar"
					aria-label="Selected list entries"
				>
					<strong>
						{selectedRows.length}{' '}
						{selectedRows.length === 1 ? 'title' : 'titles'} selected
					</strong>
					{destinations.length ? (
						<>
							<select
								value={bulkDestination}
								onChange={event =>
									setBulkDestination(event.currentTarget.value)
								}
								aria-label="Bulk move destination"
							>
								<option value="" disabled>
									Choose destination
								</option>
								{destinations.map(watchlist => (
									<option key={watchlist.id} value={watchlist.id}>
										{watchlist.header}
									</option>
								))}
							</select>
							<button
								type="button"
								disabled={!bulkDestination || bulkBusy}
								onClick={runBulkMove}
							>
								{bulkBusy ? 'Working…' : 'Move selected'}
							</button>
						</>
					) : null}
					<button
						type="button"
						className="watchlist-bulk-delete"
						disabled={bulkBusy}
						onClick={runBulkDelete}
					>
						{bulkBusy ? 'Working…' : 'Delete selected'}
					</button>
					<button type="button" disabled={bulkBusy} onClick={clearSelection}>
						Clear
					</button>
					{bulkError ? (
						<p className="watchlist-bulk-error" role="alert">
							{bulkError}
						</p>
					) : null}
				</div>
			) : null}
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
					onSelectionChanged={event => {
						gridApiRef.current = event.api
						setSelectedRows(event.api.getSelectedRows())
					}}
				></AgGridReact>
			</div>
		</div>
	)
}
