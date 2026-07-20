// ag-grid options for the watchlist grid, extracted from $watchlist_grid.jsx
// (Phase 3.2, increment 2). References the gridReady / rowDragEnd handlers now in
// grid-actions.
import { gridReady, rowDragEnd } from './grid-actions.ts'

export const gridOptions = {
  autoSizeStrategy: {
    type: 'fitCellContents',
    defaultMinWidth: 70
  },
  defaultColDef: {
    editable: false,
    resizable: false,
    flex: 1,
    suppressMovable: true,
    wrapHeaderText: true,
    autoHeaderHeight: true,
    cellStyle: {"wordBreak": "normal"},
    wrapText: true,
    autoHeight: true,
  },
  rowDragManaged: true,
  rowDragMultiRow: true,
  resetRowDataOnUpdate: true,
  onRowDragEnd: rowDragEnd,
  rowSelection: 'multiple',
  onGridReady: gridReady,
}
