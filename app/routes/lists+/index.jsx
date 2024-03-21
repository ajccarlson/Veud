import { ClientSideRowModelModule } from '@ag-grid-community/client-side-row-model'
import { ModuleRegistry } from '@ag-grid-community/core'
import { AgGridReact } from '@ag-grid-community/react'
import listThumbnailRenderer from "#app/utils/list-thumbnail-renderer.tsx";
import { scoreColor, scoreRange } from "#app/utils/list-score-colorer.tsx";
import watchlistStyleSheetUrl from '#app/styles/watchlist.scss?url'
import { useFetcher } from '@remix-run/react'
import '@ag-grid-community/styles/ag-grid.css';
import '@ag-grid-community/styles/ag-theme-alpine.css';
import { useCallback, useEffect, useState } from 'react'

    
ModuleRegistry.registerModules([ ClientSideRowModelModule ]);

const gridOptions = {
  autoSizeStrategy: {
    type: 'fitCellContents',
    defaultMinWidth: 70
  },
  defaultColDef: {
    editable: true,
    suppressMovable: true,
    wrapHeaderText: true,
    autoHeaderHeight: true,
    cellStyle: {"wordBreak": "normal"},
    wrapText: true,
    autoHeight: true
  },
  rowDragManaged: true,
  rowDragMultiRow: true,
  rowSelection: 'multiple'
}

const columnDefs = [
  { field: '#', flex: 1, minWidth: 70, maxWidth: 75, rowDrag: true },
  { field: 'Thumbnail', flex: 1, minWidth: 80, maxWidth: 200, cellRenderer: listThumbnailRenderer },
  { field: 'Title', flex: 2, minWidth: 90 },
  { field: 'Type', flex: 1, minWidth: 70, maxWidth: 80, cellStyle: function(params) {
    if (params.value.includes('Movie')) {
      return {color: '#408063'};
    } 
    else if (params.value.includes('TV Series*')) {
      return {color: '#ffdccc'};
    } else {
      return {color: '#dbffcc'};
    }
  } },
  { field: 'Air_Year', headerName: 'Air Year', flex: 1, minWidth: 65, maxWidth: 72 },
  { field: 'Length', flex: 1, minWidth: 85, maxWidth: 110 },
  { field: 'Rating', flex: 1, minWidth: 80, maxWidth: 90, editable: true },
  { field: 'Finished_Date', headerName: 'Finished Date', flex: 1,  minWidth: 85,maxWidth: 120, cellEditor: 'agDateCellEditor', editable: true },
  { field: 'Genre(s)', flex: 1, minWidth: 100 },
  { field: 'Language', flex: 1, minWidth: 90, maxWidth: 115, cellStyle: function(params) {
    if (params.value.includes('English')) {
      return {color: '#7196aa'};
    } else {
      return {color: '#ccedff'};
    }
  } },
  { field: 'Story', flex: 1, minWidth: 52, maxWidth: 80, cellEditor: 'agNumberCellEditor', cellEditorParams: { min: 1, max: 10, precision: 1, step: 1, showStepperButtons: true }, cellStyle: function(params) { let scoreType = "Default"; return scoreColor( { range: scoreRange(), score: params.value, type: scoreType } ) } },
  { field: 'Character', flex: 1, minWidth: 52, maxWidth: 80, cellEditor: 'agNumberCellEditor', cellEditorParams: { min: 1, max: 10, precision: 1, step: 1, showStepperButtons: true }, cellStyle: function(params) { let scoreType = "Default"; return scoreColor( { range: scoreRange(), score: params.value, type: scoreType } ) } },
  { field: 'Presentation', flex: 1, minWidth: 52, maxWidth: 80, cellEditor: 'agNumberCellEditor', cellEditorParams: { min: 1, max: 10, precision: 1, step: 1, showStepperButtons: true }, cellStyle: function(params) { let scoreType = "Default"; return scoreColor( { range: scoreRange(), score: params.value, type: scoreType } ) } },
  { field: 'Sound', flex: 1, minWidth: 52, maxWidth: 80, cellEditor: 'agNumberCellEditor', cellEditorParams: { min: 1, max: 10, precision: 1, step: 1, showStepperButtons: true }, cellStyle: function(params) { let scoreType = "Default"; return scoreColor( { range: scoreRange(), score: params.value, type: scoreType } ) } },
  { field: 'Performance', flex: 1, minWidth: 52, maxWidth: 80, cellEditor: 'agNumberCellEditor', cellEditorParams: { min: 1, max: 10, precision: 1, step: 1, showStepperButtons: true }, cellStyle: function(params) { let scoreType = "Default"; return scoreColor( { range: scoreRange(), score: params.value, type: scoreType } ) } },
  { field: 'Enjoyment', flex: 1, minWidth: 52, maxWidth: 80, cellEditor: 'agNumberCellEditor', cellEditorParams: { min: 1, max: 10, precision: 1, step: 1, showStepperButtons: true }, cellStyle: function(params) { let scoreType = "Default"; return scoreColor( { range: scoreRange(), score: params.value, type: scoreType } ) } },
  { field: 'Averaged', flex: 1, minWidth: 62, maxWidth: 90, editable: false, cellStyle: function(params) { let scoreType = "Default"; return scoreColor( { range: scoreRange(), score: params.value, type: scoreType } ) } },
  { field: 'Personal', flex: 1, minWidth: 55, maxWidth: 80, cellEditor: 'agNumberCellEditor', cellEditorParams: { min: 1, max: 10, precision: 1, step: 0.1, showStepperButtons: true }, cellStyle: function(params) { let scoreType = "Default"; return scoreColor( { range: scoreRange(), score: params.value, type: scoreType } ) } },
  { field: 'Difference_Personal', headerName: 'Difference Personal', flex: 1, minWidth: 70, maxWidth: 90, editable: false, cellStyle: function(params) { let scoreType = "Difference Personal"; return  scoreColor( { range: scoreRange(scoreType), score: params.value, type: scoreType } ) } },
  { field: 'TMDB_Score', headerName: 'TMDB Score', flex: 1, minWidth: 55, maxWidth: 80, editable: false, cellStyle: function(params) { let scoreType = "TMDB Score"; return  scoreColor( { range: scoreRange(scoreType), score: params.value, type: scoreType } ) } },
  { field: 'Difference_Objective', headerName: 'Difference Objective', flex: 1, minWidth: 70, maxWidth: 90, editable: false, cellStyle: function(params) { let scoreType = "Difference Objective"; return  scoreColor( { range: scoreRange(scoreType), score: params.value, type: scoreType } ) } }
]

const rowData = [
  { '#': '1',
  'Thumbnail': 'Picture',
  'Title': 'Before Sunset',
  'Type': 'Movie',
  'Air_Year': '2004',
  'Length': '1h 20m',
  'Rating': 'R',
  'Finished_Date': '6/4/23',
  'Genre(s)': 'Drama, Romance',
  'Language': 'English',
  'Story': '6',
  'Character': '10',
  'Presentation': '5',
  'Sound': '7',
  'Performance': '9',
  'Enjoyment': '10',
  'Averaged': '7.84',
  'Personal': '10',
  'Difference_Personal': '+2.16',
  'TMDB_Score': '7.8',
  'Difference_Objective': '+2.20' },

  { '#': '2',
  'Thumbnail': 'Picture',
  'Title': 'The Godfather Part II',
  'Type': 'Movie',
  'Air_Year': '1974',
  'Length': '3h 22m',
  'Rating': 'R',
  'Finished_Date': '4/23/23',
  'Genre(s)': 'Crime, Drama',
  'Language': 'English',
  'Story': '7',
  'Character': '8',
  'Presentation': '7',
  'Sound': '8',
  'Performance': '7',
  'Enjoyment': '6',
  'Averaged': '7.17',
  'Personal': '7.2',
  'Difference_Personal': '+0.03',
  'TMDB_Score': '8.6',
  'Difference_Objective': '-1.4' },

  { '#': '3',
  'Thumbnail': 'Picture',
  'Title': 'Our Little Sister',
  'Type': 'Movie',
  'Air_Year': '2015',
  'Length': '2h 7m',
  'Rating': 'PG',
  'Finished_Date': '6/23/23',
  'Genre(s)': 'Drama, Family',
  'Language': 'Japanesen',
  'Story': '3',
  'Character': '6',
  'Presentation': '8',
  'Sound': '8',
  'Performance': '7',
  'Enjoyment': '7',
  'Averaged': '6.5',
  'Personal': '5.4',
  'Difference_Personal': '-1.10',
  'TMDB_Score': '7.6',
  'Difference_Objective': '-2.20' },

  { '#': '4',
  'Thumbnail': 'Picture',
  'Title': 'Gen V',
  'Type': 'TV Series*',
  'Air_Year': '2023-',
  'Length': '8 / 8 eps',
  'Rating': 'TV-MA',
  'Finished_Date': '7/20/23',
  'Genre(s)': 'Action, Adventure, Comedy',
  'Language': 'English',
  'Story': '4',
  'Character': '4',
  'Presentation': '7',
  'Sound': '6',
  'Performance': '6',
  'Enjoyment': '5',
  'Averaged': '5.34',
  'Personal': '3.4',
  'Difference_Personal': '-2.34',
  'TMDB_Score': '8',
  'Difference_Objective': '-4.60' },

  { '#': '5',
  'Thumbnail': 'Picture',
  'Title': 'Cunk on Earth',
  'Type': 'TV Series',
  'Air_Year': '2022-2022',
  'Length': '10 / 10 eps',
  'Rating': 'TV-MA',
  'Finished_Date': '3/7/23',
  'Genre(s)': 'Comedy',
  'Language': 'English',
  'Story': '1',
  'Character': '1',
  'Presentation': '6',
  'Sound': '6',
  'Performance': '3',
  'Enjoyment': '2',
  'Averaged': '3.17',
  'Personal': '1.2',
  'Difference_Personal': '-1.97',
  'TMDB_Score': '7.8',
  'Difference_Objective': '-6.6' }
]

export default function Index() {
  return (
    <div className='ag-theme-alpine-dark' style={{ width: '100%', height: '100%' }}>
      <AgGridReact
        gridOptions={gridOptions}
        columnDefs={columnDefs}
        rowData={rowData}
      ></AgGridReact>
    </div>
  )
}

export const LinksFunction = () => {
	return [
		{ rel: 'stylesheet', href: watchlistStyleSheetUrl },
	].filter(Boolean)
}
