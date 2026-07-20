import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {
	assertSafeRestoreTarget,
	parsePostgresConnection,
	postgresConnectionIdentity,
} from './postgres-backup-utils.mjs'

export function defaultPostgresBackupReceiptPath(backupPath) {
	return `${backupPath}.restore-verified.json`
}

export function sha256File(filename) {
	return new Promise((resolve, reject) => {
		const hash = createHash('sha256')
		const stream = fs.createReadStream(filename)
		stream.on('error', reject)
		stream.on('data', chunk => hash.update(chunk))
		stream.on('end', () => resolve(hash.digest('hex')))
	})
}

function assertSummary(summary) {
	for (const field of [
		'users',
		'watchlists',
		'entries',
		'media',
		'migrations',
	]) {
		if (!Number.isSafeInteger(summary?.[field]) || summary[field] < 0) {
			throw new Error(`Invalid PostgreSQL backup summary field: ${field}`)
		}
	}
}

export async function writePostgresBackupReceipt({
	backupPath,
	sourceUrl,
	verifyUrl,
	summary,
	identityVerified = false,
	receiptPath = defaultPostgresBackupReceiptPath(backupPath),
	now = new Date(),
}) {
	if (!fs.existsSync(backupPath)) {
		throw new Error(`Backup not found: ${backupPath}`)
	}
	assertSummary(summary)
	const source = parsePostgresConnection(sourceUrl, 'DATABASE_URL')
	const restore = parsePostgresConnection(
		verifyUrl,
		'POSTGRES_BACKUP_VERIFY_URL',
	)
	assertSafeRestoreTarget(source, restore)
	const resolvedReceipt = path.resolve(receiptPath)
	const partial = `${resolvedReceipt}.partial-${process.pid}`
	const receipt = {
		version: 1,
		verifiedAt: now.toISOString(),
		sourceTarget: postgresConnectionIdentity(source),
		restoreTarget: postgresConnectionIdentity(restore),
		checks: { expectedIdentity: identityVerified === true },
		archive: {
			name: path.basename(backupPath),
			bytes: fs.statSync(backupPath).size,
			sha256: await sha256File(backupPath),
		},
		summary,
	}
	fs.mkdirSync(path.dirname(resolvedReceipt), { recursive: true })
	try {
		fs.writeFileSync(partial, `${JSON.stringify(receipt, null, 2)}\n`, {
			mode: 0o600,
		})
		fs.renameSync(partial, resolvedReceipt)
		fs.chmodSync(resolvedReceipt, 0o600)
	} finally {
		fs.rmSync(partial, { force: true })
	}
	return { path: resolvedReceipt, receipt }
}
