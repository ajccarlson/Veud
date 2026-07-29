export const PROFILE_ACTIVITY_MAX_CAPACITY = 100
export const PROFILE_ACTIVITY_ACTION_LENGTH_LIMIT = 160
export const PROFILE_ACTIVITY_TITLE_LENGTH_LIMIT = 300
export const PROFILE_ACTIVITY_THUMBNAIL_BYTE_LIMIT = 2_048
export const PROFILE_ACTIVITY_RESPONSE_BYTE_LIMIT = 64 * 1024
// Reserve space for the loader's object envelope and truncation diagnostic.
export const PROFILE_ACTIVITY_BYTE_LIMIT =
	PROFILE_ACTIVITY_RESPONSE_BYTE_LIMIT - 4 * 1024

export type ProfileActivityCollectorItem = {
	id: string
	action: string
	time: Date | string
	typeId: string | null
	media: {
		id: string
		title: string
		thumbnail: string | null
	}
}

type DeepReadonly<Value> = Value extends Date
	? Readonly<Date>
	: Value extends readonly (infer Item)[]
		? readonly DeepReadonly<Item>[]
		: Value extends object
			? { readonly [Key in keyof Value]: DeepReadonly<Value[Key]> }
			: Value

type RankedActivity<Item extends ProfileActivityCollectorItem> = {
	item: DeepReadonly<Item>
	timestamp: number
	serialized: string
	serializedBytes: number
}

export type ProfileActivityCollector<
	Item extends ProfileActivityCollectorItem,
> = Readonly<{
	capacity: number
	byteLimit: number
	byteSize: number
	size: number
	truncated: boolean
	addBatch: (items: readonly Item[]) => void
	values: () => readonly DeepReadonly<Item>[]
}>

function deepFreeze<Value>(value: Value, seen = new WeakSet<object>()): Value {
	if (value === null || typeof value !== 'object') return value
	if (seen.has(value)) return value
	seen.add(value)

	for (const child of Object.values(value)) {
		deepFreeze(child, seen)
	}

	return Object.freeze(value)
}

function cloneAndFreeze<Item extends ProfileActivityCollectorItem>(item: Item) {
	return deepFreeze(structuredClone(item)) as DeepReadonly<Item>
}

function activityTimestamp(item: ProfileActivityCollectorItem) {
	if (!(item.time instanceof Date) && typeof item.time !== 'string') {
		throw new TypeError(`Profile activity ${item.id} has an invalid time.`)
	}

	const timestamp =
		item.time instanceof Date
			? item.time.getTime()
			: item.time.trim() && item.time.trim() !== '0'
				? Date.parse(item.time.trim())
				: Number.NaN
	if (!Number.isFinite(timestamp) || timestamp === 0) {
		throw new TypeError(`Profile activity ${item.id} has an invalid time.`)
	}
	return timestamp
}

function validateActivityItem(item: ProfileActivityCollectorItem) {
	if (
		typeof item.id !== 'string' ||
		typeof item.action !== 'string' ||
		(item.typeId !== null && typeof item.typeId !== 'string') ||
		!item.media ||
		typeof item.media !== 'object' ||
		typeof item.media.id !== 'string' ||
		typeof item.media.title !== 'string' ||
		(item.media.thumbnail !== null && typeof item.media.thumbnail !== 'string')
	) {
		throw new TypeError('Profile activity has an invalid row shape.')
	}
	activityTimestamp(item)
}

function utf8ByteLength(value: string) {
	return new TextEncoder().encode(value).byteLength
}

function truncateText(value: string, limit: number) {
	const characters = Array.from(value)
	if (characters.length <= limit) return { value, truncated: false }
	return {
		value: `${characters.slice(0, limit - 1).join('')}…`,
		truncated: true,
	}
}

function normalizeActivityItem<Item extends ProfileActivityCollectorItem>(
	item: Item,
) {
	const action = truncateText(item.action, PROFILE_ACTIVITY_ACTION_LENGTH_LIMIT)
	const title = truncateText(
		item.media.title,
		PROFILE_ACTIVITY_TITLE_LENGTH_LIMIT,
	)
	const thumbnailOverLimit =
		item.media.thumbnail !== null &&
		utf8ByteLength(item.media.thumbnail) > PROFILE_ACTIVITY_THUMBNAIL_BYTE_LIMIT
	const normalized = {
		...item,
		action: action.value,
		media: {
			...item.media,
			title: title.value,
			thumbnail: thumbnailOverLimit ? null : item.media.thumbnail,
		},
	} as Item

	return {
		item: normalized,
		truncated: action.truncated || title.truncated || thumbnailOverLimit,
	}
}

function compareActivity<Item extends ProfileActivityCollectorItem>(
	left: RankedActivity<Item>,
	right: RankedActivity<Item>,
) {
	return (
		right.timestamp - left.timestamp ||
		right.item.id.localeCompare(left.item.id) ||
		left.item.action.localeCompare(right.item.action) ||
		left.item.media.id.localeCompare(right.item.media.id) ||
		left.item.media.title.localeCompare(right.item.media.title) ||
		(left.item.media.thumbnail ?? '').localeCompare(
			right.item.media.thumbnail ?? '',
		) ||
		(left.item.typeId ?? '').localeCompare(right.item.typeId ?? '') ||
		left.serialized.localeCompare(right.serialized)
	)
}

function validateCapacity(capacity: number) {
	if (
		!Number.isInteger(capacity) ||
		capacity < 0 ||
		capacity > PROFILE_ACTIVITY_MAX_CAPACITY
	) {
		throw new RangeError(
			`Profile activity capacity must be an integer between 0 and ${PROFILE_ACTIVITY_MAX_CAPACITY}.`,
		)
	}
	return capacity
}

/**
 * Keeps only the newest profile activity rows while legacy history is scanned
 * in pages. Timestamp, id, and normalized row fields provide deterministic
 * ordering; fully identical rows retain their stable insertion order.
 */
export function createProfileActivityCollector<
	Item extends ProfileActivityCollectorItem,
>(capacity = PROFILE_ACTIVITY_MAX_CAPACITY): ProfileActivityCollector<Item> {
	const boundedCapacity = validateCapacity(capacity)
	const ranked: RankedActivity<Item>[] = []
	let truncated = false
	let byteSize = 2

	function insert(candidate: RankedActivity<Item>) {
		if (boundedCapacity === 0) {
			truncated = true
			return
		}
		if (candidate.serializedBytes + 2 > PROFILE_ACTIVITY_BYTE_LIMIT) {
			truncated = true
			return
		}

		let index = 0
		while (
			index < ranked.length &&
			compareActivity(candidate, ranked[index]!) >= 0
		) {
			index++
		}
		const previousLength = ranked.length
		ranked.splice(index, 0, candidate)
		byteSize += candidate.serializedBytes + (previousLength > 0 ? 1 : 0)

		while (
			ranked.length > boundedCapacity ||
			byteSize > PROFILE_ACTIVITY_BYTE_LIMIT
		) {
			const removed = ranked.pop()
			if (!removed) break
			byteSize -= removed.serializedBytes + (ranked.length > 0 ? 1 : 0)
			truncated = true
		}
	}

	function addBatch(items: readonly Item[]) {
		// Validate the complete batch before changing collector state. This keeps
		// invalid input rejection transactional without retaining a page copy.
		try {
			for (const item of items) validateActivityItem(item)
		} catch (error) {
			truncated = true
			throw error
		}

		for (const item of items) {
			const normalized = normalizeActivityItem(item)
			if (normalized.truncated) truncated = true
			let serialized: string
			try {
				serialized = JSON.stringify(normalized.item)
				if (typeof serialized !== 'string') throw new TypeError()
			} catch {
				truncated = true
				continue
			}
			const serializedBytes = utf8ByteLength(serialized)
			if (serializedBytes + 2 > PROFILE_ACTIVITY_BYTE_LIMIT) {
				truncated = true
				continue
			}
			let frozen: DeepReadonly<Item>
			try {
				frozen = cloneAndFreeze(normalized.item)
			} catch {
				truncated = true
				continue
			}
			insert({
				item: frozen,
				timestamp: activityTimestamp(item),
				serialized,
				serializedBytes,
			})
		}
	}

	function values() {
		return Object.freeze(
			ranked.map(candidate => cloneAndFreeze(candidate.item as Item)),
		)
	}

	return Object.freeze({
		capacity: boundedCapacity,
		byteLimit: PROFILE_ACTIVITY_BYTE_LIMIT,
		get byteSize() {
			return byteSize
		},
		get size() {
			return ranked.length
		},
		get truncated() {
			return truncated
		},
		addBatch,
		values,
	})
}
