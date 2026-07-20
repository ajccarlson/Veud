#!/usr/bin/env node
/**
 * SQLite backup for Veud.
 *
 * Creates a consistent, timestamped copy of the database using SQLite's online backup
 * API (via better-sqlite3). This is safe to run while the app is live — it handles WAL
 * correctly, so you do NOT need to stop PM2. Every snapshot is restored to a temporary
 * database and checked before retention/offsite copying. Keeps the most recent BACKUP_KEEP
 * backups and prunes older ones.
 *
 * How it runs:
 *   Automatically, as a second PM2 process defined in ecosystem.config.cjs. It runs once
 *   when you `npm run start:prod` and then hourly via cron_restart — no separate command
 *   or crontab entry is needed. It no-ops under NODE_ENV=development, so `start:dev` does
 *   not produce backups.
 *
 *   To take a one-off backup by hand:  npm run db:backup
 *   To restore-test the newest backup: npm run db:verify-backup
 *
 * Config (all optional env vars):
 *   BACKUP_DB_PATH  source database file        (default: <cwd>/prisma/data.db)
 *   BACKUP_DIR      directory for backups        (default: <cwd>/backups)
 *   BACKUP_KEEP     how many backups to retain   (default: 48)
 *   BACKUP_VERIFY_USERNAME  account that must exist in the restored backup (optional)
 *   BACKUP_OFFSITE_DIR      mounted/synced off-machine directory (optional)
 *   BACKUP_OFFSITE_KEEP     offsite copies to retain (default: BACKUP_KEEP)
 *
 * Restore (with the app stopped):
 *   npm run stop:prod
 *   cp backups/data-<timestamp>.db prisma/data.db
 *   rm -f prisma/data.db-wal prisma/data.db-shm   # discard stale WAL so the copy is authoritative
 *   npm run start:prod
 */
import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import {
	assertSqlitePrimaryDatabase,
	copyVerifiedBackup,
	listRequiredMigrations,
	parsePositiveInteger,
	pruneBackups,
	verifyBackupRestore,
} from './backup-utils.mjs'

// Backups are a production concern; skip cleanly when PM2 runs this under start:dev.
if (process.env.NODE_ENV === 'development') {
	console.log('Skipping backup: NODE_ENV=development.')
	process.exit(0)
}

// Fail closed after a provider switch. Silently backing up a leftover SQLite
// file would look healthy while leaving the PostgreSQL primary unprotected.
assertSqlitePrimaryDatabase(process.env.DATABASE_URL)

const dbPath = process.env.BACKUP_DB_PATH
	? path.resolve(process.env.BACKUP_DB_PATH)
	: path.join(process.cwd(), 'prisma', 'data.db')
const backupDir = process.env.BACKUP_DIR
	? path.resolve(process.env.BACKUP_DIR)
	: path.join(process.cwd(), 'backups')
const keep = parsePositiveInteger(process.env.BACKUP_KEEP, 48, 'BACKUP_KEEP')
const offsiteDir = process.env.BACKUP_OFFSITE_DIR
	? path.resolve(process.env.BACKUP_OFFSITE_DIR)
	: undefined
const offsiteKeep = parsePositiveInteger(
	process.env.BACKUP_OFFSITE_KEEP,
	keep,
	'BACKUP_OFFSITE_KEEP',
)
const expectedUsername = process.env.BACKUP_VERIFY_USERNAME?.trim() || undefined
const requiredMigrations = listRequiredMigrations(
	path.join(process.cwd(), 'prisma', 'migrations'),
)
const verificationOptions = { expectedUsername, requiredMigrations }

fs.mkdirSync(backupDir, { recursive: true })

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const outFile = path.join(backupDir, `data-${stamp}.db`)

// Read-only source connection: the backup API only reads, and this guarantees the
// script can never modify the live database.
const db = new Database(dbPath, { readonly: true, fileMustExist: true })
try {
	await db.backup(outFile)
} catch (error) {
	fs.rmSync(outFile, { force: true })
	throw error
} finally {
	db.close()
}

let summary
try {
	summary = verifyBackupRestore(outFile, verificationOptions)
} catch (error) {
	fs.rmSync(outFile, { force: true })
	throw error
}

const mb = (fs.statSync(outFile).size / 1024 / 1024).toFixed(2)
console.log(`✅ Backup written and restore-tested: ${outFile} (${mb} MB)`)
console.log(
	`   users=${summary.users}, watchlists=${summary.watchlists}, entries=${summary.entries}, migrations=${summary.migrations}`,
)

for (const backup of pruneBackups(backupDir, keep)) {
	console.log(`🗑  Pruned old backup: ${backup}`)
}

if (offsiteDir) {
	const { destination } = copyVerifiedBackup(
		outFile,
		offsiteDir,
		verificationOptions,
	)
	console.log(`✅ Verified offsite copy: ${destination}`)
	for (const backup of pruneBackups(offsiteDir, offsiteKeep)) {
		console.log(`🗑  Pruned old offsite backup: ${backup}`)
	}
}
