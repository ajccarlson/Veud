import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
	assertPostgresRestoreStagingCapacity,
	assertPrivatePostgresBackupFile,
	attestPostgresBackupFile,
	cleanupInterruptedPostgresBackupArtifacts,
	parsePostgresRestoreStagingReserveBytes,
	postgresBackupPublicationOrder,
	publishPostgresBackupArtifacts,
	publishPostgresBackupFile,
	replacePrivatePostgresBackupFileAtomically,
	securePostgresBackupDirectory,
	withPrivatePostgresRestoreArchive,
} from './postgres-backup-publication.mjs'
import { listPostgresBackups } from './postgres-backup-utils.mjs'

let tempDir

beforeEach(() => {
	tempDir = fs.mkdtempSync(
		path.join(os.tmpdir(), 'veud-postgres-publication-test-'),
	)
})

afterEach(() => {
	fs.rmSync(tempDir, { recursive: true, force: true })
})

function artifact(name, directory = tempDir) {
	const source = path.join(directory, `${name}.staged`)
	const target = path.join(directory, name)
	fs.writeFileSync(source, name, { mode: 0o600 })
	fs.chmodSync(source, 0o600)
	return { source, target }
}

describe('durable PostgreSQL backup publication', () => {
	test('attests regular archive content and inode across restore and publication', () => {
		const staged = artifact('postgres-attested.dump')
		const attestation = attestPostgresBackupFile(
			staged.source,
			undefined,
			'Test archive',
		)
		expect(attestation).toMatchObject({
			bytes: Buffer.byteLength('postgres-attested.dump'),
		})
		expect(attestation.sha256).toMatch(/^[0-9a-f]{64}$/)
		expect(() =>
			attestPostgresBackupFile(staged.source, attestation, 'Test archive'),
		).not.toThrow()

		fs.writeFileSync(staged.source, 'changed archive bytes')
		expect(() =>
			attestPostgresBackupFile(staged.source, attestation, 'Test archive'),
		).toThrow('changed after it was staged')
	})

	test('rejects symlink archives before inspection or publication', () => {
		const target = path.join(tempDir, 'target.dump')
		const symlink = path.join(tempDir, 'postgres-symlink.dump')
		fs.writeFileSync(target, 'archive')
		fs.symlinkSync(target, symlink)
		expect(() =>
			attestPostgresBackupFile(symlink, undefined, 'Test archive'),
		).toThrow('must be a regular non-symlink file')
	})

	test('uses a distinct owner-only archive inside an owner-only restore directory', async () => {
		const source = path.join(tempDir, 'postgres-restore-source.dump')
		fs.writeFileSync(source, 'immutable restore bytes', { mode: 0o600 })
		const sourceAttestation = attestPostgresBackupFile(source)
		let privatePath
		await withPrivatePostgresRestoreArchive(
			source,
			sourceAttestation,
			async staged => {
				privatePath = staged.path
				expect(path.dirname(staged.path)).not.toBe(tempDir)
				expect(fs.statSync(path.dirname(staged.path)).mode & 0o777).toBe(0o700)
				expect(fs.statSync(staged.path).mode & 0o777).toBe(0o600)
				expect(staged.attestation.inode).not.toBe(sourceAttestation.inode)
				expect(staged.attestation.sha256).toBe(sourceAttestation.sha256)
				expect(() =>
					assertPrivatePostgresBackupFile(staged.path, staged.attestation),
				).not.toThrow()
			},
		)
		expect(fs.existsSync(privatePath)).toBe(false)
	})

	test('ignores an ambient TMPDIR that lacks a trusted sticky parent', async () => {
		const source = path.join(tempDir, 'postgres-restore-temp.dump')
		const hostileTemp = path.join(tempDir, 'hostile-temp')
		fs.mkdirSync(hostileTemp, { mode: 0o777 })
		fs.chmodSync(hostileTemp, 0o777)
		fs.writeFileSync(source, 'restore bytes', { mode: 0o600 })
		const previous = process.env.TMPDIR
		process.env.TMPDIR = hostileTemp
		try {
			await withPrivatePostgresRestoreArchive(
				source,
				attestPostgresBackupFile(source),
				async staged => {
					expect(staged.path.startsWith(hostileTemp)).toBe(false)
					expect(path.basename(path.dirname(staged.path))).toMatch(
						/^veud-postgres-restore-/,
					)
				},
			)
		} finally {
			if (previous === undefined) delete process.env.TMPDIR
			else process.env.TMPDIR = previous
		}
	})

	test('uses a configured owner-only staging root after reserving archive capacity', async () => {
		const source = path.join(tempDir, 'postgres-configured-root.dump')
		const stagingRoot = path.join(tempDir, 'restore-staging')
		fs.writeFileSync(source, 'configured restore bytes', { mode: 0o600 })
		fs.mkdirSync(stagingRoot, { mode: 0o700 })
		fs.chmodSync(stagingRoot, 0o700)
		const sourceAttestation = attestPostgresBackupFile(source)
		const reserveBytes = 1_024
		let capacityPath
		let stagedPath

		await withPrivatePostgresRestoreArchive(
			source,
			sourceAttestation,
			async staged => {
				stagedPath = staged.path
				expect(
					path
						.relative(stagingRoot, path.dirname(staged.path))
						.startsWith('..'),
				).toBe(false)
			},
			'Configured restore archive',
			{
				stagingRoot,
				reserveBytes: String(reserveBytes),
				statfs: directory => {
					capacityPath = directory
					return {
						bavail: BigInt(sourceAttestation.bytes + reserveBytes),
						bsize: 1n,
					}
				},
			},
		)

		expect(capacityPath).toBe(stagingRoot)
		expect(fs.existsSync(stagedPath)).toBe(false)
		expect(fs.readdirSync(stagingRoot)).toEqual([])
	})

	test('reads private staging root and reserve from the restore environment', async () => {
		const source = path.join(tempDir, 'postgres-environment-root.dump')
		const stagingRoot = path.join(tempDir, 'environment-staging')
		fs.writeFileSync(source, 'environment restore bytes', { mode: 0o600 })
		fs.mkdirSync(stagingRoot, { mode: 0o700 })
		fs.chmodSync(stagingRoot, 0o700)
		const previousRoot = process.env.POSTGRES_RESTORE_STAGING_ROOT
		const previousReserve = process.env.POSTGRES_RESTORE_STAGING_RESERVE_BYTES
		process.env.POSTGRES_RESTORE_STAGING_ROOT = stagingRoot
		process.env.POSTGRES_RESTORE_STAGING_RESERVE_BYTES = '0'
		try {
			await withPrivatePostgresRestoreArchive(
				source,
				attestPostgresBackupFile(source),
				async staged => {
					expect(staged.path.startsWith(`${stagingRoot}${path.sep}`)).toBe(true)
				},
			)
		} finally {
			if (previousRoot === undefined) {
				delete process.env.POSTGRES_RESTORE_STAGING_ROOT
			} else {
				process.env.POSTGRES_RESTORE_STAGING_ROOT = previousRoot
			}
			if (previousReserve === undefined) {
				delete process.env.POSTGRES_RESTORE_STAGING_RESERVE_BYTES
			} else {
				process.env.POSTGRES_RESTORE_STAGING_RESERVE_BYTES = previousReserve
			}
		}
		expect(fs.readdirSync(stagingRoot)).toEqual([])
	})

	test('fails capacity preflight before creating a restore staging directory', async () => {
		const source = path.join(tempDir, 'postgres-capacity.dump')
		const stagingRoot = path.join(tempDir, 'restore-capacity')
		fs.writeFileSync(source, 'capacity bytes', { mode: 0o600 })
		fs.mkdirSync(stagingRoot, { mode: 0o700 })
		fs.chmodSync(stagingRoot, 0o700)
		const archiveAttestation = attestPostgresBackupFile(source)
		let callbackRan = false

		await expect(
			withPrivatePostgresRestoreArchive(
				source,
				archiveAttestation,
				async () => {
					callbackRan = true
				},
				'Capacity restore archive',
				{
					stagingRoot,
					reserveBytes: 8,
					statfs: () => ({
						bavail: BigInt(archiveAttestation.bytes + 7),
						bsize: 1n,
					}),
				},
			),
		).rejects.toThrow('requires')
		expect(callbackRan).toBe(false)
		expect(fs.readdirSync(stagingRoot)).toEqual([])
	})

	test('validates restore staging reserve and capacity values exactly', () => {
		expect(parsePostgresRestoreStagingReserveBytes('0')).toBe(0)
		expect(parsePostgresRestoreStagingReserveBytes('1048576')).toBe(1_048_576)
		for (const invalid of [-1, 1.5, '', '01', '1e3', ' 1', 'one']) {
			expect(() => parsePostgresRestoreStagingReserveBytes(invalid)).toThrow(
				'must be a non-negative safe integer',
			)
		}
		expect(() =>
			assertPostgresRestoreStagingCapacity(tempDir, 10, 5, () => ({
				bavail: -1n,
				bsize: 1n,
			})),
		).toThrow('could not be safely inspected')
	})

	test('rejects an unsafe configured restore staging root', async () => {
		const source = path.join(tempDir, 'postgres-unsafe-root.dump')
		const looseRoot = path.join(tempDir, 'loose-root')
		const rootLink = path.join(tempDir, 'root-link')
		fs.writeFileSync(source, 'restore bytes', { mode: 0o600 })
		fs.mkdirSync(looseRoot, { mode: 0o755 })
		fs.chmodSync(looseRoot, 0o755)
		fs.symlinkSync(looseRoot, rootLink)
		const attestation = attestPostgresBackupFile(source)

		for (const stagingRoot of ['relative-root', looseRoot, rootLink]) {
			await expect(
				withPrivatePostgresRestoreArchive(
					source,
					attestation,
					async () => undefined,
					'Unsafe root archive',
					{ stagingRoot, reserveBytes: 0 },
				),
			).rejects.toThrow()
		}
	})

	test('rejects loose permissions before publishing generated artifacts', () => {
		const staged = artifact('postgres-loose.dump')
		fs.chmodSync(staged.source, 0o640)
		expect(() =>
			publishPostgresBackupFile(staged.source, staged.target),
		).toThrow('must be owned by this process and mode 0600')
		expect(fs.existsSync(staged.target)).toBe(false)
	})

	test('atomically refuses to replace an existing publication target', () => {
		const staged = artifact('postgres-existing.dump')
		fs.writeFileSync(staged.target, 'existing authoritative bytes', {
			mode: 0o600,
		})
		expect(() =>
			publishPostgresBackupFile(staged.source, staged.target),
		).toThrow('publication target already exists')
		expect(fs.readFileSync(staged.target, 'utf8')).toBe(
			'existing authoritative bytes',
		)
		expect(fs.existsSync(staged.source)).toBe(true)
	})

	test('atomically replaces only the exact previously attested private target', () => {
		const source = path.join(tempDir, 'receipt.partial')
		const target = path.join(tempDir, 'receipt.json')
		fs.writeFileSync(source, 'replacement receipt', { mode: 0o600 })
		fs.writeFileSync(target, 'existing receipt', { mode: 0o600 })
		const sourceAttestation = attestPostgresBackupFile(source)
		const targetAttestation = attestPostgresBackupFile(target)

		const result = replacePrivatePostgresBackupFileAtomically(
			source,
			target,
			sourceAttestation,
			targetAttestation,
		)
		expect(result.sha256).toBe(sourceAttestation.sha256)
		expect(fs.existsSync(source)).toBe(false)
		expect(fs.readFileSync(target, 'utf8')).toBe('replacement receipt')

		const secondSource = path.join(tempDir, 'second-receipt.partial')
		fs.writeFileSync(secondSource, 'second replacement', { mode: 0o600 })
		const staleTargetAttestation = attestPostgresBackupFile(target)
		fs.rmSync(target)
		fs.writeFileSync(target, 'concurrent replacement', { mode: 0o600 })
		expect(() =>
			replacePrivatePostgresBackupFileAtomically(
				secondSource,
				target,
				attestPostgresBackupFile(secondSource),
				staleTargetAttestation,
			),
		).toThrow('changed after it was staged')
		expect(fs.readFileSync(target, 'utf8')).toBe('concurrent replacement')
		expect(fs.existsSync(secondSource)).toBe(true)
	})

	test('rejects a backup-directory symlink before changing target permissions', () => {
		const target = path.join(tempDir, 'directory-target')
		const symlink = path.join(tempDir, 'directory-link')
		fs.mkdirSync(target, { mode: 0o755 })
		fs.chmodSync(target, 0o755)
		fs.symlinkSync(target, symlink)
		expect(() =>
			securePostgresBackupDirectory(symlink, 'Test backup directory'),
		).toThrow('must be a regular non-symlink directory')
		expect(fs.statSync(target).mode & 0o777).toBe(0o755)
	})

	test('publishes both archives before receipts and the local receipt last', () => {
		const artifacts = {
			localArchive: artifact('postgres-local.dump'),
			localReceipt: artifact('postgres-local.dump.restore-verified.json'),
			offsiteArchive: artifact('postgres-offsite.dump'),
			offsiteReceipt: artifact('postgres-offsite.dump.restore-verified.json'),
		}
		const order = []
		const published = publishPostgresBackupArtifacts(
			artifacts,
			(source, target) => {
				order.push(path.basename(target))
				publishPostgresBackupFile(source, target)
			},
		)
		expect(order).toEqual([
			'postgres-local.dump',
			'postgres-offsite.dump',
			'postgres-offsite.dump.restore-verified.json',
			'postgres-local.dump.restore-verified.json',
		])
		expect(published.map(value => path.basename(value))).toEqual(order)
		for (const target of published)
			expect(fs.readFileSync(target, 'utf8')).toBe(path.basename(target))
	})

	test('keeps local archive-before-receipt order without offsite storage', () => {
		const order = postgresBackupPublicationOrder({
			localArchive: { source: 'archive.partial', target: 'archive.dump' },
			localReceipt: {
				source: 'receipt.partial',
				target: 'archive.dump.restore-verified.json',
			},
		})
		expect(order.map(item => item.target)).toEqual([
			'archive.dump',
			'archive.dump.restore-verified.json',
		])
	})

	test('refuses an inode replacement immediately before publication', () => {
		const staged = artifact('postgres-replaced.dump')
		const attestation = attestPostgresBackupFile(staged.source)
		fs.rmSync(staged.source)
		fs.writeFileSync(staged.source, 'postgres-replaced.dump')
		expect(() =>
			publishPostgresBackupFile(staged.source, staged.target, attestation),
		).toThrow('changed after it was staged')
		expect(fs.existsSync(staged.target)).toBe(false)
	})

	test('never exposes incomplete local evidence at any abrupt-stop boundary', () => {
		for (let stopAfter = 1; stopAfter <= 4; stopAfter++) {
			const root = path.join(tempDir, `stop-${stopAfter}`)
			const local = path.join(root, 'local')
			const offsite = path.join(root, 'offsite')
			fs.mkdirSync(local, { recursive: true, mode: 0o700 })
			fs.mkdirSync(offsite, { recursive: true, mode: 0o700 })
			fs.chmodSync(local, 0o700)
			fs.chmodSync(offsite, 0o700)
			const artifacts = {
				localArchive: artifact('postgres-backup.dump', local),
				localReceipt: artifact(
					'postgres-backup.dump.restore-verified.json',
					local,
				),
				offsiteArchive: artifact('postgres-backup.dump', offsite),
				offsiteReceipt: artifact(
					'postgres-backup.dump.restore-verified.json',
					offsite,
				),
			}
			let published = 0
			expect(() =>
				publishPostgresBackupArtifacts(artifacts, (source, target) => {
					publishPostgresBackupFile(source, target)
					published += 1
					if (published === stopAfter) throw new Error('simulated SIGKILL')
				}),
			).toThrow('simulated SIGKILL')

			expect(listPostgresBackups(local).length).toBe(stopAfter === 4 ? 1 : 0)
			expect(listPostgresBackups(offsite).length).toBe(stopAfter >= 3 ? 1 : 0)
			if (fs.existsSync(artifacts.localReceipt.target)) {
				for (const artifact of Object.values(artifacts)) {
					expect(fs.existsSync(artifact.target)).toBe(true)
				}
			}
		}
	})
})

describe('interrupted PostgreSQL backup cleanup', () => {
	test('removes dead-process staging files and aged incomplete evidence only', () => {
		const deadPartial = path.join(
			tempDir,
			'postgres-dead.dump.partial-99999999',
		)
		const activePartial = path.join(
			tempDir,
			`postgres-active.dump.partial-${process.pid}`,
		)
		const orphanArchive = path.join(tempDir, 'postgres-orphan.dump')
		const orphanReceipt = path.join(
			tempDir,
			'postgres-missing.dump.restore-verified.json',
		)
		const completeArchive = path.join(tempDir, 'postgres-complete.dump')
		const completeReceipt = `${completeArchive}.restore-verified.json`
		for (const filename of [
			deadPartial,
			activePartial,
			orphanArchive,
			orphanReceipt,
			completeArchive,
			completeReceipt,
		]) {
			fs.writeFileSync(filename, 'test')
			fs.utimesSync(filename, new Date(0), new Date(0))
		}
		const removed = cleanupInterruptedPostgresBackupArtifacts(tempDir, {
			now: 10_000,
			orphanGraceMs: 1,
			isProcessAlive: pid => pid === process.pid,
		})
		expect(removed.map(value => path.basename(value)).sort()).toEqual(
			[
				'postgres-dead.dump.partial-99999999',
				'postgres-missing.dump.restore-verified.json',
				'postgres-orphan.dump',
			].sort(),
		)
		expect(fs.existsSync(activePartial)).toBe(true)
		expect(fs.existsSync(completeArchive)).toBe(true)
		expect(fs.existsSync(completeReceipt)).toBe(true)
	})
})
