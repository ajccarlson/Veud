// ag-grid options for the watchlist grid, extracted from $watchlist_grid.jsx
// (Phase 3.2, increment 2). References the gridReady / rowDragEnd handlers now in
// grid-actions.
import {
	gridReady,
	rowDragCancel,
	rowDragEnd,
	rowDragEnter,
	rowDragLeave,
	rowDragMove,
} from './grid-actions.ts'

const filterIcon = `
  <svg class="veud-grid-filter-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M4 5h16l-6.25 7.15v5.35l-3.5 1.75v-7.1L4 5Z" />
  </svg>
`

const rowDragIcon = `
  <svg class="veud-grid-drag-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <circle cx="8" cy="6" r="1.5" />
    <circle cx="16" cy="6" r="1.5" />
    <circle cx="8" cy="12" r="1.5" />
    <circle cx="16" cy="12" r="1.5" />
    <circle cx="8" cy="18" r="1.5" />
    <circle cx="16" cy="18" r="1.5" />
  </svg>
`

export const gridOptions = {
	headerHeight: 44,
	suppressMenuHide: true,
	icons: {
		filter: filterIcon,
		menu: filterIcon,
		menuAlt: filterIcon,
		rowDrag: rowDragIcon,
	},
	defaultColDef: {
		editable: false,
		sortable: true,
		resizable: true,
		suppressMovable: true,
		wrapHeaderText: false,
		autoHeaderHeight: false,
		cellStyle: { wordBreak: 'normal' },
		wrapText: true,
		autoHeight: true,
	},
	rowDragManaged: true,
	rowDragMultiRow: true,
	resetRowDataOnUpdate: true,
	onRowDragEnter: rowDragEnter,
	onRowDragMove: rowDragMove,
	onRowDragLeave: rowDragLeave,
	onRowDragEnd: rowDragEnd,
	onRowDragCancel: rowDragCancel,
	rowSelection: 'multiple',
	onGridReady: gridReady,
}
