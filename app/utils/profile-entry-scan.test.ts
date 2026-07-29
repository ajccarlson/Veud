import { expect, test } from 'vitest'
import { scanProfileEntryPages } from './profile-data.server.ts'

function rows(count: number, prefix = 'entry') {
	return Array.from({ length: count }, (_, index) => ({
		id: `${prefix}-${index.toString().padStart(6, '0')}`,
	}))
}

function scannerFor(data: Record<string, Array<{ id: string }>>) {
	const takes: number[] = []
	const pageSizes: number[] = []
	return {
		takes,
		pageSizes,
		scan: (limit: number) =>
			scanProfileEntryPages({
				watchlistIds: Object.keys(data),
				limit,
				fetchPage: async (watchlistId, cursor, take) => {
					takes.push(take)
					const start = cursor
						? (data[watchlistId]?.findIndex(row => row.id === cursor) ?? -1) + 1
						: 0
					return (data[watchlistId] ?? []).slice(start, start + take)
				},
				onPage: page => {
					pageSizes.push(page.length)
				},
			}),
	}
}

test('distinguishes an exact entry ceiling from a ceiling plus one', async () => {
	const exact = scannerFor({ list: rows(1_000) })
	await expect(exact.scan(1_000)).resolves.toEqual({
		processed: 1_000,
		truncated: false,
	})
	expect(Math.max(...exact.pageSizes)).toBe(500)
	expect(Math.max(...exact.takes)).toBe(501)

	const overflow = scannerFor({ list: rows(1_001) })
	await expect(overflow.scan(1_000)).resolves.toEqual({
		processed: 1_000,
		truncated: true,
	})
	expect(Math.max(...overflow.pageSizes)).toBe(500)
})

test('probes later watchlists after reaching the ceiling', async () => {
	const exact = scannerFor({
		first: rows(500, 'first'),
		second: [],
	})
	await expect(exact.scan(500)).resolves.toEqual({
		processed: 500,
		truncated: false,
	})

	const overflow = scannerFor({
		first: rows(500, 'first'),
		second: rows(1, 'second'),
	})
	await expect(overflow.scan(500)).resolves.toEqual({
		processed: 500,
		truncated: true,
	})
})
