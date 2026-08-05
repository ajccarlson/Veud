// The insertion control on a row boundary in the position column. Clicking it
// opens the same quick-add search the list header uses, and the chosen title is
// inserted into that gap instead of being appended.
//
// The dialog is loaded and mounted only after a click, the way the quick editor
// trigger is, so a list of rows costs nothing until someone actually inserts.
import { lazy, Suspense, useEffect, useState } from 'react'
import {
	boundaryInsertPosition,
	boundaryLabel,
	isManualRowOrder,
} from '#app/utils/lists/insert-boundary.ts'

const DeferredMediaSearch = lazy(() =>
	import('#app/components/search-add-watchlist-entry.tsx').then(module => ({
		default: module.MediaSearchBar,
	})),
)

/**
 * Whether the grid is currently showing rows in their stored order.
 *
 * Asked of the api the cell was handed rather than the module-level handle,
 * which is only assigned once the grid reports ready — cells render before
 * that, and reading the shared handle hid the control permanently.
 */
export function gridShowsStoredOrder(api: any) {
	try {
		return isManualRowOrder(api?.getColumnState?.() ?? null)
	} catch {
		// A grid that cannot say how it is sorted cannot promise the gap on screen
		// is the gap the entry lands in, so the control stays hidden.
		return false
	}
}

export function InsertBoundaryTrigger({
	params,
	columnParams,
	side,
}: {
	params: any
	columnParams: any
	side: 'above' | 'below'
}) {
	const [requestCount, setRequestCount] = useState(0)
	const [storedOrder, setStoredOrder] = useState(() =>
		gridShowsStoredOrder(params.api),
	)

	// Sorting is the grid's to own, so the control follows it rather than
	// keeping a copy that goes stale the moment a header is clicked.
	useEffect(() => {
		const api = params.api
		if (!api?.addEventListener) return
		const sync = () => setStoredOrder(gridShowsStoredOrder(api))
		sync()
		api.addEventListener('sortChanged', sync)
		api.addEventListener('gridReady', sync)
		return () => {
			api.removeEventListener?.('sortChanged', sync)
			api.removeEventListener?.('gridReady', sync)
		}
	}, [params.api])

	const position = boundaryInsertPosition(Number(params.value), side)
	if (position === null) return null
	if (!storedOrder) return null

	const listName =
		columnParams.typedWatchlists?.[columnParams.listTypeData.id]?.find(
			(watchlist: any) => watchlist.id === params.data.watchlistId,
		)?.header ?? 'this list'

	return (
		<>
			<button
				type="button"
				className={`ag-insert-boundary ag-insert-boundary-${side}`}
				// Hover reveals it, but it is a real button in the tab order too: a
				// control that only exists under a pointer cannot be reached at all
				// by anyone navigating with a keyboard.
				aria-label={boundaryLabel(position, listName)}
				title={`Insert at position ${position}`}
				onClick={() => setRequestCount(current => current + 1)}
			/>
			{requestCount > 0 ? (
				<Suspense
					fallback={
						<span className="sr-only" role="status">
							Loading catalog search…
						</span>
					}
				>
					<DeferredMediaSearch
						columnParams={columnParams}
						openOnMount={requestCount}
						hideTrigger
						insertPosition={position}
						insertWatchlistId={params.data.watchlistId}
					/>
				</Suspense>
			) : null}
		</>
	)
}
