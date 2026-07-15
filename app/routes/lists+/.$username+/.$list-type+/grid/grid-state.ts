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

export let gridAPI: any
export let columnParams: any

export function setGridAPI(api: any) {
  gridAPI = api
}

export function setColumnParams(params: any) {
  columnParams = params
}
