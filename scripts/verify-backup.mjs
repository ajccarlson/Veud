#!/usr/bin/env node
/**
 * Restores a backup into a temporary directory, validates it, then removes the copy.
 * Pass a backup path as the first argument or omit it to verify the newest backup.
 */
import 'dotenv/config'
import path from 'node:path'
import {
	findLatestBackup,
	listRequiredMigrations,
	verifyBackupRestore,
} from './backup-utils.mjs'

const backupDir = process.env.BACKUP_DIR
	? path.resolve(process.env.BACKUP_DIR)
	: path.join(process.cwd(), 'backups')
const backupPath = process.argv[2]
	? path.resolve(process.argv[2])
	: process.env.BACKUP_FILE
		? path.resolve(process.env.BACKUP_FILE)
		: findLatestBackup(backupDir)
const expectedUsername = process.env.BACKUP_VERIFY_USERNAME?.trim() || undefined
const requiredMigrations = listRequiredMigrations(
	path.join(process.cwd(), 'prisma', 'migrations'),
)

const summary = verifyBackupRestore(backupPath, {
	expectedUsername,
	requiredMigrations,
})

console.log(`✅ Restore drill passed: ${backupPath}`)
console.log(
	`   users=${summary.users}, watchlists=${summary.watchlists}, entries=${summary.entries}, migrations=${summary.migrations}`,
)
