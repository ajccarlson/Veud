import { type Prisma } from '@prisma/client'
import { expect, test, vi } from 'vitest'
import { serializeUserLibraryMutation } from './watchlist-limits.ts'

function transactionWith(execute: () => Promise<number>) {
	return {
		$executeRaw: vi.fn(execute),
	} as unknown as Pick<Prisma.TransactionClient, '$executeRaw'>
}

test('acquires each owner mutex only once per transaction', async () => {
	let release = () => {}
	const held = new Promise<number>(resolve => {
		release = () => resolve(1)
	})
	const tx = transactionWith(() => held)

	const first = serializeUserLibraryMutation(tx, 'owner-a')
	const duplicate = serializeUserLibraryMutation(tx, 'owner-a')
	expect(tx.$executeRaw).toHaveBeenCalledTimes(1)

	release()
	await Promise.all([first, duplicate])
	await serializeUserLibraryMutation(tx, 'owner-a')
	expect(tx.$executeRaw).toHaveBeenCalledTimes(1)

	await serializeUserLibraryMutation(tx, 'owner-b')
	expect(tx.$executeRaw).toHaveBeenCalledTimes(2)
})

test('a failed acquisition can be retried in the same transaction', async () => {
	const failure = new Error('lock failed')
	const tx = transactionWith(
		vi
			.fn<() => Promise<number>>()
			.mockRejectedValueOnce(failure)
			.mockResolvedValueOnce(1),
	)

	await expect(serializeUserLibraryMutation(tx, 'retry-owner')).rejects.toBe(
		failure,
	)
	await expect(
		serializeUserLibraryMutation(tx, 'retry-owner'),
	).resolves.toBeUndefined()
	expect(tx.$executeRaw).toHaveBeenCalledTimes(2)
})
