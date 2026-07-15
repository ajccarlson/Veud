// columnDefs() — assembles the watchlist grid's 37 columns from the 8 group files, in display
// order (Phase 3.2, increment 4). Extracted verbatim from $watchlist_grid.jsx.
import { positionColumn } from './position-column.tsx'
import { infoColumns } from './info-columns.tsx'
import { progressColumns } from './progress-columns.tsx'
import { ratingColumn } from './rating-column.tsx'
import { dateColumns } from './date-columns.tsx'
import { metaColumns } from './meta-columns.tsx'
import { scoreColumns } from './score-columns.tsx'
import { textColumns } from './text-columns.tsx'

export function columnDefs() {
  return [
      ...positionColumn(),


      ...infoColumns(),


      ...progressColumns(),


      ...ratingColumn(),


      ...dateColumns(),


      ...metaColumns(),


      ...scoreColumns(),


      ...textColumns()
  ]
}
