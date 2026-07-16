// Rating column for the watchlist grid (a single content-rating column that sits between
// the progress columns and the date columns in source order). Kept as its own small file
// rather than folded into a group it doesn't semantically belong to. Phase 3.2, increment 3.
import { columnParams } from './grid-state.ts'
import { setterFunction } from './grid-actions.ts'

export function ratingColumn() {
  return [
    {
      field: 'rating',
      headerName: 'Rating',
      valueSetter: (params: any) => {setterFunction(params)},
      minWidth: 80,
      maxWidth: 90,
      filter: "agSetColumnFilter",
      hide: !columnParams.displayedColumns['rating'],
    },
  ]
}
