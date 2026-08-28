import { beforeEach, expect, test, vi } from 'vitest'
import { mutateList } from '#app/utils/lists/mutation-client.ts'
import { setterFunction } from './grid-actions.ts'

vi.mock('#app/utils/lists/mutation-client.ts', () => ({
	getWatchlistEntries: vi.fn(),
	mutateList: vi.fn(),
}))

const mutateListMock = vi.mocked(mutateList)

beforeEach(() => {
	mutateListMock.mockReset()
	mutateListMock.mockResolvedValue(undefined)
})

test('unchanged cell edits do not mutate the entry or touch its list', async () => {
	const data = {
		id: 'entry-1',
		watchlistId: 'watchlist-1',
		title: 'Existing title',
	}

	await expect(
		setterFunction({
			column: { colId: 'title' },
			data,
			oldValue: 'Existing title',
			newValue: 'Existing title',
		}),
	).resolves.toBe(false)
	expect(data.title).toBe('Existing title')
	expect(mutateListMock).not.toHaveBeenCalled()
})

test('changed cell edits still update the entry and touch its list', async () => {
	const data = {
		id: 'entry-1',
		watchlistId: 'watchlist-1',
		title: 'Existing title',
	}

	await expect(
		setterFunction({
			column: { colId: 'title' },
			data,
			oldValue: 'Existing title',
			newValue: 'Updated title',
		}),
	).resolves.toBe(true)
	expect(data.title).toBe('Updated title')
	expect(mutateListMock).toHaveBeenNthCalledWith(1, 'update-entry-cell', {
		columnId: 'title',
		entryId: 'entry-1',
		value: 'Updated title',
	})
	expect(mutateListMock).toHaveBeenNthCalledWith(2, 'touch-watchlist', {
		watchlistId: 'watchlist-1',
	})
	expect(mutateListMock).toHaveBeenCalledTimes(2)
})
