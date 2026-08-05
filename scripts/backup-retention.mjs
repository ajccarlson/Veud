/**
 * Which snapshots to keep, and which to let go.
 *
 * Keeping the N most recent is the wrong shape for an hourly schedule: 48
 * snapshots is about two days, so any mistake older than a weekend is
 * unrecoverable no matter how much disk is free. Depth matters more than
 * density once a snapshot is a day old — nobody restores to 14:00 rather than
 * 15:00 three weeks later, but they very much want *some* copy from three
 * weeks ago.
 *
 * So: every snapshot from the recent window, then one per day, then one per
 * week. The newest snapshot in a period is the one kept, because it is the one
 * with the most data in it.
 */

const DAY_MS = 24 * 60 * 60 * 1_000

/** The UTC day a snapshot belongs to. */
function dayKey(timestamp) {
	return Math.floor(timestamp / DAY_MS)
}

/** The UTC week a snapshot belongs to. */
function weekKey(timestamp) {
	return Math.floor(timestamp / (7 * DAY_MS))
}

function positiveCount(value, name) {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new Error(`${name} must be a non-negative integer; received ${value}`)
	}
	return value
}

/**
 * Split snapshots into the ones to keep and the ones to remove.
 *
 * `backups` must be newest first, each `{ name, mtime }`. Nothing is removed
 * that a shorter tier already kept, so the tiers overlap rather than compete.
 */
export function selectBackupRetention(backups, options = {}) {
	const recent = positiveCount(options.recent ?? 48, 'recent retention')
	const daily = positiveCount(options.daily ?? 14, 'daily retention')
	const weekly = positiveCount(options.weekly ?? 8, 'weekly retention')

	const keep = new Set()
	const ordered = [...backups].sort(
		(first, second) => second.mtime - first.mtime,
	)

	for (const backup of ordered.slice(0, recent)) keep.add(backup.name)

	const seenDays = new Set()
	for (const backup of ordered) {
		if (seenDays.size >= daily && !seenDays.has(dayKey(backup.mtime))) continue
		if (seenDays.has(dayKey(backup.mtime))) continue
		seenDays.add(dayKey(backup.mtime))
		keep.add(backup.name)
	}

	const seenWeeks = new Set()
	for (const backup of ordered) {
		if (seenWeeks.size >= weekly && !seenWeeks.has(weekKey(backup.mtime)))
			continue
		if (seenWeeks.has(weekKey(backup.mtime))) continue
		seenWeeks.add(weekKey(backup.mtime))
		keep.add(backup.name)
	}

	return {
		keep: ordered.filter(backup => keep.has(backup.name)),
		remove: ordered.filter(backup => !keep.has(backup.name)),
	}
}

/** Retention settings from the environment, with the tiers named separately. */
export function retentionFromEnvironment(env, prefix = 'BACKUP') {
	const read = (suffix, fallback) => {
		const raw = env[`${prefix}_${suffix}`]
		if (raw === undefined || raw === '') return fallback
		const parsed = Number(raw)
		if (!Number.isSafeInteger(parsed) || parsed < 0) {
			throw new Error(
				`${prefix}_${suffix} must be a non-negative integer; received ${raw}`,
			)
		}
		return parsed
	}
	return {
		// BACKUP_KEEP kept its meaning: the recent, every-snapshot window.
		recent: read('KEEP', 48),
		daily: read('KEEP_DAILY', 14),
		weekly: read('KEEP_WEEKLY', 8),
	}
}
