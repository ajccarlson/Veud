import { expect, test } from 'vitest'
import {
	parseBoundedProfileHistory,
	profileHistoryTimestamp,
	PROFILE_HISTORY_CODE_UNIT_LIMIT,
	PROFILE_HISTORY_DEPTH_LIMIT,
	PROFILE_HISTORY_EVENT_LIMIT,
	PROFILE_HISTORY_NODE_LIMIT,
} from './profile-history-bounds.ts'

function nestedHistory(depth: number) {
	const root: Record<string, unknown> = {}
	let cursor = root
	for (let index = 0; index < depth; index += 1) {
		const child: Record<string, unknown> = {}
		cursor.next = child
		cursor = child
	}
	return root
}

test('parses a detached JSON-compatible history object', () => {
	const source = {
		finished: '2026-01-01T00:00:00.000Z',
		progress: { 1: { finishDate: ['2026-01-01T00:00:00.000Z'] } },
	}
	const result = parseBoundedProfileHistory(source)

	expect(result).toEqual({
		history: source,
		rejected: false,
		reason: null,
		nodeCount: 6,
		finishEventsTruncated: false,
	})
	expect(result.history).not.toBe(source)
	expect(result.history?.progress).not.toBe(source.progress)
})

test('rejects oversized strings before JSON decoding', () => {
	const input = `{"value":"${'x'.repeat(PROFILE_HISTORY_CODE_UNIT_LIMIT)}"}`
	expect(parseBoundedProfileHistory(input)).toEqual({
		history: null,
		rejected: true,
		reason: 'code-unit-limit',
		nodeCount: 0,
		finishEventsTruncated: false,
	})
})

test('accepts the depth boundary and rejects the next nested container', () => {
	expect(
		parseBoundedProfileHistory(nestedHistory(PROFILE_HISTORY_DEPTH_LIMIT))
			.rejected,
	).toBe(false)
	expect(
		parseBoundedProfileHistory(nestedHistory(PROFILE_HISTORY_DEPTH_LIMIT + 1)),
	).toEqual(
		expect.objectContaining({
			history: null,
			rejected: true,
			reason: 'depth-limit',
		}),
	)
})

test('accepts exactly the decoded-node ceiling and rejects one more node', () => {
	const accepted = {
		values: Array.from({ length: PROFILE_HISTORY_NODE_LIMIT - 2 }, () => null),
	}
	const rejected = { values: [...accepted.values, null] }

	expect(parseBoundedProfileHistory(accepted)).toEqual(
		expect.objectContaining({
			rejected: false,
			nodeCount: PROFILE_HISTORY_NODE_LIMIT,
		}),
	)
	expect(parseBoundedProfileHistory(rejected)).toEqual(
		expect.objectContaining({
			rejected: true,
			reason: 'node-limit',
		}),
	)
})

test('rejects cyclic, invalid, and non-record histories safely', () => {
	const cyclic: Record<string, unknown> = {}
	cyclic.self = cyclic

	expect(parseBoundedProfileHistory(cyclic).reason).toBe('cycle')
	expect(parseBoundedProfileHistory('{invalid').reason).toBe('invalid-json')
	expect(parseBoundedProfileHistory('[]').reason).toBe('invalid-root')
	expect(parseBoundedProfileHistory({ value: BigInt(1) }).reason).toBe(
		'invalid-structure',
	)
})

test('copies special JSON keys without changing object prototypes', () => {
	const result = parseBoundedProfileHistory(
		'{"__proto__":{"polluted":true},"constructor":"stored"}',
	)

	expect(result.rejected).toBe(false)
	expect(Object.getPrototypeOf(result.history)).toBe(Object.prototype)
	expect(
		Object.prototype.hasOwnProperty.call(result.history, '__proto__'),
	).toBe(true)
	expect((result.history?.__proto__ as { polluted?: boolean }).polluted).toBe(
		true,
	)
	expect(({} as { polluted?: boolean }).polluted).toBeUndefined()
})

test('caps finish timestamps across arrays to the newest valid values', () => {
	const timestamps = Array.from(
		{ length: PROFILE_HISTORY_EVENT_LIMIT + 1 },
		(_, index) => new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
	)
	const result = parseBoundedProfileHistory({
		progress: {
			episode: {
				1: {
					finishDate: [false, [], {}, 0, 'invalid', ...timestamps],
				},
			},
		},
	})
	const history = result.history as {
		progress: { episode: { 1: { finishDate: unknown[] } } }
	}

	expect(result.rejected).toBe(false)
	expect(result.finishEventsTruncated).toBe(true)
	expect(history.progress.episode[1].finishDate).toHaveLength(
		PROFILE_HISTORY_EVENT_LIMIT + 5,
	)
	expect(history.progress.episode[1].finishDate).not.toContain(timestamps[0])
	expect(history.progress.episode[1].finishDate).toContain(timestamps.at(-1))
	expect(history.progress.episode[1].finishDate.slice(0, 5)).toEqual([
		false,
		[],
		{},
		0,
		'invalid',
	])
})

test('does not duplicate long ancestor keys for every finish candidate', () => {
	const ancestor = 'ancestor'.repeat(8_000)
	const timestamps = Array.from(
		{ length: PROFILE_HISTORY_EVENT_LIMIT + 1 },
		(_, index) => index + 1,
	)
	const result = parseBoundedProfileHistory({
		progress: {
			[ancestor]: { finishDate: timestamps },
		},
	})
	const history = result.history as {
		progress: Record<string, { finishDate: number[] }>
	}

	expect(result.rejected).toBe(false)
	expect(result.finishEventsTruncated).toBe(true)
	expect(history.progress[ancestor]?.finishDate).toHaveLength(
		PROFILE_HISTORY_EVENT_LIMIT,
	)
	expect(history.progress[ancestor]?.finishDate[0]).toBe(2)
	expect(history.progress[ancestor]?.finishDate.at(-1)).toBe(
		PROFILE_HISTORY_EVENT_LIMIT + 1,
	)
})

test('recognizes only explicit nonzero scalar history dates', () => {
	const epoch = '1970-01-01T00:00:00.001Z'
	expect(profileHistoryTimestamp(epoch)).toBe(1)
	expect(profileHistoryTimestamp(1)).toBe(1)
	expect(profileHistoryTimestamp(new Date(epoch))).toBe(1)

	for (const value of [
		true,
		false,
		[],
		[epoch],
		{},
		{ valueOf: () => 1 },
		1e100,
		-1e100,
		0,
		'0',
		' ',
		'invalid',
	]) {
		expect(profileHistoryTimestamp(value)).toBeNull()
	}
})
