// Date columns for the watchlist grid (started / finished / added / lastUpdated), extracted
// from $watchlist_grid.jsx's columnDefs() (Phase 3.2, increment 3). Returned in original
// source order; spread back into columnDefs() in place.
import { columnParams } from './grid-state.ts'
import { setterFunction, reformatHistory } from './grid-actions.ts'
import { dateFormatter, timeSince } from '#app/utils/lists/column-functions.tsx'

export function dateColumns() {
  return [
    {
      field: 'started',
      headerName: 'Start Date',
      valueGetter: (params: any) => {
        try {
          return (JSON.parse(params.data.history) as any).started
        }
        catch(e) {
          try {
            const parsedDate = Date.parse(params.data.history)

            reformatHistory(params, params.data.history).then((val: any) => {
            }).catch((e: any) => {
            })

            return parsedDate
          }
          catch(e) {}
        }
      },
      valueSetter: (params: any) => {setterFunction(params)},
      valueFormatter: (params: any) => dateFormatter(params.value),
      editable: columnParams.currentUserId == columnParams.listOwner.id,
      minWidth: 85,
      maxWidth: 120,
      cellDataType: 'date',
      filter: "agDateColumnFilter",
      hide: !columnParams.displayedColumns['startDate'],
    },


    {
      field: 'finished',
      headerName: 'Finished Date',
      valueGetter: (params: any) => {
        try {
          return (JSON.parse(params.data.history) as any).finished
        }
        catch(e) {
          try {
            const parsedDate = Date.parse(params.data.history)

            reformatHistory(params, params.data.history).then((val: any) => {
            }).catch((e: any) => {
            })

            return parsedDate
          }
          catch(e) {}
        }
      },
      valueSetter: (params: any) => {setterFunction(params)},
      valueFormatter: (params: any) => dateFormatter(params.value),
      editable: columnParams.currentUserId == columnParams.listOwner.id,
      minWidth: 85,
      maxWidth: 120,
      cellDataType: 'date',
      filter: "agDateColumnFilter",
      hide: !columnParams.displayedColumns['finishedDate'],
    },


    {
      field: 'added',
      headerName: 'Date Added',
      valueGetter: (params: any) => {
        try {
          return (JSON.parse(params.data.history) as any).added
        }
        catch(e) {
          try {
            const parsedDate = Date.parse(params.data.history)

            reformatHistory(params, params.data.history).then((val: any) => {
            }).catch((e: any) => {
            })

            return parsedDate
          }
          catch(e) {}
        }
      },
      valueSetter: (params: any) => {setterFunction(params)},
      valueFormatter: (params: any) => dateFormatter(params.value),
      minWidth: 85,
      maxWidth: 120,
      cellDataType: 'date',
      filter: "agDateColumnFilter",
      hide: !columnParams.displayedColumns['dateAdded'],
    },


    {
      field: 'lastUpdated',
      headerName: 'Last Updated',
      valueGetter: (params: any) => {
        try {
          return (JSON.parse(params.data.history) as any).lastUpdated
        }
        catch(e) {
          try {
            const parsedDate = Date.parse(params.data.history)

            reformatHistory(params, params.data.history).then((val: any) => {
            }).catch((e: any) => {
            })

            return parsedDate
          }
          catch(e) {}
        }
      },
      valueSetter: (params: any) => {setterFunction(params)},
      valueFormatter: (params: any) => timeSince(params.value),
      minWidth: 85,
      maxWidth: 120,
      cellDataType: 'date',
      filter: "agDateColumnFilter",
      hide: !columnParams.displayedColumns['lastUpdated'],
    },
  ]
}
