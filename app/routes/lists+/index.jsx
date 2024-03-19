import { ClientSideRowModelModule } from '@ag-grid-community/client-side-row-model'
import { ModuleRegistry } from '@ag-grid-community/core'
import { AgGridReact } from '@ag-grid-community/react'
import { useFetcher } from '@remix-run/react'
import '@ag-grid-community/styles/ag-grid.css';
import '@ag-grid-community/styles/ag-theme-alpine.css';
import { useCallback, useEffect, useState } from 'react'

    
ModuleRegistry.registerModules([ ClientSideRowModelModule ]);

const gridOptions = {
  autoSizeStrategy: {
    type: 'fitGridWidth',
    defaultMinWidth: 70
  },
  defaultColDef: {
    editable: true,
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
  { field: '#', flex: 1, minWidth: 70, maxWidth: 80, rowDrag: true },
  { field: 'Thumbnail', flex: 1, minWidth: 80, maxWidth: 90 },
  { field: 'Title', flex: 2, minWidth: 90 },
  { field: 'Type', flex: 1, minWidth: 70, maxWidth: 80 },
  { field: 'Air_Year', flex: 1, headerName: 'Air Year', minWidth: 65, maxWidth: 70 },
  { field: 'Length', flex: 1, minWidth: 85, maxWidth: 110 },
  { field: 'Rating', flex: 1, minWidth: 80, maxWidth: 90, editable: true },
  { field: 'Finished_Date', flex: 1, headerName: 'Finished Date',  minWidth: 85,maxWidth: 120, editable: true },
  { field: 'Genre(s)', flex: 1, minWidth: 100 },
  { field: 'Language', flex: 1, minWidth: 90, maxWidth: 115 },
  { field: 'Story', flex: 1, minWidth: 52, maxWidth: 80, cellEditor: 'agNumberCellEditor', cellEditorParams: { min: 1, max: 10, precision: 1, step: 0.1, showStepperButtons: true } },
  { field: 'Character', flex: 1, minWidth: 52, maxWidth: 80, cellEditor: 'agNumberCellEditor', cellEditorParams: { min: 1, max: 10, precision: 1, step: 0.1, showStepperButtons: true } },
  { field: 'Presentation', flex: 1, minWidth: 52, maxWidth: 80, cellEditor: 'agNumberCellEditor', cellEditorParams: { min: 1, max: 10, precision: 1, step: 0.1, showStepperButtons: true } },
  { field: 'Sound', flex: 1, minWidth: 52, maxWidth: 80, cellEditor: 'agNumberCellEditor', cellEditorParams: { min: 1, max: 10, precision: 1, step: 0.1, showStepperButtons: true } },
  { field: 'Performance', flex: 1, minWidth: 52, maxWidth: 80, cellEditor: 'agNumberCellEditor', cellEditorParams: { min: 1, max: 10, precision: 1, step: 0.1, showStepperButtons: true } },
  { field: 'Enjoyment', flex: 1, minWidth: 52, maxWidth: 80, cellEditor: 'agNumberCellEditor', cellEditorParams: { min: 1, max: 10, precision: 1, step: 0.1, showStepperButtons: true } },
  { field: 'Averaged', flex: 1, minWidth: 62, maxWidth: 90, editable: false },
  { field: 'Personal', flex: 1, minWidth: 55, maxWidth: 80, cellEditor: 'agNumberCellEditor', cellEditorParams: { min: 1, max: 10, precision: 1, step: 0.1, showStepperButtons: true } },
  { field: 'Difference_Personal', flex: 1, minWidth: 70, maxWidth: 90, headerName: 'Difference Personal', editable: false },
  { field: 'TMDB_Score', flex: 1, minWidth: 55, maxWidth: 80, headerName: 'TMDB Score', editable: false },
  { field: 'Difference_Objective', flex: 1, minWidth: 70, maxWidth: 90, headerName: 'Difference Objective', editable: false }
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
  'Title': 'Schindler\'s List',
  'Type': 'Movie',
  'Air_Year': '1993',
  'Length': '3h 15m',
  'Rating': 'R',
  'Finished_Date': '4/30/23',
  'Genre(s)': 'Biography, Drama, History',
  'Language': 'English',
  'Story': '8',
  'Character': '10',
  'Presentation': '10',
  'Sound': '10',
  'Performance': '10',
  'Enjoyment': '8',
  'Averaged': '9.34',
  'Personal': '10',
  'Difference_Personal': '+0.66',
  'TMDB_Score': '8.6',
  'Difference_Objective': '+1.40' },

  { '#': '3',
  'Thumbnail': 'Picture',
  'Title': 'The Act of Killing',
  'Type': 'Movie',
  'Air_Year': '2012',
  'Length': '1h 57m',
  'Rating': 'NR',
  'Finished_Date': '6/19/23',
  'Genre(s)': 'Documentary, Biography, Crime',
  'Language': 'Indonesian',
  'Story': '8',
  'Character': '10',
  'Presentation': '6',
  'Sound': '5',
  'Performance': '9',
  'Enjoyment': '8',
  'Averaged': '7.67',
  'Personal': '10',
  'Difference_Personal': '+2.33',
  'TMDB_Score': '7.7',
  'Difference_Objective': '+2.30' },

  { '#': '4',
  'Thumbnail': 'Picture',
  'Title': 'Parasite',
  'Type': 'Movie',
  'Air_Year': '2019',
  'Length': '2h 12m',
  'Rating': 'R',
  'Finished_Date': '2/14/20',
  'Genre(s)': 'Drama, Thriller',
  'Language': 'English',
  'Story': '10',
  'Character': '10',
  'Presentation': '8',
  'Sound': '8',
  'Performance': '8',
  'Enjoyment': '9',
  'Averaged': '7.67',
  'Personal': '10',
  'Difference_Personal': '+1.16',
  'TMDB_Score': '8.5',
  'Difference_Objective': '+1.50' },

  { '#': '5',
  'Thumbnail': 'Picture',
  'Title': 'Knives Out',
  'Type': 'Movie',
  'Air_Year': '2019',
  'Length': '2h 10m',
  'Rating': 'PG-13',
  'Finished_Date': '5/26/23',
  'Genre(s)': 'Comedy, Crime, Drama',
  'Language': 'English',
  'Story': '10',
  'Character': '8',
  'Presentation': '8',
  'Sound': '9',
  'Performance': '8',
  'Enjoyment': '10',
  'Averaged': '8.84',
  'Personal': '10',
  'Difference_Personal': '+1.16',
  'TMDB_Score': '8.5',
  'Difference_Objective': '+1.50' }
]

export default function Index() {
  return (
    <div className='ag-theme-alpine' style={{ width: '100%', height: '100%' }}>
      <AgGridReact
        gridOptions={gridOptions}
        columnDefs={columnDefs}
        rowData={rowData}
      ></AgGridReact>
    </div>
  )
}
