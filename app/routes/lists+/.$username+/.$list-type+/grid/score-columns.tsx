// Score columns for the watchlist grid (Phase 3.2, increment 3).
//
// The 6 rating columns (story / character / presentation / sound / performance / enjoyment)
// are identical except for field/header/hide-key and a left border on the first one, so they
// come from the scoreColumn() factory below. The 6 computed columns (averaged / personal /
// differencePersonal / tmdbScore / malScore / differenceObjective) each have distinct
// value-getters, scoreTypes, and borders, so they're written out explicitly. All are returned
// in the original source order.
//
// FIXED (was a latent bug): the `enjoyment` column's hide key was 'averaged', not 'enjoyment',
// so the "Averaged" visibility toggle also controlled Enjoyment and Enjoyment had no independent
// toggle. Now keyed to its own field like every other score column.
import { columnParams } from './grid-state.ts'
import { setterFunction } from './grid-actions.ts'
import { scoreColor, scoreRange } from '#app/utils/lists/score-colorer.tsx'
import { differenceFormatter } from '#app/utils/lists/column-functions.tsx'

// Factory for the six 1-10 rating columns. `borderLeft` adds the single left border that only
// the first rating column (story) carries; `hideKey` is the displayedColumns key (normally the
// field name — see the enjoyment note above).
function scoreColumn(field: string, headerName: string, hideKey: string, borderLeft: boolean) {
  const borderClass = borderLeft ? 'ag-score-border-left-single ' : ''
  return {
    field,
    headerName,
    valueSetter: (params: any) => {setterFunction(params)},
    valueFormatter: (params: any) => {
      if (!params.value || params.value == "null" || params.value == "NULL" || params.value == 0) {
        return ""
      }
    },
    editable: columnParams.currentUserId == columnParams.listOwner.id,
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
    cellClass: (params: any) => {
      if (params.value && params.value != 0)
        return borderClass + "ag-score-cell ag-score-present"
      else {
        return borderClass + "ag-score-cell ag-score-empty"
      }
    },
    cellStyle: function(params: any) {
      let scoreType = "Default";
      return scoreColor( {
        range: scoreRange(),
        score: params.value,
        type: scoreType
      } )
    },
    hide: !columnParams.displayedColumns[hideKey],
  }
}

export function scoreColumns() {
  return [
    // --- 6 rating columns via factory (story carries the left border) ---
    scoreColumn('story', 'Story', 'story', true),
    scoreColumn('character', 'Character', 'character', false),
    scoreColumn('presentation', 'Presentation', 'presentation', false),
    scoreColumn('sound', 'Sound', 'sound', false),
    scoreColumn('performance', 'Performance', 'performance', false),
    scoreColumn('enjoyment', 'Enjoyment', 'enjoyment', false),

    // --- 6 computed columns (explicit; distinct value-getters / scoreTypes / borders) ---
    {
      field: 'averaged',
      headerName: 'Averaged',
      valueSetter: (params: any) => {setterFunction(params)},
      valueFormatter: (params: any) => {
        if (!params.value || params.value == "null" || params.value == "NULL" || params.value == 0) {
          return ""
        } else {
          return Number(params.value).toFixed(1)
        }
      },
      valueGetter: (params: any) => {
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
      minWidth: 62,
      maxWidth: 90,
      filter: 'agNumberColumnFilter',
      editable: false,
      cellClass: (params: any) => {
        if (params.value && params.value != 0)
          return "ag-score-border-left-double ag-score-cell ag-score-present"
        else {
          return "ag-score-border-left-double ag-score-cell ag-score-empty"
        }
      },
      cellStyle: function(params: any) {
        let scoreType = "Default";
        return scoreColor( {
          range: scoreRange(),
          score: params.value,
          type: scoreType
        } )
      },
      hide: !columnParams.displayedColumns['averaged'],
    },
    {
      field: 'personal',
      headerName: 'Personal',
      valueSetter: (params: any) => {setterFunction(params)},
      valueFormatter: (params: any) => {
        if (!params.value || params.value == "null" || params.value == "NULL" || params.value == 0) {
          return ""
        } else {
          return Number(params.value).toFixed(1)
        }
      },
      editable: columnParams.currentUserId == columnParams.listOwner.id,
      minWidth: 55,
      maxWidth: 80,
      cellDataType: 'number',
      filter: 'agNumberColumnFilter',
      cellEditor: 'agNumberCellEditor',
      cellEditorParams: {
        min: 1,
        max: 10,
        precision: 1,
        step: 0.1,
        showStepperButtons: true
      },
      cellClass: (params: any) => {
        if (params.value && params.value != 0)
          return "ag-score-cell ag-score-present"
        else {
          return "ag-score-cell ag-score-empty"
        }
      },
      cellStyle: function(params: any) {
        let scoreType = "Default";
        return scoreColor( {
          range: scoreRange(),
          score: params.value,
          type: scoreType
        } )
      },
      hide: !columnParams.displayedColumns['personal'],
    },
    {
      field: 'differencePersonal',
      headerName: 'Difference: Personal',
      valueSetter: (params: any) => {setterFunction(params)},
      valueGetter: (params: any) => {
        if (params.data.personal && params.data.personal != 0) {
          return (params.data.personal - ((params.data.story + params.data.character + params.data.presentation + params.data.sound + params.data.performance + params.data.enjoyment) / 6))
        } else {return ""}
      },
      valueFormatter: (params: any) => {
        if ((!params.value || params.value == "null" || params.value == "NULL" || params.value == 0) && (!params.data.personal || params.data.personal == "null" || params.data.personal == "NULL" || params.data.personal == 0)) {
          return ""
        } else {
          return differenceFormatter(params.value)
        }
      },
      minWidth: 70,
      maxWidth: 90,
      filter: 'agNumberColumnFilter',
      editable: false,
      cellClass: (params: any) => {
        if (params.value && params.value != 0)
          return "ag-score-cell ag-score-present"
        else {
          return "ag-score-cell ag-score-empty"
        }
      },
      cellStyle: function(params: any) {
        let scoreType = "Difference Personal";
        return  scoreColor( {
          range: scoreRange(scoreType),
          score: params.value,
          type: scoreType
        } )
      },
      hide: !columnParams.displayedColumns['differencePersonal'],
    },
    {
      field: 'tmdbScore',
      headerName: 'TMDB Score',
      valueSetter: (params: any) => {setterFunction(params)},
      valueFormatter: (params: any) => {
        if (!params.value || params.value == "null" || params.value == "NULL" || params.value == 0) {
          return ""
        } else {
          return Number(params.value).toFixed(1)
        }
      },
      minWidth: 55,
      maxWidth: 80,
      filter: 'agNumberColumnFilter',
      editable: false,
      cellClass: (params: any) => {
        if (params.value && params.value != 0)
          return "ag-score-border-left-double ag-score-cell ag-score-present"
        else {
          return "ag-score-border-left-double ag-score-cell ag-score-empty"
        }
      },
      cellStyle: function(params: any) {
        let scoreType = "TMDB Score";
        return  scoreColor( {
          range: scoreRange(scoreType),
          score: params.value,
          type: scoreType
        } )
      },
      hide: !columnParams.displayedColumns['tmdbScore'],
    },
    {
      field: 'malScore',
      headerName: 'MAL Score',
      valueSetter: (params: any) => {setterFunction(params)},
      valueFormatter: (params: any) => {
        if (!params.value || params.value == "null" || params.value == "NULL" || params.value == 0) {
          return ""
        } else {
          return Number(params.value).toFixed(1)
        }
      },
      minWidth: 55,
      maxWidth: 80,
      filter: 'agNumberColumnFilter',
      editable: false,
      cellClass: (params: any) => {
        if (params.value && params.value != 0)
          return "ag-score-border-left-double ag-score-cell ag-score-present"
        else {
          return "ag-score-border-left-double ag-score-cell ag-score-empty"
        }
      },
      cellStyle: function(params: any) {
        let scoreType = "MAL Score";
        return  scoreColor( {
          range: scoreRange(scoreType),
          score: params.value,
          type: scoreType
        } )
      },
      hide: !columnParams.displayedColumns['malScore'],
    },
    {
      field: 'differenceObjective',
      headerName: 'Difference: Objective',
      valueSetter: (params: any) => {setterFunction(params)},
      valueGetter: (params: any) => {
        if ((params.data.personal && params.data.personal != 0) && (params.data.tmdbScore && params.data.tmdbScore != 0)) {
          return (params.data.personal - params.data.tmdbScore)
        } 
        else if ((params.data.personal && params.data.personal != 0) && (params.data.malScore && params.data.malScore != 0)) {
          return (params.data.personal - params.data.malScore)
        } else {return ""}
      },
      valueFormatter: (params: any) => {
        if ((!params.value || params.value == "null" || params.value == "NULL" || params.value == 0) && (!params.data.tmdbScore || params.data.tmdbScore == "null" || params.data.tmdbScore == "NULL" || params.data.tmdbScore == 0)) {
          return ""
        } else {
          return differenceFormatter(params.value)
        }
      },
      minWidth: 70,
      maxWidth: 90,
      filter: 'agNumberColumnFilter',
      editable: false,
      cellClass: (params: any) => {
        if (params.value && params.value != 0)
          return "ag-score-cell ag-score-present"
        else {
          return "ag-score-cell ag-score-empty"
        }
      },
      cellStyle: function(params: any) {
        let scoreType = "Difference Objective";
        return  scoreColor( {
          range: scoreRange(scoreType),
          score: params.value,
          type: scoreType
        } )
      },
      hide: !columnParams.displayedColumns['differenceObjective'],
    },
  ]
}
