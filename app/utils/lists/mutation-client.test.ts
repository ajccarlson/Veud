import { afterEach, expect, test, vi } from 'vitest'
import {
	getWatchlistEntries,
	ListMutationClientError,
} from './mutation-client.ts'

afterEach(() => {
	vi.unstubAllGlobals()
})

function page(
	entries: unknown[],
	pagination: { nextCursor: string | null; revision: number },
) {
	return Response.json({ ok: true, data: entries, pagination })
}

test('watchlist entries assemble every bounded revision-pinned page', async () => {
	const fetchMock = vi
		.fn()
		.mockResolvedValueOnce(
			page([{ id: 'entry-1' }], { nextCursor: 'entry-1', revision: 7 }),
		)
		.mockResolvedValueOnce(
			page([{ id: 'entry-2' }], { nextCursor: null, revision: 7 }),
		)
	vi.stubGlobal('fetch', fetchMock)

	await expect(getWatchlistEntries('watchlist-1')).resolves.toEqual([
		{ id: 'entry-1' },
		{ id: 'entry-2' },
	])
	expect(fetchMock).toHaveBeenCalledTimes(2)
	const first = new URL(
		String(fetchMock.mock.calls[0]?.[0]),
		'https://example.com',
	)
	const second = new URL(
		String(fetchMock.mock.calls[1]?.[0]),
		'https://example.com',
	)
	expect(Object.fromEntries(first.searchParams)).toEqual({
		watchlistId: 'watchlist-1',
		take: '250',
	})
	expect(Object.fromEntries(second.searchParams)).toEqual({
		watchlistId: 'watchlist-1',
		take: '250',
		cursor: 'entry-1',
		revision: '7',
	})
})

test('watchlist entry collection restarts once after a revision conflict', async () => {
	const fetchMock = vi
		.fn()
		.mockResolvedValueOnce(
			page([{ id: 'stale-entry' }], {
				nextCursor: 'stale-entry',
				revision: 1,
			}),
		)
		.mockResolvedValueOnce(
			Response.json(
				{
					ok: false,
					error: { code: 'CONFLICT', message: 'List changed' },
				},
				{ status: 409 },
			),
		)
		.mockResolvedValueOnce(
			page([{ id: 'fresh-entry' }], { nextCursor: null, revision: 2 }),
		)
	vi.stubGlobal('fetch', fetchMock)

	await expect(getWatchlistEntries('watchlist-1')).resolves.toEqual([
		{ id: 'fresh-entry' },
	])
	expect(fetchMock).toHaveBeenCalledTimes(3)
	const restarted = new URL(
		String(fetchMock.mock.calls[2]?.[0]),
		'https://example.com',
	)
	expect(Object.fromEntries(restarted.searchParams)).toEqual({
		watchlistId: 'watchlist-1',
		take: '250',
	})
})

test('watchlist entry collection restarts when a page changes revision', async () => {
	const fetchMock = vi
		.fn()
		.mockResolvedValueOnce(
			page([{ id: 'stale-entry' }], {
				nextCursor: 'stale-entry',
				revision: 1,
			}),
		)
		.mockResolvedValueOnce(
			page([{ id: 'mixed-entry' }], { nextCursor: null, revision: 2 }),
		)
		.mockResolvedValueOnce(
			page([{ id: 'fresh-entry' }], { nextCursor: null, revision: 2 }),
		)
	vi.stubGlobal('fetch', fetchMock)

	await expect(getWatchlistEntries('watchlist-1')).resolves.toEqual([
		{ id: 'fresh-entry' },
	])
	expect(fetchMock).toHaveBeenCalledTimes(3)
	const restarted = new URL(
		String(fetchMock.mock.calls[2]?.[0]),
		'https://example.com',
	)
	expect(Object.fromEntries(restarted.searchParams)).toEqual({
		watchlistId: 'watchlist-1',
		take: '250',
	})
})

test('watchlist entry collection rejects a repeated cursor', async () => {
	const fetchMock = vi
		.fn()
		.mockResolvedValueOnce(
			page([{ id: 'entry-1' }], { nextCursor: 'entry-1', revision: 1 }),
		)
		.mockResolvedValueOnce(
			page([{ id: 'entry-2' }], { nextCursor: 'entry-1', revision: 1 }),
		)
	vi.stubGlobal('fetch', fetchMock)

	const error = await getWatchlistEntries('watchlist-1').catch(
		(caught: unknown) => caught,
	)
	expect(error).toBeInstanceOf(ListMutationClientError)
	expect(error).toMatchObject({ code: 'INVALID_RESPONSE' })
})
