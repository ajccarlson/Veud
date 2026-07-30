import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { isIP } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const READY_PATTERN = /VEUD_POSTGRES_RESTORE_LOCK_READY:(\d+)\n/
const HOLDER_PATH = fileURLToPath(
	new URL('./postgres-restore-lock-holder.sh', import.meta.url),
)

function parseWaitSeconds(value) {
	const resolved = value === undefined || value === '' ? 120 : Number(value)
	if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > 3_600) {
		throw new Error(
			'POSTGRES_BACKUP_RESTORE_LOCK_WAIT_SECONDS must be an integer from 1 through 3600',
		)
	}
	return resolved
}

function defaultLockDirectory() {
	const uid = typeof process.getuid === 'function' ? process.getuid() : 'user'
	return path.join(os.tmpdir(), `veud-postgres-restore-locks-${uid}`)
}

function assertPrivateLockDirectory(directory) {
	fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
	const resolved = fs.realpathSync(directory)
	const stat = fs.statSync(resolved)
	if (!stat.isDirectory()) {
		throw new Error('PostgreSQL restore lock path must be a directory')
	}
	if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) {
		throw new Error(
			'PostgreSQL restore lock directory must be owned by the current user',
		)
	}
	if ((stat.mode & 0o077) !== 0) {
		throw new Error(
			'PostgreSQL restore lock directory must not be group/world accessible',
		)
	}
	return resolved
}

export function postgresRestoreLockIdentity(identity) {
	if (identity?.serverAddress === 'local-socket') {
		throw new Error(
			'PostgreSQL destructive restore verification does not support Unix-socket targets',
		)
	}
	if (
		!identity ||
		typeof identity !== 'object' ||
		Array.isArray(identity) ||
		typeof identity.database !== 'string' ||
		!identity.database ||
		typeof identity.databaseOid !== 'string' ||
		!/^\d+$/.test(identity.databaseOid) ||
		typeof identity.serverAddress !== 'string' ||
		!identity.serverAddress ||
		isIP(identity.serverAddress) === 0 ||
		!Number.isSafeInteger(identity.serverPort) ||
		identity.serverPort < 1 ||
		identity.serverPort > 65_535 ||
		typeof identity.postmasterStartedAt !== 'string' ||
		!/^\d+$/.test(identity.postmasterStartedAt) ||
		!Number.isSafeInteger(identity.serverVersionNum)
	) {
		throw new Error(
			'PostgreSQL restore lock requires an attested TCP endpoint identity',
		)
	}
	return JSON.stringify({
		serverAddress: identity.serverAddress,
		serverPort: identity.serverPort,
		postmasterStartedAt: identity.postmasterStartedAt,
		databaseOid: identity.databaseOid,
		database: identity.database,
		serverVersionNum: identity.serverVersionNum,
	})
}

export function postgresRestoreLockPath(
	identity,
	lockDirectory = process.env.POSTGRES_BACKUP_RESTORE_LOCK_DIR ||
		defaultLockDirectory(),
) {
	const lockIdentity = postgresRestoreLockIdentity(identity)
	const digest = createHash('sha256').update(lockIdentity).digest('hex')
	return path.join(
		assertPrivateLockDirectory(path.resolve(lockDirectory)),
		digest,
	)
}

function assertPrivateLockFileStat(stat) {
	if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
		throw new Error(
			'PostgreSQL restore lock must be a private regular file with one link',
		)
	}
	if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) {
		throw new Error('PostgreSQL restore lock must be owned by the current user')
	}
	if ((stat.mode & 0o077) !== 0) {
		throw new Error(
			'PostgreSQL restore lock must not be group/world accessible',
		)
	}
}

function openPrivateLockFile(lockPath) {
	try {
		const existing = fs.lstatSync(lockPath)
		assertPrivateLockFileStat(existing)
	} catch (error) {
		if (error?.code !== 'ENOENT') throw error
	}
	const fd = fs.openSync(
		lockPath,
		fs.constants.O_CREAT |
			fs.constants.O_RDWR |
			(fs.constants.O_NOFOLLOW ?? 0),
		0o600,
	)
	try {
		const opened = fs.fstatSync(fd)
		const linked = fs.lstatSync(lockPath)
		assertPrivateLockFileStat(opened)
		assertPrivateLockFileStat(linked)
		if (opened.dev !== linked.dev || opened.ino !== linked.ino) {
			throw new Error('PostgreSQL restore lock changed while it was opened')
		}
		return { fd, stat: opened }
	} catch (error) {
		fs.closeSync(fd)
		throw error
	}
}

function assertLockFileUnchanged(lockPath, expected) {
	const actual = fs.lstatSync(lockPath)
	assertPrivateLockFileStat(actual)
	if (actual.dev !== expected.dev || actual.ino !== expected.ino) {
		throw new Error('PostgreSQL restore lock changed during acquisition')
	}
}

function waitForHolderReady(holder, waitSeconds) {
	return new Promise((resolve, reject) => {
		let stdout = ''
		let stderr = ''
		let settled = false
		const finish = callback => {
			if (settled) return
			settled = true
			clearTimeout(timer)
			callback()
		}
		const timer = setTimeout(
			() =>
				finish(() => {
					holder.kill('SIGKILL')
					reject(
						new Error('Timed out acquiring the PostgreSQL restore-target lock'),
					)
				}),
			(waitSeconds + 5) * 1_000,
		)
		holder.stderr.on('data', chunk => {
			stderr += chunk
		})
		holder.stdout.on('data', chunk => {
			stdout += chunk
			const ready = READY_PATTERN.exec(stdout)
			if (!ready) return
			holder.restoreLockHelperPid = Number(ready[1])
			finish(resolve)
		})
		holder.once('error', error =>
			finish(() =>
				reject(
					new Error(
						`Could not start the PostgreSQL restore-target lock holder: ${error.message}`,
					),
				),
			),
		)
		holder.once('exit', code =>
			finish(() =>
				reject(
					new Error(
						`Could not acquire the PostgreSQL restore-target lock: ${
							stderr.trim() || `flock exited ${String(code)}`
						}`,
					),
				),
			),
		)
	})
}

function waitForProcessExit(child) {
	if (child.exitCode !== null || child.signalCode !== null) {
		return Promise.resolve({
			code: child.exitCode,
			signal: child.signalCode,
		})
	}
	return new Promise(resolve => {
		const onExit = (code, signal) => resolve({ code, signal })
		child.once('exit', onExit)
		if (child.exitCode !== null || child.signalCode !== null) {
			child.removeListener('exit', onExit)
			resolve({
				code: child.exitCode,
				signal: child.signalCode,
			})
		}
	})
}

async function stopHolder(holder) {
	if (holder.exitCode !== null || holder.signalCode !== null) return
	const terminated = waitForProcessExit(holder)
	if (Number.isSafeInteger(holder.restoreLockHelperPid)) {
		try {
			process.kill(holder.restoreLockHelperPid, 'SIGTERM')
		} catch (error) {
			if (error?.code !== 'ESRCH') throw error
		}
	} else {
		holder.kill('SIGTERM')
	}
	const killTimeout = new Promise(resolve =>
		setTimeout(resolve, 2_000, 'timeout'),
	)
	if ((await Promise.race([terminated, killTimeout])) !== 'timeout') return
	holder.kill('SIGKILL')
	await terminated
}

export async function withPostgresRestoreLock(
	identity,
	operation,
	{
		lockDirectory,
		waitSeconds = process.env.POSTGRES_BACKUP_RESTORE_LOCK_WAIT_SECONDS,
		flockBinary = '/usr/bin/flock',
		bashBinary = '/usr/bin/bash',
	} = {},
) {
	if (typeof operation !== 'function') {
		throw new Error('PostgreSQL restore lock operation must be a function')
	}
	const boundedWait = parseWaitSeconds(waitSeconds)
	const lockPath = postgresRestoreLockPath(identity, lockDirectory)
	const lockFile = openPrivateLockFile(lockPath)
	const holder = spawn(
		bashBinary,
		[
			HOLDER_PATH,
			String(process.pid),
			String(boundedWait),
			flockBinary,
		],
		{
			stdio: ['ignore', 'pipe', 'pipe', lockFile.fd],
			env: { PATH: '/usr/bin:/bin' },
		},
	)
	try {
		await waitForHolderReady(holder, boundedWait)
		assertLockFileUnchanged(lockPath, lockFile.stat)
		const controller = new AbortController()
		const operationPromise = Promise.resolve().then(() =>
			operation({
				signal: controller.signal,
				holderPid: holder.restoreLockHelperPid,
			}),
		)
		const holderExitPromise = waitForProcessExit(holder).then(
			({ code, signal }) => {
				throw new Error(
					`PostgreSQL restore-target lock holder exited unexpectedly (${
						signal ? `signal ${signal}` : `exit ${String(code)}`
					})`,
				)
			},
		)
		try {
			return await Promise.race([operationPromise, holderExitPromise])
		} catch (error) {
			controller.abort(error)
			try {
				await operationPromise
			} catch {
				// Preserve the lock-holder failure that initiated cancellation.
			}
			throw error
		}
	} finally {
		try {
			await stopHolder(holder)
		} finally {
			fs.closeSync(lockFile.fd)
		}
	}
}
