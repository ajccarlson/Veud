import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { TextDecoder } from 'node:util'
import {
	DEFAULT_POSTGRES_BACKUP_SOURCE_POLICY,
	PRISTINE_EMPTY_POSTGRES_SOURCE_POLICY,
	parsePostgresBackupSourcePolicy,
} from './postgres-backup-operations.mjs'
import {
	assertPrivatePostgresBackupDirectory,
	assertPrivatePostgresBackupFile,
	attestPostgresBackupFile,
	publishPostgresBackupFile,
	removePostgresBackupFileDurably,
	replacePrivatePostgresBackupFileAtomically,
	securePostgresBackupDirectory,
} from './postgres-backup-publication.mjs'
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

const BACKUP_SUMMARY_FIELDS = [
	'users',
	'watchlists',
	'entries',
	'media',
	'migrations',
]
const RECEIPT_FIELDS = [
	'version',
	'verifiedAt',
	'sourceTarget',
	'restoreTarget',
	'checks',
	'archive',
	'summary',
]
const RECEIPT_CHECK_FIELDS = ['expectedIdentity', 'sourcePolicy']
const LEGACY_RECEIPT_CHECK_FIELDS = ['expectedIdentity']
const RECEIPT_ARCHIVE_FIELDS = ['name', 'bytes', 'sha256']
export const MAX_POSTGRES_BACKUP_RECEIPT_BYTES = 64 * 1024

function assertExactObject(value, fields, label) {
	if (
		!value ||
		typeof value !== 'object' ||
		Array.isArray(value) ||
		Object.getPrototypeOf(value) !== Object.prototype
	) {
		throw new Error(`${label} must be an object`)
	}
	const actual = Object.keys(value).sort()
	const expected = [...fields].sort()
	if (
		actual.length !== expected.length ||
		actual.some((field, index) => field !== expected[index])
	) {
		throw new Error(`${label} contains unexpected or missing fields`)
	}
}

function assertSummary(summary) {
	assertExactObject(
		summary,
		BACKUP_SUMMARY_FIELDS,
		'PostgreSQL backup receipt summary',
	)
	for (const field of BACKUP_SUMMARY_FIELDS) {
		if (!Number.isSafeInteger(summary?.[field]) || summary[field] < 0) {
			throw new Error(`Invalid PostgreSQL backup summary field: ${field}`)
		}
	}
}

function hasControlCharacters(value) {
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index)
		if (code <= 0x1f || code === 0x7f) return true
	}
	return false
}

function assertReceiptTarget(value, label) {
	if (
		typeof value !== 'string' ||
		value.length < 5 ||
		value.length > 2_048 ||
		hasControlCharacters(value) ||
		/[\s@]/.test(value)
	) {
		throw new Error(`${label} must be a credential-free PostgreSQL target`)
	}
	const match = /^(.+):([0-9]{1,5})\/([^/]+)$/.exec(value)
	const port = match ? Number(match[2]) : Number.NaN
	if (!match || !match[1] || !match[3] || port < 1 || port > 65_535) {
		throw new Error(`${label} must be a credential-free PostgreSQL target`)
	}
}

function assertReceiptArchiveName(value) {
	if (
		typeof value !== 'string' ||
		!value ||
		value.length > 255 ||
		path.basename(value) !== value ||
		!value.endsWith('.dump') ||
		hasControlCharacters(value)
	) {
		throw new Error(
			'PostgreSQL backup receipt archive name must be a dump filename',
		)
	}
}

function assertReceiptTimestamp(value) {
	if (typeof value !== 'string' || value.length > 64) {
		throw new Error(
			'PostgreSQL backup receipt verifiedAt must be an ISO timestamp',
		)
	}
	const parsed = new Date(value)
	if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value) {
		throw new Error(
			'PostgreSQL backup receipt verifiedAt must be an ISO timestamp',
		)
	}
}

export function validatePostgresBackupReceipt(
	receipt,
	{ archiveName, archiveAttestation } = {},
) {
	assertExactObject(receipt, RECEIPT_FIELDS, 'PostgreSQL backup receipt')
	if (receipt.version !== 1 && receipt.version !== 2) {
		throw new Error('PostgreSQL backup receipt version must be 1 or 2')
	}
	assertReceiptTimestamp(receipt.verifiedAt)
	assertReceiptTarget(
		receipt.sourceTarget,
		'PostgreSQL backup receipt sourceTarget',
	)
	assertReceiptTarget(
		receipt.restoreTarget,
		'PostgreSQL backup receipt restoreTarget',
	)
	if (receipt.sourceTarget === receipt.restoreTarget) {
		throw new Error(
			'PostgreSQL backup receipt restoreTarget must differ from sourceTarget',
		)
	}
	assertExactObject(
		receipt.checks,
		receipt.version === 1 ? LEGACY_RECEIPT_CHECK_FIELDS : RECEIPT_CHECK_FIELDS,
		'PostgreSQL backup receipt checks',
	)
	if (typeof receipt.checks.expectedIdentity !== 'boolean') {
		throw new Error(
			'PostgreSQL backup receipt expectedIdentity must be a boolean',
		)
	}
	let sourcePolicy = DEFAULT_POSTGRES_BACKUP_SOURCE_POLICY
	if (receipt.version === 2) {
		if (
			typeof receipt.checks.sourcePolicy !== 'string' ||
			receipt.checks.sourcePolicy !== receipt.checks.sourcePolicy.trim() ||
			!receipt.checks.sourcePolicy
		) {
			throw new Error(
				'PostgreSQL backup receipt sourcePolicy must be an exact policy name',
			)
		}
		sourcePolicy = parsePostgresBackupSourcePolicy(receipt.checks.sourcePolicy)
	}
	assertExactObject(
		receipt.archive,
		RECEIPT_ARCHIVE_FIELDS,
		'PostgreSQL backup receipt archive',
	)
	assertReceiptArchiveName(receipt.archive.name)
	if (
		!Number.isSafeInteger(receipt.archive.bytes) ||
		receipt.archive.bytes < 1
	) {
		throw new Error(
			'PostgreSQL backup receipt archive bytes must be a positive safe integer',
		)
	}
	if (
		typeof receipt.archive.sha256 !== 'string' ||
		!/^[0-9a-f]{64}$/.test(receipt.archive.sha256)
	) {
		throw new Error(
			'PostgreSQL backup receipt archive sha256 must be lowercase hexadecimal',
		)
	}
	assertSummary(receipt.summary)
	assertSummaryMatchesSourcePolicy(receipt.summary, sourcePolicy)
	if (
		sourcePolicy === PRISTINE_EMPTY_POSTGRES_SOURCE_POLICY &&
		receipt.checks.expectedIdentity
	) {
		throw new Error(
			'pristine-empty-v1 PostgreSQL backups cannot verify an account identity',
		)
	}
	if (archiveName !== undefined && receipt.archive.name !== archiveName) {
		throw new Error(
			'PostgreSQL backup receipt archive name does not match the archive',
		)
	}
	if (
		archiveAttestation !== undefined &&
		(receipt.archive.bytes !== archiveAttestation.bytes ||
			receipt.archive.sha256 !== archiveAttestation.sha256)
	) {
		throw new Error(
			'PostgreSQL backup receipt archive attestation does not match the archive',
		)
	}
	return receipt
}

function readBoundedPrivatePostgresReceipt(
	receiptPath,
	label = 'PostgreSQL backup receipt',
) {
	let descriptor
	try {
		const pathStat = fs.lstatSync(receiptPath, { bigint: true })
		if (pathStat.isSymbolicLink() || !pathStat.isFile()) {
			throw new Error(`${label} must be a regular non-symlink file`)
		}
		if (
			pathStat.size < 1n ||
			pathStat.size > BigInt(MAX_POSTGRES_BACKUP_RECEIPT_BYTES)
		) {
			throw new Error(
				`${label} must be between 1 and ${MAX_POSTGRES_BACKUP_RECEIPT_BYTES} bytes`,
			)
		}
		descriptor = fs.openSync(
			receiptPath,
			fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
		)
		const before = fs.fstatSync(descriptor, { bigint: true })
		if (
			!before.isFile() ||
			before.dev !== pathStat.dev ||
			before.ino !== pathStat.ino ||
			before.size !== pathStat.size
		) {
			throw new Error(`${label} changed while it was opened`)
		}
		const contents = Buffer.alloc(Number(before.size))
		let offset = 0
		while (offset < contents.length) {
			const count = fs.readSync(
				descriptor,
				contents,
				offset,
				contents.length - offset,
				null,
			)
			if (count < 1) throw new Error(`${label} changed while it was read`)
			offset += count
		}
		const trailing = Buffer.allocUnsafe(1)
		if (fs.readSync(descriptor, trailing, 0, 1, null) !== 0) {
			throw new Error(`${label} changed while it was read`)
		}
		const after = fs.fstatSync(descriptor, { bigint: true })
		if (
			after.dev !== before.dev ||
			after.ino !== before.ino ||
			after.size !== before.size ||
			after.mtimeNs !== before.mtimeNs ||
			after.ctimeNs !== before.ctimeNs
		) {
			throw new Error(`${label} changed while it was read`)
		}
		const attestation = {
			device: after.dev.toString(),
			inode: after.ino.toString(),
			bytes: Number(after.size),
			sha256: createHash('sha256').update(contents).digest('hex'),
		}
		assertPrivatePostgresBackupDirectory(
			path.dirname(receiptPath),
			`${label} parent directory`,
		)
		return {
			attestation,
			text: new TextDecoder('utf-8', { fatal: true }).decode(contents),
		}
	} catch (error) {
		if (error instanceof Error && error.message.startsWith(label)) throw error
		throw new Error(`${label} could not be safely read`, { cause: error })
	} finally {
		if (descriptor !== undefined) fs.closeSync(descriptor)
	}
}

export function readAndValidatePostgresBackupReceipt({
	receiptPath,
	backupPath,
	archiveAttestation,
	archiveName = path.basename(backupPath),
	label = 'PostgreSQL backup receipt',
}) {
	const verifiedArchive = assertPrivatePostgresBackupFile(
		backupPath,
		archiveAttestation,
		`${label} archive`,
	)
	const bounded = readBoundedPrivatePostgresReceipt(receiptPath, label)
	assertPrivatePostgresBackupFile(receiptPath, bounded.attestation, label)
	let receipt
	try {
		receipt = JSON.parse(bounded.text)
	} catch {
		throw new Error(`${label} must contain valid JSON`)
	}
	validatePostgresBackupReceipt(receipt, {
		archiveName,
		archiveAttestation: verifiedArchive,
	})
	assertPrivatePostgresBackupFile(
		backupPath,
		verifiedArchive,
		`${label} archive`,
	)
	assertPrivatePostgresBackupFile(receiptPath, bounded.attestation, label)
	return {
		receipt,
		receiptAttestation: bounded.attestation,
		archiveAttestation: verifiedArchive,
		sourcePolicy:
			receipt.version === 1
				? DEFAULT_POSTGRES_BACKUP_SOURCE_POLICY
				: receipt.checks.sourcePolicy,
	}
}

function assertSummaryMatchesSourcePolicy(summary, sourcePolicy) {
	if (
		sourcePolicy === PRISTINE_EMPTY_POSTGRES_SOURCE_POLICY &&
		(Object.keys(summary).length !== BACKUP_SUMMARY_FIELDS.length ||
			BACKUP_SUMMARY_FIELDS.some(field => summary[field] !== 0))
	) {
		throw new Error(
			'pristine-empty-v1 PostgreSQL backup summary must contain exact zero counts',
		)
	}
}

export async function writePostgresBackupReceipt({
	backupPath,
	sourceUrl,
	verifyUrl,
	summary,
	sourcePolicy,
	identityVerified = false,
	receiptPath = defaultPostgresBackupReceiptPath(backupPath),
	archiveName = path.basename(backupPath),
	archiveAttestation,
	now = new Date(),
	replaceExistingReceipt = false,
}) {
	const policy = parsePostgresBackupSourcePolicy(sourcePolicy)
	if (typeof identityVerified !== 'boolean') {
		throw new Error('PostgreSQL backup identityVerified must be a boolean')
	}
	if (typeof replaceExistingReceipt !== 'boolean') {
		throw new Error(
			'PostgreSQL backup replaceExistingReceipt must be a boolean',
		)
	}
	if (!archiveAttestation) {
		throw new Error(
			'PostgreSQL backup receipt requires the restore-verified archive attestation',
		)
	}
	const verifiedArchive = attestPostgresBackupFile(
		backupPath,
		archiveAttestation,
		'Restore-verified PostgreSQL archive',
	)
	assertSummary(summary)
	assertSummaryMatchesSourcePolicy(summary, policy)
	assertReceiptArchiveName(archiveName)
	if (
		policy === PRISTINE_EMPTY_POSTGRES_SOURCE_POLICY &&
		identityVerified === true
	) {
		throw new Error(
			'pristine-empty-v1 PostgreSQL backups cannot verify an account identity',
		)
	}
	const source = parsePostgresConnection(sourceUrl, 'DATABASE_URL')
	const restore = parsePostgresConnection(
		verifyUrl,
		'POSTGRES_BACKUP_VERIFY_URL',
	)
	assertSafeRestoreTarget(source, restore)
	const resolvedReceipt = path.resolve(receiptPath)
	const partial = `${resolvedReceipt}.partial-${process.pid}`
	let partialCreated = false
	let existingReceipt
	const receipt = {
		version: 2,
		verifiedAt:
			now instanceof Date && Number.isFinite(now.valueOf())
				? now.toISOString()
				: undefined,
		sourceTarget: postgresConnectionIdentity(source),
		restoreTarget: postgresConnectionIdentity(restore),
		checks: {
			expectedIdentity: identityVerified === true,
			sourcePolicy: policy,
		},
		archive: {
			name: archiveName,
			bytes: verifiedArchive.bytes,
			sha256: verifiedArchive.sha256,
		},
		summary: Object.fromEntries(
			BACKUP_SUMMARY_FIELDS.map(field => [field, summary[field]]),
		),
	}
	validatePostgresBackupReceipt(receipt, {
		archiveName,
		archiveAttestation: verifiedArchive,
	})
	securePostgresBackupDirectory(
		path.dirname(resolvedReceipt),
		'PostgreSQL backup receipt directory',
	)
	if (replaceExistingReceipt) {
		if (archiveName !== path.basename(backupPath)) {
			throw new Error(
				'PostgreSQL backup receipt replacement requires the archive filename',
			)
		}
		existingReceipt = readAndValidatePostgresBackupReceipt({
			receiptPath: resolvedReceipt,
			backupPath,
			archiveAttestation: verifiedArchive,
			archiveName,
			label: 'Existing PostgreSQL backup receipt',
		})
	}
	try {
		fs.writeFileSync(partial, `${JSON.stringify(receipt, null, 2)}\n`, {
			mode: 0o600,
			flag: 'wx',
		})
		partialCreated = true
		const stagedReceipt = readAndValidatePostgresBackupReceipt({
			receiptPath: partial,
			backupPath,
			archiveAttestation: verifiedArchive,
			archiveName,
			label: 'Staged PostgreSQL backup receipt',
		})
		if (replaceExistingReceipt) {
			replacePrivatePostgresBackupFileAtomically(
				partial,
				resolvedReceipt,
				stagedReceipt.receiptAttestation,
				existingReceipt.receiptAttestation,
			)
			partialCreated = false
		} else {
			publishPostgresBackupFile(
				partial,
				resolvedReceipt,
				stagedReceipt.receiptAttestation,
			)
			partialCreated = false
		}
	} finally {
		if (partialCreated) removePostgresBackupFileDurably(partial)
	}
	return { path: resolvedReceipt, receipt }
}

export function replacePostgresBackupReceipt(options) {
	return writePostgresBackupReceipt({
		...options,
		replaceExistingReceipt: true,
	})
}
