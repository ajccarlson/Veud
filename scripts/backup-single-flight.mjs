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
	fs.mkdirSync(path.dirname(lockPath), { recursive: true })

	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			// wx fails if the file exists, which is the whole mechanism.
			const handle = fs.openSync(lockPath, 'wx', 0o600)
			fs.writeSync(handle, String(pid))
			fs.closeSync(handle)
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
			// The owner is gone, or the lock is unreadable. Reclaim it and retry
			// once; a second EEXIST means someone else won the race, which the next
			// pass reports honestly.
			fs.rmSync(lockPath, { force: true })
		}
	}
	return { acquired: false, owner: null, release() {} }
}
