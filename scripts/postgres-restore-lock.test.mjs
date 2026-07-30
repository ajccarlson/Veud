import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
	postgresRestoreLockIdentity,
	postgresRestoreLockPath,
	withPostgresRestoreLock,
} from './postgres-restore-lock.mjs'

const firstIdentity = {
	database: 'veud_restore_drill',
	databaseOid: '16385',
	serverAddress: '127.0.0.1',
	serverPort: 5433,
	postmasterStartedAt: '1750000000000000',
	serverVersionNum: 160014,
}
const sameTargetThroughAnotherAlias = {
	...firstIdentity,
	configuredHost: 'database.internal',
	configuredRole: 'restore_two',
}

let tempDir
const children = new Set()

beforeEach(() => {
	tempDir = fs.mkdtempSync(
		path.join(os.tmpdir(), 'veud-postgres-restore-lock-test-'),
	)
	fs.chmodSync(tempDir, 0o700)
})

afterEach(async () => {
	for (const child of children) {
		if (child.exitCode === null && child.signalCode === null) {
			child.kill('SIGKILL')
			await new Promise(resolve => child.once('exit', resolve))
		}
	}
	children.clear()
	fs.rmSync(tempDir, { recursive: true, force: true })
})

function waitForFile(filename) {
	return new Promise((resolve, reject) => {
		const started = Date.now()
		const timer = setInterval(() => {
			if (fs.existsSync(filename)) {
				clearInterval(timer)
				resolve()
			} else if (Date.now() - started > 5_000) {
				clearInterval(timer)
				reject(new Error(`Timed out waiting for ${filename}`))
			}
		}, 10)
	})
}

describe('PostgreSQL restore-target lock identities', () => {
	test('serializes roles and credentials that address the same exact database', () => {
		expect(JSON.parse(postgresRestoreLockIdentity(firstIdentity))).toEqual(
			firstIdentity,
		)
		expect(postgresRestoreLockPath(firstIdentity, tempDir)).toBe(
			postgresRestoreLockPath(sameTargetThroughAnotherAlias, tempDir),
		)
	})

	test('locks inside the destructive API so entrypoints cannot bypass it', () => {
		const operations = fs.readFileSync(
			path.join(process.cwd(), 'scripts/postgres-backup-operations.mjs'),
			'utf8',
		)
		expect(operations).toContain('return withPostgresRestoreLock(')
		expect(operations.indexOf('return withPostgresRestoreLock(')).toBeLessThan(
			operations.lastIndexOf('await restorePostgresBackupExclusively({'),
		)
		for (const filename of [
			'scripts/backup-postgres.mjs',
			'scripts/verify-postgres-backup.mjs',
		]) {
			const source = fs.readFileSync(path.join(process.cwd(), filename), 'utf8')
			expect(source, filename).not.toContain('withPostgresRestoreLock')
			expect(source, filename).toContain('verifyPostgresBackup({')
		}
	})

	test('rejects un-attested and Unix-socket lock identities', () => {
		expect(() =>
			postgresRestoreLockIdentity({
				...firstIdentity,
				serverAddress: 'local-socket',
				serverPort: 0,
			}),
		).toThrow('does not support Unix-socket targets')
		expect(() =>
			postgresRestoreLockIdentity({
				...firstIdentity,
				databaseOid: undefined,
			}),
		).toThrow('requires an attested TCP endpoint identity')
	})

	test('rejects symlinked and multiply-linked lock paths', async () => {
		const lockPath = postgresRestoreLockPath(firstIdentity, tempDir)
		const external = path.join(tempDir, 'external-lock')
		fs.writeFileSync(external, '')
		fs.chmodSync(external, 0o600)
		fs.symlinkSync(external, lockPath)
		await expect(
			withPostgresRestoreLock(firstIdentity, async () => undefined, {
				lockDirectory: tempDir,
				waitSeconds: 1,
			}),
		).rejects.toThrow('private regular file with one link')
		fs.unlinkSync(lockPath)
		fs.linkSync(external, lockPath)
		await expect(
			withPostgresRestoreLock(firstIdentity, async () => undefined, {
				lockDirectory: tempDir,
				waitSeconds: 1,
			}),
		).rejects.toThrow('private regular file with one link')
	})
})

describe('PostgreSQL restore-target lock execution', () => {
	test('locks the inherited descriptor without creating a file named 3', async () => {
		const accidentalPath = path.join(process.cwd(), '3')
		const before = fs.existsSync(accidentalPath)
			? fs.statSync(accidentalPath)
			: undefined
		await withPostgresRestoreLock(firstIdentity, async () => undefined, {
			lockDirectory: tempDir,
			waitSeconds: 2,
		})
		expect(fs.existsSync(accidentalPath)).toBe(Boolean(before))
		if (before) {
			const after = fs.statSync(accidentalPath)
			expect(after.ino).toBe(before.ino)
			expect(after.mtimeMs).toBe(before.mtimeMs)
		}
	})

	test('ignores ambient binary overrides and reports injected exec failure', async () => {
		const previousFlock = process.env.FLOCK_BIN
		const previousBash = process.env.BASH_BIN
		process.env.FLOCK_BIN = '/bin/false'
		process.env.BASH_BIN = '/bin/false'
		try {
			await expect(
				withPostgresRestoreLock(firstIdentity, async () => 'locked', {
					lockDirectory: tempDir,
					waitSeconds: 2,
				}),
			).resolves.toBe('locked')
		} finally {
			if (previousFlock === undefined) delete process.env.FLOCK_BIN
			else process.env.FLOCK_BIN = previousFlock
			if (previousBash === undefined) delete process.env.BASH_BIN
			else process.env.BASH_BIN = previousBash
		}
		await expect(
			withPostgresRestoreLock(firstIdentity, async () => undefined, {
				lockDirectory: tempDir,
				waitSeconds: 1,
				flockBinary: '/bin/false',
			}),
		).rejects.toThrow('status 1')
	})

	test('runs same-target destructive operations one at a time', async () => {
		let active = 0
		let maximumActive = 0
		const order = []
		const operation = label => async () => {
			active++
			maximumActive = Math.max(maximumActive, active)
			order.push(`${label}:enter`)
			await new Promise(resolve => setTimeout(resolve, 75))
			order.push(`${label}:exit`)
			active--
		}
		await Promise.all([
			withPostgresRestoreLock(firstIdentity, operation('first'), {
				lockDirectory: tempDir,
				waitSeconds: 2,
			}),
			withPostgresRestoreLock(
				sameTargetThroughAnotherAlias,
				operation('second'),
				{
					lockDirectory: tempDir,
					waitSeconds: 2,
				},
			),
		])
		expect(maximumActive).toBe(1)
		expect(order).toHaveLength(4)
		expect(order[1]).toMatch(/:exit$/)
		expect(order[2]).toMatch(/:enter$/)
	})

	test('releases the lock when the owning verification process crashes', async () => {
		const ready = path.join(tempDir, 'worker-ready')
		const moduleUrl = pathToFileURL(
			path.join(process.cwd(), 'scripts/postgres-restore-lock.mjs'),
		).href
		const worker = spawn(
			process.execPath,
			[
				'--input-type=module',
				'--eval',
				`
						import fs from "node:fs"
						import { withPostgresRestoreLock } from ${JSON.stringify(moduleUrl)}
						await withPostgresRestoreLock(
						JSON.parse(process.env.VERIFY_IDENTITY),
						async () => {
							fs.writeFileSync(process.env.READY_FILE, "ready")
							await new Promise(() => {})
						},
							{ lockDirectory: process.env.LOCK_DIR, waitSeconds: 2 },
						)
					`,
			],
			{
				env: {
					...process.env,
					VERIFY_IDENTITY: JSON.stringify(firstIdentity),
					READY_FILE: ready,
					LOCK_DIR: tempDir,
				},
				stdio: 'ignore',
			},
		)
		children.add(worker)
		await waitForFile(ready)
		await expect(
			withPostgresRestoreLock(firstIdentity, async () => undefined, {
				lockDirectory: tempDir,
				waitSeconds: 1,
			}),
		).rejects.toThrow('Could not acquire')

		worker.kill('SIGKILL')
		await new Promise(resolve => worker.once('exit', resolve))
		children.delete(worker)
		await expect(
			withPostgresRestoreLock(firstIdentity, async () => 'recovered', {
				lockDirectory: tempDir,
				waitSeconds: 3,
			}),
		).resolves.toBe('recovered')
	}, 10_000)

	test('aborts the operation if the ready lock holder dies unexpectedly', async () => {
		await expect(
			withPostgresRestoreLock(
				firstIdentity,
				({ signal, holderPid }) =>
					new Promise((resolve, reject) => {
						signal.addEventListener(
							'abort',
							() => reject(signal.reason),
							{ once: true },
						)
						process.kill(holderPid, 'SIGKILL')
					}),
				{ lockDirectory: tempDir, waitSeconds: 2 },
			),
		).rejects.toThrow('lock holder exited unexpectedly')
	}, 10_000)
})
