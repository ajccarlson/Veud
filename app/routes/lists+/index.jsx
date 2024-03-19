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
    defaultMinWidth: 50,
  },
}

const columnDefs = [
  { field: '#', maxWidth: 50, editable: true },
  { field: 'Thumbnail', maxWidth: 100 },
  { field: 'Title' },
  { field: 'Type', maxWidth: 80 },
  { field: 'Air_Year', headerName: 'Air Year', maxWidth: 80 },
  { field: 'Length', maxWidth: 110 },
  { field: 'Rating', minWidth: 80, maxWidth: 90, editable: true },
  { field: 'Finished_Date', headerName: 'Finished Date', maxWidth: 110, editable: true },
  { field: 'Genre(s)', minWidth: 150 },
  { field: 'Language', maxWidth: 115 },
  { field: 'Story', maxWidth: 80, editable: true, cellEditor: 'agNumberCellEditor', cellEditorParams: { min: 1, max: 10, precision: 1, step: 0.1, showStepperButtons: true } },
  { field: 'Character', maxWidth: 80, editable: true, cellEditor: 'agNumberCellEditor', cellEditorParams: { min: 1, max: 10, precision: 1, step: 0.1, showStepperButtons: true } },
  { field: 'Presentation', maxWidth: 80, editable: true, cellEditor: 'agNumberCellEditor', cellEditorParams: { min: 1, max: 10, precision: 1, step: 0.1, showStepperButtons: true } },
  { field: 'Sound', maxWidth: 80, editable: true, cellEditor: 'agNumberCellEditor', cellEditorParams: { min: 1, max: 10, precision: 1, step: 0.1, showStepperButtons: true } },
  { field: 'Performance', maxWidth: 80, editable: true, cellEditor: 'agNumberCellEditor', cellEditorParams: { min: 1, max: 10, precision: 1, step: 0.1, showStepperButtons: true } },
  { field: 'Enjoyment', maxWidth: 80, editable: true, cellEditor: 'agNumberCellEditor', cellEditorParams: { min: 1, max: 10, precision: 1, step: 0.1, showStepperButtons: true } },
  { field: 'Averaged', maxWidth: 90, editable: true, cellEditor: 'agNumberCellEditor', cellEditorParams: { min: 1, max: 10, precision: 1, step: 0.1, showStepperButtons: true } },
  { field: 'Personal', maxWidth: 80, editable: true, cellEditor: 'agNumberCellEditor', cellEditorParams: { min: 1, max: 10, precision: 1, step: 0.1, showStepperButtons: true } },
  { field: 'Difference_Personal', maxWidth: 90, headerName: 'Difference Personal' },
  { field: 'TMDB_Score', maxWidth: 80, headerName: 'TMDB Score' },
  { field: 'Difference_Objective', maxWidth: 90, headerName: 'Difference Objective' }
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
