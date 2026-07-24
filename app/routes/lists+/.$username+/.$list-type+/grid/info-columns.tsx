// Basic info columns for the watchlist grid (thumbnail / title / type / airYear /
// startSeason / startYear / releaseStart / releaseEnd), extracted from
// $watchlist_grid.jsx's columnDefs() (Phase 3.2, increment 3). Returned in source order.
import { columnParams } from './grid-state.ts'
import { setterFunction } from './grid-actions.ts'
import {
	dateFormatter,
	hyperlinkRenderer,
	titleCellRenderer,
	typeCellRenderer,
} from '#app/utils/lists/column-functions.tsx'

export function infoColumns() {
	return [
		{
			field: 'thumbnail',
			headerName: 'Thumbnail',
			valueSetter: (params: any) => {
				setterFunction(params)
			},
			sortable: false,
			minWidth: 96,
			maxWidth: 128,
			cellRenderer: (params: any) =>
				hyperlinkRenderer(params.value, 'thumbnail', params.data.mediaId),
			cellClass: 'ag-thumbnail-cell',
			hide: !columnParams.displayedColumns['thumbnail'],
		},

		{
			field: 'title',
			headerName: 'Title',
			valueSetter: (params: any) => {
				setterFunction(params)
			},
			flex: 2,
			resizable: false,
			minWidth: 140,
			cellRenderer: (params: any) => titleCellRenderer(params, columnParams),
			filter: 'agTextColumnFilter',
			cellClass: 'ag-title-cell',
			hide: !columnParams.displayedColumns['title'],
		},

		{
			field: 'type',
			headerName: 'Type',
			valueSetter: (params: any) => {
				setterFunction(params)
			},
			minWidth: 70,
			maxWidth: 125,
			cellRenderer: (params: any) => typeCellRenderer(params, columnParams),
			filter: 'agTextColumnFilter',
			cellStyle: function (params: any) {
				if (params.value) {
					if (params.value.includes('Movie')) {
						return { color: '#408063' }
					} else if (params.value.includes('TV Series*')) {
						return { color: '#A2FFD5' }
					} else {
						return { color: '#dbffcc' }
					}
				}
			},
			hide: !columnParams.displayedColumns['type'],
		},

		{
			field: 'airYear',
			headerName: 'Air Year',
			valueSetter: (params: any) => {
				setterFunction(params)
			},
			minWidth: 65,
			maxWidth: 72,
			filter: 'agDateColumnFilter',
			hide: !columnParams.displayedColumns['airYear'],
		},

		{
			field: 'startSeason',
			headerName: 'Start Season',
			valueSetter: (params: any) => {
				setterFunction(params)
			},
			minWidth: 65,
			maxWidth: 72,
			filter: 'agTextColumnFilter',
			hide: !columnParams.displayedColumns['startSeason'],
		},

		{
			field: 'startYear',
			headerName: 'Start Year',
			valueSetter: (params: any) => {
				setterFunction(params)
			},
			minWidth: 65,
			maxWidth: 72,
			filter: 'agTextColumnFilter',
			hide: !columnParams.displayedColumns['startYear'],
		},

		{
			field: 'releaseStart',
			headerName: 'Release Start',
			valueSetter: (params: any) => {
				setterFunction(params)
			},
			valueFormatter: (params: any) => dateFormatter(params.value),
			minWidth: 65,
			maxWidth: 72,
			filter: 'agDateColumnFilter',
			hide: !columnParams.displayedColumns['releaseStart'],
		},

		{
			field: 'releaseEnd',
			headerName: 'Release End',
			valueSetter: (params: any) => {
				setterFunction(params)
			},
			valueFormatter: (params: any) => dateFormatter(params.value),
			minWidth: 65,
			maxWidth: 72,
			filter: 'agDateColumnFilter',
			hide: !columnParams.displayedColumns['releaseEnd'],
		},
	]
}
