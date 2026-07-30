#!/usr/bin/env node
import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import {
	DEFAULT_POSTGRES_BACKUP_SOURCE_POLICY,
	parsePostgresBackupSourcePolicy,
	verifyPostgresBackup,
} from './postgres-backup-operations.mjs'
import { attestPostgresBackupFile } from './postgres-backup-publication.mjs'
import {
	defaultPostgresBackupReceiptPath,
	replacePostgresBackupReceipt,
	writePostgresBackupReceipt,
} from './postgres-backup-receipt.mjs'
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
const sourcePolicy = parsePostgresBackupSourcePolicy(
	process.env.BACKUP_SOURCE_POLICY,
)
const expectedUsername =
	sourcePolicy === DEFAULT_POSTGRES_BACKUP_SOURCE_POLICY
		? process.env.BACKUP_VERIFY_USERNAME?.trim() || undefined
		: undefined

const archiveAttestation = attestPostgresBackupFile(
	backupPath,
	undefined,
	'PostgreSQL restore-drill archive',
)
const summary = await verifyPostgresBackup({
	backupPath,
	sourceUrl,
	verifyUrl,
	expectedUsername,
	sourcePolicy,
})
const receiptPath =
	process.env.POSTGRES_BACKUP_RECEIPT?.trim() ||
	defaultPostgresBackupReceiptPath(backupPath)
const receiptOptions = {
	backupPath,
	sourceUrl,
	verifyUrl,
	summary,
	identityVerified: Boolean(expectedUsername),
	sourcePolicy,
	receiptPath,
	archiveAttestation,
}
const receipt = fs.existsSync(receiptPath)
	? await replacePostgresBackupReceipt(receiptOptions)
	: await writePostgresBackupReceipt(receiptOptions)
console.log(`✅ PostgreSQL restore drill passed: ${backupPath}`)
console.log(
	`   users=${summary.users}, watchlists=${summary.watchlists}, entries=${summary.entries}, media=${summary.media}, migrations=${summary.migrations}`,
)
console.log(`   restore receipt=${receipt.path}`)
