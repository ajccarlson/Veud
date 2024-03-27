import { dateFormatter, differenceFormatter, listThumbnailRenderer } from "#app/utils/lists/column-functions.tsx";
import { scoreColor, scoreRange } from "#app/utils/lists/score-colorer.tsx";

export const gridOptions = {
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

export const columnDefs = [
  { field: 'position', headerName: '#', flex: 1, resizable: false, minWidth: 35, maxWidth: 35, filter: 'agNumberColumnFilter', rowDrag: true },
  { field: 'thumbnail', headerName: 'Thumbnail', flex: 1, resizable: false, minWidth: 80, maxWidth: 120, cellRenderer:  params => listThumbnailRenderer(params.value) },
  { field: 'title', headerName: 'Title', flex: 2, resizable: false, minWidth: 90, maxWidth: 200, filter: 'agTextColumnFilter', cellClass: "ag-title-cell" },
  { field: 'type', headerName: 'Type', flex: 1, resizable: false, minWidth: 70, maxWidth: 110, filter: 'agSetColumnFilter', cellStyle: function(params) {
    if (params.value.includes('Movie')) {
      return {color: '#408063'};
    } 
    else if (params.value.includes('TV Series*')) {
      return {color: '#ffdccc'};
    } else {
      return {color: '#dbffcc'};
    }
  } },
  { field: 'airYear', headerName: 'Air Year', flex: 1, resizable: false, minWidth: 65, maxWidth: 72, filter: 'agDateColumnFilter' },
  { field: 'length', headerName: 'Length', flex: 1, resizable: false, minWidth: 85, maxWidth: 110, filter: "agTextColumnFilter" },
  { field: 'rating', headerName: 'Rating', flex: 1, resizable: false, minWidth: 80, maxWidth: 90, filter: "agSetColumnFilter", editable: true },
  { field: 'finishedDate', headerName: 'Finished Date', valueFormatter: params => dateFormatter(params.value), flex: 1, resizable: false,  minWidth: 85, maxWidth: 120, filter: 'agDateColumnFilter', cellEditor: 'agDateCellEditor', editable: true },
  { field: 'genres', headerName: 'Finished Date', flex: 1, resizable: false, minWidth: 100, maxWidth: 200, filter: "agSetColumnFilter" },
  { field: 'language', headerName: 'Language', flex: 1, resizable: false, minWidth: 90, maxWidth: 135, filter: "agSetColumnFilter", cellStyle: function(params) {
    if (params.value.includes('English')) {
      return {color: '#7196aa'};
    } else {
      return {color: '#ccedff'};
    }
  } },
  { field: 'story', headerName: 'Story', flex: 1, resizable: false, minWidth: 52, maxWidth: 80, filter: "agNumberColumnFilter", cellEditor: 'agNumberCellEditor', cellEditorParams: { min: 1, max: 10, precision: 1, step: 1, showStepperButtons: true }, cellClass: "ag-score-border-left-single ag-score-cell", cellStyle: function(params) { let scoreType = "Default"; return scoreColor( { range: scoreRange(), score: params.value, type: scoreType } ) } },
  { field: 'character', headerName: 'Character', flex: 1, resizable: false, minWidth: 52, maxWidth: 80, filter: "agNumberColumnFilter", cellEditor: 'agNumberCellEditor', cellEditorParams: { min: 1, max: 10, precision: 1, step: 1, showStepperButtons: true }, cellClass: "ag-score-cell", cellStyle: function(params) { let scoreType = "Default"; return scoreColor( { range: scoreRange(), score: params.value, type: scoreType } ) } },
  { field: 'presentation', headerName: 'Presentation', flex: 1, resizable: false, minWidth: 52, maxWidth: 80, filter: 'agNumberColumnFilter', cellEditor: 'agNumberCellEditor', cellEditorParams: { min: 1, max: 10, precision: 1, step: 1, showStepperButtons: true }, cellClass: "ag-score-cell", cellStyle: function(params) { let scoreType = "Default"; return scoreColor( { range: scoreRange(), score: params.value, type: scoreType } ) } },
  { field: 'sound', headerName: 'Sound', flex: 1, resizable: false, minWidth: 52, maxWidth: 80, filter: 'agNumberColumnFilter', cellEditor: 'agNumberCellEditor', cellEditorParams: { min: 1, max: 10, precision: 1, step: 1, showStepperButtons: true }, cellClass: "ag-score-cell", cellStyle: function(params) { let scoreType = "Default"; return scoreColor( { range: scoreRange(), score: params.value, type: scoreType } ) } },
  { field: 'performance', headerName: 'Performance', flex: 1, resizable: false, minWidth: 52, maxWidth: 80, filter: 'agNumberColumnFilter', cellEditor: 'agNumberCellEditor', cellEditorParams: { min: 1, max: 10, precision: 1, step: 1, showStepperButtons: true }, cellClass: "ag-score-cell", cellStyle: function(params) { let scoreType = "Default"; return scoreColor( { range: scoreRange(), score: params.value, type: scoreType } ) } },
  { field: 'enjoyment', headerName: 'Enjoyment', flex: 1, resizable: false, minWidth: 52, maxWidth: 80, filter: 'agNumberColumnFilter', cellEditor: 'agNumberCellEditor', cellEditorParams: { min: 1, max: 10, precision: 1, step: 1, showStepperButtons: true }, cellClass: "ag-score-cell", cellStyle: function(params) { let scoreType = "Default"; return scoreColor( { range: scoreRange(), score: params.value, type: scoreType } ) } },
  { field: 'averaged', headerName: 'Averaged', valueGetter: '(data.story + data.character + data.presentation + data.sound + data.performance + data.enjoyment) / 6', valueFormatter: params => Number(params.value).toFixed(2), flex: 1, resizable: false, minWidth: 62, maxWidth: 90, filter: 'agNumberColumnFilter', editable: false, cellClass: "ag-score-border-left-double ag-score-cell", cellStyle: function(params) { let scoreType = "Default"; return scoreColor( { range: scoreRange(), score: params.value, type: scoreType } ) } },
  { field: 'personal', headerName: 'Personal', valueFormatter: params => Number(params.value).toFixed(1), flex: 1, resizable: false, minWidth: 55, maxWidth: 80, filter: 'agNumberColumnFilter', cellEditor: 'agNumberCellEditor', cellEditorParams: { min: 1, max: 10, precision: 1, step: 0.1, showStepperButtons: true }, cellClass: "ag-score-cell", cellStyle: function(params) { let scoreType = "Default"; return scoreColor( { range: scoreRange(), score: params.value, type: scoreType } ) } },
  { field: 'differencePersonal', headerName: 'Difference: Personal', valueGetter: 'data.personal - data.averaged', valueFormatter: params => differenceFormatter(params.value), flex: 1, resizable: false, minWidth: 70, maxWidth: 90, filter: 'agNumberColumnFilter', editable: false, cellClass: "ag-score-cell", cellStyle: function(params) { let scoreType = "Difference Personal"; return  scoreColor( { range: scoreRange(scoreType), score: params.value, type: scoreType } ) } },
  { field: 'tmdbScore', headerName: 'TMDB Score', valueFormatter: params => Number(params.value).toFixed(1), flex: 1, resizable: false, minWidth: 55, maxWidth: 80, filter: 'agNumberColumnFilter', editable: false, cellClass: "ag-score-border-left-double ag-score-cell", cellStyle: function(params) { let scoreType = "TMDB Score"; return  scoreColor( { range: scoreRange(scoreType), score: params.value, type: scoreType } ) } },
  { field: 'differenceObjective', headerName: 'Difference: Objective', valueGetter: 'data.personal - data.tmdbScore', valueFormatter: params => differenceFormatter(params.value), flex: 1, resizable: false, minWidth: 70, maxWidth: 90, filter: 'agNumberColumnFilter', editable: false, cellClass: "ag-score-cell", cellStyle: function(params) { let scoreType = "Difference Objective"; return  scoreColor( { range: scoreRange(scoreType), score: params.value, type: scoreType } ) } }
]
