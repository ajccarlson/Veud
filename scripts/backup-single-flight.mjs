import fs from 'node:fs'
import path from 'node:path'

/**
 * One backup at a time.
 *
 * The hourly schedule restarts this process on the hour whether or not the
 * previous run has finished. As the database grows, a dump plus its
 * restore-verification will eventually cross that boundary, and two backups
 * competing for the same directory is how a half-written snapshot meets a
 * pruner.
 *
 * The lock is advisory and self-healing: it records the owning process, and a
 * lock left behind by a process that no longer exists is reclaimed rather than
 * blocking every future run.
 */
export function acquireBackupLock(lockPath, operations = {}) {
	const isRunning =
		operations.isRunning ??
		(pid => {
			try {
				process.kill(pid, 0)
				return true
			} catch {
				return false
			}
		})
	const pid = operations.pid ?? process.pid
	const now = operations.now ?? Date.now
	// Longer than any backup this has ever taken; a dump plus its restore
	// verification runs in minutes.
	const unreadableGraceMs = operations.unreadableGraceMs ?? 2 * 60 * 60 * 1_000
	const lockAge = operations.lockAge ?? (path => fs.statSync(path).mtimeMs)
	fs.mkdirSync(path.dirname(lockPath), { recursive: true })

	for (let attempt = 0; attempt < 2; attempt++) {
		const staging = `${lockPath}.${pid}.staged`
		try {
			// The lock is written first and published second. Creating it with
			// `wx` and writing the pid afterwards left a window where the file
			// existed but was empty — and a concurrent reader parsing '' gets 0,
			// which fails the `> 0` check and reclaims a live owner's lock as
			// debris. linkSync is atomic and fails EEXIST if the name is taken, so
			// the lock is never observable without its owner inside it.
			fs.writeFileSync(staging, String(pid), { mode: 0o600 })
			fs.linkSync(staging, lockPath)
			fs.rmSync(staging, { force: true })
			return {
				acquired: true,
				release() {
					try {
						const owner = Number(fs.readFileSync(lockPath, 'utf8').trim())
						// Never remove a lock this process does not own; that would hand
						// the next run a directory another backup is still writing to.
						if (owner === pid) fs.rmSync(lockPath, { force: true })
					} catch {
						// A lock that has already gone needs no releasing.
					}
				},
			}
		} catch (error) {
			fs.rmSync(staging, { force: true })
			if (error?.code !== 'EEXIST') throw error
			let owner
			try {
				owner = Number(fs.readFileSync(lockPath, 'utf8').trim())
			} catch {
				owner = Number.NaN
			}
			if (Number.isSafeInteger(owner) && owner > 0 && isRunning(owner)) {
				return { acquired: false, owner, release() {} }
			}
			// A lock with no readable pid cannot be attributed. This version never
			// writes one, so it came from an older build or a torn write. Both
			// answers are wrong on their own: reclaiming it immediately can steal
			// from a live writer, and honouring it forever stops every future
			// backup silently. So it is honoured until it is old enough that no
			// backup could still be running behind it.
			if (!Number.isSafeInteger(owner) || owner <= 0) {
				const age = now() - lockAge(lockPath)
				if (age < unreadableGraceMs) {
					return { acquired: false, owner: null, release() {} }
				}
			}
			// The owner is gone, or the lock is unreadable. Reclaim it and retry
			// once; a second EEXIST means someone else won the race, which the next
			// pass reports honestly.
			fs.rmSync(lockPath, { force: true })
		}
	}
	return { acquired: false, owner: null, release() {} }
}
