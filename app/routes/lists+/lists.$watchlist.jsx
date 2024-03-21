import { ClientSideRowModelModule } from '@ag-grid-community/client-side-row-model'
import { ModuleRegistry } from '@ag-grid-community/core'
import { AgGridReact } from '@ag-grid-community/react'
import '@ag-grid-community/styles/ag-grid.css';
import "#app/styles/watchlist.scss";
import listThumbnailRenderer from "#app/utils/lists/thumbnail-renderer.tsx";
import { scoreColor, scoreRange } from "#app/utils/lists/score-colorer.tsx";
import { differenceFormatter } from "#app/utils/lists/column-functions.tsx";
import { rowData } from "#app/utils/lists/test-data.tsx";

    
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
  { field: 'Thumbnail', flex: 1, minWidth: 80, maxWidth: 120, cellRenderer: listThumbnailRenderer },
  { field: 'Title', flex: 2, minWidth: 90, cellClass: "ag-title-cell" },
  { field: 'Type', flex: 1, minWidth: 70, maxWidth: 110, cellStyle: function(params) {
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
  { field: 'Story', flex: 1, minWidth: 52, maxWidth: 80, cellEditor: 'agNumberCellEditor', cellEditorParams: { min: 1, max: 10, precision: 1, step: 1, showStepperButtons: true }, cellClass: "ag-score-border-left-single ag-score-cell", cellStyle: function(params) { let scoreType = "Default"; return scoreColor( { range: scoreRange(), score: params.value, type: scoreType } ) } },
  { field: 'Character', flex: 1, minWidth: 52, maxWidth: 80, cellEditor: 'agNumberCellEditor', cellEditorParams: { min: 1, max: 10, precision: 1, step: 1, showStepperButtons: true }, cellClass: "ag-score-cell", cellStyle: function(params) { let scoreType = "Default"; return scoreColor( { range: scoreRange(), score: params.value, type: scoreType } ) } },
  { field: 'Presentation', flex: 1, minWidth: 52, maxWidth: 80, cellEditor: 'agNumberCellEditor', cellEditorParams: { min: 1, max: 10, precision: 1, step: 1, showStepperButtons: true }, cellClass: "ag-score-cell", cellStyle: function(params) { let scoreType = "Default"; return scoreColor( { range: scoreRange(), score: params.value, type: scoreType } ) } },
  { field: 'Sound', flex: 1, minWidth: 52, maxWidth: 80, cellEditor: 'agNumberCellEditor', cellEditorParams: { min: 1, max: 10, precision: 1, step: 1, showStepperButtons: true }, cellClass: "ag-score-cell", cellStyle: function(params) { let scoreType = "Default"; return scoreColor( { range: scoreRange(), score: params.value, type: scoreType } ) } },
  { field: 'Performance', flex: 1, minWidth: 52, maxWidth: 80, cellEditor: 'agNumberCellEditor', cellEditorParams: { min: 1, max: 10, precision: 1, step: 1, showStepperButtons: true }, cellClass: "ag-score-cell", cellStyle: function(params) { let scoreType = "Default"; return scoreColor( { range: scoreRange(), score: params.value, type: scoreType } ) } },
  { field: 'Enjoyment', flex: 1, minWidth: 52, maxWidth: 80, cellEditor: 'agNumberCellEditor', cellEditorParams: { min: 1, max: 10, precision: 1, step: 1, showStepperButtons: true }, cellClass: "ag-score-cell", cellStyle: function(params) { let scoreType = "Default"; return scoreColor( { range: scoreRange(), score: params.value, type: scoreType } ) } },
  { field: 'Averaged', flex: 1, minWidth: 62, maxWidth: 90, editable: false, cellClass: "ag-score-border-left-double ag-score-cell", cellStyle: function(params) { let scoreType = "Default"; return scoreColor( { range: scoreRange(), score: params.value, type: scoreType } ) } },
  { field: 'Personal', flex: 1, minWidth: 55, maxWidth: 80, cellEditor: 'agNumberCellEditor', cellEditorParams: { min: 1, max: 10, precision: 1, step: 0.1, showStepperButtons: true }, cellClass: "ag-score-cell", cellStyle: function(params) { let scoreType = "Default"; return scoreColor( { range: scoreRange(), score: params.value, type: scoreType } ) } },
  { field: 'Difference_Personal', headerName: 'Difference: Personal', valueGetter: 'data.Personal - data.Averaged', valueFormatter: params => differenceFormatter(params), flex: 1, minWidth: 70, maxWidth: 90, editable: false, cellClass: "ag-score-cell", cellStyle: function(params) { let scoreType = "Difference Personal"; return  scoreColor( { range: scoreRange(scoreType), score: params.value, type: scoreType } ) } },
  { field: 'TMDB_Score', headerName: 'TMDB Score', flex: 1, minWidth: 55, maxWidth: 80, editable: false, cellClass: "ag-score-border-left-double ag-score-cell", cellStyle: function(params) { let scoreType = "TMDB Score"; return  scoreColor( { range: scoreRange(scoreType), score: params.value, type: scoreType } ) } },
  { field: 'Difference_Objective', headerName: 'Difference: Objective', valueGetter: 'data.Personal - data.TMDB_Score', valueFormatter: params => differenceFormatter(params), flex: 1, minWidth: 70, maxWidth: 90, editable: false, cellClass: "ag-score-cell", cellStyle: function(params) { let scoreType = "Difference Objective"; return  scoreColor( { range: scoreRange(scoreType), score: params.value, type: scoreType } ) } }
]

function WatchList() {
  return (
    <div style={{ width: '100%', height: '90%' }} className='ag-theme-custom-react'>
      <AgGridReact
        gridOptions={gridOptions}
        columnDefs={columnDefs}
        rowData={rowData}

      ></AgGridReact>
    </div>
  )
}

export { WatchList }
