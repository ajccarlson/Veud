import { expect, test } from 'vitest'
import { awaitExclusiveRestoreTarget } from './postgres-backup-operations.mjs'

const busy = { otherDatabaseSessions: 1, preparedTransactions: 0 }
const prepared = { otherDatabaseSessions: 0, preparedTransactions: 1 }
const free = { otherDatabaseSessions: 0, preparedTransactions: 0 }

function reader(sequence) {
	let index = 0
	const calls = () => index
	return {
		read: async () => sequence[Math.min(index++, sequence.length - 1)],
		calls,
	}
}

test('an already exclusive target is returned without waiting', async () => {
	const { read, calls } = reader([free])
	const identity = await awaitExclusiveRestoreTarget(null, null, 'test', {
		readIdentity: read,
		waitMs: 10_000,
		pollMs: 1,
	})
	expect(identity).toEqual(free)
	expect(calls()).toBe(1)
})

test('a session that is still closing is waited out', async () => {
	// The failure this fixes: a deployment takes two backups minutes apart, and
	// the first one's session had not finished closing when the second checked.
	const { read } = reader([busy, busy, free])
	const identity = await awaitExclusiveRestoreTarget(null, null, 'test', {
		readIdentity: read,
		waitMs: 10_000,
		pollMs: 1,
	})
	expect(identity).toEqual(free)
})

test('a prepared transaction is waited out too', async () => {
	const { read } = reader([prepared, free])
	const identity = await awaitExclusiveRestoreTarget(null, null, 'test', {
		readIdentity: read,
		waitMs: 10_000,
		pollMs: 1,
	})
	expect(identity).toEqual(free)
})

test('waiting is bounded, and a target that never frees is still reported busy', async () => {
	// The caller asserts exclusivity afterwards, so a destructive restore must
	// never proceed just because the wait expired.
	const { read } = reader([busy])
	let now = 0
	const identity = await awaitExclusiveRestoreTarget(null, null, 'test', {
		readIdentity: read,
		waitMs: 50,
		pollMs: 1,
		now: () => (now += 30),
	})
	expect(identity).toEqual(busy)
})

test('an aborted run stops waiting', async () => {
	const controller = new AbortController()
	controller.abort()
	const { read } = reader([busy, free])
	await expect(
		awaitExclusiveRestoreTarget(null, null, 'test', {
			readIdentity: read,
			waitMs: 10_000,
			pollMs: 1,
			signal: controller.signal,
		}),
	).rejects.toThrow()
})
