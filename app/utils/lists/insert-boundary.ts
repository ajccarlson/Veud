/**
 * Inserting a new entry into the gap between two rows.
 *
 * The position column shows a control on each row boundary; choosing a title
 * there puts it in that gap rather than at the end of the list.
 *
 * Insertion is only meaningful while the grid is showing rows in their stored
 * order. Under any other sort the visible neighbours are not the stored
 * neighbours, so "between these two rows" does not describe a position anyone
 * could act on, and the control is hidden instead of guessing.
 */

export type SortedColumnState = { colId?: string; sort?: string | null }

/**
 * Whether the rows on screen are in stored-position order.
 *
 * A watchlist can be sorted two ways — a saved default, and a column the viewer
 * clicked — and both land in the grid's column state, so that is the one thing
 * worth asking. Reading the saved default alone would leave the control visible
 * under an ad-hoc sort, where it would insert into a gap the viewer cannot see.
 */
export function isManualRowOrder(columnState: SortedColumnState[] | null) {
	if (!Array.isArray(columnState)) return false
	return !columnState.some(
		column => column.sort === 'asc' || column.sort === 'desc',
	)
}

/**
 * The position a new entry takes when inserted at a boundary.
 *
 * `above` targets the gap before the row, which is the row's own position: the
 * newcomer takes it and everything from there down shifts by one. `below`
 * targets the gap after it, one further along. The boundary below the last row
 * is how a title is appended, and needs no special case.
 */
export function boundaryInsertPosition(
	rowPosition: number,
	side: 'above' | 'below',
) {
	if (!Number.isFinite(rowPosition)) return null
	const position = Math.trunc(rowPosition)
	if (position < 1) return null
	return side === 'above' ? position : position + 1
}

/**
 * Clamp a requested insertion to a position that exists.
 *
 * `entryCount + 1` is the end of the list, which is a real place to insert; the
 * server clamps the same way, and agreeing with it keeps the row from appearing
 * somewhere the viewer did not click.
 */
export function clampInsertPosition(position: number, entryCount: number) {
	if (!Number.isFinite(position) || !Number.isFinite(entryCount)) return null
	const limit = Math.max(0, Math.trunc(entryCount)) + 1
	return Math.min(Math.max(Math.trunc(position), 1), limit)
}

/**
 * Whether an insertion position still applies to the chosen destination.
 *
 * The quick-add dialog lets the viewer change which list a title goes to. A gap
 * in the list being viewed says nothing about any other list, so the position is
 * dropped and the title is appended instead of landing at an unrelated place.
 */
export function insertPositionForDestination(
	position: number | null,
	boundaryWatchlistId: string | null,
	destinationWatchlistId: string | null,
) {
	if (position === null) return null
	if (!boundaryWatchlistId || !destinationWatchlistId) return null
	return boundaryWatchlistId === destinationWatchlistId ? position : null
}

/** The label a boundary control announces, since it has no visible text. */
export function boundaryLabel(position: number, listName: string) {
	return `Insert a title at position ${position} in ${listName}`
}
