import { expect, test } from 'vitest'
import {
	boundaryInsertPosition,
	boundaryLabel,
	clampInsertPosition,
	insertPositionForDestination,
	isManualRowOrder,
} from './insert-boundary.ts'

test('rows are in stored order only when nothing is sorted', () => {
	expect(isManualRowOrder([])).toBe(true)
	expect(isManualRowOrder([{ colId: 'title', sort: null }])).toBe(true)
	expect(isManualRowOrder([{ colId: 'title', sort: 'asc' }])).toBe(false)
	expect(isManualRowOrder([{ colId: 'title', sort: 'desc' }])).toBe(false)
	expect(
		isManualRowOrder([
			{ colId: 'position', sort: null },
			{ colId: 'score', sort: 'desc' },
		]),
	).toBe(false)
})

test('an unreadable column state is treated as sorted, not as manual', () => {
	// Guessing "manual" here would show the control in a view where the gap the
	// viewer clicked is not the gap the entry lands in.
	expect(isManualRowOrder(null)).toBe(false)
	expect(isManualRowOrder(undefined as never)).toBe(false)
})

test('the boundary above a row takes that row position', () => {
	expect(boundaryInsertPosition(1, 'above')).toBe(1)
	expect(boundaryInsertPosition(7, 'above')).toBe(7)
})

test('the boundary below a row takes the next position', () => {
	expect(boundaryInsertPosition(1, 'below')).toBe(2)
	expect(boundaryInsertPosition(7, 'below')).toBe(8)
})

test('the ends of the list are ordinary boundaries', () => {
	// Above the first row and below the last are where off-by-one errors live.
	expect(boundaryInsertPosition(1, 'above')).toBe(1)
	expect(boundaryInsertPosition(12, 'below')).toBe(13)
	expect(clampInsertPosition(13, 12)).toBe(13)
	expect(clampInsertPosition(1, 12)).toBe(1)
})

test('a position that could not exist is refused', () => {
	expect(boundaryInsertPosition(0, 'above')).toBeNull()
	expect(boundaryInsertPosition(-4, 'below')).toBeNull()
	expect(boundaryInsertPosition(Number.NaN, 'above')).toBeNull()
	expect(boundaryInsertPosition(Number.POSITIVE_INFINITY, 'above')).toBeNull()
})

test('a fractional row position is truncated rather than carried through', () => {
	expect(boundaryInsertPosition(3.7, 'above')).toBe(3)
	expect(boundaryInsertPosition(3.7, 'below')).toBe(4)
})

test('clamping agrees with the server: one past the end is allowed, further is not', () => {
	expect(clampInsertPosition(99, 12)).toBe(13)
	expect(clampInsertPosition(0, 12)).toBe(1)
	expect(clampInsertPosition(-5, 12)).toBe(1)
	expect(clampInsertPosition(1, 0)).toBe(1)
	expect(clampInsertPosition(4, 0)).toBe(1)
	expect(clampInsertPosition(2, Number.NaN)).toBeNull()
	expect(clampInsertPosition(Number.NaN, 2)).toBeNull()
})

test('a position is dropped when the title is sent to a different list', () => {
	expect(insertPositionForDestination(3, 'list-a', 'list-a')).toBe(3)
	expect(insertPositionForDestination(3, 'list-a', 'list-b')).toBeNull()
	expect(insertPositionForDestination(null, 'list-a', 'list-a')).toBeNull()
	expect(insertPositionForDestination(3, null, 'list-a')).toBeNull()
	expect(insertPositionForDestination(3, 'list-a', null)).toBeNull()
})

test('a boundary control says where it inserts, since it shows no text', () => {
	expect(boundaryLabel(4, 'Watching')).toBe(
		'Insert a title at position 4 in Watching',
	)
})
