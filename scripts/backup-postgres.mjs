#!/usr/bin/env node
import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { retentionFromEnvironment } from './backup-retention.mjs'
import {
	assertBackupDirectoryFreeSpace,
	parsePositiveInteger,
} from './backup-utils.mjs'
import {
	DEFAULT_POSTGRES_BACKUP_SOURCE_POLICY,
	createPostgresBackup,
	inspectPostgresBackup,
	parsePostgresBackupSourcePolicy,
	verifyPostgresBackup,
} from './postgres-backup-operations.mjs'
import {
	attestPostgresBackupFile,
	cleanupInterruptedPostgresBackupArtifacts,
	copyPostgresBackupToPrivatePath,
	publishPostgresBackupArtifacts,
	removePostgresBackupFileDurably,
	securePostgresBackupDirectory,
} from './postgres-backup-publication.mjs'
import {
	defaultPostgresBackupReceiptPath,
	writePostgresBackupReceipt,
} from './postgres-backup-receipt.mjs'
import {
	assertIndependentBackupMount,
	prunePostgresBackupsByRetention,
} from './postgres-backup-utils.mjs'

const sourceUrl = process.env.DATABASE_URL
const verifyUrl = process.env.POSTGRES_BACKUP_VERIFY_URL
if (!sourceUrl) throw new Error('DATABASE_URL is required')
if (!verifyUrl) throw new Error('POSTGRES_BACKUP_VERIFY_URL is required')
const sourcePolicy = parsePostgresBackupSourcePolicy(
	process.env.BACKUP_SOURCE_POLICY,
)

const backupDir = path.resolve(process.env.BACKUP_DIR || 'backups')
const retention = retentionFromEnvironment(process.env)
const offsiteDir = process.env.BACKUP_OFFSITE_DIR
	? path.resolve(process.env.BACKUP_OFFSITE_DIR)
	: undefined
// The offsite copy keeps its own recent window; day and week tiers match,
// since depth is the point of holding a second copy at all.
const offsiteRetention = {
	...retention,
	recent: parsePositiveInteger(
		process.env.BACKUP_OFFSITE_KEEP,
		retention.recent,
		'BACKUP_OFFSITE_KEEP',
	),
}
const expectedUsername =
	sourcePolicy === DEFAULT_POSTGRES_BACKUP_SOURCE_POLICY
		? process.env.BACKUP_VERIFY_USERNAME?.trim() || undefined
		: undefined
securePostgresBackupDirectory(backupDir)
const orphanGrace = process.env.POSTGRES_BACKUP_ORPHAN_GRACE_MS?.trim()
const cleanupOptions = orphanGrace
	? { orphanGraceMs: Number(orphanGrace) }
	: undefined
for (const artifact of cleanupInterruptedPostgresBackupArtifacts(
	backupDir,
	cleanupOptions,
)) {
	console.log(`🗑  Removed interrupted PostgreSQL backup artifact: ${artifact}`)
}
assertBackupDirectoryFreeSpace(
	backupDir,
	Number(process.env.BACKUP_MIN_FREE_BYTES || 0),
)
if (offsiteDir) {
	assertIndependentBackupMount(
		offsiteDir,
		process.env.BACKUP_OFFSITE_MOUNTPOINT?.trim(),
		Number(process.env.BACKUP_OFFSITE_MIN_FREE_BYTES || 0),
	)
	securePostgresBackupDirectory(
		offsiteDir,
		'PostgreSQL offsite backup directory',
	)
	for (const artifact of cleanupInterruptedPostgresBackupArtifacts(
		offsiteDir,
		cleanupOptions,
	)) {
		console.log(
			`🗑  Removed interrupted PostgreSQL offsite artifact: ${artifact}`,
		)
	}
}
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const outputPath = path.join(backupDir, `postgres-${stamp}.dump`)
const partial = `${outputPath}.partial-${process.pid}`
const receiptPath = defaultPostgresBackupReceiptPath(outputPath)
const receiptPartial = `${receiptPath}.publication-${process.pid}`
const publishedPaths = []
let destination
let destinationPartial
let destinationReceipt
let destinationReceiptPartial
let summary
let receipt
let localArchiveAttestation
let offsiteArchiveAttestation
let localReceiptAttestation
let offsiteReceiptAttestation

try {
	const localFinalPaths = [outputPath, receiptPath]
	if (localFinalPaths.some(filename => fs.existsSync(filename))) {
		throw new Error('PostgreSQL backup publication target already exists')
	}
	await createPostgresBackup({
		outputPath: partial,
		sourceUrl,
		sourcePolicy,
	})
	localArchiveAttestation = attestPostgresBackupFile(
		partial,
		undefined,
		'PostgreSQL staged archive',
	)
	summary = await verifyPostgresBackup({
		backupPath: partial,
		sourceUrl,
		verifyUrl,
		expectedUsername,
		sourcePolicy,
	})
	attestPostgresBackupFile(
		partial,
		localArchiveAttestation,
		'PostgreSQL staged archive',
	)
	const stagedReceipt = await writePostgresBackupReceipt({
		backupPath: partial,
		sourceUrl,
		verifyUrl,
		summary,
		identityVerified: Boolean(expectedUsername),
		sourcePolicy,
		receiptPath: receiptPartial,
		archiveName: path.basename(outputPath),
		archiveAttestation: localArchiveAttestation,
	})
	localReceiptAttestation = attestPostgresBackupFile(
		stagedReceipt.path,
		undefined,
		'PostgreSQL staged receipt',
	)
	if (
		stagedReceipt.receipt.archive.sha256 !== localArchiveAttestation.sha256 ||
		stagedReceipt.receipt.archive.bytes !== localArchiveAttestation.bytes
	) {
		throw new Error('PostgreSQL staged archive differs from its receipt')
	}

	if (offsiteDir) {
		if (!fs.existsSync(offsiteDir) || !fs.statSync(offsiteDir).isDirectory()) {
			throw new Error(
				'BACKUP_OFFSITE_DIR must already exist and be mounted/synced',
			)
		}
		if (fs.realpathSync(offsiteDir) === fs.realpathSync(backupDir)) {
			throw new Error('BACKUP_OFFSITE_DIR must differ from BACKUP_DIR')
		}
		destination = path.join(offsiteDir, path.basename(outputPath))
		destinationPartial = `${destination}.partial-${process.pid}`
		destinationReceipt = defaultPostgresBackupReceiptPath(destination)
		destinationReceiptPartial = `${destinationReceipt}.publication-${process.pid}`
		if (
			[destination, destinationReceipt].some(filename =>
				fs.existsSync(filename),
			)
		) {
			throw new Error('PostgreSQL offsite publication target already exists')
		}
		offsiteArchiveAttestation = copyPostgresBackupToPrivatePath(
			partial,
			destinationPartial,
			localArchiveAttestation,
			'PostgreSQL staged offsite archive',
		)
		await inspectPostgresBackup({
			backupPath: destinationPartial,
			connectionUrl: verifyUrl,
		})
		attestPostgresBackupFile(
			destinationPartial,
			offsiteArchiveAttestation,
			'PostgreSQL staged offsite archive',
		)
		if (
			offsiteArchiveAttestation.sha256 !== stagedReceipt.receipt.archive.sha256
		) {
			throw new Error('PostgreSQL offsite copy SHA-256 does not match receipt')
		}
		offsiteReceiptAttestation = copyPostgresBackupToPrivatePath(
			stagedReceipt.path,
			destinationReceiptPartial,
			localReceiptAttestation,
			'PostgreSQL staged offsite receipt',
		)
	}

	publishPostgresBackupArtifacts(
		{
			localArchive: {
				source: partial,
				target: outputPath,
				expected: localArchiveAttestation,
			},
			localReceipt: {
				source: stagedReceipt.path,
				target: receiptPath,
				expected: localReceiptAttestation,
			},
			...(destination
				? {
						offsiteArchive: {
							source: destinationPartial,
							target: destination,
							expected: offsiteArchiveAttestation,
						},
						offsiteReceipt: {
							source: destinationReceiptPartial,
							target: destinationReceipt,
							expected: offsiteReceiptAttestation,
						},
					}
				: {}),
		},
		undefined,
		filename => publishedPaths.push(filename),
	)
	receipt = { path: receiptPath, receipt: stagedReceipt.receipt }
} catch (error) {
	removePostgresBackupFileDurably(partial)
	removePostgresBackupFileDurably(receiptPartial)
	if (destinationPartial) removePostgresBackupFileDurably(destinationPartial)
	if (destinationReceiptPartial)
		removePostgresBackupFileDurably(destinationReceiptPartial)
	for (const filename of publishedPaths.reverse()) {
		removePostgresBackupFileDurably(filename)
	}
	throw error
}

const mb = (fs.statSync(outputPath).size / 1024 / 1024).toFixed(2)
console.log(
	`✅ PostgreSQL backup written and restore-tested: ${outputPath} (${mb} MB)`,
)
console.log(
	`   users=${summary.users}, watchlists=${summary.watchlists}, entries=${summary.entries}, media=${summary.media}, migrations=${summary.migrations}`,
)
console.log(`   restore receipt=${receipt.path}`)
for (const backup of prunePostgresBackupsByRetention(backupDir, retention)) {
	console.log(`🗑  Pruned old PostgreSQL backup: ${backup}`)
}

if (destination) {
	console.log(`✅ Verified PostgreSQL offsite copy: ${destination}`)
	for (const backup of prunePostgresBackupsByRetention(
		offsiteDir,
		offsiteRetention,
	)) {
		console.log(`🗑  Pruned old PostgreSQL offsite backup: ${backup}`)
	}
}
