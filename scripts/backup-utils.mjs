import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'

const BACKUP_FILE_PATTERN = /^data-.*\.db$/
const REQUIRED_TABLES = ['_prisma_migrations', 'User', 'Watchlist', 'Entry']

export function parsePositiveInteger(value, fallback, name) {
	const parsed = value === undefined || value === '' ? fallback : Number(value)
	if (!Number.isSafeInteger(parsed) || parsed < 1) {
		throw new Error(`${name} must be a positive integer; received ${value}`)
	}
	return parsed
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
		throw new Error(`Backup retention must be a positive integer; received ${keep}`)
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
			throw new Error(`Backup is missing required tables: ${missingTables.join(', ')}`)
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
			watchlists: db
				.prepare('SELECT COUNT(*) AS count FROM "Watchlist"')
				.get().count,
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
	if (!fs.existsSync(destinationDir) || !fs.statSync(destinationDir).isDirectory()) {
		throw new Error('BACKUP_OFFSITE_DIR must already exist and be mounted/synced')
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
