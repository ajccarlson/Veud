import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const LIVE_CATALOG_DATABASES = Object.freeze([
	{
		environment: 'production',
		user: 'veud_production_app',
		database: 'veud_production',
	},
	{
		environment: 'staging',
		user: 'veud_staging_app',
		database: 'veud_staging',
	},
	{
		environment: 'staging',
		user: 'veud_staging_load',
		database: 'veud_staging_load',
	},
])

function parseDatabaseUrl(raw) {
	if (typeof raw !== 'string' || !raw) return undefined
	try {
		return new URL(raw)
	} catch {
		return undefined
	}
}

function decodeDatabaseIdentityComponent(value) {
	try {
		return decodeURIComponent(value)
	} catch {
		throw new Error('PostgreSQL datasource identity has invalid URL encoding')
	}
}

export function identifyLiveCatalogDatabase(databaseUrl) {
	const url = parseDatabaseUrl(databaseUrl)
	if (!url || !['postgres:', 'postgresql:'].includes(url.protocol)) {
		return undefined
	}
	const user = decodeDatabaseIdentityComponent(url.username)
	const database = decodeDatabaseIdentityComponent(
		url.pathname.replace(/^\//, ''),
	)
	return LIVE_CATALOG_DATABASES.find(
		identity => identity.user === user && identity.database === database,
	)
}

export function expectedCatalogWriterLockPath(environment, env = process.env) {
	const liveMount = env.VEUD_STAGING_LIVE_MOUNT || '/media/sde'
	if (environment === 'production') {
		const root =
			env.VEUD_PRODUCTION_ROOT || path.join(liveMount, 'veud-production')
		return path.join(root, 'run/catalog-writer-lifetime.lock')
	}
	if (environment === 'staging') {
		const root =
			env.VEUD_STAGING_ROOT || path.join(liveMount, 'veud-staging-postgres')
		return path.join(root, 'run/catalog-writer-lifetime.lock')
	}
	throw new Error(`Unsupported live catalog environment: ${environment}`)
}

function parentPid(pid, readFile = fs.readFileSync) {
	const stat = readFile(`/proc/${pid}/stat`, 'utf8')
	const commandEnd = stat.lastIndexOf(')')
	if (commandEnd < 0)
		throw new Error(`Could not inspect lock holder PID ${pid}`)
	const fields = stat
		.slice(commandEnd + 2)
		.trim()
		.split(/\s+/)
	const ppid = Number(fields[1])
	if (!Number.isSafeInteger(ppid) || ppid < 0) {
		throw new Error(`Could not inspect lock holder PID ${pid}`)
	}
	return ppid
}

function isSelfOrAncestor(pid, operations) {
	let candidate = operations.currentPid
	for (let depth = 0; depth < 64 && candidate > 0; depth++) {
		if (candidate === pid) return true
		const next = parentPid(candidate, operations.readFile)
		if (next === candidate) break
		candidate = next
	}
	return false
}

function parseProofFileDescriptors(value) {
	if (typeof value !== 'string' || !/^[0-9]+(?:,[0-9]+)*$/.test(value)) {
		throw new Error(
			'VEUD_CATALOG_WRITER_LOCK_FDS must list inherited file descriptors',
		)
	}
	const descriptors = [...new Set(value.split(',').map(Number))]
	if (
		descriptors.some(
			descriptor =>
				!Number.isSafeInteger(descriptor) || descriptor < 3 || descriptor > 255,
		)
	) {
		throw new Error(
			'VEUD_CATALOG_WRITER_LOCK_FDS contains an invalid file descriptor',
		)
	}
	return descriptors
}

function sameFile(left, right) {
	return left.dev === right.dev && left.ino === right.ino
}

const TRUSTED_FLOCK_BIN = '/usr/bin/flock'

function defaultDescriptorLockAcquire(descriptor) {
	const result = spawnSync(TRUSTED_FLOCK_BIN, ['--shared', '--nonblock', '3'], {
		encoding: 'utf8',
		// Duplicating the inherited descriptor into the child preserves the
		// same open-file-description. A successful flock therefore remains
		// owned by this process after the short-lived helper exits.
		stdio: ['ignore', 'pipe', 'pipe', descriptor],
		timeout: 2_000,
	})
	if (result.error) {
		throw new Error(
			`Could not acquire the catalog writer lifetime lock: ${result.error.message}`,
		)
	}
	if (result.signal || result.status === null) {
		throw new Error('Could not acquire the catalog writer lifetime lock')
	}
	if (result.status === 0) return true
	if (result.status === 1) return false
	throw new Error(
		`Could not acquire the catalog writer lifetime lock: ${result.stderr.trim() || `flock exited ${result.status}`}`,
	)
}

function defaultLockProbe(lockPath, expectedStat) {
	let descriptor
	try {
		descriptor = fs.openSync(
			lockPath,
			fs.constants.O_RDWR | (fs.constants.O_NOFOLLOW ?? 0),
		)
		if (!sameFile(fs.fstatSync(descriptor), expectedStat)) return false
		const result = spawnSync(
			TRUSTED_FLOCK_BIN,
			['--exclusive', '--nonblock', '3'],
			{
				encoding: 'utf8',
				env: {
					LANG: 'C',
					LC_ALL: 'C',
					PATH: '/usr/bin:/bin',
				},
				stdio: ['ignore', 'pipe', 'pipe', descriptor],
				timeout: 2_000,
			},
		)
		if (result.error) {
			throw new Error(
				`Could not verify the catalog writer lifetime lock: ${result.error.message}`,
			)
		}
		if (result.signal || result.status === null) {
			throw new Error('Could not verify the catalog writer lifetime lock')
		}
		if (result.status === 0) return false
		if (result.status === 1) return true
		throw new Error(
			`Could not verify the catalog writer lifetime lock: ${result.stderr.trim() || `flock exited ${result.status}`}`,
		)
	} finally {
		if (descriptor !== undefined) fs.closeSync(descriptor)
	}
}

function descriptorHasSharedFlock(fdinfo, inode) {
	for (const line of fdinfo.split('\n')) {
		if (!line.startsWith('lock:')) continue
		const match =
			/^lock:\s+\d+:\s+FLOCK\s+ADVISORY\s+READ\s+\d+\s+[0-9a-f]+:[0-9a-f]+:(\d+)\s+0\s+EOF$/i.exec(
				line,
			)
		if (match && match[1] === String(inode)) return true
	}
	return false
}

export function assertCatalogWriterRuntimeProof(
	env = process.env,
	overrides = {},
) {
	const identity = identifyLiveCatalogDatabase(env.DATABASE_URL)
	if (!identity) return false

	const expectedPath = expectedCatalogWriterLockPath(identity.environment, env)
	if (
		env.VEUD_CATALOG_WRITER_LOCK_ENVIRONMENT !== identity.environment ||
		env.VEUD_CATALOG_WRITER_LOCK_PATH !== expectedPath
	) {
		throw new Error(
			`Direct ${identity.environment} PostgreSQL access is blocked; use a catalog-writer lifetime-lock launcher`,
		)
	}
	const holderPid = Number(env.VEUD_CATALOG_WRITER_LOCK_HOLDER_PID)
	if (!Number.isSafeInteger(holderPid) || holderPid < 1) {
		throw new Error(
			'Catalog writer lifetime-lock proof has an invalid holder PID',
		)
	}
	const descriptors = parseProofFileDescriptors(
		env.VEUD_CATALOG_WRITER_LOCK_FDS,
	)
	const operations = {
		currentPid: overrides.currentPid ?? process.pid,
		readFile: overrides.readFile ?? fs.readFileSync,
		lstat: overrides.lstat ?? fs.lstatSync,
		stat: overrides.stat ?? fs.statSync,
		currentUid:
			overrides.currentUid ??
			(typeof process.getuid === 'function' ? process.getuid() : undefined),
		descriptorLockAcquire:
			overrides.descriptorLockAcquire ?? defaultDescriptorLockAcquire,
		lockProbe: overrides.lockProbe ?? defaultLockProbe,
	}
	if (!isSelfOrAncestor(holderPid, operations)) {
		throw new Error(
			'Catalog writer lifetime-lock holder is not the current process or an ancestor',
		)
	}
	let lockStat
	try {
		lockStat = operations.lstat(expectedPath)
	} catch {
		throw new Error('Catalog writer lifetime-lock file is unavailable')
	}
	if (
		lockStat.isSymbolicLink() ||
		!lockStat.isFile() ||
		lockStat.nlink !== 1 ||
		(operations.currentUid !== undefined &&
			lockStat.uid !== operations.currentUid) ||
		(lockStat.mode & 0o600) !== 0o600 ||
		(lockStat.mode & 0o022) !== 0
	) {
		throw new Error(
			'Catalog writer lifetime-lock path has unsafe ownership or mode',
		)
	}
	const matchingDescriptors = descriptors.filter(descriptor => {
		try {
			const holderDescriptor = operations.stat(
				`/proc/${holderPid}/fd/${descriptor}`,
			)
			const currentDescriptor = operations.stat(
				`/proc/${operations.currentPid}/fd/${descriptor}`,
			)
			return (
				sameFile(lockStat, holderDescriptor) &&
				sameFile(lockStat, currentDescriptor)
			)
		} catch {
			return false
		}
	})
	if (!matchingDescriptors.length) {
		throw new Error(
			'Catalog writer lifetime-lock holder and current process do not share the expected descriptor',
		)
	}
	let acquiredDescriptor
	for (const descriptor of matchingDescriptors) {
		if (operations.descriptorLockAcquire(descriptor)) {
			acquiredDescriptor = descriptor
			break
		}
	}
	if (acquiredDescriptor === undefined) {
		throw new Error(
			'Catalog writer lifetime-lock could not be acquired through the inherited descriptor',
		)
	}
	let fdinfo
	try {
		fdinfo = operations.readFile(
			`/proc/${operations.currentPid}/fdinfo/${acquiredDescriptor}`,
			'utf8',
		)
	} catch {
		throw new Error(
			'Catalog writer lifetime-lock descriptor proof is unavailable',
		)
	}
	if (!descriptorHasSharedFlock(fdinfo, lockStat.ino)) {
		throw new Error(
			'Catalog writer lifetime-lock descriptor does not own the shared lock',
		)
	}
	if (!operations.lockProbe(expectedPath, lockStat)) {
		throw new Error('Catalog writer lifetime-lock file is not locked')
	}
	let finalLockStat
	try {
		finalLockStat = operations.lstat(expectedPath)
	} catch {
		throw new Error('Catalog writer lifetime-lock file changed during proof')
	}
	if (
		finalLockStat.isSymbolicLink() ||
		!finalLockStat.isFile() ||
		!sameFile(lockStat, finalLockStat) ||
		finalLockStat.nlink !== lockStat.nlink ||
		finalLockStat.uid !== lockStat.uid ||
		finalLockStat.mode !== lockStat.mode
	) {
		throw new Error('Catalog writer lifetime-lock file changed during proof')
	}
	return true
}
