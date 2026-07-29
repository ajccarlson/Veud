export const PROFILE_HISTORY_CODE_UNIT_LIMIT = 512 * 1024
export const PROFILE_HISTORY_DEPTH_LIMIT = 32
export const PROFILE_HISTORY_NODE_LIMIT = 20_000
export const PROFILE_HISTORY_EVENT_LIMIT = 10_000

export type ProfileHistoryRejectReason =
	| 'invalid-json'
	| 'invalid-root'
	| 'invalid-structure'
	| 'code-unit-limit'
	| 'depth-limit'
	| 'node-limit'
	| 'cycle'

export type BoundedProfileHistoryResult = {
	history: Record<string, unknown> | null
	rejected: boolean
	reason: ProfileHistoryRejectReason | null
	nodeCount: number
	finishEventsTruncated: boolean
}

type Container = Record<string, unknown> | unknown[]

type CloneFrame = {
	source: Container
	target: Container
	depth: number
	finishDateArray: boolean
}

type FinishTimestampCandidate = {
	array: unknown[]
	index: number
	timestamp: number
	ordinal: number
}

function rejected(
	reason: ProfileHistoryRejectReason,
	nodeCount = 0,
	finishEventsTruncated = false,
): BoundedProfileHistoryResult {
	return {
		history: null,
		rejected: true,
		reason,
		nodeCount,
		finishEventsTruncated,
	}
}

function isPlainObject(value: object) {
	const prototype = Object.getPrototypeOf(value)
	return prototype === Object.prototype || prototype === null
}

function isContainer(value: unknown): value is Container {
	return (
		value !== null &&
		typeof value === 'object' &&
		(Array.isArray(value) || isPlainObject(value))
	)
}

function setCloneValue(target: Container, key: string, value: unknown) {
	Object.defineProperty(target, key, {
		value,
		writable: true,
		enumerable: true,
		configurable: true,
	})
}

function arrayIndex(key: string) {
	const index = Number(key)
	return Number.isInteger(index) &&
		index >= 0 &&
		index < 4_294_967_295 &&
		String(index) === key
		? index
		: null
}

/**
 * Converts only explicit scalar date values used by legacy history. JavaScript
 * also accepts values such as false, [], {}, and numeric zero as dates; those
 * coercions are not stored history events and must not consume event budgets.
 */
export function profileHistoryTimestamp(value: unknown) {
	let timestamp: number
	if (value instanceof Date) {
		timestamp = value.getTime()
	} else if (typeof value === 'number') {
		if (!Number.isFinite(value) || value === 0) return null
		timestamp = value
	} else if (typeof value === 'string') {
		const normalized = value.trim()
		if (!normalized || normalized === '0') return null
		timestamp = Date.parse(normalized)
	} else {
		return null
	}

	if (!Number.isFinite(timestamp) || timestamp === 0) return null
	const clippedTimestamp = new Date(timestamp).getTime()
	return Number.isFinite(clippedTimestamp) && clippedTimestamp !== 0
		? clippedTimestamp
		: null
}

function pruneOldFinishTimestamps(
	candidates: FinishTimestampCandidate[],
): boolean {
	if (candidates.length <= PROFILE_HISTORY_EVENT_LIMIT) return false

	const retained = new Set(
		[...candidates]
			.sort(
				(left, right) =>
					right.timestamp - left.timestamp || left.ordinal - right.ordinal,
			)
			.slice(0, PROFILE_HISTORY_EVENT_LIMIT),
	)
	const removedByArray = new Map<unknown[], Set<number>>()
	for (const candidate of candidates) {
		if (retained.has(candidate)) continue
		const removed = removedByArray.get(candidate.array) ?? new Set<number>()
		removed.add(candidate.index)
		removedByArray.set(candidate.array, removed)
	}

	for (const [array, removed] of removedByArray) {
		const originalLength = array.length
		let writeIndex = 0
		for (let readIndex = 0; readIndex < originalLength; readIndex += 1) {
			if (removed.has(readIndex)) continue
			if (Object.prototype.hasOwnProperty.call(array, readIndex)) {
				if (writeIndex !== readIndex) {
					Object.defineProperty(array, writeIndex, {
						value: array[readIndex],
						writable: true,
						enumerable: true,
						configurable: true,
					})
				}
			} else if (Object.prototype.hasOwnProperty.call(array, writeIndex)) {
				delete array[writeIndex]
			}
			writeIndex += 1
		}
		for (let index = writeIndex; index < originalLength; index += 1) {
			delete array[index]
		}
		array.length = writeIndex
	}

	return true
}

/**
 * Parses and clones legacy Entry history without allowing one row to create an
 * unbounded traversal. The returned value contains only JSON-compatible data,
 * is detached from object inputs, and has all finishDate arrays capped across
 * the whole entry.
 */
export function parseBoundedProfileHistory(
	input: unknown,
): BoundedProfileHistoryResult {
	if (
		input === null ||
		input === undefined ||
		input === '' ||
		input === 'null'
	) {
		return {
			history: null,
			rejected: false,
			reason: null,
			nodeCount: 0,
			finishEventsTruncated: false,
		}
	}

	let decoded: unknown = input
	if (typeof input === 'string') {
		if (input.length > PROFILE_HISTORY_CODE_UNIT_LIMIT) {
			return rejected('code-unit-limit')
		}
		try {
			decoded = JSON.parse(input)
		} catch {
			return rejected('invalid-json')
		}
	}

	if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
		return rejected('invalid-root')
	}

	try {
		if (!isPlainObject(decoded)) return rejected('invalid-root')

		const clone: Record<string, unknown> = {}
		const seen = new WeakSet<object>([decoded])
		const frames: CloneFrame[] = [
			{
				source: decoded as Record<string, unknown>,
				target: clone,
				depth: 0,
				finishDateArray: false,
			},
		]
		let nodeCount = 1
		let codeUnits = 0
		const finishTimestampCandidates: FinishTimestampCandidate[] = []
		let finishTimestampOrdinal = 0

		while (frames.length) {
			const frame = frames.pop()
			if (!frame) break

			for (const key in frame.source) {
				if (!Object.prototype.hasOwnProperty.call(frame.source, key)) continue

				codeUnits += key.length
				if (codeUnits > PROFILE_HISTORY_CODE_UNIT_LIMIT) {
					return rejected('code-unit-limit', nodeCount)
				}

				const value = (frame.source as Record<string, unknown>)[key]
				nodeCount += 1
				if (nodeCount > PROFILE_HISTORY_NODE_LIMIT) {
					return rejected('node-limit', nodeCount)
				}

				if (value === null || typeof value === 'boolean') {
					setCloneValue(frame.target, key, value)
					continue
				}
				if (typeof value === 'string') {
					codeUnits += value.length
					if (codeUnits > PROFILE_HISTORY_CODE_UNIT_LIMIT) {
						return rejected('code-unit-limit', nodeCount)
					}
					setCloneValue(frame.target, key, value)
					const finishArray =
						frame.finishDateArray && Array.isArray(frame.target)
							? frame.target
							: null
					const index = finishArray === null ? null : arrayIndex(key)
					const timestamp =
						index === null ? null : profileHistoryTimestamp(value)
					if (finishArray !== null && index !== null && timestamp !== null) {
						finishTimestampCandidates.push({
							array: finishArray,
							index,
							timestamp,
							ordinal: finishTimestampOrdinal++,
						})
					}
					continue
				}
				if (typeof value === 'number' && Number.isFinite(value)) {
					setCloneValue(frame.target, key, value)
					const finishArray =
						frame.finishDateArray && Array.isArray(frame.target)
							? frame.target
							: null
					const index = finishArray === null ? null : arrayIndex(key)
					const timestamp =
						index === null ? null : profileHistoryTimestamp(value)
					if (finishArray !== null && index !== null && timestamp !== null) {
						finishTimestampCandidates.push({
							array: finishArray,
							index,
							timestamp,
							ordinal: finishTimestampOrdinal++,
						})
					}
					continue
				}
				if (!isContainer(value)) {
					return rejected('invalid-structure', nodeCount)
				}
				if (seen.has(value)) {
					return rejected('cycle', nodeCount)
				}
				if (frame.depth >= PROFILE_HISTORY_DEPTH_LIMIT) {
					return rejected('depth-limit', nodeCount)
				}
				if (Array.isArray(value) && value.length > PROFILE_HISTORY_NODE_LIMIT) {
					return rejected('node-limit', nodeCount)
				}

				seen.add(value)
				const child: Container = Array.isArray(value) ? [] : {}
				setCloneValue(frame.target, key, child)
				frames.push({
					source: value,
					target: child,
					depth: frame.depth + 1,
					finishDateArray: Array.isArray(value) && key === 'finishDate',
				})
			}
		}

		const finishEventsTruncated = pruneOldFinishTimestamps(
			finishTimestampCandidates,
		)
		return {
			history: clone,
			rejected: false,
			reason: null,
			nodeCount,
			finishEventsTruncated,
		}
	} catch {
		return rejected('invalid-structure')
	}
}
