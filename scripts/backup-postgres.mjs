#!/usr/bin/env node
import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { parsePositiveInteger } from './backup-utils.mjs'
import {
	createPostgresBackup,
	inspectPostgresBackup,
	verifyPostgresBackup,
} from './postgres-backup-operations.mjs'
import {
	sha256File,
	writePostgresBackupReceipt,
} from './postgres-backup-receipt.mjs'
import {
	assertIndependentBackupMount,
	prunePostgresBackups,
} from './postgres-backup-utils.mjs'

const sourceUrl = process.env.DATABASE_URL
const verifyUrl = process.env.POSTGRES_BACKUP_VERIFY_URL
if (!sourceUrl) throw new Error('DATABASE_URL is required')
if (!verifyUrl) throw new Error('POSTGRES_BACKUP_VERIFY_URL is required')

const backupDir = path.resolve(process.env.BACKUP_DIR || 'backups')
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
fs.mkdirSync(backupDir, { recursive: true })
if (offsiteDir) {
	assertIndependentBackupMount(
		offsiteDir,
		process.env.BACKUP_OFFSITE_MOUNTPOINT?.trim(),
		Number(process.env.BACKUP_OFFSITE_MIN_FREE_BYTES || 0),
	)
}
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const outputPath = path.join(backupDir, `postgres-${stamp}.dump`)
const partial = `${outputPath}.partial-${process.pid}`

try {
	await createPostgresBackup({ outputPath: partial, sourceUrl })
	const summary = await verifyPostgresBackup({
		backupPath: partial,
		sourceUrl,
		verifyUrl,
		expectedUsername,
	})
	fs.renameSync(partial, outputPath)
	const receipt = await writePostgresBackupReceipt({
		backupPath: outputPath,
		sourceUrl,
		verifyUrl,
		summary,
		identityVerified: Boolean(expectedUsername),
	})
	const mb = (fs.statSync(outputPath).size / 1024 / 1024).toFixed(2)
	console.log(
		`✅ PostgreSQL backup written and restore-tested: ${outputPath} (${mb} MB)`,
	)
	console.log(
		`   users=${summary.users}, watchlists=${summary.watchlists}, entries=${summary.entries}, media=${summary.media}, migrations=${summary.migrations}`,
	)
	console.log(`   restore receipt=${receipt.path}`)
	for (const backup of prunePostgresBackups(backupDir, keep)) {
		console.log(`🗑  Pruned old PostgreSQL backup: ${backup}`)
	}

	if (offsiteDir) {
		// The source archive already passed a full restore. Reuse the existing
		// atomic copy boundary, then keep PostgreSQL retention separate from SQLite.
		if (!fs.existsSync(offsiteDir) || !fs.statSync(offsiteDir).isDirectory()) {
			throw new Error(
				'BACKUP_OFFSITE_DIR must already exist and be mounted/synced',
			)
		}
		if (fs.realpathSync(offsiteDir) === fs.realpathSync(backupDir)) {
			throw new Error('BACKUP_OFFSITE_DIR must differ from BACKUP_DIR')
		}
		const destination = path.join(offsiteDir, path.basename(outputPath))
		const destinationPartial = `${destination}.partial-${process.pid}`
		try {
			fs.copyFileSync(outputPath, destinationPartial)
			await inspectPostgresBackup({
				backupPath: destinationPartial,
				connectionUrl: verifyUrl,
			})
			fs.renameSync(destinationPartial, destination)
		} finally {
			fs.rmSync(destinationPartial, { force: true })
		}
		if ((await sha256File(destination)) !== receipt.receipt.archive.sha256) {
			throw new Error('PostgreSQL offsite copy SHA-256 does not match receipt')
		}
		const destinationReceipt = `${destination}.restore-verified.json`
		const receiptPartial = `${destinationReceipt}.partial-${process.pid}`
		try {
			fs.copyFileSync(receipt.path, receiptPartial)
			fs.chmodSync(receiptPartial, 0o600)
			fs.renameSync(receiptPartial, destinationReceipt)
		} finally {
			fs.rmSync(receiptPartial, { force: true })
		}
		console.log(`✅ Verified PostgreSQL offsite copy: ${destination}`)
		for (const backup of prunePostgresBackups(offsiteDir, offsiteKeep)) {
			console.log(`🗑  Pruned old PostgreSQL offsite backup: ${backup}`)
		}
	}
} catch (error) {
	fs.rmSync(partial, { force: true })
	throw error
}
