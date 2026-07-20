import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import {
	defaultPostgresBackupReceiptPath,
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
		fs.writeFileSync(backupPath, 'verified archive')
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
			now,
		})

		expect(result.path).toBe(defaultPostgresBackupReceiptPath(backupPath))
		expect(result.receipt).toMatchObject({
			version: 1,
			verifiedAt: now.toISOString(),
			sourceTarget: 'db.example:5432/veud',
			restoreTarget: 'db.example:5432/veud_restore',
			checks: { expectedIdentity: false },
			archive: { name: 'postgres-test.dump', bytes: 16 },
		})
		expect(result.receipt.archive.sha256).toBe(await sha256File(backupPath))
		expect(fs.statSync(result.path).mode & 0o777).toBe(0o600)
		expect(fs.readFileSync(result.path, 'utf8')).not.toContain('secret')
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
			target: 'load.example:5432/veud_load_test',
			requestedRows: 100_000,
			loadedRows: 100_000,
			existingRows: 0,
			insertedRows: 100_000,
			insert: { rowsPerSecond: 9_000 },
			storageGrowthBytes: 1_000_000,
			missingTrigramIndexes: [],
			queries: requiredLoadQueries.map(name => ({ name, executionMs: 25 })),
			concurrency: { searches: 20, updateBatches: 5, wallMs: 50 },
		},
		backupReceipt: {
			version: 1,
			verifiedAt: '2026-07-20T11:30:00.000Z',
			sourceTarget: policy.expectedDatabaseTarget,
			restoreTarget: 'db.example:5432/veud_restore',
			checks: { expectedIdentity: true },
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
