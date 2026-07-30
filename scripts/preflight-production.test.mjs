import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { runProductionPreflight } from './preflight-production.mjs'

const roots = []

afterEach(() => {
	for (const root of roots.splice(0)) {
		fs.rmSync(root, { recursive: true, force: true })
	}
})

const APPLICATION_URL =
	'postgresql://veud_production_app:' +
	'a'.repeat(64) +
	'@127.0.0.1:5433/veud_production?schema=public'
const RESTORE_URL =
	'postgresql://veud_production_restore:' +
	'b'.repeat(64) +
	'@127.0.0.1:5433/veud_production_restore?schema=public'
const SECRET = 'c'.repeat(64)

function productionRoot({
	applicationUrl = APPLICATION_URL,
	operationsUrl = APPLICATION_URL,
	restoreUrl = RESTORE_URL,
	secrets = {
		SESSION_SECRET: SECRET,
		HONEYPOT_SECRET: SECRET,
		INTERNAL_COMMAND_TOKEN: SECRET,
	},
	release = 'd'.repeat(40),
	activate = true,
	blockingState = undefined,
	applicationMode = 0o600,
	port = '4021',
	host = '127.0.0.1',
	runMode = undefined,
	lockMode = undefined,
} = {}) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'veud-preflight-'))
	roots.push(root)
	fs.mkdirSync(path.join(root, 'config'), { recursive: true })
	fs.mkdirSync(path.join(root, 'run'), { recursive: true })
	// A correctly provisioned production root keeps its runtime state private.
	fs.chmodSync(path.join(root, 'run'), 0o700)
	const applicationLines = [
		`DATABASE_URL="${applicationUrl}"`,
		`PORT="${port}"`,
		`HOST="${host}"`,
	]
	for (const [key, value] of Object.entries(secrets)) {
		applicationLines.push(`${key}="${value}"`)
	}
	fs.writeFileSync(
		path.join(root, 'config/application.env'),
		`${applicationLines.join('\n')}\n`,
		{ mode: applicationMode },
	)
	fs.writeFileSync(
		path.join(root, 'config/postgres.env'),
		[
			`DATABASE_URL="${operationsUrl}"`,
			`POSTGRES_BACKUP_VERIFY_URL="${restoreUrl}"`,
			'',
		].join('\n'),
		{ mode: 0o600 },
	)
	if (activate) {
		const releases = path.join(root, 'app/releases', release)
		fs.mkdirSync(releases, { recursive: true })
		fs.mkdirSync(path.join(releases, 'scripts'), { recursive: true })
		fs.mkdirSync(path.join(releases, 'ops/local-production'), {
			recursive: true,
		})
		fs.writeFileSync(path.join(releases, 'scripts/pm2-entry.mjs'), '')
		fs.writeFileSync(path.join(releases, 'ops/local-production/run-app.sh'), '')
		fs.writeFileSync(path.join(releases, 'RELEASE'), `${release}\n`)
		fs.symlinkSync(releases, path.join(root, 'app/current'))
	} else {
		fs.mkdirSync(path.join(root, 'app'), { recursive: true })
	}
	if (lockMode !== undefined) {
		const lock = path.join(root, 'run/catalog-writer-lifetime.lock')
		fs.writeFileSync(lock, '')
		fs.chmodSync(lock, lockMode)
	}
	if (runMode !== undefined) fs.chmodSync(path.join(root, 'run'), runMode)
	if (blockingState) {
		fs.writeFileSync(path.join(root, 'run', blockingState), 'blocked\n')
	}
	return root
}

// Default to "pm2 absent" so no test depends on the host's real process list.
function preflight(root, readPm2Processes = () => undefined) {
	return runProductionPreflight({ productionRoot: root, readPm2Processes })
}

function run(options) {
	return preflight(productionRoot(options))
}

function pm2Process(name, execPath, interpreter = 'bash', restarts = 0) {
	return {
		name,
		pm2_env: {
			pm_exec_path: execPath,
			exec_interpreter: interpreter,
			restart_time: restarts,
		},
	}
}

function releasePath(root, ...parts) {
	return path.join(fs.realpathSync(path.join(root, 'app/current')), ...parts)
}

test('a correct production setup passes and reports the activated release', () => {
	const result = run()
	expect(result.failures).toEqual([])
	expect(result.notes.join(' ')).toContain('activated release dddddddddddd')
})

test('a staging datasource in application.env fails closed', () => {
	// This is the exact misconfiguration that took production down: the
	// application config carried staging credentials while the launcher required
	// the production identity.
	const stagingUrl =
		'postgresql://veud_staging_app:' +
		'a'.repeat(64) +
		'@127.0.0.1:5433/veud_staging?schema=public'
	const result = run({ applicationUrl: stagingUrl })
	expect(result.failures.join('\n')).toContain('application.env DATABASE_URL')
	expect(result.failures.join('\n')).toContain('role veud_staging_app')
	expect(result.failures.join('\n')).toContain('database veud_staging')
	// The parity failure is reported too, so the cause is unambiguous.
	expect(result.failures.join('\n')).toContain('must be identical')
})

test('a datasource mismatch between the two config files is reported', () => {
	const otherUrl =
		'postgresql://veud_production_app:' +
		'z'.repeat(64) +
		'@127.0.0.1:5433/veud_production?schema=public'
	const result = run({ operationsUrl: otherUrl })
	expect(result.failures.join('\n')).toContain('must be identical')
})

test('short production secrets fail with their measured length', () => {
	const result = run({
		secrets: {
			SESSION_SECRET: SECRET,
			HONEYPOT_SECRET: 'super-duper-s3cret',
			INTERNAL_COMMAND_TOKEN: SECRET,
		},
	})
	// The honeypot placeholder is 18 characters — the local failure that started
	// this investigation.
	expect(result.failures.join('\n')).toContain(
		'HONEYPOT_SECRET must contain at least 32 characters (found 18)',
	)
})

test('every production secret is checked, not just the first', () => {
	const result = run({
		secrets: {
			SESSION_SECRET: 'short',
			HONEYPOT_SECRET: 'short',
			INTERNAL_COMMAND_TOKEN: 'short',
		},
	})
	for (const secret of [
		'SESSION_SECRET',
		'HONEYPOT_SECRET',
		'INTERNAL_COMMAND_TOKEN',
	]) {
		expect(result.failures.join('\n')).toContain(secret)
	}
})

test('a missing activated release fails before anything restarts', () => {
	const result = run({ activate: false })
	expect(result.failures.join('\n')).toContain('No activated release')
})

test('an in-progress or blocked cutover prevents a start', () => {
	for (const state of [
		'catalog-release-preparation.state',
		'catalog-release-maintenance.state',
		'catalog-release-emergency-block.state',
	]) {
		const result = run({ blockingState: state })
		expect(result.failures.join('\n')).toContain(state)
	}
})

test('a group or world readable config file is refused', () => {
	const result = run({ applicationMode: 0o640 })
	expect(result.failures.join('\n')).toContain('group or world accessible')
})

test('the restore datasource must be the dedicated restore role', () => {
	const result = run({ restoreUrl: APPLICATION_URL })
	expect(result.failures.join('\n')).toContain('POSTGRES_BACKUP_VERIFY_URL')
	expect(result.failures.join('\n')).toContain('veud_production_restore')
})

test('a missing config file is reported rather than crashing', () => {
	const root = productionRoot()
	fs.rmSync(path.join(root, 'config/application.env'))
	const result = preflight(root)
	expect(result.failures.join('\n')).toContain(
		'Production application configuration does not exist',
	)
})

test('a symlinked config file is refused instead of read through', () => {
	// The mode check is a security check, so it has to describe the bytes read.
	// The race itself is prevented structurally (one O_NOFOLLOW open, then fstat
	// and read on that descriptor); this test pins the refusal that goes with it.
	const root = productionRoot()
	const elsewhere = path.join(root, 'config/elsewhere.env')
	fs.writeFileSync(elsewhere, `DATABASE_URL="${APPLICATION_URL}"\n`, {
		mode: 0o600,
	})
	const target = path.join(root, 'config/application.env')
	fs.rmSync(target)
	fs.symlinkSync(elsewhere, target)
	const result = preflight(root)
	expect(result.failures.join('\n')).toContain(
		'must be a regular non-symlink file',
	)
})

test('secret values never appear in the reported failures', () => {
	const result = run({
		applicationUrl:
			'postgresql://veud_staging_app:' +
			'sekrit'.repeat(11) +
			'@127.0.0.1:5433/veud_staging?schema=public',
	})
	const report = [...result.failures, ...result.notes].join('\n')
	expect(report).not.toContain('sekrit')
})

test('a release predating the launcher entry point is rejected', () => {
	// The exact condition that left production unstartable: the activated
	// release was cut before scripts/pm2-entry.mjs and run-app.sh existed, so
	// the launcher's `cd $APP_ROOT && node scripts/pm2-entry.mjs` cannot work.
	const root = productionRoot()
	const release = fs.readlinkSync(path.join(root, 'app/current'))
	fs.rmSync(path.join(release, 'scripts'), { recursive: true, force: true })
	fs.rmSync(path.join(release, 'ops'), { recursive: true, force: true })
	const result = preflight(root)
	const report = result.failures.join('\n')
	expect(report).toContain('scripts/pm2-entry.mjs')
	expect(report).toContain('ops/local-production/run-app.sh')
	expect(report).toContain('a restart cannot fix this')
})

test('a release containing the launcher entry point passes', () => {
	const root = productionRoot()
	const result = preflight(root)
	expect(result.failures).toEqual([])
})

test('a pm2 definition pairing bash with the development script is rejected', () => {
	// The live failure that silently broke hourly production backups: the saved
	// list kept the production interpreter (bash) alongside the development
	// script path, so bash tried to execute a JavaScript file.
	const root = productionRoot()
	const result = preflight(root, () => [
		pm2Process('veud', releasePath(root, 'ops/local-production/run-app.sh')),
		pm2Process(
			'veud-backup',
			'/home/acarl/Programs/Veud/scripts/backup-database.mjs',
		),
	])
	const report = result.failures.join('\n')
	expect(report).toContain('veud-backup')
	expect(report).toContain('bash tries to execute JavaScript')
})

test('a launcher run from outside the activated release is rejected', () => {
	// Relative script paths in ecosystem.config.cjs resolve against the cwd of
	// `pm2 start`, so a list saved from the repository runs the working tree.
	const root = productionRoot()
	const result = preflight(root, () => [
		pm2Process(
			'veud',
			'/home/acarl/Programs/Veud/ops/local-production/run-app.sh',
		),
		pm2Process(
			'veud-backup',
			'/home/acarl/Programs/Veud/ops/local-production/run-backup.sh',
		),
	])
	const report = result.failures.join('\n')
	expect(report).toContain('outside the activated release')
	// Both processes are reported, not just the first.
	expect(result.failures).toHaveLength(2)
	expect(report).toContain('saved veud definition')
	expect(report).toContain('saved veud-backup definition')
})

test('pm2 definitions taken from the activated release pass', () => {
	const root = productionRoot()
	const result = preflight(root, () => [
		pm2Process('veud', releasePath(root, 'ops/local-production/run-app.sh')),
		pm2Process(
			'veud-backup',
			releasePath(root, 'ops/local-production/run-backup.sh'),
		),
	])
	expect(result.failures).toEqual([])
})

test('a missing pm2 process is a note, not a failure', () => {
	const root = productionRoot()
	const result = preflight(root, () => [])
	expect(result.failures).toEqual([])
	expect(result.notes.join('\n')).toContain('no saved veud-backup process yet')
})

test('the staging port in application.env is refused with its cause named', () => {
	// The exact failure that stopped the recovery deployment at its health check:
	// production carried staging's port, and `${PORT:-4021}` cannot override a
	// value that is already set, so production tried to bind the port the running
	// staging app already held.
	const result = run({ port: '4022' })
	const report = result.failures.join('\n')
	expect(report).toContain('application.env PORT must be 4021')
	expect(report).toContain('found 4022')
	expect(report).toContain('staging port')
})

test('any other wrong port is refused without claiming it came from staging', () => {
	const result = run({ port: '8080' })
	const report = result.failures.join('\n')
	expect(report).toContain('found 8080')
	expect(report).not.toContain('staging port')
})

test('an unset port is a note, because the launcher default applies', () => {
	const root = productionRoot()
	const file = path.join(root, 'config/application.env')
	fs.writeFileSync(
		file,
		fs
			.readFileSync(file, 'utf8')
			.split('\n')
			.filter(line => !line.startsWith('PORT='))
			.join('\n'),
		{ mode: 0o600 },
	)
	const result = preflight(root)
	expect(result.failures).toEqual([])
	expect(result.notes.join(' ')).toContain('PORT is unset')
})

test('a host that would expose production beyond the proxy is refused', () => {
	const result = run({ host: '0.0.0.0' })
	expect(result.failures.join('\n')).toContain('application.env HOST must be')
	expect(result.failures.join('\n')).toContain('found 0.0.0.0')
})

test('a group or world accessible runtime state directory is refused', () => {
	// `run/` was mode 0777 with a default ACL granting other rwx, so every lock
	// created there inherited 0666 and the writer guard blocked the deployment.
	const result = run({ runMode: 0o777 })
	const report = result.failures.join('\n')
	expect(report).toContain(
		'runtime state directory is group or world accessible',
	)
	expect(report).toContain('777')
})

test('a group or world writable runtime lock is refused', () => {
	// The catalog-writer runtime guard requires (mode & 0o022) === 0, so the
	// preflight has to reject exactly what the guard would reject — otherwise it
	// passes and the writer fails later, mid-cutover.
	const result = run({ lockMode: 0o666 })
	const report = result.failures.join('\n')
	expect(report).toContain('catalog-writer-lifetime.lock')
	expect(report).toContain('group or world writable')
})

test('a private runtime lock passes', () => {
	const result = run({ lockMode: 0o600 })
	expect(result.failures).toEqual([])
})
