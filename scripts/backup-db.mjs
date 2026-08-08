#!/usr/bin/env node
/**
 * SQLite backup for Veud.
 *
 * Creates a consistent, timestamped copy of the database using SQLite's online backup
 * API (via better-sqlite3). This is safe to run while the app is live — it handles WAL
 * correctly, so you do NOT need to stop PM2. Every snapshot is restored to a temporary
 * database and checked before retention/offsite copying. Retention is tiered:
 * every snapshot from the most recent BACKUP_KEEP, then one a day for
 * BACKUP_KEEP_DAILY days, then one a week for BACKUP_KEEP_WEEKLY weeks.
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
 *   BACKUP_KEEP     recent snapshots to keep all of (default: 48)
 *   BACKUP_KEEP_DAILY   days to keep one snapshot each (default: 14)
 *   BACKUP_KEEP_WEEKLY  weeks to keep one snapshot each (default: 8)
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
import { retentionFromEnvironment } from './backup-retention.mjs'
import {
	assertBackupDirectoryFreeSpace,
	assertSqlitePrimaryDatabase,
	cleanupInterruptedBackupArtifacts,
	copyVerifiedBackup,
	listRequiredMigrations,
	parsePositiveInteger,
	partialBackupPath,
	pruneBackupsByRetention,
	verifyBackupRestore,
} from './backup-utils.mjs'
import { assertIndependentBackupMount } from './postgres-backup-utils.mjs'

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
const retention = retentionFromEnvironment(process.env)
const offsiteDir = process.env.BACKUP_OFFSITE_DIR
	? path.resolve(process.env.BACKUP_OFFSITE_DIR)
	: undefined
// The offsite copy keeps its own recent window; the day and week tiers match,
// since depth is the point of holding a second copy at all.
const offsiteRetention = {
	...retention,
	recent: parsePositiveInteger(
		process.env.BACKUP_OFFSITE_KEEP,
		retention.recent,
		'BACKUP_OFFSITE_KEEP',
	),
}
const minimumFreeBytes = Number(process.env.BACKUP_MIN_FREE_BYTES || 0)
const offsiteMinimumFreeBytes = Number(
	process.env.BACKUP_OFFSITE_MIN_FREE_BYTES || 0,
)
const expectedUsername = process.env.BACKUP_VERIFY_USERNAME?.trim() || undefined
const requiredMigrations = listRequiredMigrations(
	path.join(process.cwd(), 'prisma', 'migrations'),
)
const verificationOptions = { expectedUsername, requiredMigrations }

fs.mkdirSync(backupDir, { recursive: true })

for (const artifact of cleanupInterruptedBackupArtifacts(backupDir)) {
	console.log(`🗑  Removed interrupted backup artifact: ${artifact}`)
}
assertBackupDirectoryFreeSpace(backupDir, minimumFreeBytes)
if (offsiteDir) {
	// The offsite copy is only offsite if it is a separate filesystem. Without
	// this the copy lands on the primary disk and looks like protection.
	assertIndependentBackupMount(
		offsiteDir,
		process.env.BACKUP_OFFSITE_MOUNTPOINT?.trim(),
		offsiteMinimumFreeBytes,
	)
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const outFile = path.join(backupDir, `data-${stamp}.db`)
// Written under a name a restore will never select, and moved into place only
// once it has been verified. A crash or a scheduler kill mid-write therefore
// leaves debris rather than a truncated file that looks like the newest good
// snapshot.
const partialFile = partialBackupPath(outFile)

// Read-only source connection: the backup API only reads, and this guarantees the
// script can never modify the live database.
const db = new Database(dbPath, { readonly: true, fileMustExist: true })
try {
	await db.backup(partialFile)
} catch (error) {
	fs.rmSync(partialFile, { force: true })
	throw error
} finally {
	db.close()
}

let summary
try {
	summary = verifyBackupRestore(partialFile, verificationOptions)
} catch (error) {
	fs.rmSync(partialFile, { force: true })
	throw error
}
fs.renameSync(partialFile, outFile)

const mb = (fs.statSync(outFile).size / 1024 / 1024).toFixed(2)
console.log(`✅ Backup written and restore-tested: ${outFile} (${mb} MB)`)
console.log(
	`   users=${summary.users}, watchlists=${summary.watchlists}, entries=${summary.entries}, migrations=${summary.migrations}`,
)

for (const backup of pruneBackupsByRetention(backupDir, retention)) {
	console.log(`🗑  Pruned old backup: ${backup}`)
}

if (offsiteDir) {
	for (const artifact of cleanupInterruptedBackupArtifacts(offsiteDir)) {
		console.log(`🗑  Removed interrupted offsite artifact: ${artifact}`)
	}
	const { destination } = copyVerifiedBackup(
		outFile,
		offsiteDir,
		verificationOptions,
	)
	console.log(`✅ Verified offsite copy: ${destination}`)
	for (const backup of pruneBackupsByRetention(offsiteDir, offsiteRetention)) {
		console.log(`🗑  Pruned old offsite backup: ${backup}`)
	}
}
