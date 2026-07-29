import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { attestPostgresBackupFile } from './postgres-backup-publication.mjs'
import {
	defaultPostgresBackupReceiptPath,
	MAX_POSTGRES_BACKUP_RECEIPT_BYTES,
	readAndValidatePostgresBackupReceipt,
	replacePostgresBackupReceipt,
	sha256File,
	writePostgresBackupReceipt,
} from './postgres-backup-receipt.mjs'
import {
	executePostgresCanary,
	normalizeCanaryOrigin,
	summarizeDurations,
} from './postgres-canary-utils.mjs'
import {
	evaluatePostgresCutoverEvidence,
	requiredLoadQueries,
} from './postgres-cutover-utils.mjs'

const now = new Date('2026-07-20T12:00:00.000Z')

test('writes a credential-free private restore-verification receipt', async () => {
	const tempDir = fs.mkdtempSync(
		path.join(os.tmpdir(), 'veud-backup-receipt-test-'),
	)
	try {
		const backupPath = path.join(tempDir, 'postgres-test.dump')
		fs.writeFileSync(backupPath, 'verified archive', { mode: 0o600 })
		const result = await writePostgresBackupReceipt({
			backupPath,
			sourceUrl: 'postgresql://veud:primary-secret@db.example/veud',
			verifyUrl: 'postgresql://veud:restore-secret@db.example/veud_restore',
			summary: {
				users: 2,
				watchlists: 3,
				entries: 4,
				media: 5,
				migrations: 6,
			},
			archiveAttestation: attestPostgresBackupFile(backupPath),
			now,
		})

		expect(result.path).toBe(defaultPostgresBackupReceiptPath(backupPath))
		expect(result.receipt).toMatchObject({
			version: 2,
			verifiedAt: now.toISOString(),
			sourceTarget: 'db.example:5432/veud',
			restoreTarget: 'db.example:5432/veud_restore',
			checks: {
				expectedIdentity: false,
				sourcePolicy: 'migrated-veud-v1',
			},
			archive: { name: 'postgres-test.dump', bytes: 16 },
		})
		expect(result.receipt.archive.sha256).toBe(await sha256File(backupPath))
		expect(fs.statSync(result.path).mode & 0o777).toBe(0o600)
		expect(fs.readFileSync(result.path, 'utf8')).not.toContain('secret')
		expect(
			readAndValidatePostgresBackupReceipt({
				receiptPath: result.path,
				backupPath,
				archiveAttestation: attestPostgresBackupFile(backupPath),
			}).receipt,
		).toEqual(result.receipt)
	} finally {
		fs.rmSync(tempDir, { recursive: true, force: true })
	}
})

test('refuses to publish a receipt after the verified archive inode changes', async () => {
	const tempDir = fs.mkdtempSync(
		path.join(os.tmpdir(), 'veud-backup-receipt-swap-test-'),
	)
	try {
		const backupPath = path.join(tempDir, 'postgres-test.dump')
		fs.writeFileSync(backupPath, 'verified archive', { mode: 0o600 })
		const archiveAttestation = attestPostgresBackupFile(backupPath)
		fs.rmSync(backupPath)
		fs.writeFileSync(backupPath, 'verified archive', { mode: 0o600 })
		await expect(
			writePostgresBackupReceipt({
				backupPath,
				sourceUrl: 'postgresql://veud:source@db.example/veud',
				verifyUrl: 'postgresql://veud:restore@db.example/veud_restore',
				summary: {
					users: 0,
					watchlists: 0,
					entries: 0,
					media: 0,
					migrations: 0,
				},
				archiveAttestation,
			}),
		).rejects.toThrow('changed after it was staged')
		expect(fs.existsSync(defaultPostgresBackupReceiptPath(backupPath))).toBe(
			false,
		)
	} finally {
		fs.rmSync(tempDir, { recursive: true, force: true })
	}
})

test('accepts exact legacy-v1 evidence and rotates it to v2', async () => {
	const tempDir = fs.mkdtempSync(
		path.join(os.tmpdir(), 'veud-legacy-backup-receipt-test-'),
	)
	try {
		const backupPath = path.join(tempDir, 'postgres-legacy.dump')
		const receiptPath = defaultPostgresBackupReceiptPath(backupPath)
		fs.writeFileSync(backupPath, 'legacy archive', { mode: 0o600 })
		const archiveAttestation = attestPostgresBackupFile(backupPath)
		const summary = {
			users: 2,
			watchlists: 3,
			entries: 4,
			media: 5,
			migrations: 6,
		}
		const legacyReceipt = {
			version: 1,
			verifiedAt: now.toISOString(),
			sourceTarget: 'db.example:5432/veud',
			restoreTarget: 'db.example:5432/veud_restore',
			checks: { expectedIdentity: false },
			archive: {
				name: path.basename(backupPath),
				bytes: archiveAttestation.bytes,
				sha256: archiveAttestation.sha256,
			},
			summary,
		}
		fs.writeFileSync(receiptPath, `${JSON.stringify(legacyReceipt)}\n`, {
			mode: 0o600,
		})
		const legacyInode = fs.statSync(receiptPath).ino
		const validatedLegacy = readAndValidatePostgresBackupReceipt({
			receiptPath,
			backupPath,
			archiveAttestation,
		})
		expect(validatedLegacy.receipt).toEqual(legacyReceipt)
		expect(validatedLegacy.sourcePolicy).toBe('migrated-veud-v1')

		await replacePostgresBackupReceipt({
			backupPath,
			sourceUrl: 'postgresql://veud:source@db.example/veud',
			verifyUrl: 'postgresql://veud:restore@db.example/veud_restore',
			summary,
			archiveAttestation,
			now: new Date('2026-07-21T12:00:00.000Z'),
		})
		const rotated = readAndValidatePostgresBackupReceipt({
			receiptPath,
			backupPath,
			archiveAttestation,
		}).receipt
		expect(rotated.version).toBe(2)
		expect(rotated.checks).toEqual({
			expectedIdentity: false,
			sourcePolicy: 'migrated-veud-v1',
		})
		expect(fs.statSync(receiptPath).ino).not.toBe(legacyInode)
	} finally {
		fs.rmSync(tempDir, { recursive: true, force: true })
	}
})

test('strictly rejects malformed, unbounded, and symlink restore receipts', async () => {
	const tempDir = fs.mkdtempSync(
		path.join(os.tmpdir(), 'veud-strict-backup-receipt-test-'),
	)
	try {
		const backupPath = path.join(tempDir, 'postgres-strict.dump')
		const receiptPath = defaultPostgresBackupReceiptPath(backupPath)
		fs.writeFileSync(backupPath, 'strict archive', { mode: 0o600 })
		const archiveAttestation = attestPostgresBackupFile(backupPath)
		const result = await writePostgresBackupReceipt({
			backupPath,
			sourceUrl: 'postgresql://veud:source@db.example/veud',
			verifyUrl: 'postgresql://veud:restore@db.example/veud_restore',
			summary: {
				users: 1,
				watchlists: 2,
				entries: 3,
				media: 4,
				migrations: 5,
			},
			archiveAttestation,
			now,
		})
		const malformedReceipts = [
			{ ...result.receipt, unexpected: true },
			{
				...result.receipt,
				checks: { ...result.receipt.checks, unexpected: true },
			},
			{
				...result.receipt,
				checks: { ...result.receipt.checks, sourcePolicy: '' },
			},
			{
				...result.receipt,
				summary: { ...result.receipt.summary, unexpected: 1 },
			},
			{ ...result.receipt, version: 1 },
			{ ...result.receipt, version: '1' },
			{ ...result.receipt, verifiedAt: 'July 20, 2026' },
			{
				...result.receipt,
				restoreTarget: result.receipt.sourceTarget,
			},
			{
				...result.receipt,
				archive: {
					...result.receipt.archive,
					bytes: result.receipt.archive.bytes + 1,
				},
			},
			{
				...result.receipt,
				archive: {
					...result.receipt.archive,
					sha256: result.receipt.archive.sha256.toUpperCase(),
				},
			},
		]

		for (const malformed of malformedReceipts) {
			fs.rmSync(receiptPath)
			fs.writeFileSync(receiptPath, JSON.stringify(malformed), { mode: 0o600 })
			expect(() =>
				readAndValidatePostgresBackupReceipt({
					receiptPath,
					backupPath,
					archiveAttestation,
				}),
			).toThrow()
		}

		fs.chmodSync(receiptPath, 0o644)
		expect(() =>
			readAndValidatePostgresBackupReceipt({
				receiptPath,
				backupPath,
				archiveAttestation,
			}),
		).toThrow('owned by this process and mode 0600')
		fs.chmodSync(receiptPath, 0o600)

		fs.rmSync(receiptPath)
		fs.writeFileSync(
			receiptPath,
			Buffer.alloc(MAX_POSTGRES_BACKUP_RECEIPT_BYTES + 1, 0x20),
			{ mode: 0o600 },
		)
		expect(() =>
			readAndValidatePostgresBackupReceipt({
				receiptPath,
				backupPath,
				archiveAttestation,
			}),
		).toThrow(`between 1 and ${MAX_POSTGRES_BACKUP_RECEIPT_BYTES} bytes`)

		const symlinkTarget = path.join(tempDir, 'untrusted-receipt.json')
		fs.writeFileSync(symlinkTarget, JSON.stringify(result.receipt), {
			mode: 0o600,
		})
		fs.rmSync(receiptPath)
		fs.symlinkSync(symlinkTarget, receiptPath)
		expect(() =>
			readAndValidatePostgresBackupReceipt({
				receiptPath,
				backupPath,
				archiveAttestation,
			}),
		).toThrow('regular non-symlink file')
	} finally {
		fs.rmSync(tempDir, { recursive: true, force: true })
	}
})

test('manual receipt re-verification replaces valid evidence atomically', async () => {
	const tempDir = fs.mkdtempSync(
		path.join(os.tmpdir(), 'veud-replace-backup-receipt-test-'),
	)
	try {
		const backupPath = path.join(tempDir, 'postgres-reverify.dump')
		fs.writeFileSync(backupPath, 'reverified archive', { mode: 0o600 })
		const archiveAttestation = attestPostgresBackupFile(backupPath)
		const options = {
			backupPath,
			sourceUrl: 'postgresql://veud:source@db.example/veud',
			verifyUrl: 'postgresql://veud:restore@db.example/veud_restore',
			summary: {
				users: 2,
				watchlists: 3,
				entries: 4,
				media: 5,
				migrations: 6,
			},
			archiveAttestation,
		}
		const original = await writePostgresBackupReceipt({ ...options, now })
		const originalContents = fs.readFileSync(original.path, 'utf8')
		const originalInode = fs.statSync(original.path).ino

		await expect(
			writePostgresBackupReceipt({
				...options,
				now: new Date('2026-07-21T12:00:00.000Z'),
			}),
		).rejects.toThrow('publication target already exists')
		expect(fs.readFileSync(original.path, 'utf8')).toBe(originalContents)

		const replacementTime = new Date('2026-07-22T12:00:00.000Z')
		await replacePostgresBackupReceipt({
			...options,
			now: replacementTime,
		})
		const validated = readAndValidatePostgresBackupReceipt({
			receiptPath: original.path,
			backupPath,
			archiveAttestation,
		})
		expect(validated.receipt.verifiedAt).toBe(replacementTime.toISOString())
		expect(fs.statSync(original.path).ino).not.toBe(originalInode)
		expect(fs.statSync(original.path).mode & 0o777).toBe(0o600)

		fs.writeFileSync(original.path, '{"version":1}\n', { mode: 0o600 })
		const malformedContents = fs.readFileSync(original.path, 'utf8')
		await expect(
			replacePostgresBackupReceipt({
				...options,
				now: new Date('2026-07-23T12:00:00.000Z'),
			}),
		).rejects.toThrow('unexpected or missing fields')
		expect(fs.readFileSync(original.path, 'utf8')).toBe(malformedContents)
	} finally {
		fs.rmSync(tempDir, { recursive: true, force: true })
	}
})

test('records pristine-empty policy only with an exact zero summary', async () => {
	const tempDir = fs.mkdtempSync(
		path.join(os.tmpdir(), 'veud-pristine-backup-receipt-test-'),
	)
	try {
		const backupPath = path.join(tempDir, 'postgres-pristine.dump')
		const receiptPath = defaultPostgresBackupReceiptPath(backupPath)
		fs.writeFileSync(backupPath, 'verified pristine archive', { mode: 0o600 })
		const options = {
			backupPath,
			sourceUrl: 'postgresql://veud:source-secret@db.example/veud',
			verifyUrl: 'postgresql://veud:restore-secret@db.example/veud_restore',
			sourcePolicy: 'pristine-empty-v1',
			summary: {
				users: 0,
				watchlists: 0,
				entries: 0,
				media: 0,
				migrations: 0,
			},
			archiveAttestation: attestPostgresBackupFile(backupPath),
			now,
		}

		const result = await writePostgresBackupReceipt(options)
		expect(result.receipt.checks).toEqual({
			expectedIdentity: false,
			sourcePolicy: 'pristine-empty-v1',
		})
		expect(result.receipt.summary).toEqual(options.summary)

		fs.rmSync(receiptPath)
		await expect(
			writePostgresBackupReceipt({
				...options,
				summary: { ...options.summary, migrations: 1 },
			}),
		).rejects.toThrow(
			'pristine-empty-v1 PostgreSQL backup summary must contain exact zero counts',
		)
		expect(fs.existsSync(receiptPath)).toBe(false)

		await expect(
			writePostgresBackupReceipt({
				...options,
				identityVerified: true,
			}),
		).rejects.toThrow(
			'pristine-empty-v1 PostgreSQL backups cannot verify an account identity',
		)
		expect(fs.existsSync(receiptPath)).toBe(false)

		await expect(
			writePostgresBackupReceipt({
				...options,
				sourcePolicy: 'pristine-empty',
			}),
		).rejects.toThrow(
			'BACKUP_SOURCE_POLICY must be migrated-veud-v1 or pristine-empty-v1',
		)
		expect(fs.existsSync(receiptPath)).toBe(false)
	} finally {
		fs.rmSync(tempDir, { recursive: true, force: true })
	}
})

test('allows local HTTP and requires HTTPS without URL credentials', () => {
	expect(normalizeCanaryOrigin('http://localhost:4021')).toBe(
		'http://localhost:4021',
	)
	expect(normalizeCanaryOrigin('https://canary.example.com')).toBe(
		'https://canary.example.com',
	)
	expect(() => normalizeCanaryOrigin('http://canary.example.com')).toThrow(
		'must use https://',
	)
	expect(() =>
		normalizeCanaryOrigin('https://user:secret@canary.example.com'),
	).toThrow('must not contain credentials')
})

test('summarizes percentile latency and exercises every canary path', async () => {
	expect(
		summarizeDurations([
			{ ok: true, durationMs: 1 },
			{ ok: true, durationMs: 2 },
			{ ok: false, durationMs: 9 },
		]),
	).toEqual({ passed: 2, failed: 1, p50Ms: 2, p95Ms: 9, maxMs: 9 })

	const report = await executePostgresCanary({
		origin: 'https://canary.example.com',
		paths: ['/resources/healthcheck', '/credits'],
		requestCount: 4,
		concurrency: 2,
		timeoutMs: 1_000,
		fetchImpl: async url => ({
			ok: true,
			status: 200,
			text: async () =>
				url.pathname === '/resources/healthcheck' ? 'OK' : '<html></html>',
		}),
		now,
	})
	expect(report).toMatchObject({
		version: 1,
		measuredAt: now.toISOString(),
		origin: 'https://canary.example.com',
		requestCount: 4,
		summary: { passed: 4, failed: 0 },
		failures: [],
	})
	expect(report.paths.map(pathResult => pathResult.path)).toEqual([
		'/resources/healthcheck',
		'/credits',
	])
})

function validEvidence() {
	const policy = {
		version: 1,
		approvedBy: 'Deployment Owner',
		approvedAt: '2026-07-20T10:00:00.000Z',
		expectedDatabaseTarget: 'db.example:5432/veud',
		expectedCanaryOrigin: 'https://canary.example.com',
		minimumSyntheticRows: 100_000,
		minimumTransferredTables: 2,
		minimumInsertRowsPerSecond: 2_000,
		minimumConcurrentSearches: 20,
		minimumConcurrentUpdateBatches: 5,
		minimumSyntheticRelations: 5_000,
		minimumSyntheticMembers: 1_000,
		minimumSyntheticTrackingRows: 100_000,
		minimumSyntheticEntries: 100_000,
		minimumSyntheticActivityRows: 20_000,
		minimumConcurrentMemberReads: 20,
		minimumConcurrentTrackingWriteBatches: 5,
		minimumDatabasePressureSamples: 1,
		maximumConnectionUtilization: 0.8,
		maximumWaitingLocks: 0,
		maximumLoadAgeHours: 24,
		maximumTransferAgeHours: 24,
		maximumBackupAgeHours: 4,
		maximumCanaryAgeHours: 1,
		maximumConcurrentWallMs: 2_000,
		maximumCanaryP95Ms: 1_000,
		minimumCanaryRequests: 20,
		minimumCanaryConcurrency: 4,
		requiredCanaryPaths: [
			'/resources/healthcheck',
			'/',
			'/discover',
			'/credits',
		],
		requireBackupIdentity: true,
		requireInterruptedResume: true,
		maximumQueryExecutionMs: Object.fromEntries(
			requiredLoadQueries.map(name => [name, 500]),
		),
		minimumBackupCounts: {
			users: 1,
			watchlists: 1,
			entries: 1,
			media: 1,
			migrations: 1,
		},
	}
	return {
		policy,
		checkpoint: {
			version: 1,
			status: 'completed',
			target: policy.expectedDatabaseTarget,
			sourceSha256: 'a'.repeat(64),
			completedAt: '2026-07-20T11:00:00.000Z',
			completedTables: ['User', 'Media'],
		},
		loadReport: {
			version: 1,
			measuredAt: '2026-07-20T11:00:00.000Z',
			target: policy.expectedDatabaseTarget,
			requestedRows: 100_000,
			loadedRows: 100_000,
			existingRows: 0,
			insertedRows: 100_000,
			insert: { rowsPerSecond: 9_000 },
			recovery: {
				checkpointSha256: '6'.repeat(64),
				observedRowsAtResume: 50_000,
			},
			storageGrowthBytes: 1_000_000,
			missingTrigramIndexes: [],
			queries: requiredLoadQueries.map(name => ({ name, executionMs: 25 })),
			representative: {
				relationRows: 10_000,
				memberCount: 1_000,
				trackingRows: 100_000,
				entryRows: 100_000,
				activityRows: 20_000,
			},
			concurrency: {
				searches: 20,
				updateBatches: 5,
				memberReads: 20,
				trackingWriteBatches: 5,
				databasePressure: {
					sampleCount: 3,
					maxConnections: 100,
					peakTotalConnections: 12,
					peakActiveConnections: 9,
					peakWaitingLocks: 0,
					peakConnectionUtilization: 0.12,
				},
				wallMs: 50,
			},
		},
		loadCheckpoint: {
			version: 1,
			status: 'completed',
			target: policy.expectedDatabaseTarget,
			requestedRows: 100_000,
			initialRows: 0,
			loadedRows: 100_000,
			interruptedAt: '2026-07-20T10:30:00.000Z',
			resumedAt: '2026-07-20T10:35:00.000Z',
			completedAt: '2026-07-20T11:00:00.000Z',
		},
		backupReceipt: {
			version: 2,
			verifiedAt: '2026-07-20T11:30:00.000Z',
			sourceTarget: policy.expectedDatabaseTarget,
			restoreTarget: 'db.example:5432/veud_restore',
			checks: { expectedIdentity: true, sourcePolicy: 'migrated-veud-v1' },
			archive: {
				name: 'postgres-test.dump',
				bytes: 128,
				sha256: 'b'.repeat(64),
			},
			summary: {
				users: 2,
				watchlists: 3,
				entries: 4,
				media: 5,
				migrations: 25,
			},
		},
		canaryReport: {
			version: 1,
			measuredAt: '2026-07-20T11:45:00.000Z',
			origin: policy.expectedCanaryOrigin,
			requestCount: 40,
			concurrency: 4,
			summary: { passed: 40, failed: 0, p95Ms: 100 },
			paths: [
				{ path: '/resources/healthcheck', passed: 10, failed: 0 },
				{ path: '/', passed: 10, failed: 0 },
				{ path: '/discover', passed: 10, failed: 0 },
				{ path: '/credits', passed: 10, failed: 0 },
			],
		},
		actualSnapshot: { bytes: 256, sha256: 'a'.repeat(64) },
		actualBackup: {
			name: 'postgres-test.dump',
			bytes: 128,
			sha256: 'b'.repeat(64),
		},
		evidenceSha256: {
			policy: '1'.repeat(64),
			checkpoint: '2'.repeat(64),
			loadReport: '3'.repeat(64),
			loadCheckpoint: '6'.repeat(64),
			backupReceipt: '4'.repeat(64),
			canaryReport: '5'.repeat(64),
		},
		now,
	}
}

test('passes fresh, target-bound evidence within an approved policy', () => {
	const evidence = validEvidence()
	expect(evaluatePostgresCutoverEvidence(evidence)).toMatchObject({
		version: 1,
		status: 'passed',
		evaluatedAt: now.toISOString(),
		target: evidence.policy.expectedDatabaseTarget,
		approval: { approvedBy: 'Deployment Owner' },
		evidence: {
			transfer: { snapshotSha256: 'a'.repeat(64) },
			load: { loadedRows: 100_000, rowsPerSecond: 9_000 },
			backup: { archiveSha256: 'b'.repeat(64) },
			canary: { requests: 40, p95Ms: 100 },
		},
	})
})

test('rejects stale, undersized, mismatched, or failing evidence together', () => {
	const evidence = validEvidence()
	evidence.checkpoint.sourceSha256 = 'c'.repeat(64)
	evidence.loadReport.loadedRows = 1
	evidence.loadReport.missingTrigramIndexes = ['Media_title_trgm_idx']
	evidence.backupReceipt.sourceTarget = 'other.example:5432/veud'
	evidence.canaryReport.summary = { passed: 39, failed: 1, p95Ms: 2_000 }
	evidence.canaryReport.measuredAt = '2026-07-20T08:00:00.000Z'

	expect(() => evaluatePostgresCutoverEvidence(evidence)).toThrow(
		/transfer snapshot SHA-256.*at least 100000 rows.*trigram index.*backup receipt source.*every canary request.*canary p95.*hours old/s,
	)
})

test('rejects a flat catalog load without representative member evidence', () => {
	const evidence = validEvidence()
	delete evidence.loadReport.representative
	evidence.loadReport.concurrency.memberReads = 0
	evidence.loadReport.concurrency.trackingWriteBatches = 0

	expect(() => evaluatePostgresCutoverEvidence(evidence)).toThrow(
		/representative relations.*representative members.*representative tracking rows.*representative entries.*representative activity rows.*concurrent member reads.*tracking write batches/s,
	)
})

test('rejects load evidence measured against a different database target', () => {
	const evidence = validEvidence()
	evidence.loadReport.target = 'other.example:5432/veud_staging'

	expect(() => evaluatePostgresCutoverEvidence(evidence)).toThrow(
		'load report target does not match policy',
	)
})

test('rejects unproven recovery and excessive database pressure', () => {
	const evidence = validEvidence()
	delete evidence.loadCheckpoint.interruptedAt
	evidence.loadReport.recovery.observedRowsAtResume = 0
	evidence.loadReport.concurrency.databasePressure = {
		sampleCount: 0,
		peakConnectionUtilization: 0.95,
		peakWaitingLocks: 2,
	}

	expect(() => evaluatePostgresCutoverEvidence(evidence)).toThrow(
		/interrupted run resumed.*at least 1 database pressure samples.*connection utilization.*waiting locks/s,
	)
})
