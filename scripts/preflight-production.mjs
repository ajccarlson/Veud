#!/usr/bin/env node
/**
 * Validate the production runtime setup before PM2 is asked to start it.
 *
 * A production start has several independent preconditions — an activated
 * release, a config file whose datasource really is production, secrets long
 * enough for the startup validator, a supported Node runtime. When any of them
 * is wrong the launcher fails inside PM2, which retries, and the real reason
 * scrolls past in a JSON log. Checking them up front turns that into one clear
 * message before anything restarts.
 *
 * Secret VALUES are never read into a report or printed: only their length is
 * measured, and only the structure of a datasource is described.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const MINIMUM_PRODUCTION_SECRET_LENGTH = 32
const REQUIRED_NODE_MAJOR = 22
const EXPECTED_HOST = '127.0.0.1'
const EXPECTED_PORT = '5433'
const EXPECTED_APPLICATION_ROLE = 'veud_production_app'
const EXPECTED_APPLICATION_DATABASE = 'veud_production'
const EXPECTED_RESTORE_ROLE = 'veud_production_restore'
const EXPECTED_RESTORE_DATABASE = 'veud_production_restore'
const PRODUCTION_SECRETS = [
	'SESSION_SECRET',
	'HONEYPOT_SECRET',
	'INTERNAL_COMMAND_TOKEN',
]
const EXPECTED_LISTEN_HOST = '127.0.0.1'
const EXPECTED_LISTEN_PORT = '4021'
const STAGING_LISTEN_PORT = '4022'

const failures = []
const notes = []

function fail(message) {
	failures.push(message)
}

/**
 * The file-type and mode checks below are security checks, so they have to
 * describe the bytes actually read. Opening once with O_NOFOLLOW and then
 * inspecting that descriptor lets the kernel reject a symlink atomically and
 * guarantees fstat and read see the same inode — re-checking the path with
 * lstat would leave a window in which it could be swapped for a symlink.
 */
function readEnvFile(file, label) {
	let fd
	try {
		fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
	} catch (error) {
		const code = error?.code
		if (code === 'ELOOP') {
			fail(`${label} must be a regular non-symlink file: ${file}`)
		} else if (code === 'ENOENT') {
			fail(`${label} does not exist: ${file}`)
		} else {
			fail(`${label} could not be opened (${code ?? 'unknown error'}): ${file}`)
		}
		return undefined
	}
	try {
		const stat = fs.fstatSync(fd)
		if (!stat.isFile()) {
			fail(`${label} must be a regular non-symlink file: ${file}`)
			return undefined
		}
		if ((stat.mode & 0o077) !== 0) {
			fail(
				`${label} is group or world accessible (mode ${(stat.mode & 0o777).toString(8)}): ${file}`,
			)
		}
		const values = new Map()
		for (const line of fs.readFileSync(fd, 'utf8').split('\n')) {
			const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
			if (!match) continue
			values.set(match[1], match[2].replace(/^"|"$/g, ''))
		}
		return values
	} finally {
		fs.closeSync(fd)
	}
}

/** Describe a datasource without ever surfacing its password. */
function checkDatasource(rawUrl, label, expectedRole, expectedDatabase) {
	if (!rawUrl) {
		fail(`${label} is missing`)
		return
	}
	let url
	try {
		url = new URL(rawUrl)
	} catch {
		fail(`${label} is not a valid URL`)
		return
	}
	const problems = []
	if (url.protocol !== 'postgresql:') problems.push(`protocol ${url.protocol}`)
	if (url.username !== expectedRole) problems.push(`role ${url.username}`)
	if (!url.password) problems.push('empty password')
	if (url.hostname !== EXPECTED_HOST) problems.push(`host ${url.hostname}`)
	if (url.port !== EXPECTED_PORT) problems.push(`port ${url.port}`)
	if (url.pathname !== `/${expectedDatabase}`) {
		problems.push(`database ${url.pathname.replace(/^\//, '')}`)
	}
	if (url.search !== '?schema=public' || url.searchParams.size !== 1) {
		problems.push(`query ${url.search || '(none)'}`)
	}
	if (problems.length) {
		fail(
			`${label} does not match ${expectedRole}@${EXPECTED_HOST}:${EXPECTED_PORT}/${expectedDatabase}?schema=public — found ${problems.join(', ')}`,
		)
	}
}

export function checkNodeRuntime(version = process.version) {
	const major = Number.parseInt(version.replace(/^v/, '').split('.')[0], 10)
	if (major !== REQUIRED_NODE_MAJOR) {
		fail(`Node ${REQUIRED_NODE_MAJOR} is required; this process is ${version}`)
	}
}

function checkActivatedRelease(productionRoot) {
	const current = path.join(productionRoot, 'app/current')
	let target
	try {
		target = fs.readlinkSync(current)
	} catch {
		fail(
			`No activated release: ${current} is not a symlink. Deploy a release before starting.`,
		)
		return
	}
	const releaseFile = path.join(current, 'RELEASE')
	let recorded
	try {
		recorded = fs.readFileSync(releaseFile, 'utf8').trim()
	} catch {
		fail(`Activated release has no RELEASE marker: ${releaseFile}`)
		return
	}
	if (!/^[0-9a-f]{40}$/.test(recorded)) {
		fail(`Activated release marker is not a commit: ${releaseFile}`)
		return
	}
	if (path.basename(target) !== recorded) {
		fail(
			`Activated release symlink and marker disagree: ${path.basename(target)} vs ${recorded}`,
		)
		return
	}
	notes.push(`activated release ${recorded.slice(0, 12)}`)

	// The launcher does `cd "$APP_ROOT"` and executes the RELEASE's own entry
	// point, so a release cut before that entry point existed can never be
	// started by the current launcher. This is precisely how production ended up
	// unstartable: the activated release predated the runtime-lifecycle
	// hardening that introduced these files, and the only fix is a deployment,
	// not a restart.
	for (const required of [
		'scripts/pm2-entry.mjs',
		'ops/local-production/run-app.sh',
	]) {
		if (!fs.existsSync(path.join(current, required))) {
			fail(
				`Activated release ${recorded.slice(0, 12)} is missing ${required}, so the current launcher cannot start it. ` +
					'Deploy a current release with ops/local-production/deploy-catalog-release.sh; a restart cannot fix this.',
			)
		}
	}
}

/**
 * The listen address decides whether production can bind at all, and it comes
 * from the same file that has twice been found holding staging's values. The
 * launcher defaults to 4021, but `${PORT:-4021}` cannot override a value that is
 * already set — so a copied staging PORT wins silently and production fails at
 * the health check with EADDRINUSE against the running staging app.
 */
function checkListenAddress(application) {
	const port = (application.get('PORT') ?? '').trim()
	if (!port) {
		notes.push(
			`PORT is unset, so the launcher default ${EXPECTED_LISTEN_PORT} applies`,
		)
	} else if (port !== EXPECTED_LISTEN_PORT) {
		fail(
			`application.env PORT must be ${EXPECTED_LISTEN_PORT}; found ${port}` +
				(port === STAGING_LISTEN_PORT
					? '. That is the staging port: this file was copied from staging, and production cannot bind it while staging is running.'
					: '.'),
		)
	}
	const host = (application.get('HOST') ?? '').trim()
	if (host && host !== EXPECTED_LISTEN_HOST) {
		fail(
			`application.env HOST must be ${EXPECTED_LISTEN_HOST} so only the reverse proxy can reach production; found ${host}`,
		)
	}
}

/**
 * The catalog-writer lifetime lock is only meaningful if no other account can
 * write it, so the runtime guard refuses any lock with group or world write
 * bits. That is not hypothetical: `run/` was mode 0777 with a default ACL
 * granting `other` rwx, every lock created there inherited 0666, and the guard
 * correctly blocked a production deployment mid-cutover.
 */
function checkRuntimeStateDirectory(productionRoot) {
	const runDir = path.join(productionRoot, 'run')
	let dirStat
	try {
		dirStat = fs.lstatSync(runDir)
	} catch {
		notes.push(`no runtime state directory yet: ${runDir}`)
		return
	}
	if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) {
		fail(`Production runtime state path must be a real directory: ${runDir}`)
		return
	}
	if ((dirStat.mode & 0o077) !== 0) {
		fail(
			`Production runtime state directory is group or world accessible (mode ${(dirStat.mode & 0o777).toString(8)}): ${runDir}. ` +
				'Files created there inherit the exposure, and the catalog-writer guard refuses a writable lock.',
		)
	}
	let entries
	try {
		entries = fs.readdirSync(runDir)
	} catch {
		return
	}
	for (const entry of entries.filter(name => name.endsWith('.lock'))) {
		const file = path.join(runDir, entry)
		let lockStat
		try {
			lockStat = fs.lstatSync(file)
		} catch {
			continue
		}
		if ((lockStat.mode & 0o022) !== 0) {
			fail(
				`Runtime lock is group or world writable (mode ${(lockStat.mode & 0o777).toString(8)}): ${file}. ` +
					'The catalog-writer lifetime-lock guard requires no group or world write bits and will refuse to start a writer.',
			)
		}
	}
}

function checkBlockingCutoverState(productionRoot) {
	for (const name of [
		'catalog-release-preparation.state',
		'catalog-release-maintenance.state',
		'catalog-release-emergency-block.state',
	]) {
		const file = path.join(productionRoot, 'run', name)
		if (fs.existsSync(file)) {
			fail(`A catalog cutover is in progress or blocked: ${file}`)
		}
	}
}

/** Every process PM2 supervises in production, with the launcher each must run. */
const EXPECTED_PM2_LAUNCHERS = [
	['veud', 'ops/local-production/run-app.sh'],
	['veud-backup', 'ops/local-production/run-backup.sh'],
]

function readPm2ProcessesFromPm2() {
	let raw
	try {
		raw = execFileSync('pm2', ['jlist'], {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
		})
	} catch {
		return undefined
	}
	try {
		return JSON.parse(raw)
	} catch {
		return null
	}
}

/**
 * Report the definitions PM2 would actually run, so a stale saved process list
 * cannot quietly reintroduce a wrapper the config no longer uses.
 *
 * `ecosystem.config.cjs` chooses both the script and the interpreter from
 * NODE_ENV at load time and names the script RELATIVELY, so a saved definition
 * records whatever was resolved when `pm2 start` last ran. Two failures follow
 * from that and both have happened here: a list saved from the repository keeps
 * running the working tree instead of the immutable release, and a list saved
 * across a config change can pair the production interpreter with the
 * development script — bash executing a `.mjs` file, which is what silently
 * broke hourly backups.
 */
function checkPm2Definition(productionRoot, readPm2Processes) {
	const processes = readPm2Processes()
	if (processes === undefined) {
		notes.push('pm2 is not running, so no saved definition to compare')
		return
	}
	if (!Array.isArray(processes)) {
		notes.push('pm2 jlist output could not be parsed')
		return
	}
	let releaseRoot
	try {
		releaseRoot = fs.realpathSync(path.join(productionRoot, 'app/current'))
	} catch {
		// checkActivatedRelease already reported the missing release.
		releaseRoot = undefined
	}
	for (const [name, launcher] of EXPECTED_PM2_LAUNCHERS) {
		const app = processes.find(entry => entry?.name === name)
		if (!app) {
			notes.push(`pm2 has no saved ${name} process yet`)
			continue
		}
		const execPath = String(app.pm2_env?.pm_exec_path ?? '')
		const interpreter = String(app.pm2_env?.exec_interpreter ?? '')
		if (interpreter === 'bash' && execPath.endsWith('.mjs')) {
			fail(
				`pm2's saved ${name} definition runs ${execPath} with the bash interpreter, so bash tries to execute JavaScript. ` +
					'The saved list mixes the production interpreter with the development script; recreate it from the activated release.',
			)
		} else if (!execPath.endsWith(launcher)) {
			fail(
				`pm2's saved ${name} definition runs ${execPath || '(unknown)'} instead of ${launcher}. ` +
					`Run "pm2 delete ${name}", recreate it from the activated release, and "pm2 save".`,
			)
		} else if (
			releaseRoot &&
			!execPath.startsWith(`${releaseRoot}${path.sep}`)
		) {
			fail(
				`pm2's saved ${name} definition runs ${launcher} from ${execPath}, which is outside the activated release ${releaseRoot}. ` +
					'Production would run the working tree instead of the immutable release; recreate the definition from the release.',
			)
		}
		const restarts = Number(app.pm2_env?.restart_time ?? 0)
		if (restarts > 10) {
			notes.push(
				`pm2 has restarted ${name} ${restarts} times; investigate before starting`,
			)
		}
	}
}

export function runProductionPreflight({
	productionRoot = process.env.VEUD_PRODUCTION_ROOT ??
		`${process.env.VEUD_STAGING_LIVE_MOUNT ?? '/media/sde'}/veud-production`,
	readPm2Processes = readPm2ProcessesFromPm2,
} = {}) {
	failures.length = 0
	notes.length = 0
	checkNodeRuntime()
	checkActivatedRelease(productionRoot)
	checkBlockingCutoverState(productionRoot)
	checkRuntimeStateDirectory(productionRoot)

	const configDir = path.join(productionRoot, 'config')
	const application = readEnvFile(
		path.join(configDir, 'application.env'),
		'Production application configuration',
	)
	const operations = readEnvFile(
		path.join(configDir, 'postgres.env'),
		'Production PostgreSQL configuration',
	)

	if (application) {
		checkDatasource(
			application.get('DATABASE_URL'),
			'application.env DATABASE_URL',
			EXPECTED_APPLICATION_ROLE,
			EXPECTED_APPLICATION_DATABASE,
		)
		checkListenAddress(application)
		for (const secret of PRODUCTION_SECRETS) {
			const value = application.get(secret) ?? ''
			if (value.trim().length < MINIMUM_PRODUCTION_SECRET_LENGTH) {
				fail(
					`application.env ${secret} must contain at least ${MINIMUM_PRODUCTION_SECRET_LENGTH} characters (found ${value.trim().length})`,
				)
			}
		}
	}
	if (operations) {
		checkDatasource(
			operations.get('DATABASE_URL'),
			'postgres.env DATABASE_URL',
			EXPECTED_APPLICATION_ROLE,
			EXPECTED_APPLICATION_DATABASE,
		)
		checkDatasource(
			operations.get('POSTGRES_BACKUP_VERIFY_URL'),
			'postgres.env POSTGRES_BACKUP_VERIFY_URL',
			EXPECTED_RESTORE_ROLE,
			EXPECTED_RESTORE_DATABASE,
		)
	}
	// The launcher asserts these two agree; comparing here explains why rather
	// than failing inside PM2 with a bare identity error.
	if (application && operations) {
		const applicationUrl = application.get('DATABASE_URL')
		const operationsUrl = operations.get('DATABASE_URL')
		if (applicationUrl && operationsUrl && applicationUrl !== operationsUrl) {
			fail(
				'application.env and postgres.env DATABASE_URL must be identical; the launcher requires datasource parity',
			)
		}
	}
	checkPm2Definition(productionRoot, readPm2Processes)
	return { failures: [...failures], notes: [...notes] }
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const result = runProductionPreflight()
	for (const note of result.notes) console.log(`note: ${note}`)
	if (result.failures.length) {
		console.error('\nProduction preflight failed:')
		for (const failure of result.failures) console.error(`  - ${failure}`)
		process.exit(1)
	}
	console.log('Production preflight passed.')
}
