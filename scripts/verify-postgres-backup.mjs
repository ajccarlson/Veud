#!/usr/bin/env node
import 'dotenv/config'
import path from 'node:path'
import { verifyPostgresBackup } from './postgres-backup-operations.mjs'
import { findLatestPostgresBackup } from './postgres-backup-utils.mjs'

const backupDir = path.resolve(process.env.BACKUP_DIR || 'backups')
const backupPath = process.argv[2]
	? path.resolve(process.argv[2])
	: process.env.BACKUP_FILE
		? path.resolve(process.env.BACKUP_FILE)
		: findLatestPostgresBackup(backupDir)
const sourceUrl = process.env.DATABASE_URL
const verifyUrl = process.env.POSTGRES_BACKUP_VERIFY_URL
if (!sourceUrl) throw new Error('DATABASE_URL is required')
if (!verifyUrl) throw new Error('POSTGRES_BACKUP_VERIFY_URL is required')

const summary = await verifyPostgresBackup({
	backupPath,
	sourceUrl,
	verifyUrl,
	expectedUsername: process.env.BACKUP_VERIFY_USERNAME?.trim() || undefined,
})
console.log(`✅ PostgreSQL restore drill passed: ${backupPath}`)
console.log(
	`   users=${summary.users}, watchlists=${summary.watchlists}, entries=${summary.entries}, media=${summary.media}, migrations=${summary.migrations}`,
)
