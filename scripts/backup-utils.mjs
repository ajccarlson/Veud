import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'

const BACKUP_FILE_PATTERN = /^data-.*\.db$/
// A snapshot in progress carries this suffix so it can never satisfy
// BACKUP_FILE_PATTERN: an unverified file must not be listed, pruned against,
// or selected as "latest" by a restore.
const PARTIAL_FILE_PATTERN = /^data-.*\.db\.partial-\d+$/
const REQUIRED_TABLES = ['_prisma_migrations', 'User', 'Watchlist', 'Entry']

export function assertSqlitePrimaryDatabase(databaseUrl) {
	const normalized = databaseUrl?.trim()
	if (normalized && !normalized.startsWith('file:')) {
		throw new Error(
			'The SQLite backup command cannot protect a PostgreSQL primary database. Configure and verify PostgreSQL-native backups before cutover.',
		)
	}
}

export function parsePositiveInteger(value, fallback, name) {
	const parsed = value === undefined || value === '' ? fallback : Number(value)
	if (!Number.isSafeInteger(parsed) || parsed < 1) {
		throw new Error(`${name} must be a positive integer; received ${value}`)
	}
	return parsed
}

/** The name a snapshot is written under before it has been verified. */
export function partialBackupPath(finalPath, pid = process.pid) {
	return `${finalPath}.partial-${pid}`
}

/**
 * Remove snapshots that were interrupted before they could be verified.
 *
 * The hourly schedule kills a backup that overruns, and a crash leaves the same
 * debris. Files still being written by a live process are left alone; the grace
 * period covers the gap between a process dying and its file going stale.
 */
export function cleanupInterruptedBackupArtifacts(backupDir, options = {}) {
	const orphanGraceMs = options.orphanGraceMs ?? 60 * 60 * 1_000
	const now = options.now?.() ?? Date.now()
	const isRunning =
		options.isRunning ??
		(pid => {
			try {
				process.kill(pid, 0)
				return true
			} catch {
				return false
			}
		})
	if (!fs.existsSync(backupDir)) return []
	const removed = []
	for (const entry of fs.readdirSync(backupDir, { withFileTypes: true })) {
		if (!entry.isFile() || !PARTIAL_FILE_PATTERN.test(entry.name)) continue
		const pid = Number(entry.name.slice(entry.name.lastIndexOf('-') + 1))
		const artifactPath = path.join(backupDir, entry.name)
		if (Number.isSafeInteger(pid) && pid > 0 && isRunning(pid)) continue
		if (now - fs.statSync(artifactPath).mtimeMs < orphanGraceMs) continue
		fs.rmSync(artifactPath, { force: true })
		removed.push(entry.name)
	}
	return removed
}

/**
 * Refuse to start a snapshot that the filesystem cannot hold.
 *
 * Running out of space mid-write produces exactly the truncated file this
 * module works to avoid, and it does so on the destination that is supposed to
 * be the recovery path.
 */
export function assertBackupDirectoryFreeSpace(
	backupDir,
	minimumFreeBytes,
	operations = {},
) {
	const statfs = operations.statfs ?? fs.statfsSync
	if (!Number.isSafeInteger(minimumFreeBytes) || minimumFreeBytes < 0) {
		throw new Error(
			`Backup free-space floor must be a non-negative integer; received ${minimumFreeBytes}`,
		)
	}
	if (minimumFreeBytes === 0) return
	const filesystem = statfs(backupDir)
	const availableBytes = Number(filesystem.bavail) * Number(filesystem.bsize)
	if (availableBytes < minimumFreeBytes) {
		throw new Error(
			`${backupDir} has ${availableBytes} bytes available; ${minimumFreeBytes} required`,
		)
	}
	return availableBytes
}

export function listBackupFiles(backupDir) {
	if (!fs.existsSync(backupDir)) return []
	return fs
		.readdirSync(backupDir, { withFileTypes: true })
		.filter(entry => entry.isFile() && BACKUP_FILE_PATTERN.test(entry.name))
		.map(entry => ({
			name: entry.name,
			path: path.join(backupDir, entry.name),
			mtime: fs.statSync(path.join(backupDir, entry.name)).mtimeMs,
		}))
		.sort((a, b) => b.mtime - a.mtime || b.name.localeCompare(a.name))
}

export function findLatestBackup(backupDir) {
	const latest = listBackupFiles(backupDir)[0]
	if (!latest) {
		throw new Error(`No data-*.db backups found in ${backupDir}`)
	}
	return latest.path
}

export function pruneBackups(backupDir, keep) {
	if (!Number.isSafeInteger(keep) || keep < 1) {
		throw new Error(
			`Backup retention must be a positive integer; received ${keep}`,
		)
	}
	const pruned = []
	for (const backup of listBackupFiles(backupDir).slice(keep)) {
		fs.unlinkSync(backup.path)
		pruned.push(backup.name)
	}
	return pruned
}

export function listRequiredMigrations(migrationsDir) {
	return fs
		.readdirSync(migrationsDir, { withFileTypes: true })
		.filter(entry => entry.isDirectory())
		.map(entry => entry.name)
		.sort()
}

export function verifyBackupDatabase(
	databasePath,
	{ expectedUsername, requiredMigrations = [] } = {},
) {
	const db = new Database(databasePath, {
		readonly: true,
		fileMustExist: true,
	})

	try {
		const integrityResults = db.pragma('integrity_check').flatMap(Object.values)
		if (integrityResults.length !== 1 || integrityResults[0] !== 'ok') {
			throw new Error(
				`SQLite integrity check failed: ${integrityResults.join('; ')}`,
			)
		}

		const foreignKeyProblems = db.pragma('foreign_key_check')
		if (foreignKeyProblems.length > 0) {
			throw new Error(
				`SQLite foreign key check failed with ${foreignKeyProblems.length} violation(s)`,
			)
		}

		const tables = new Set(
			db
				.prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
				.all()
				.map(row => row.name),
		)
		const missingTables = REQUIRED_TABLES.filter(table => !tables.has(table))
		if (missingTables.length > 0) {
			throw new Error(
				`Backup is missing required tables: ${missingTables.join(', ')}`,
			)
		}

		const appliedMigrations = new Set(
			db
				.prepare(
					`SELECT migration_name FROM "_prisma_migrations"
					 WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`,
				)
				.all()
				.map(row => row.migration_name),
		)
		const missingMigrations = requiredMigrations.filter(
			migration => !appliedMigrations.has(migration),
		)
		if (missingMigrations.length > 0) {
			throw new Error(
				`Backup is missing applied migrations: ${missingMigrations.join(', ')}`,
			)
		}

		if (expectedUsername) {
			const expectedUser = db
				.prepare('SELECT 1 FROM "User" WHERE username = ?')
				.get(expectedUsername)
			if (!expectedUser) {
				throw new Error('Backup does not contain BACKUP_VERIFY_USERNAME')
			}
		}

		return {
			users: db.prepare('SELECT COUNT(*) AS count FROM "User"').get().count,
			watchlists: db.prepare('SELECT COUNT(*) AS count FROM "Watchlist"').get()
				.count,
			entries: db.prepare('SELECT COUNT(*) AS count FROM "Entry"').get().count,
			migrations: appliedMigrations.size,
		}
	} finally {
		db.close()
	}
}

export function verifyBackupRestore(backupPath, options) {
	const restoreDir = fs.mkdtempSync(path.join(os.tmpdir(), 'veud-restore-'))
	const restoredDatabase = path.join(restoreDir, 'data.db')

	try {
		fs.copyFileSync(backupPath, restoredDatabase)
		return verifyBackupDatabase(restoredDatabase, options)
	} finally {
		fs.rmSync(restoreDir, { recursive: true, force: true })
	}
}

export function copyVerifiedBackup(backupPath, destinationDir, options) {
	if (
		!fs.existsSync(destinationDir) ||
		!fs.statSync(destinationDir).isDirectory()
	) {
		throw new Error(
			'BACKUP_OFFSITE_DIR must already exist and be mounted/synced',
		)
	}
	const sourceDir = fs.realpathSync(path.dirname(backupPath))
	const resolvedDestination = fs.realpathSync(destinationDir)
	if (sourceDir === resolvedDestination) {
		throw new Error('BACKUP_OFFSITE_DIR must differ from BACKUP_DIR')
	}

	const destination = path.join(resolvedDestination, path.basename(backupPath))
	const partial = `${destination}.partial-${process.pid}-${Date.now()}`

	try {
		fs.copyFileSync(backupPath, partial)
		const summary = verifyBackupDatabase(partial, options)
		fs.renameSync(partial, destination)
		return { destination, summary }
	} finally {
		fs.rmSync(partial, { force: true })
	}
}
