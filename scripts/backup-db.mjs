#!/usr/bin/env node
/**
 * SQLite backup for Veud.
 *
 * Creates a consistent, timestamped copy of the database using SQLite's online backup
 * API (via better-sqlite3). This is safe to run while the app is live — it handles WAL
 * correctly, so you do NOT need to stop PM2. Keeps the most recent BACKUP_KEEP backups
 * and prunes older ones.
 *
 * Run once:
 *   node scripts/backup-db.mjs      (or: npm run db:backup)
 *
 * Config (all optional env vars):
 *   BACKUP_DB_PATH  source database file        (default: <cwd>/prisma/data.db)
 *   BACKUP_DIR      directory for backups        (default: <cwd>/backups)
 *   BACKUP_KEEP     how many backups to retain   (default: 48)
 *
 * Schedule hourly with cron:
 *   0 * * * * cd /path/to/Veud && /usr/bin/node scripts/backup-db.mjs >> backups/backup.log 2>&1
 * ...or with PM2 (keeps it next to the app):
 *   pm2 start scripts/backup-db.mjs --name veud-backup --no-autorestart --cron-restart "0 * * * *"
 *   pm2 save
 *
 * Restore (with the app stopped):
 *   pm2 stop all
 *   cp backups/data-<timestamp>.db prisma/data.db
 *   rm -f prisma/data.db-wal prisma/data.db-shm   # discard stale WAL so the copy is authoritative
 *   pm2 start all
 */
import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

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
