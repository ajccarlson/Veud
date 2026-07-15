// Free-text columns for the watchlist grid (description / notes), extracted from
// $watchlist_grid.jsx's columnDefs() (Phase 3.2, increment 3). These were the LAST two
// elements of the original array (notes had no trailing comma); here they're normal array
// elements. Returned in original source order.
import { columnParams } from './grid-state.ts'
import { setterFunction } from './grid-actions.ts'

export function textColumns() {
  return [
    {
      field: 'description',
      headerName: 'Description',
      valueSetter: (params: any) => {setterFunction(params)},
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
      valueSetter: (params: any) => {setterFunction(params)},
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
