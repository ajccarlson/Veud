import fs from 'node:fs'
import path from 'node:path'

const POSTGRES_BACKUP_PATTERN = /^postgres-.*\.dump$/

export function parsePostgresConnection(value, label) {
	let url
	try {
		url = new URL(value)
	} catch {
		throw new Error(`${label} must be a valid PostgreSQL URL`)
	}
	if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
		throw new Error(`${label} must use postgresql://`)
	}
	const database = decodeURIComponent(url.pathname.replace(/^\//, ''))
	if (!url.hostname || !database) {
		throw new Error(`${label} must include a host and database name`)
	}
	return {
		host: url.hostname,
		port: url.port || '5432',
		user: decodeURIComponent(url.username),
		password: decodeURIComponent(url.password),
		database,
		sslmode: url.searchParams.get('sslmode') || undefined,
	}
}

export function postgresConnectionIdentity(connection) {
	return `${connection.host.toLowerCase()}:${connection.port}/${connection.database}`
}

export function assertSafeRestoreTarget(source, restore) {
	if (
		postgresConnectionIdentity(source) === postgresConnectionIdentity(restore)
	) {
		throw new Error(
			'POSTGRES_BACKUP_VERIFY_URL must not point to the primary database',
		)
	}
	if (!/(restore|verify|drill)/i.test(restore.database)) {
		throw new Error(
			'POSTGRES_BACKUP_VERIFY_URL database name must contain restore, verify, or drill',
		)
	}
}

export function postgresConnectionEnv(connection) {
	return {
		PGHOST: connection.host,
		PGPORT: connection.port,
		PGUSER: connection.user,
		PGPASSWORD: connection.password,
		PGDATABASE: connection.database,
		...(connection.sslmode ? { PGSSLMODE: connection.sslmode } : {}),
	}
}

export function listPostgresBackups(backupDir) {
	if (!fs.existsSync(backupDir)) return []
	return fs
		.readdirSync(backupDir, { withFileTypes: true })
		.filter(entry => entry.isFile() && POSTGRES_BACKUP_PATTERN.test(entry.name))
		.map(entry => ({
			name: entry.name,
			path: path.join(backupDir, entry.name),
			mtime: fs.statSync(path.join(backupDir, entry.name)).mtimeMs,
		}))
		.sort(
			(left, right) =>
				right.mtime - left.mtime || right.name.localeCompare(left.name),
		)
}

export function findLatestPostgresBackup(backupDir) {
	const latest = listPostgresBackups(backupDir)[0]
	if (!latest)
		throw new Error(`No postgres-*.dump backups found in ${backupDir}`)
	return latest.path
}

export function prunePostgresBackups(backupDir, keep) {
	if (!Number.isSafeInteger(keep) || keep < 1) {
		throw new Error(
			`Backup retention must be a positive integer; received ${keep}`,
		)
	}
	const removed = []
	for (const backup of listPostgresBackups(backupDir).slice(keep)) {
		fs.unlinkSync(backup.path)
		fs.rmSync(`${backup.path}.restore-verified.json`, { force: true })
		removed.push(backup.name)
	}
	return removed
}

export function assertIndependentBackupMount(
	offsiteDir,
	mountPoint,
	minimumFreeBytes = 0,
	operations = {},
) {
	const realpath = operations.realpath ?? fs.realpathSync
	const stat = operations.stat ?? fs.statSync
	const statfs = operations.statfs ?? fs.statfsSync
	if (!mountPoint) return
	if (!fs.existsSync(offsiteDir) || !fs.statSync(offsiteDir).isDirectory()) {
		throw new Error(
			'BACKUP_OFFSITE_DIR must already exist and be mounted/synced',
		)
	}
	if (!fs.existsSync(mountPoint) || !fs.statSync(mountPoint).isDirectory()) {
		throw new Error('BACKUP_OFFSITE_MOUNTPOINT must be an existing directory')
	}
	const resolvedDirectory = realpath(offsiteDir)
	const resolvedMount = realpath(mountPoint)
	const relative = path.relative(resolvedMount, resolvedDirectory)
	if (relative.startsWith('..') || path.isAbsolute(relative)) {
		throw new Error(
			'BACKUP_OFFSITE_DIR must be inside BACKUP_OFFSITE_MOUNTPOINT',
		)
	}
	if (stat(resolvedMount).dev === stat(path.dirname(resolvedMount)).dev) {
		throw new Error(
			'BACKUP_OFFSITE_MOUNTPOINT is not a distinct mounted filesystem',
		)
	}
	if (!Number.isSafeInteger(minimumFreeBytes) || minimumFreeBytes < 0) {
		throw new Error(
			'BACKUP_OFFSITE_MIN_FREE_BYTES must be a non-negative integer',
		)
	}
	const filesystem = statfs(resolvedDirectory)
	const availableBytes = Number(filesystem.bavail) * Number(filesystem.bsize)
	if (availableBytes < minimumFreeBytes) {
		throw new Error(
			`BACKUP_OFFSITE_DIR has ${availableBytes} bytes available; ${minimumFreeBytes} required`,
		)
	}
}
