// Metadata columns for the watchlist grid (genres / studios / serialization / authors /
// language / priority), extracted from $watchlist_grid.jsx's columnDefs() (Phase 3.2,
// increment 3). Returned in original source order.
import { columnParams } from './grid-state.ts'
import { setterFunction } from './grid-actions.ts'
import { hyperlinkRenderer } from '#app/utils/lists/column-functions.tsx'

export function metaColumns() {
	return [
		{
			field: 'genres',
			headerName: 'Genre(s)',
			valueSetter: (params: any) => {
				setterFunction(params)
			},
			resizable: false,
			minWidth: 100,
			maxWidth: 200,
			filter: 'agTextColumnFilter',
			cellRenderer: (params: any) => {
				let genres: string[] = String(params.value).split(', ')
				let genreSpans: any[] = [],
					genreCount = 0

				if (genres.length > 0 && !genres.includes('null')) {
					for (let genre of genres) {
						let genreText = ''

						if (genreCount < genres.length - 1) {
							genreText = genre + ', '
						} else {
							genreText = genre
						}

						if (genreCount % 2 == 0) {
							genreSpans.push(<span className="ag-list-odd">{genreText}</span>)
						} else {
							genreSpans.push(<span className="ag-list-even">{genreText}</span>)
						}

						genreCount++
					}

					return <div>{genreSpans}</div>
				}
			},
			hide: !columnParams.displayedColumns['genres'],
		},

		{
			field: 'studios',
			headerName: 'Studios',
			valueSetter: (params: any) => {
				setterFunction(params)
			},
			minWidth: 65,
			maxWidth: 72,
			cellRenderer: (params: any) => hyperlinkRenderer(params.value, undefined),
			filter: 'agTextColumnFilter',
			hide: !columnParams.displayedColumns['studios'],
		},

		{
			field: 'serialization',
			headerName: 'Serialization',
			valueSetter: (params: any) => {
				setterFunction(params)
			},
			minWidth: 65,
			maxWidth: 72,
			cellRenderer: (params: any) => hyperlinkRenderer(params.value, undefined),
			filter: 'agTextColumnFilter',
			hide: !columnParams.displayedColumns['serialization'],
		},

		{
			field: 'authors',
			headerName: 'Authors',
			valueSetter: (params: any) => {
				setterFunction(params)
			},
			minWidth: 65,
			maxWidth: 72,
			cellRenderer: (params: any) => hyperlinkRenderer(params.value, undefined),
			filter: 'agTextColumnFilter',
			hide: !columnParams.displayedColumns['authors'],
		},

		{
			field: 'language',
			headerName: 'Language',
			valueSetter: (params: any) => {
				setterFunction(params)
			},
			minWidth: 90,
			maxWidth: 135,
			filter: 'agTextColumnFilter',
			cellStyle: function (params: any) {
				if (params.value) {
					if (params.value.includes('English')) {
						return { color: '#7196aa' }
					} else {
						return { color: '#ccedff' }
					}
				}
			},
			hide: !columnParams.displayedColumns['language'],
		},

		{
			field: 'priority',
			headerName: 'Priority',
			valueSetter: (params: any) => {
				setterFunction(params)
			},
			editable: columnParams.currentUserId == columnParams.listOwner.id,
			minWidth: 65,
			maxWidth: 72,
			filter: 'agTextColumnFilter',
			hide: !columnParams.displayedColumns['priority'],
		},
	]
}
