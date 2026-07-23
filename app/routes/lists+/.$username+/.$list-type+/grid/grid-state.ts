// Shared mutable state for the watchlist grid.
//
// Historically these two values were module-level `let` bindings inside
// $watchlist_grid.jsx:
//   - `gridAPI`       the ag-grid API handle, assigned once the grid is ready
//   - `columnParams`  the bag of loader data + React state setters that the grid
//                     component hands to every column definition and to the
//                     row/cell action helpers; reassigned on each render of
//                     watchlistGrid()
// Every column def and helper *reads* them; only two sites *write* them
// (gridReady -> gridAPI, watchlistGrid -> columnParams).
//
// As those functions move into separate modules (Phase 3.2), the write sites can no
// longer mutate a plain imported binding, since ES-module imports are read-only in the
// consuming module. So the two writers go through setGridAPI/setColumnParams defined
// here (a same-module reassignment, which is allowed), while every reader imports the
// live `gridAPI`/`columnParams` bindings directly and observes updates through ES
// live-binding semantics. This preserves the original single-grid-per-page contract
// exactly — no behavioral change, just a relocation of where the state lives.
//
// (Note: `gridAPI` here is this app's own shared handle to ag-grid's API object; it is
// unrelated to ag-grid's built-in grid *state* feature.)

import type { GridApi } from '@ag-grid-community/core'
import type { Dispatch, SetStateAction } from 'react'

export type WatchlistRow = Record<string, unknown> & {
	id?: string
	watchlistId: string
	position: number
	title?: string | null
	type?: string | null
	thumbnail?: string | null
}

export type WatchlistSummary = {
	id: string
	typeId: string
	name: string
	header: string
	position: number
	displayedColumns?: string | null
	defaultSortColumn?: string | null
	defaultSortDirection?: string | null
}

export type ListTypeSummary = {
	id: string
	name: string
	header: string
	columns: string
	mediaType: string
}

export type FavoriteSummary = {
	id: string
	typeId: string
	thumbnail: string | null
}

export type GridUser = {
	id: string
	username: string
}

export type TrackingSummary = {
	mediaId: string
	watchlistId: string | null
	statusLabel: string | null
}

export type WatchlistColumnParams = {
	listEntries: WatchlistRow[]
	setListEntries: Dispatch<SetStateAction<WatchlistRow[]>>
	selectedSearchType: string
	setSelectedSearchType: Dispatch<SetStateAction<string>>
	favoriteIds: Array<string | undefined>
	setFavoriteIds: Dispatch<SetStateAction<Array<string | undefined>>>
	watchListData: WatchlistSummary
	listTypeData: ListTypeSummary
	watchlistId: string
	typedWatchlists: Record<string, WatchlistSummary[]>
	typedFavorites: Record<string, FavoriteSummary[]>
	trackingByIdentity: Record<string, TrackingSummary>
	listOwner: GridUser
	currentUser: GridUser | null | undefined
	currentUserId: string | null
	displayedColumns: Record<string, boolean>
	navigate: (path: string) => void
}

export let gridAPI: GridApi<WatchlistRow>
export let columnParams: WatchlistColumnParams

export function setGridAPI(api: GridApi<WatchlistRow>) {
	gridAPI = api
}

export function setColumnParams(params: WatchlistColumnParams) {
	columnParams = params
}
