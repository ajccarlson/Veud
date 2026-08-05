import { expect, test } from 'vitest'
import {
	retentionFromEnvironment,
	selectBackupRetention,
} from './backup-retention.mjs'

const HOUR = 60 * 60 * 1_000
const DAY = 24 * HOUR

/** `count` hourly snapshots ending now, newest first. */
function hourly(count, now = Date.UTC(2026, 7, 5, 12)) {
	return Array.from({ length: count }, (_, index) => ({
		name: `data-${index}.db`,
		mtime: now - index * HOUR,
	}))
}

test('everything inside the recent window is kept', () => {
	const { keep, remove } = selectBackupRetention(hourly(10), {
		recent: 10,
		daily: 0,
		weekly: 0,
	})
	expect(keep).toHaveLength(10)
	expect(remove).toEqual([])
})

test('past the recent window, one snapshot a day survives', () => {
	// Four days of hourly snapshots, a six-hour recent window.
	const { keep, remove } = selectBackupRetention(hourly(96), {
		recent: 6,
		daily: 14,
		weekly: 0,
	})
	// Six recent, plus the newest in each remaining distinct day.
	expect(keep.length).toBeGreaterThan(6)
	expect(keep.length).toBeLessThan(96)
	expect(remove.length).toBe(96 - keep.length)
	// No day appears twice outside the recent window.
	const olderDays = keep.slice(6).map(backup => Math.floor(backup.mtime / DAY))
	expect(new Set(olderDays).size).toBe(olderDays.length)
})

test('the newest snapshot in a period is the one kept', () => {
	// It holds the most data, which is the only thing that distinguishes them.
	const now = Date.UTC(2026, 7, 5, 12)
	const backups = [
		{ name: 'newest-of-day', mtime: now - 2 * DAY },
		{ name: 'older-of-day', mtime: now - 2 * DAY - 3 * HOUR },
	]
	const { keep } = selectBackupRetention(backups, {
		recent: 0,
		daily: 5,
		weekly: 0,
	})
	expect(keep.map(backup => backup.name)).toEqual(['newest-of-day'])
})

test('weekly depth reaches further back than daily', () => {
	const now = Date.UTC(2026, 7, 5, 12)
	const backups = Array.from({ length: 60 }, (_, index) => ({
		name: `day-${index}.db`,
		mtime: now - index * DAY,
	}))
	const daysOnly = selectBackupRetention(backups, {
		recent: 0,
		daily: 7,
		weekly: 0,
	})
	const withWeeks = selectBackupRetention(backups, {
		recent: 0,
		daily: 7,
		weekly: 8,
	})
	expect(withWeeks.keep.length).toBeGreaterThan(daysOnly.keep.length)
	const oldestKept = Math.min(...withWeeks.keep.map(backup => backup.mtime))
	const oldestDaily = Math.min(...daysOnly.keep.map(backup => backup.mtime))
	expect(oldestKept).toBeLessThan(oldestDaily)
})

test('tiers overlap rather than compete', () => {
	// A snapshot kept by any tier is kept, and never appears in both lists.
	const backups = hourly(200)
	const { keep, remove } = selectBackupRetention(backups)
	const keptNames = new Set(keep.map(backup => backup.name))
	for (const backup of remove) expect(keptNames.has(backup.name)).toBe(false)
	expect(keep.length + remove.length).toBe(200)
})

test('an empty set has nothing to remove', () => {
	expect(selectBackupRetention([])).toEqual({ keep: [], remove: [] })
})

test('unsorted input is ordered before deciding', () => {
	const now = Date.UTC(2026, 7, 5, 12)
	const shuffled = [
		{ name: 'middle', mtime: now - 2 * HOUR },
		{ name: 'newest', mtime: now },
		{ name: 'oldest', mtime: now - 5 * HOUR },
	]
	const { keep } = selectBackupRetention(shuffled, {
		recent: 1,
		daily: 0,
		weekly: 0,
	})
	expect(keep.map(backup => backup.name)).toEqual(['newest'])
})

test('nonsensical retention is refused rather than silently deleting', () => {
	for (const bad of [-1, 1.5, Number.NaN]) {
		expect(() => selectBackupRetention(hourly(3), { recent: bad })).toThrow(
			'non-negative integer',
		)
		expect(() => selectBackupRetention(hourly(3), { daily: bad })).toThrow(
			'non-negative integer',
		)
		expect(() => selectBackupRetention(hourly(3), { weekly: bad })).toThrow(
			'non-negative integer',
		)
	}
})

test('BACKUP_KEEP keeps its old meaning as the recent window', () => {
	expect(retentionFromEnvironment({})).toEqual({
		recent: 48,
		daily: 14,
		weekly: 8,
	})
	expect(
		retentionFromEnvironment({
			BACKUP_KEEP: '12',
			BACKUP_KEEP_DAILY: '30',
			BACKUP_KEEP_WEEKLY: '0',
		}),
	).toEqual({ recent: 12, daily: 30, weekly: 0 })
	expect(
		retentionFromEnvironment({ POSTGRES_KEEP: '5' }, 'POSTGRES'),
	).toMatchObject({ recent: 5 })
	expect(() => retentionFromEnvironment({ BACKUP_KEEP: '-3' })).toThrow(
		'non-negative integer',
	)
})
