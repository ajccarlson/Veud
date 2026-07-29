import { describe, expect, test } from 'vitest'
import {
	createProfileActivityCollector,
	PROFILE_ACTIVITY_ACTION_LENGTH_LIMIT,
	PROFILE_ACTIVITY_BYTE_LIMIT,
	PROFILE_ACTIVITY_MAX_CAPACITY,
	PROFILE_ACTIVITY_THUMBNAIL_BYTE_LIMIT,
	PROFILE_ACTIVITY_TITLE_LENGTH_LIMIT,
	type ProfileActivityCollectorItem,
} from './profile-activity.ts'

function activity(
	id: string,
	time: Date | string,
	overrides: Partial<ProfileActivityCollectorItem> = {},
): ProfileActivityCollectorItem {
	return {
		id,
		action: `Updated ${id}`,
		time,
		typeId: 'anime',
		media: {
			id: `media-${id}`,
			title: `Title ${id}`,
			thumbnail: `https://example.com/${id}.jpg`,
		},
		...overrides,
	}
}

describe('createProfileActivityCollector', () => {
	test('keeps the newest 100 rows across incremental pages', () => {
		const collector = createProfileActivityCollector()
		const rows = Array.from({ length: 145 }, (_, index) =>
			activity(
				`activity-${index.toString().padStart(3, '0')}`,
				new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
			),
		)

		collector.addBatch(rows.slice(0, 47))
		expect(collector.size).toBe(47)
		collector.addBatch(rows.slice(47, 103))
		expect(collector.size).toBe(PROFILE_ACTIVITY_MAX_CAPACITY)
		collector.addBatch(rows.slice(103))

		const expected = [...rows]
			.sort(
				(left, right) =>
					new Date(right.time).getTime() - new Date(left.time).getTime() ||
					right.id.localeCompare(left.id),
			)
			.slice(0, PROFILE_ACTIVITY_MAX_CAPACITY)

		expect(collector.size).toBe(PROFILE_ACTIVITY_MAX_CAPACITY)
		expect(collector.truncated).toBe(true)
		expect(collector.values().map(item => item.id)).toEqual(
			expected.map(item => item.id),
		)
	})

	test('discards an older batch added after the collector is full', () => {
		const collector = createProfileActivityCollector()
		const recent = Array.from({ length: 100 }, (_, index) =>
			activity(`recent-${index}`, new Date(Date.UTC(2026, 6, 1, 0, index))),
		)
		const older = Array.from({ length: 80 }, (_, index) =>
			activity(`older-${index}`, new Date(Date.UTC(1990, 0, 1, 0, index))),
		)

		collector.addBatch(recent)
		expect(collector.truncated).toBe(false)
		const before = collector.values().map(item => item.id)
		collector.addBatch(older)

		expect(collector.size).toBe(100)
		expect(collector.truncated).toBe(true)
		expect(collector.values().map(item => item.id)).toEqual(before)
	})

	test('marks a displaced retained row as truncated', () => {
		const collector = createProfileActivityCollector(2)
		collector.addBatch([
			activity('oldest', '2026-01-01T00:00:00.000Z'),
			activity('middle', '2026-02-01T00:00:00.000Z'),
		])

		expect(collector.truncated).toBe(false)
		collector.addBatch([activity('newest', '2026-03-01T00:00:00.000Z')])

		expect(collector.truncated).toBe(true)
		expect(collector.values().map(item => item.id)).toEqual([
			'newest',
			'middle',
		])
	})

	test('uses descending ids for equal timestamps and preserves exact ties', () => {
		const collector = createProfileActivityCollector(6)
		const sameTime = '2026-07-28T18:30:00.000Z'

		collector.addBatch([
			activity('alpha', sameTime, { action: 'first alpha' }),
			activity('charlie', new Date(sameTime)),
		])
		collector.addBatch([
			activity('bravo', sameTime),
			activity('alpha', new Date(sameTime), { action: 'second alpha' }),
		])

		expect(collector.values().map(item => [item.id, item.action])).toEqual([
			['charlie', 'Updated charlie'],
			['bravo', 'Updated bravo'],
			['alpha', 'first alpha'],
			['alpha', 'second alpha'],
		])
	})

	test('rejects invalid dates without partially applying a batch', () => {
		const collector = createProfileActivityCollector(4)
		collector.addBatch([activity('existing', '2026-01-01T00:00:00.000Z')])

		expect(() =>
			collector.addBatch([
				activity('valid', '2027-01-01T00:00:00.000Z'),
				activity('invalid-string', 'not-a-date'),
			]),
		).toThrowError(TypeError)
		expect(collector.values().map(item => item.id)).toEqual(['existing'])
		expect(collector.truncated).toBe(true)

		for (const [index, invalidTime] of [
			new Date(Number.NaN),
			new Date(0),
			'0',
			' ',
			0,
			false,
			[],
			{},
		].entries()) {
			expect(() =>
				collector.addBatch([
					activity(`invalid-date-${index}`, invalidTime as Date | string),
				]),
			).toThrowError(TypeError)
			expect(collector.values().map(item => item.id)).toEqual(['existing'])
			expect(collector.truncated).toBe(true)
		}
	})

	test('clips hostile display strings and removes unsafe oversized thumbnails', () => {
		const collector = createProfileActivityCollector(2)
		const hostileLength = 512 * 1024
		collector.addBatch([
			activity('hostile', '2026-07-28T18:30:00.000Z', {
				action: 'a'.repeat(hostileLength),
				media: {
					id: 'media-hostile',
					title: '😀'.repeat(hostileLength),
					thumbnail: 'é'.repeat(
						Math.floor(PROFILE_ACTIVITY_THUMBNAIL_BYTE_LIMIT / 2) + 1,
					),
				},
			}),
		])

		const [item] = collector.values()
		expect(Array.from(item!.action)).toHaveLength(
			PROFILE_ACTIVITY_ACTION_LENGTH_LIMIT,
		)
		expect(item!.action.endsWith('…')).toBe(true)
		expect(Array.from(item!.media.title)).toHaveLength(
			PROFILE_ACTIVITY_TITLE_LENGTH_LIMIT,
		)
		expect(item!.media.title.endsWith('…')).toBe(true)
		expect(item!.media.thumbnail).toBeNull()
		expect(collector.truncated).toBe(true)
		expect(collector.byteSize).toBeLessThanOrEqual(collector.byteLimit)
	})

	test('accepts the exact serialized byte boundary and rejects one byte more', () => {
		const textEncoder = new TextEncoder()
		const template = {
			...activity('exact', '2026-07-28T18:30:00.000Z'),
			padding: '',
		}
		const baseBytes = textEncoder.encode(JSON.stringify(template)).byteLength
		const exact = {
			...template,
			padding: 'x'.repeat(PROFILE_ACTIVITY_BYTE_LIMIT - 2 - baseBytes),
		}
		const over = { ...exact, padding: `${exact.padding}x` }

		const exactCollector = createProfileActivityCollector<typeof exact>(1)
		exactCollector.addBatch([exact])
		expect(exactCollector.size).toBe(1)
		expect(exactCollector.byteSize).toBe(PROFILE_ACTIVITY_BYTE_LIMIT)
		expect(exactCollector.truncated).toBe(false)

		const overCollector = createProfileActivityCollector<typeof over>(1)
		overCollector.addBatch([over])
		expect(overCollector.size).toBe(0)
		expect(overCollector.byteSize).toBe(2)
		expect(overCollector.truncated).toBe(true)
	})

	test('uses the byte budget to retain the newer prefix deterministically', () => {
		const collector = createProfileActivityCollector<
			ProfileActivityCollectorItem & { padding: string }
		>(3)
		const older = {
			...activity('older-large', '2025-01-01T00:00:00.000Z'),
			padding: 'x'.repeat(50 * 1024),
		}
		const newer = {
			...activity('newer', '2026-01-01T00:00:00.000Z'),
			padding: 'y'.repeat(20 * 1024),
		}

		collector.addBatch([older])
		expect(collector.values().map(item => item.id)).toEqual(['older-large'])
		collector.addBatch([newer])

		expect(collector.values().map(item => item.id)).toEqual(['newer'])
		expect(collector.truncated).toBe(true)
		expect(collector.byteSize).toBe(
			new TextEncoder().encode(JSON.stringify(collector.values())).byteLength,
		)
	})

	test('does not mark exact action and title limits as clipped', () => {
		const exactCollector = createProfileActivityCollector(1)
		exactCollector.addBatch([
			activity('exact-text', '2026-01-01T00:00:00.000Z', {
				action: 'a'.repeat(PROFILE_ACTIVITY_ACTION_LENGTH_LIMIT),
				media: {
					id: 'media-exact-text',
					title: 't'.repeat(PROFILE_ACTIVITY_TITLE_LENGTH_LIMIT),
					thumbnail: null,
				},
			}),
		])
		expect(exactCollector.truncated).toBe(false)

		const clippedCollector = createProfileActivityCollector(1)
		clippedCollector.addBatch([
			activity('clipped-text', '2026-01-01T00:00:00.000Z', {
				action: 'a'.repeat(PROFILE_ACTIVITY_ACTION_LENGTH_LIMIT + 1),
				media: {
					id: 'media-clipped-text',
					title: 't'.repeat(PROFILE_ACTIVITY_TITLE_LENGTH_LIMIT + 1),
					thumbnail: null,
				},
			}),
		])
		expect(clippedCollector.truncated).toBe(true)
	})

	test('marks unencodable rows as rejected without retaining them', () => {
		const collector = createProfileActivityCollector<
			ProfileActivityCollectorItem & { invalid: bigint }
		>(1)
		collector.addBatch([
			{
				...activity('bigint', '2026-01-01T00:00:00.000Z'),
				invalid: BigInt(1),
			},
		])

		expect(collector.values()).toEqual([])
		expect(collector.truncated).toBe(true)
	})

	test('supports zero capacity and rejects unsafe capacities', () => {
		const collector = createProfileActivityCollector(0)
		collector.addBatch([activity('ignored', '2026-01-01T00:00:00.000Z')])

		expect(collector.capacity).toBe(0)
		expect(collector.byteLimit).toBe(PROFILE_ACTIVITY_BYTE_LIMIT)
		expect(collector.byteSize).toBe(2)
		expect(collector.size).toBe(0)
		expect(collector.truncated).toBe(true)
		expect(collector.values()).toEqual([])
		expect(Object.isFrozen(collector.values())).toBe(true)

		for (const capacity of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(() => createProfileActivityCollector(capacity)).toThrowError(
				RangeError,
			)
		}
		expect(() =>
			createProfileActivityCollector(PROFILE_ACTIVITY_MAX_CAPACITY + 1),
		).toThrowError(RangeError)
	})

	test('isolates retained values from input and result mutation', () => {
		const collector = createProfileActivityCollector(2)
		const inputTime = new Date('2026-07-28T18:30:00.000Z')
		const input = activity('isolated', inputTime)

		collector.addBatch([input])
		input.action = 'Mutated input'
		input.media.title = 'Mutated input title'
		inputTime.setUTCFullYear(1999)

		const first = collector.values()
		expect(first[0]).toMatchObject({
			action: 'Updated isolated',
			media: { title: 'Title isolated' },
		})
		expect(new Date(first[0]!.time).getUTCFullYear()).toBe(2026)
		expect(Object.isFrozen(first)).toBe(true)
		expect(Object.isFrozen(first[0])).toBe(true)
		expect(Object.isFrozen(first[0]!.media)).toBe(true)
		const mutableFirst = first[0] as { action: string }
		expect(() => {
			mutableFirst.action = 'Mutated result'
		}).toThrowError(TypeError)

		if (first[0]!.time instanceof Date) {
			first[0]!.time.setUTCFullYear(2001)
		}
		const second = collector.values()
		expect(second).not.toBe(first)
		expect(second[0]).not.toBe(first[0])
		expect(second[0]!.media).not.toBe(first[0]!.media)
		expect(new Date(second[0]!.time).getUTCFullYear()).toBe(2026)
	})
})
