import { AgGridReact } from '@ag-grid-community/react'
import { Icon } from '#app/components/ui/icon.tsx'
import { dateFormatter, differenceFormatter, listThumbnailRenderer } from "#app/utils/lists/column-functions.tsx"
import { scoreColor, scoreRange } from "#app/utils/lists/score-colorer.tsx"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuPortal,
	DropdownMenuTrigger,
} from '#app/components/ui/dropdown-menu.tsx'
import { Button } from '#app/components/ui/button.tsx'

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
  rowSelection: 'multiple',
}

function createNewRow() {
  console.log("TEST!!!!")
}

function setterFunction(params) {
  console.log(params)

  if (params.data != params.newValue) {
    console.log("value: " + params.data + " has changed to " + params.newValue)
    params.data[params.column.colId] = params.newValue

    fetch('fetch/' + new URLSearchParams({
        colId: params.column.colId,
        type: params.colDef.cellDataType,
        filter: params.colDef.filter,
        rowIndex: params.data.id,
        newValue: params.newValue,
    })).then((response) => { 
      return response.json().then((data) => {
          console.log(data);
          return data;
      }).catch((err) => {
          console.log(err);
      }) 
    });

    return true;
  }
  else {
    console.log("value unchanged")
    return false;
  }
}

export function columnDefs(hiddenColumns) {
  return [
    {
      field: 'position',
      headerName: '#',
      valueSetter: params => {setterFunction(params)},
      flex: 1,
      resizable: false,
      minWidth: 35,
      maxWidth: 35,
      filter: 'agNumberColumnFilter',
      rowDrag: true,
      cellRenderer: params => {
        return (
          <div>
            {params.value}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <span className='ag-cell-insert'>
                  <Icon name="plus"></Icon>
                </span>
              </DropdownMenuTrigger>
              <DropdownMenuPortal>
                <DropdownMenuContent sideOffset={8} align="start">
                  <DropdownMenuItem onSelect={event => {
                    createNewRow()
                  }}>
                    Insert row below
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenuPortal>
            </DropdownMenu>
          </div>
        )
      },
      cellClass: "ag-position-cell",
      hide: hiddenColumns['position'],
    },


    {
      field: 'thumbnail',
      headerName: 'Thumbnail',
      valueSetter: params => {setterFunction(params)},
      flex: 1,
      resizable: false,
      minWidth: 80,
      maxWidth: 120,
      cellRenderer: params => listThumbnailRenderer(params.value),
      cellClass: "ag-thumbnail-cell",
      hide: hiddenColumns['thumbnail'],
    },


    {
      field: 'title',
      headerName: 'Title',
      valueSetter: params => {setterFunction(params)},
      flex: 2,
      resizable: false,
      minWidth: 90,
      maxWidth: 200,
      filter: 'agTextColumnFilter',
      cellClass: "ag-title-cell",
      hide: hiddenColumns['title'],
    },


    {
      field: 'type',
      headerName: 'Type',
      valueSetter: params => {setterFunction(params)},
      flex: 1,
      resizable: false,
      minWidth: 70,
      maxWidth: 110,
      filter: 'agSetColumnFilter',
      cellStyle: function(params) {
        if (params.value.includes('Movie')) {
          return {color: '#408063'};
        } 
        else if (params.value.includes('TV Series*')) {
          return {color: '#ffdccc'};
        } else {
          return {color: '#dbffcc'};
        }
      },
      hide: hiddenColumns['type'],
    },


    {
      field: 'airYear',
      headerName: 'Air Year',
      valueSetter: params => {setterFunction(params)},
      flex: 1,
      resizable: false,
      minWidth: 65,
      maxWidth: 72,
      filter: 'agDateColumnFilter',
      hide: hiddenColumns['airYear'],
    },


    {
      field: 'length',
      headerName: 'Length',
      valueSetter: params => {setterFunction(params)},
      valueFormatter: params => {
        if (!params.value || params.value == "null" || params.value == "NULL" || params.value == 0) {
            return ""
        }
      },
      flex: 1,
      resizable: false,
      minWidth: 85,
      maxWidth: 110,
      filter: "agTextColumnFilter",
      hide: hiddenColumns['length'],
    },


    {
      field: 'rating',
      headerName: 'Rating',
      valueSetter: params => {setterFunction(params)},
      flex: 1,
      resizable: false,
      minWidth: 80,
      maxWidth: 90,
      filter: "agSetColumnFilter",
      editable: true,
      hide: hiddenColumns['rating'],
    },


    {
      field: 'finishedDate',
      headerName: 'Finished Date',
      valueSetter: params => {setterFunction(params)},
      valueFormatter: params => dateFormatter(params.value),
      flex: 1,
      resizable: false,
      minWidth: 85,
      maxWidth: 120,
      cellDataType: 'date',
      editable: true,
      hide: hiddenColumns['finishedDate'],
    },


    {
      field: 'genres',
      headerName: 'Genre(s)',
      valueSetter: params => {setterFunction(params)},
      flex: 1,
      resizable: false,
      minWidth: 100,
      maxWidth: 200,
      filter: "agSetColumnFilter",
      hide: hiddenColumns['genres'],
    },


    {
      field: 'language',
      headerName: 'Language',
      valueSetter: params => {setterFunction(params)},
      flex: 1,
      resizable: false,
      minWidth: 90,
      maxWidth: 135,
      filter: "agSetColumnFilter",
      cellStyle: function(params) {
        if (params.value.includes('English')) {
          return {color: '#7196aa'};
        } else {
          return {color: '#ccedff'};
        }
      },
      hide: hiddenColumns['language'],
    },


    {
      field: 'story',
      headerName: 'Story',
      valueSetter: params => {setterFunction(params)},
      valueFormatter: params => {
        if (!params.value || params.value == "null" || params.value == "NULL" || params.value == 0) {
            return ""
        }
      },
      flex: 1,
      resizable: false,
      minWidth: 52,
      maxWidth: 80,
      filter: "agNumberColumnFilter",
      cellEditor: 'agNumberCellEditor',
      cellEditorParams: {
        min: 1,
        max: 10,
        precision: 1,
        step: 1,
        showStepperButtons: true
      },
      cellClass: params => {
        if (params.value && params.value != 0)
          return "ag-score-border-left-single ag-score-cell ag-score-present"
        else {
          return "ag-score-border-left-single ag-score-cell ag-score-empty"
        }
      },
      cellStyle: function(params) {
        let scoreType = "Default";
        return scoreColor( {
          range: scoreRange(),
          score: params.value,
          type: scoreType
        } )
      },
      hide: hiddenColumns['story'],
    },


    {
      field: 'character',
      headerName: 'Character',
      valueSetter: params => {setterFunction(params)},
      valueFormatter: params => {
        if (!params.value || params.value == "null" || params.value == "NULL" || params.value == 0) {
          return ""
        }
      },
      flex: 1,
      resizable: false,
      minWidth: 52,
      maxWidth: 80,
      filter: "agNumberColumnFilter",
      cellEditor: 'agNumberCellEditor',
      cellEditorParams: {
        min: 1,
        max: 10,
        precision: 1,
        step: 1,
        showStepperButtons: true
      },
      cellClass: params => {
        if (params.value && params.value != 0)
          return "ag-score-cell ag-score-present"
        else {
          return "ag-score-cell ag-score-empty"
        }
      },
      cellStyle: function(params) {
        let scoreType = "Default";
        return scoreColor( {
          range: scoreRange(),
          score: params.value,
          type: scoreType
        } )
      },
      hide: hiddenColumns['character'],
    },


    {
      field: 'presentation',
      headerName: 'Presentation',
      valueSetter: params => {setterFunction(params)},
      valueFormatter: params => {
        if (!params.value || params.value == "null" || params.value == "NULL" || params.value == 0) {
          return "" 
        }
      },
      flex: 1,
      resizable:
      false, minWidth: 52,
      maxWidth: 80, filter:
      'agNumberColumnFilter',
      cellEditor: 'agNumberCellEditor',
      cellEditorParams: {
        min: 1,
        max: 10,
        precision: 1,
        step: 1,
        showStepperButtons:
        true
      },
      cellClass: params => {
        if (params.value && params.value != 0)
          return "ag-score-cell ag-score-present"
        else {
          return "ag-score-cell ag-score-empty"
        }
      },
      cellStyle: function(params) {
        let scoreType = "Default";
        return scoreColor( {
          range: scoreRange(),
          score: params.value,
          type: scoreType
        } )
      },
      hide: hiddenColumns['presentation'],
    },


    {
      field: 'sound',
      headerName: 'Sound',
      valueSetter: params => {setterFunction(params)},
      valueFormatter: params => {
        if (!params.value || params.value == "null" || params.value == "NULL" || params.value == 0) {
          return ""
        }
      },
      flex: 1,
      resizable: false,
      minWidth: 52,
      maxWidth: 80,
      filter: 'agNumberColumnFilter',
      cellEditor: 'agNumberCellEditor',
      cellEditorParams: {
        min: 1,
        max: 10,
        precision: 1,
        step: 1,
        showStepperButtons: true
      },
      cellClass: params => {
        if (params.value && params.value != 0)
          return "ag-score-cell ag-score-present"
        else {
          return "ag-score-cell ag-score-empty"
        }
      },
      cellStyle: function(params) {
        let scoreType = "Default";
        return scoreColor( {
          range: scoreRange(),
          score: params.value,
          type: scoreType
        } )
      },
      hide: hiddenColumns['sound'],
    },


    {
      field: 'performance',
      headerName: 'Performance',
      valueSetter: params => {setterFunction(params)},
      valueFormatter: params => {
        if (!params.value || params.value == "null" || params.value == "NULL" || params.value == 0) {
          return ""
        }
      },
      flex: 1,
      resizable: false,
      minWidth: 52,
      maxWidth: 80,
      filter: 'agNumberColumnFilter',
      cellEditor: 'agNumberCellEditor',
      cellEditorParams: {
        min: 1,
        max: 10,
        precision: 1,
        step: 1,
        showStepperButtons: true
      },
      cellClass: params => {
        if (params.value && params.value != 0)
          return "ag-score-cell ag-score-present"
        else {
          return "ag-score-cell ag-score-empty"
        }
      },
      cellStyle: function(params) {
        let scoreType = "Default";
        return scoreColor( {
          range: scoreRange(),
          score: params.value,
          type: scoreType
        } )
      },
      hide: hiddenColumns['performance'],
    },


    {
      field: 'enjoyment',
      headerName: 'Enjoyment',
      valueSetter: params => {setterFunction(params)},
      valueFormatter: params => {
        if (!params.value || params.value == "null" || params.value == "NULL" || params.value == 0) {
          return ""
        }
      },
      flex: 1,
      resizable: false,
      minWidth: 52,
      maxWidth: 80,
      filter: 'agNumberColumnFilter',
      cellEditor: 'agNumberCellEditor',
      cellEditorParams: {
        min: 1,
        max: 10,
        precision: 1,
        step: 1,
        showStepperButtons: true
      },
      cellClass: params => {
        if (params.value && params.value != 0)
          return "ag-score-cell ag-score-present"
        else {
          return "ag-score-cell ag-score-empty"
        }
      },
      cellStyle: function(params) {
        let scoreType = "Default";
        return scoreColor( {
          range: scoreRange(),
          score: params.value,
          type: scoreType
        } )
      },
      hide: hiddenColumns['averaged'],
    },


    {
      field: 'averaged',
      headerName: 'Averaged',
      valueSetter: params => {setterFunction(params)},
      valueFormatter: params => {
        if (!params.value || params.value == "null" || params.value == "NULL" || params.value == 0) {
          return ""
        } else {
          return Number(params.value).toFixed(1)
        }
      },
      valueGetter: params => {
        let scoreCategories = [params.data.story, params.data.character, params.data.presentation, params.data.sound, params.data.performance, params.data.enjoyment];
        let foundScores = 0;
        let sum = 0;

        for (let category of scoreCategories) {
          if (category) {
            foundScores ++;
            sum += category;
          }
        }

        return (sum / foundScores)
      },
      flex: 1,
      resizable: false,
      minWidth: 62,
      maxWidth: 90,
      filter: 'agNumberColumnFilter',
      editable: false,
      cellClass: params => {
        if (params.value && params.value != 0)
          return "ag-score-border-left-double ag-score-cell ag-score-present"
        else {
          return "ag-score-border-left-double ag-score-cell ag-score-empty"
        }
      },
      cellStyle: function(params) {
        let scoreType = "Default";
        return scoreColor( {
          range: scoreRange(),
          score: params.value,
          type: scoreType
        } )
      },
      hide: hiddenColumns['averaged'],
    },


    {
      field: 'personal',
      headerName: 'Personal',
      valueSetter: params => {setterFunction(params)},
      valueFormatter: params => {
        if (!params.value || params.value == "null" || params.value == "NULL" || params.value == 0) {
          return ""
        } else {
          return Number(params.value).toFixed(1)
        }
      },
      flex: 1,
      resizable: false,
      minWidth: 55,
      maxWidth: 80,
      filter: 'agNumberColumnFilter',
      cellEditor: 'agNumberCellEditor',
      cellEditorParams: {
        min: 1,
        max: 10,
        precision: 1,
        step: 0.1,
        showStepperButtons: true
      },
      cellClass: params => {
        if (params.value && params.value != 0)
          return "ag-score-cell ag-score-present"
        else {
          return "ag-score-cell ag-score-empty"
        }
      },
      cellStyle: function(params) {
        let scoreType = "Default";
        return scoreColor( {
          range: scoreRange(),
          score: params.value,
          type: scoreType
        } )
      },
      hide: hiddenColumns['personal'],
    },


    {
      field: 'differencePersonal',
      headerName: 'Difference: Personal',
      valueSetter: params => {setterFunction(params)},
      valueGetter: params => {
        if (params.data.personal && params.data.personal != 0) {
          return (params.data.personal - ((params.data.story + params.data.character + params.data.presentation + params.data.sound + params.data.performance + params.data.enjoyment) / 6))
        } else {return ""}
      },
      valueFormatter: params => {
        if (!params.value || params.value == "null" || params.value == "NULL" || params.value == 0) {
          return ""
        } else {
          return differenceFormatter(params.value)
        }
      },
      flex: 1,
      resizable: false,
      minWidth: 70,
      maxWidth: 90,
      filter: 'agNumberColumnFilter',
      editable: false,
      cellClass: params => {
        if (params.value && params.value != 0)
          return "ag-score-cell ag-score-present"
        else {
          return "ag-score-cell ag-score-empty"
        }
      },
      cellStyle: function(params) {
        let scoreType = "Difference Personal";
        return  scoreColor( {
          range: scoreRange(scoreType),
          score: params.value,
          type: scoreType
        } )
      },
      hide: hiddenColumns['differencePersonal'],
    },


    {
      field: 'tmdbScore',
      headerName: 'TMDB Score',
      valueSetter: params => {setterFunction(params)},
      valueFormatter: params => {
        if (!params.value || params.value == "null" || params.value == "NULL" || params.value == 0) {
          return ""
        } else {
          return Number(params.value).toFixed(1)
        }
      },
      flex: 1,
      resizable: false,
      minWidth: 55,
      maxWidth: 80,
      filter: 'agNumberColumnFilter',
      editable: false,
      cellClass: params => {
        if (params.value && params.value != 0)
          return "ag-score-border-left-double ag-score-cell ag-score-present"
        else {
          return "ag-score-border-left-double ag-score-cell ag-score-empty"
        }
      },
      cellStyle: function(params) {
        let scoreType = "TMDB Score";
        return  scoreColor( {
          range: scoreRange(scoreType),
          score: params.value,
          type: scoreType
        } )
      },
      hide: hiddenColumns['tmdbScore'],
    },


    {
      field: 'differenceObjective',
      headerName: 'Difference: Objective',
      valueSetter: params => {setterFunction(params)},
      valueGetter: params => {
        if ((params.data.personal && params.data.personal != 0) && (params.data.tmdbScore && params.data.tmdbScore != 0)) {
          return (params.data.personal - params.data.tmdbScore)
        } else {return ""}
      },
      valueFormatter: params => {
        if (!params.value || params.value == "null" || params.value == "NULL" || params.value == 0) {
          return ""
        } else {
          return differenceFormatter(params.value)
        }
      },
      flex: 1,
      resizable: false,
      minWidth: 70,
      maxWidth: 90,
      filter: 'agNumberColumnFilter',
      editable: false,
      cellClass: params => {
        if (params.value && params.value != 0)
          return "ag-score-cell ag-score-present"
        else {
          return "ag-score-cell ag-score-empty"
        }
      },
      cellStyle: function(params) {
        let scoreType = "Difference Objective";
        return  scoreColor( {
          range: scoreRange(scoreType),
          score: params.value,
          type: scoreType
        } )
      },
      hide: hiddenColumns['differenceObjective'],
    },


    {
      field: 'description',
      headerName: 'Description',
      valueSetter: params => {setterFunction(params)},
      flex: 2,
      resizable: false,
      minWidth: 90,
      maxWidth: 500,
      filter: 'agTextColumnFilter',
      cellClass: "ag-description-cell",
      hide: hiddenColumns['description'],
    }
  ]
}

export function watchlistGrid(listEntries, watchListData) {
  const columns = ["position", "thumbnail", "title", "type", "airYear", "length", "rating", "finishedDate", "genres", "language", "story", "character", "presentation", "sound", "performance", "enjoyment", "averaged", "personal", "differencePersonal", "tmdbScore", "differenceObjective", "description"];
  const hiddenArray = columns.filter(x => !watchListData.columns.split(', ').includes(x));
  const hiddenColumns = hiddenArray.reduce((key,value) => (key[value] = true, key),{});

  return (
    <div style={{ width: '100%', height: '90%' }} className='ag-theme-custom-react'>
        <AgGridReact
          gridOptions={gridOptions}
          columnDefs={columnDefs(hiddenColumns)}
          rowData={listEntries}
        ></AgGridReact>
    </div>
  )
}
