import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const POSTGRES_ARCHIVE = /^postgres-.*\.dump$/
const POSTGRES_RECEIPT = /^postgres-.*\.dump\.restore-verified\.json$/
const INTERRUPTED_ARTIFACT =
	/^postgres-.*\.dump(?:\.restore-verified\.json)?\.(?:partial|publication)-(\d+)(?:\.partial-\d+)?$/
export const DEFAULT_POSTGRES_RESTORE_STAGING_RESERVE_BYTES = 64 * 1024 * 1024
const MAX_SAFE_BYTES = BigInt(Number.MAX_SAFE_INTEGER)

function currentEffectiveUserId() {
	if (typeof process.geteuid !== 'function') {
		throw new Error('PostgreSQL backup file ownership requires a POSIX runtime')
	}
	return BigInt(process.geteuid())
}

export function parsePostgresRestoreStagingReserveBytes(
	value = DEFAULT_POSTGRES_RESTORE_STAGING_RESERVE_BYTES,
) {
	if (
		typeof value === 'string' &&
		(!/^(?:0|[1-9]\d*)$/.test(value) || value.length > 16)
	) {
		throw new Error(
			'POSTGRES_RESTORE_STAGING_RESERVE_BYTES must be a non-negative safe integer',
		)
	}
	const parsed = typeof value === 'string' ? Number(value) : value
	if (!Number.isSafeInteger(parsed) || parsed < 0) {
		throw new Error(
			'POSTGRES_RESTORE_STAGING_RESERVE_BYTES must be a non-negative safe integer',
		)
	}
	return parsed
}

function statFileSystemAvailableBytes(directory, statfs = fs.statfsSync) {
	let stats
	try {
		stats = statfs(directory, { bigint: true })
	} catch {
		throw new Error(
			'PostgreSQL restore staging capacity could not be safely inspected',
		)
	}
	try {
		const availableBlocks = BigInt(stats.bavail)
		const blockSize = BigInt(stats.bsize)
		if (availableBlocks < 0n || blockSize < 1n) throw new Error()
		return availableBlocks * blockSize
	} catch {
		throw new Error(
			'PostgreSQL restore staging capacity could not be safely inspected',
		)
	}
}

export function assertPostgresRestoreStagingCapacity(
	directory,
	archiveBytes,
	reserveBytes = DEFAULT_POSTGRES_RESTORE_STAGING_RESERVE_BYTES,
	statfs = fs.statfsSync,
) {
	if (!Number.isSafeInteger(archiveBytes) || archiveBytes < 1) {
		throw new Error(
			'PostgreSQL restore archive size must be a positive safe integer',
		)
	}
	const parsedReserve = parsePostgresRestoreStagingReserveBytes(reserveBytes)
	const required = BigInt(archiveBytes) + BigInt(parsedReserve)
	if (required > MAX_SAFE_BYTES) {
		throw new Error(
			'PostgreSQL restore staging capacity requirement exceeds the supported range',
		)
	}
	const available = statFileSystemAvailableBytes(directory, statfs)
	if (available < required) {
		throw new Error(
			`PostgreSQL restore staging requires ${required.toString()} bytes but only ${available.toString()} bytes are available`,
		)
	}
	return {
		archiveBytes,
		reserveBytes: parsedReserve,
		requiredBytes: Number(required),
		availableBytes:
			available <= MAX_SAFE_BYTES ? Number(available) : available.toString(),
	}
}

export function assertPrivatePostgresBackupDirectory(
	directory,
	label = 'PostgreSQL backup directory',
) {
	let stat
	try {
		stat = fs.lstatSync(directory, { bigint: true })
	} catch {
		throw new Error(`${label} could not be safely inspected`)
	}
	if (stat.isSymbolicLink() || !stat.isDirectory()) {
		throw new Error(`${label} must be a regular non-symlink directory`)
	}
	if (
		stat.uid !== currentEffectiveUserId() ||
		(stat.mode & 0o777n) !== 0o700n
	) {
		throw new Error(`${label} must be owned by this process and mode 0700`)
	}
	return stat
}

export function securePostgresBackupDirectory(
	directory,
	label = 'PostgreSQL backup directory',
) {
	if (!fs.existsSync(directory)) {
		fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
	}
	const stat = fs.lstatSync(directory, { bigint: true })
	if (stat.isSymbolicLink() || !stat.isDirectory()) {
		throw new Error(`${label} must be a regular non-symlink directory`)
	}
	if (stat.uid !== currentEffectiveUserId()) {
		throw new Error(`${label} must be owned by this process`)
	}
	fs.chmodSync(directory, 0o700)
	return assertPrivatePostgresBackupDirectory(directory, label)
}

export function attestPostgresBackupFile(
	filename,
	expected,
	label = 'PostgreSQL backup artifact',
) {
	let descriptor
	try {
		const pathStat = fs.lstatSync(filename, { bigint: true })
		if (pathStat.isSymbolicLink() || !pathStat.isFile()) {
			throw new Error(`${label} must be a regular non-symlink file`)
		}
		descriptor = fs.openSync(
			filename,
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
		const hash = crypto.createHash('sha256')
		const buffer = Buffer.allocUnsafe(1024 * 1024)
		let bytesRead
		do {
			bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null)
			if (bytesRead) hash.update(buffer.subarray(0, bytesRead))
		} while (bytesRead)
		const after = fs.fstatSync(descriptor, { bigint: true })
		if (
			after.dev !== before.dev ||
			after.ino !== before.ino ||
			after.size !== before.size ||
			after.mtimeNs !== before.mtimeNs ||
			after.ctimeNs !== before.ctimeNs
		) {
			throw new Error(`${label} changed while it was hashed`)
		}
		if (after.size < 1n) throw new Error(`${label} must not be empty`)
		const attestation = {
			device: after.dev.toString(),
			inode: after.ino.toString(),
			bytes: Number(after.size),
			sha256: hash.digest('hex'),
		}
		if (!Number.isSafeInteger(attestation.bytes)) {
			throw new Error(`${label} size exceeds the supported range`)
		}
		if (
			expected &&
			(expected.device !== attestation.device ||
				expected.inode !== attestation.inode ||
				expected.bytes !== attestation.bytes ||
				expected.sha256 !== attestation.sha256)
		) {
			throw new Error(`${label} changed after it was staged`)
		}
		return attestation
	} catch (error) {
		if (error instanceof Error && error.message.startsWith(label)) throw error
		throw new Error(`${label} could not be safely attested`, { cause: error })
	} finally {
		if (descriptor !== undefined) fs.closeSync(descriptor)
	}
}

export function assertPrivatePostgresBackupFile(
	filename,
	expected,
	label = 'PostgreSQL backup artifact',
) {
	const attestation = attestPostgresBackupFile(filename, expected, label)
	const stat = fs.lstatSync(filename, { bigint: true })
	if (
		stat.isSymbolicLink() ||
		!stat.isFile() ||
		stat.dev.toString() !== attestation.device ||
		stat.ino.toString() !== attestation.inode ||
		Number(stat.size) !== attestation.bytes
	) {
		throw new Error(`${label} changed while permissions were inspected`)
	}
	if (
		stat.uid !== currentEffectiveUserId() ||
		(stat.mode & 0o777n) !== 0o600n
	) {
		throw new Error(`${label} must be owned by this process and mode 0600`)
	}
	assertPrivatePostgresBackupDirectory(
		path.dirname(filename),
		`${label} parent directory`,
	)
	return attestation
}

function copyPostgresBackupDescriptors(sourceDescriptor, targetDescriptor) {
	const buffer = Buffer.allocUnsafe(1024 * 1024)
	for (;;) {
		const bytesRead = fs.readSync(
			sourceDescriptor,
			buffer,
			0,
			buffer.length,
			null,
		)
		if (!bytesRead) break
		let written = 0
		while (written < bytesRead) {
			const bytesWritten = fs.writeSync(
				targetDescriptor,
				buffer,
				written,
				bytesRead - written,
				null,
			)
			if (bytesWritten < 1) {
				throw new Error('PostgreSQL backup private copy stopped progressing')
			}
			written += bytesWritten
		}
	}
}

export function copyPostgresBackupToPrivatePath(
	source,
	destination,
	expected,
	label = 'PostgreSQL restore archive',
) {
	const sourceAttestation = attestPostgresBackupFile(source, expected, label)
	assertPrivatePostgresBackupDirectory(
		path.dirname(destination),
		`${label} private staging directory`,
	)
	let sourceDescriptor
	let destinationDescriptor
	try {
		sourceDescriptor = fs.openSync(
			source,
			fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
		)
		const sourceStat = fs.fstatSync(sourceDescriptor, { bigint: true })
		if (
			!sourceStat.isFile() ||
			sourceStat.dev.toString() !== sourceAttestation.device ||
			sourceStat.ino.toString() !== sourceAttestation.inode ||
			Number(sourceStat.size) !== sourceAttestation.bytes
		) {
			throw new Error(`${label} changed while private staging began`)
		}
		destinationDescriptor = fs.openSync(
			destination,
			fs.constants.O_WRONLY |
				fs.constants.O_CREAT |
				fs.constants.O_EXCL |
				(fs.constants.O_NOFOLLOW ?? 0),
			0o600,
		)
		copyPostgresBackupDescriptors(sourceDescriptor, destinationDescriptor)
		fs.fsyncSync(destinationDescriptor)
	} catch (error) {
		if (error instanceof Error && error.message.startsWith(label)) throw error
		throw new Error(`${label} could not be copied into private staging`, {
			cause: error,
		})
	} finally {
		if (destinationDescriptor !== undefined) fs.closeSync(destinationDescriptor)
		if (sourceDescriptor !== undefined) fs.closeSync(sourceDescriptor)
	}
	fs.chmodSync(destination, 0o600)
	syncPostgresBackupDirectory(path.dirname(destination))
	const stagedAttestation = assertPrivatePostgresBackupFile(
		destination,
		undefined,
		`${label} private copy`,
	)
	if (
		stagedAttestation.bytes !== sourceAttestation.bytes ||
		stagedAttestation.sha256 !== sourceAttestation.sha256
	) {
		throw new Error(`${label} private copy differs from its source`)
	}
	attestPostgresBackupFile(source, sourceAttestation, label)
	return stagedAttestation
}

export async function withPrivatePostgresRestoreArchive(
	source,
	expected,
	callback,
	label = 'PostgreSQL restore archive',
	options = {},
) {
	if (!options || typeof options !== 'object' || Array.isArray(options)) {
		throw new Error('PostgreSQL restore staging options must be an object')
	}
	const sourceAttestation = attestPostgresBackupFile(source, expected, label)
	const effectiveUserId = currentEffectiveUserId()
	const userRuntimeRoot = `/run/user/${effectiveUserId.toString()}`
	let temporaryRoot
	const configuredRoot =
		options.stagingRoot ??
		process.env.POSTGRES_RESTORE_STAGING_ROOT?.trim() ??
		undefined
	if (configuredRoot !== undefined) {
		if (
			typeof configuredRoot !== 'string' ||
			!configuredRoot ||
			!path.isAbsolute(configuredRoot)
		) {
			throw new Error(
				'POSTGRES_RESTORE_STAGING_ROOT must be an absolute owner-only directory',
			)
		}
		temporaryRoot = path.resolve(configuredRoot)
		let canonicalRoot
		try {
			canonicalRoot = fs.realpathSync(temporaryRoot)
		} catch {
			throw new Error(
				'PostgreSQL restore staging root could not be safely resolved',
			)
		}
		if (canonicalRoot !== temporaryRoot) {
			throw new Error(
				'POSTGRES_RESTORE_STAGING_ROOT must not traverse symbolic links',
			)
		}
		assertPrivatePostgresBackupDirectory(
			temporaryRoot,
			'PostgreSQL restore staging root',
		)
	} else if (fs.existsSync(userRuntimeRoot)) {
		const runtimeStat = fs.lstatSync(userRuntimeRoot, { bigint: true })
		if (
			!runtimeStat.isSymbolicLink() &&
			runtimeStat.isDirectory() &&
			runtimeStat.uid === effectiveUserId &&
			(runtimeStat.mode & 0o077n) === 0n
		) {
			temporaryRoot = userRuntimeRoot
		}
	}
	const reserveBytes = parsePostgresRestoreStagingReserveBytes(
		options.reserveBytes ??
			process.env.POSTGRES_RESTORE_STAGING_RESERVE_BYTES?.trim() ??
			DEFAULT_POSTGRES_RESTORE_STAGING_RESERVE_BYTES,
	)
	let directory
	if (temporaryRoot) {
		assertPostgresRestoreStagingCapacity(
			temporaryRoot,
			sourceAttestation.bytes,
			reserveBytes,
			options.statfs,
		)
		try {
			directory = fs.mkdtempSync(
				path.join(temporaryRoot, 'veud-postgres-restore-'),
			)
		} catch (error) {
			if (
				configuredRoot !== undefined ||
				!['EACCES', 'EPERM', 'EROFS'].includes(error?.code)
			) {
				throw error
			}
			temporaryRoot = undefined
		}
	}
	if (!temporaryRoot) {
		const sharedTemporaryRoot = '/tmp'
		const temporaryRootStat = fs.lstatSync(sharedTemporaryRoot, {
			bigint: true,
		})
		let namespaceMappedRoot = false
		try {
			const uidMap = fs.readFileSync('/proc/self/uid_map', 'utf8').trim()
			namespaceMappedRoot = new RegExp(
				`^${effectiveUserId.toString()}\\s+0\\s+1(?:\\s|$)`,
			).test(uidMap)
		} catch {
			// A normal non-namespaced runtime requires literal root ownership.
		}
		if (
			temporaryRootStat.isSymbolicLink() ||
			!temporaryRootStat.isDirectory() ||
			(temporaryRootStat.uid !== 0n &&
				!(temporaryRootStat.uid === 65_534n && namespaceMappedRoot)) ||
			(temporaryRootStat.mode & 0o1000n) === 0n
		) {
			throw new Error(
				'PostgreSQL restore staging requires an owner-only runtime directory or root-owned sticky /tmp',
			)
		}
		temporaryRoot = sharedTemporaryRoot
		assertPostgresRestoreStagingCapacity(
			temporaryRoot,
			sourceAttestation.bytes,
			reserveBytes,
			options.statfs,
		)
		directory = fs.mkdtempSync(
			path.join(temporaryRoot, 'veud-postgres-restore-'),
		)
	}
	fs.chmodSync(directory, 0o700)
	assertPrivatePostgresBackupDirectory(
		directory,
		`${label} private staging directory`,
	)
	if (
		fs.realpathSync(directory) !== directory ||
		fs.realpathSync(path.dirname(directory)) !== temporaryRoot
	) {
		throw new Error(`${label} private staging directory changed after creation`)
	}
	const stagedPath = path.join(directory, 'archive.dump')
	try {
		const attestation = copyPostgresBackupToPrivatePath(
			source,
			stagedPath,
			sourceAttestation,
			label,
		)
		const result = await callback({
			path: stagedPath,
			attestation,
		})
		assertPrivatePostgresBackupFile(
			stagedPath,
			attestation,
			`${label} private copy`,
		)
		attestPostgresBackupFile(source, sourceAttestation, label)
		return result
	} finally {
		fs.rmSync(directory, { recursive: true, force: true })
	}
}

export function syncPostgresBackupPath(filename) {
	const descriptor = fs.openSync(
		filename,
		fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
	)
	try {
		if (!fs.fstatSync(descriptor).isFile()) {
			throw new Error('PostgreSQL backup artifact must be a regular file')
		}
		fs.fsyncSync(descriptor)
	} finally {
		fs.closeSync(descriptor)
	}
}

export function syncPostgresBackupDirectory(directory) {
	const descriptor = fs.openSync(directory, 'r')
	try {
		fs.fsyncSync(descriptor)
	} finally {
		fs.closeSync(descriptor)
	}
}

export function publishPostgresBackupFile(source, destination, expected) {
	const attestation = assertPrivatePostgresBackupFile(source, expected)
	assertPrivatePostgresBackupDirectory(
		path.dirname(destination),
		'PostgreSQL backup publication directory',
	)
	syncPostgresBackupPath(source)
	try {
		fs.linkSync(source, destination)
	} catch (error) {
		if (error?.code === 'EEXIST') {
			throw new Error('PostgreSQL backup publication target already exists', {
				cause: error,
			})
		}
		throw error
	}
	syncPostgresBackupDirectory(path.dirname(destination))
	fs.unlinkSync(source)
	syncPostgresBackupDirectory(path.dirname(destination))
	assertPrivatePostgresBackupFile(destination, attestation)
}

export function replacePrivatePostgresBackupFileAtomically(
	source,
	destination,
	expectedSource,
	expectedDestination,
) {
	const resolvedSource = path.resolve(source)
	const resolvedDestination = path.resolve(destination)
	if (
		path.dirname(resolvedSource) !== path.dirname(resolvedDestination) ||
		resolvedSource === resolvedDestination
	) {
		throw new Error(
			'PostgreSQL backup atomic replacement requires distinct files in one private directory',
		)
	}
	if (!expectedDestination) {
		throw new Error(
			'PostgreSQL backup atomic replacement requires the existing target attestation',
		)
	}
	const sourceAttestation = assertPrivatePostgresBackupFile(
		resolvedSource,
		expectedSource,
		'PostgreSQL backup replacement source',
	)
	assertPrivatePostgresBackupFile(
		resolvedDestination,
		expectedDestination,
		'PostgreSQL backup replacement target',
	)
	syncPostgresBackupPath(resolvedSource)
	assertPrivatePostgresBackupFile(
		resolvedDestination,
		expectedDestination,
		'PostgreSQL backup replacement target',
	)
	fs.renameSync(resolvedSource, resolvedDestination)
	syncPostgresBackupPath(resolvedDestination)
	syncPostgresBackupDirectory(path.dirname(resolvedDestination))
	return assertPrivatePostgresBackupFile(
		resolvedDestination,
		sourceAttestation,
		'PostgreSQL backup replacement result',
	)
}

export function removePostgresBackupFileDurably(filename) {
	const existed = fs.existsSync(filename)
	fs.rmSync(filename, { force: true })
	if (existed && fs.existsSync(path.dirname(filename))) {
		syncPostgresBackupDirectory(path.dirname(filename))
	}
}

export function postgresBackupPublicationOrder({
	localArchive,
	localReceipt,
	offsiteArchive,
	offsiteReceipt,
}) {
	const publications = [
		{
			source: localArchive.source,
			target: localArchive.target,
			expected: localArchive.expected,
		},
	]
	if (offsiteArchive) {
		publications.push({
			source: offsiteArchive.source,
			target: offsiteArchive.target,
			expected: offsiteArchive.expected,
		})
	}
	if (offsiteReceipt) {
		publications.push({
			source: offsiteReceipt.source,
			target: offsiteReceipt.target,
			expected: offsiteReceipt.expected,
		})
	}
	// The local receipt is the overall completion authority. It is published only
	// after every requested archive and independent receipt is durable.
	publications.push({
		source: localReceipt.source,
		target: localReceipt.target,
		expected: localReceipt.expected,
	})
	return publications
}

export function publishPostgresBackupArtifacts(
	artifacts,
	publish = publishPostgresBackupFile,
	onPublished = () => undefined,
) {
	const published = []
	for (const artifact of postgresBackupPublicationOrder(artifacts)) {
		publish(artifact.source, artifact.target, artifact.expected)
		published.push(artifact.target)
		onPublished(artifact.target)
	}
	return published
}

function processIsAlive(pid) {
	try {
		process.kill(pid, 0)
		return true
	} catch (error) {
		return error?.code === 'EPERM'
	}
}

export function cleanupInterruptedPostgresBackupArtifacts(
	directory,
	{
		now = Date.now(),
		orphanGraceMs = 60 * 60 * 1_000,
		isProcessAlive = processIsAlive,
	} = {},
) {
	if (!fs.existsSync(directory)) return []
	if (
		!Number.isSafeInteger(orphanGraceMs) ||
		orphanGraceMs < 0 ||
		orphanGraceMs > 7 * 24 * 60 * 60 * 1_000
	) {
		throw new Error(
			'PostgreSQL backup orphan grace must be between 0 and 604800000 milliseconds',
		)
	}
	const entries = fs.readdirSync(directory, { withFileTypes: true })
	const names = new Set(
		entries.filter(entry => entry.isFile()).map(entry => entry.name),
	)
	const removed = []
	for (const entry of entries) {
		if (!entry.isFile()) continue
		const interrupted = INTERRUPTED_ARTIFACT.exec(entry.name)
		const filename = path.join(directory, entry.name)
		if (interrupted) {
			if (isProcessAlive(Number(interrupted[1]))) continue
			removePostgresBackupFileDurably(filename)
			removed.push(filename)
			continue
		}
		const age = now - fs.statSync(filename).mtimeMs
		if (age < orphanGraceMs) continue
		if (
			POSTGRES_ARCHIVE.test(entry.name) &&
			!names.has(`${entry.name}.restore-verified.json`)
		) {
			removePostgresBackupFileDurably(filename)
			removed.push(filename)
		} else if (
			POSTGRES_RECEIPT.test(entry.name) &&
			!names.has(entry.name.replace(/\.restore-verified\.json$/, ''))
		) {
			removePostgresBackupFileDurably(filename)
			removed.push(filename)
		}
	}
	return removed
}
