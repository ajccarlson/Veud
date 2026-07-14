#!/usr/bin/env node
/**
 * SQLite backup for Veud.
 *
 * Creates a consistent, timestamped copy of the database using SQLite's online backup
 * API (via better-sqlite3). This is safe to run while the app is live — it handles WAL
 * correctly, so you do NOT need to stop PM2. Keeps the most recent BACKUP_KEEP backups
 * and prunes older ones.
 *
 * How it runs:
 *   Automatically, as a second PM2 process defined in ecosystem.config.cjs. It runs once
 *   when you `npm run start:prod` and then hourly via cron_restart — no separate command
 *   or crontab entry is needed. It no-ops under NODE_ENV=development, so `start:dev` does
 *   not produce backups.
 *
 *   To take a one-off backup by hand:  node scripts/backup-db.mjs
 *
 * Config (all optional env vars):
 *   BACKUP_DB_PATH  source database file        (default: <cwd>/prisma/data.db)
 *   BACKUP_DIR      directory for backups        (default: <cwd>/backups)
 *   BACKUP_KEEP     how many backups to retain   (default: 48)
 *
 * Restore (with the app stopped):
 *   npm run stop:prod
 *   cp backups/data-<timestamp>.db prisma/data.db
 *   rm -f prisma/data.db-wal prisma/data.db-shm   # discard stale WAL so the copy is authoritative
 *   npm run start:prod
 */
import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

// Backups are a production concern; skip cleanly when PM2 runs this under start:dev.
if (process.env.NODE_ENV === 'development') {
	console.log('Skipping backup: NODE_ENV=development.')
	process.exit(0)
}

const dbPath = process.env.BACKUP_DB_PATH
	? path.resolve(process.env.BACKUP_DB_PATH)
	: path.join(process.cwd(), 'prisma', 'data.db')
const backupDir = process.env.BACKUP_DIR
	? path.resolve(process.env.BACKUP_DIR)
	: path.join(process.cwd(), 'backups')
const keep = Math.max(1, Number(process.env.BACKUP_KEEP || 48))

fs.mkdirSync(backupDir, { recursive: true })

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const outFile = path.join(backupDir, `data-${stamp}.db`)

// Read-only source connection: the backup API only reads, and this guarantees the
// script can never modify the live database.
const db = new Database(dbPath, { readonly: true, fileMustExist: true })
try {
	await db.backup(outFile)
	const mb = (fs.statSync(outFile).size / 1024 / 1024).toFixed(2)
	console.log(`✅ Backup written: ${outFile} (${mb} MB)`)
} finally {
	db.close()
}

// Retention: keep the newest `keep` backups (by mtime), prune the rest. The filename
// pattern is specific so nothing else in the directory (e.g. backup.log) is touched.
const backups = fs
	.readdirSync(backupDir)
	.filter(f => /^data-.*\.db$/.test(f))
	.map(f => ({ f, mtime: fs.statSync(path.join(backupDir, f)).mtimeMs }))
	.sort((a, b) => b.mtime - a.mtime)

for (const { f } of backups.slice(keep)) {
	fs.unlinkSync(path.join(backupDir, f))
	console.log(`🗑  Pruned old backup: ${f}`)
}
