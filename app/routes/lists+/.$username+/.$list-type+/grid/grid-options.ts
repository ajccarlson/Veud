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

export const gridOptions = {
	autoSizeStrategy: {
		type: 'fitGridWidth',
		defaultMinWidth: 80,
	},
	headerHeight: 44,
	suppressMenuHide: true,
	icons: {
		filter: filterIcon,
		menu: filterIcon,
		menuAlt: filterIcon,
	},
	defaultColDef: {
		editable: false,
		resizable: true,
		flex: 1,
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
