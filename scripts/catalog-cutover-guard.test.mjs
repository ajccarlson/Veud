import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, test } from 'vitest'

const repositoryRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'..',
)
const productionCommon = path.join(
	repositoryRoot,
	'ops/local-production/common.sh',
)
const stagingCommon = path.join(repositoryRoot, 'ops/local-staging/common.sh')
const catalogCutoverCommon = path.join(
	repositoryRoot,
	'ops/catalog-cutover-common.sh',
)
const productionDeployPath = path.join(
	repositoryRoot,
	'ops/local-production/deploy-catalog-release.sh',
)
const stagingDeployPath = path.join(
	repositoryRoot,
	'ops/local-staging/deploy.sh',
)
const productionPrepareTargetPath = path.join(
	repositoryRoot,
	'ops/local-production/prepare-target.sh',
)
const stagingProvisionPath = path.join(
	repositoryRoot,
	'ops/local-staging/provision.sh',
)
const productionProvisionPath = path.join(
	repositoryRoot,
	'ops/local-production/provision.sh',
)
const productionDeploy = fs.readFileSync(productionDeployPath, 'utf8')
const stagingDeploy = fs.readFileSync(stagingDeployPath, 'utf8')
const productionPrepareTarget = fs.readFileSync(
	productionPrepareTargetPath,
	'utf8',
)
const stagingProvision = fs.readFileSync(stagingProvisionPath, 'utf8')
const productionProvision = fs.readFileSync(productionProvisionPath, 'utf8')
const temporaryRoots = []
const childProcesses = new Set()
const originalRelease = '1'.repeat(40)
const requestedRelease = '2'.repeat(40)
const differentRelease = '3'.repeat(40)
const require = createRequire(import.meta.url)

const node22 = [
	process.env.VEUD_STAGING_NODE_BIN,
	path.join(os.homedir(), '.nvm/versions/node/v22.23.1/bin/node'),
	process.execPath,
].find(candidate => {
	if (!candidate || !fs.existsSync(candidate)) return false
	const result = spawnSync(candidate, ['--version'], { encoding: 'utf8' })
	return result.status === 0 && result.stdout.startsWith('v22.')
})

assert.ok(node22, 'The catalog cutover tests require the supported Node.js 22')

afterEach(async () => {
	for (const child of childProcesses) {
		if (child.exitCode === null) child.kill('SIGKILL')
	}
	await Promise.all(
		[...childProcesses].map(async child => {
			if (child.exitCode === null) await once(child, 'exit').catch(() => {})
		}),
	)
	childProcesses.clear()
	for (const root of temporaryRoots.splice(0)) {
		fs.rmSync(root, { recursive: true, force: true })
	}
})

function temporaryRoot(label) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), `veud-${label}-`))
	temporaryRoots.push(root)
	return root
}

function createRelease(root, release) {
	const releaseRoot = path.join(root, 'app/releases', release)
	fs.mkdirSync(releaseRoot, { recursive: true })
	fs.writeFileSync(path.join(releaseRoot, 'RELEASE'), `${release}\n`)
	return releaseRoot
}

function selectActiveRelease(root, release) {
	const current = path.join(root, 'app/current')
	fs.mkdirSync(path.dirname(current), { recursive: true })
	fs.rmSync(current, { recursive: true, force: true })
	fs.symlinkSync(path.join(root, 'app/releases', release), current)
}

function createActiveRelease(root, release) {
	createRelease(root, release)
	selectActiveRelease(root, release)
}

function writeProductionMarker(
	root,
	{
		format = 2,
		environment = 'production',
		phase,
		mutation = true,
		activated = false,
		original = originalRelease,
		requested = requestedRelease,
		stateDir = path.join(root, 'run', `catalog-release-state-${requested}`),
	} = {},
) {
	fs.mkdirSync(path.join(root, 'run'), { recursive: true })
	if (stateDir) fs.mkdirSync(stateDir, { recursive: true })
	fs.writeFileSync(
		path.join(root, 'run/catalog-release-maintenance.state'),
		[
			`format=${format}`,
			`environment=${environment}`,
			`original_active_release=${original}`,
			`requested_release=${requested}`,
			...(stateDir ? [`state_dir=${stateDir}`] : []),
			`phase=${phase}`,
			`database_mutation_started=${mutation}`,
			`release_activated=${activated}`,
			'',
		].join('\n'),
		{ mode: 0o600 },
	)
}

function writeStagingMarker(
	root,
	{
		format = 2,
		environment = 'staging',
		phase,
		mutation = true,
		activated = false,
		bootstrap = false,
		original = bootstrap ? 'none' : originalRelease,
		requested = requestedRelease,
		stateDir = path.join(root, 'run', `provenance-cutover-state-${requested}`),
	} = {},
) {
	fs.mkdirSync(path.join(root, 'run'), { recursive: true })
	if (stateDir) fs.mkdirSync(stateDir, { recursive: true })
	const unitState = path.join(root, 'run/provenance-cutover-unit-state')
	fs.writeFileSync(unitState, 'test fixture\n', { mode: 0o600 })
	fs.writeFileSync(
		path.join(root, 'run/provenance-cutover-incomplete'),
		[
			`format=${format}`,
			`environment=${environment}`,
			`release=${requested}`,
			`original_release=${original}`,
			`bootstrap=${bootstrap}`,
			`backup_source_policy=${
				bootstrap ? 'pristine-empty-v1' : 'migrated-veud-v1'
			}`,
			...(stateDir ? [`state_dir=${stateDir}`] : []),
			`phase=${phase}`,
			`mutation_started=${mutation}`,
			`release_activated=${activated}`,
			`unit_state=${unitState}`,
			'',
		].join('\n'),
		{ mode: 0o600 },
	)
}

function runBash(source, { args = [], env = {} } = {}) {
	return spawnSync('/bin/bash', ['-c', source, 'cutover-test', ...args], {
		encoding: 'utf8',
		env: { ...process.env, ...env },
	})
}

function runGuard(kind, root, role, extraCommand = '') {
	const common = kind === 'production' ? productionCommon : stagingCommon
	const guard =
		kind === 'production'
			? 'assert_production_catalog_cutover_role'
			: 'assert_staging_catalog_cutover_role'
	const environmentVariable =
		kind === 'production' ? 'VEUD_PRODUCTION_ROOT' : 'VEUD_STAGING_ROOT'
	return runBash(`source "$1"; ${guard} "$2"; ${extraCommand}`, {
		args: [common, role],
		env: {
			[environmentVariable]: root,
			VEUD_STAGING_NODE_BIN: node22,
			VEUD_STAGING_NPM_BIN: node22,
		},
	})
}

function expectAllowed(result) {
	assert.equal(result.status, 0, result.stderr)
}

function expectBlocked(result) {
	assert.notEqual(result.status, 0)
	assert.match(
		result.stderr,
		/blocked|invalid|unsupported|outside|different|unexpected/i,
	)
}

function extractShellFunction(source, name) {
	const lines = source.split('\n')
	const start = lines.findIndex(line => line === `${name}() {`)
	assert.notEqual(start, -1, `Missing shell function: ${name}`)
	let depth = 1
	let end = -1
	for (let index = start + 1; index < lines.length; index += 1) {
		if (/^[a-zA-Z_][a-zA-Z0-9_]*\(\) \{$/.test(lines[index])) {
			depth += 1
		} else if (lines[index] === '}') {
			depth -= 1
			if (depth === 0) {
				end = index
				break
			}
		}
	}
	assert.notEqual(end, -1, `Unterminated shell function: ${name}`)
	return lines.slice(start, end + 1).join('\n')
}

function withoutShellFunctions(source) {
	const lines = source.split('\n')
	const result = []
	let functionDepth = 0
	for (const line of lines) {
		if (/^[a-zA-Z_][a-zA-Z0-9_]*\(\) \{$/.test(line)) {
			functionDepth += 1
			continue
		}
		if (functionDepth > 0 && line === '}') {
			functionDepth -= 1
			continue
		}
		if (functionDepth === 0) result.push(line)
	}
	return result.join('\n')
}

function assertOrdered(source, needles, label) {
	let previous = -1
	for (const needle of needles) {
		const next = source.indexOf(needle, previous + 1)
		assert.notEqual(next, -1, `${label}: missing ${needle}`)
		assert.ok(next > previous, `${label}: ${needle} is out of order`)
		previous = next
	}
}

function parseUnitFile(source) {
	const parsed = new Map()
	let section = ''
	for (const rawLine of source.split('\n')) {
		const line = rawLine.trim()
		if (!line || line.startsWith('#') || line.startsWith(';')) continue
		if (line.startsWith('[') && line.endsWith(']')) {
			section = line.slice(1, -1)
			continue
		}
		const separator = line.indexOf('=')
		if (separator === -1) continue
		const key = `${section}.${line.slice(0, separator)}`
		const values = parsed.get(key) ?? []
		values.push(line.slice(separator + 1))
		parsed.set(key, values)
	}
	return parsed
}

function serviceDefinitions(environment) {
	const directory = path.join(
		repositoryRoot,
		`ops/local-${environment}/systemd`,
	)
	return fs
		.readdirSync(directory)
		.filter(file => file.endsWith('.service'))
		.sort()
		.map(file => {
			const source = fs.readFileSync(path.join(directory, file), 'utf8')
			const parsed = parseUnitFile(source)
			return {
				file,
				source,
				type: parsed.get('Service.Type')?.[0] ?? 'simple',
				execStarts: parsed.get('Service.ExecStart') ?? [],
			}
		})
}

function shellWords(command) {
	const words = []
	let current = ''
	let quote = ''
	for (const character of command) {
		if (quote) {
			if (character === quote) quote = ''
			else current += character
		} else if (character === '"' || character === "'") {
			quote = character
		} else if (/\s/.test(character)) {
			if (current) {
				words.push(current)
				current = ''
			}
		} else {
			current += character
		}
	}
	if (current) words.push(current)
	assert.equal(quote, '', `Unterminated quote in ExecStart: ${command}`)
	return words
}

function repositoryLauncher(word) {
	const marker = word.indexOf('/ops/local-')
	if (marker === -1 || !word.endsWith('.sh')) return null
	return path.join(repositoryRoot, word.slice(marker + 1))
}

function productionPm2Launchers() {
	const ecosystemPath = path.join(repositoryRoot, 'ecosystem.config.cjs')
	const previousEnvironment = process.env.NODE_ENV
	process.env.NODE_ENV = 'production'
	delete require.cache[require.resolve(ecosystemPath)]
	try {
		const config = require(ecosystemPath)
		return config.apps.map(app => path.resolve(repositoryRoot, app.script))
	} finally {
		delete require.cache[require.resolve(ecosystemPath)]
		if (previousEnvironment === undefined) delete process.env.NODE_ENV
		else process.env.NODE_ENV = previousEnvironment
	}
}

function instrumentLauncher(launcher, environment) {
	const root = temporaryRoot(`launcher-${path.basename(launcher, '.sh')}`)
	const copiedLauncher = path.join(root, path.basename(launcher))
	fs.copyFileSync(launcher, copiedLauncher)
	fs.chmodSync(copiedLauncher, 0o755)
	const active = createRelease(root, originalRelease)
	selectActiveRelease(root, originalRelease)
	fs.symlinkSync(active, path.join(root, 'current'))
	const common = `#!/usr/bin/env bash
set -Eeuo pipefail
PRODUCTION_ROOT="\${VEUD_PRODUCTION_ROOT}"
STAGING_ROOT="\${VEUD_STAGING_ROOT}"
APP_ROOT="$PRODUCTION_ROOT/current"
NODE_BIN=/bin/true
NPM_BIN=/bin/true
PG_BIN=/bin
die() { printf 'ERROR: %s\\n' "$*" >&2; exit 1; }
guard_live_storage() { :; }
guard_backup_storage() { :; }
load_production_worker_environment() { :; }
load_application_environment() { :; }
load_staging_environment() { :; }
verify_node_22() { :; }
assert_production_application_database_identity() { :; }
assert_production_backup_database_identities() { :; }
assert_staging_application_database_identity() { :; }
assert_staging_operations_database_identities() { :; }
assert_staging_application_operations_database_identities() { :; }
verify_active_release() { :; }
verify_active_staging_release() { :; }
require_command() { :; }
acquire_production_writer_lifetime_lock_shared() {
	printf 'lifetime-shared\\n'
}
acquire_staging_writer_lifetime_lock_shared() {
	printf 'lifetime-shared\\n'
}
assert_production_catalog_cutover_role() {
	printf 'catalog-guard:%s\\n' "$1"
	exit 86
}
assert_staging_catalog_cutover_role() {
	printf 'catalog-guard:%s\\n' "$1"
	exit 86
}
prepare_worker() {
	acquire_production_writer_lifetime_lock_shared
	assert_production_catalog_cutover_role writer
}
production_backup_release_root() { printf '%s' "$APP_ROOT"; }
staging_backup_release_root() { printf '%s' "$STAGING_ROOT/current"; }
cutover_active_release_id() { printf '${originalRelease}'; }
`
	fs.writeFileSync(path.join(root, 'common.sh'), common, { mode: 0o755 })
	const result = spawnSync('/bin/bash', [copiedLauncher], {
		encoding: 'utf8',
		env: {
			...process.env,
			VEUD_PRODUCTION_ROOT: root,
			VEUD_STAGING_ROOT: root,
			MAL_CLIENT_ID: 'test',
			MAL_CATALOG_POLICY_APPROVAL_REF: 'test',
			TMDB_API_KEY: 'test',
			RESEND_API_KEY: 'test',
		},
	})
	assert.equal(
		result.status,
		86,
		`${environment} launcher did not reach the cutover guard: ${launcher}\n${result.stderr}`,
	)
	const events = result.stdout.trim().split('\n')
	const lock = events.indexOf('lifetime-shared')
	const guard = events.findIndex(event => event.startsWith('catalog-guard:'))
	assert.ok(lock !== -1 && guard !== -1 && lock < guard, launcher)
}

function writeBackupPair(
	directory,
	name,
	contents,
	sourceTarget,
	restoreTarget,
	sourcePolicy = 'migrated-veud-v1',
) {
	fs.mkdirSync(directory, { recursive: true })
	const archive = path.join(directory, name)
	const receipt = `${archive}.restore-verified.json`
	const bytes = Buffer.from(contents)
	fs.writeFileSync(archive, bytes)
	fs.writeFileSync(
		receipt,
		JSON.stringify({
			version: 2,
			verifiedAt: '2026-07-29T12:00:00.000Z',
			sourceTarget,
			restoreTarget,
			checks: {
				expectedIdentity: sourcePolicy === 'migrated-veud-v1',
				sourcePolicy,
			},
			summary: {
				users: 0,
				watchlists: 0,
				entries: 0,
				media: 0,
				migrations: 0,
			},
			archive: {
				name,
				sha256: createHash('sha256').update(bytes).digest('hex'),
				bytes: bytes.byteLength,
			},
		}),
	)
	return { archive, receipt }
}

function waitForReady(child) {
	return new Promise((resolve, reject) => {
		let stdout = ''
		let stderr = ''
		const timeout = setTimeout(() => {
			reject(new Error(`Timed out waiting for lock holder: ${stderr}`))
		}, 5_000)
		child.stdout.on('data', chunk => {
			stdout += chunk
			if (stdout.includes('READY\n')) {
				clearTimeout(timeout)
				resolve()
			}
		})
		child.stderr.on('data', chunk => {
			stderr += chunk
		})
		child.once('exit', code => {
			if (!stdout.includes('READY\n')) {
				clearTimeout(timeout)
				reject(
					new Error(`Lock holder exited before readiness (${code}): ${stderr}`),
				)
			}
		})
	})
}

async function startLifetimeLockHolder(kind, root, preopened = false) {
	const common = kind === 'production' ? productionCommon : stagingCommon
	const acquire =
		kind === 'production'
			? 'acquire_production_writer_lifetime_lock_shared'
			: 'acquire_staging_writer_lifetime_lock_shared'
	const lock = path.join(root, 'run/catalog-writer-lifetime.lock')
	fs.mkdirSync(path.dirname(lock), { recursive: true })
	const preopen = preopened ? 'exec 8>"$3"; flock --shared 8;' : ''
	const child = spawn(
		'/bin/bash',
		[
			'-c',
			`${preopen} source "$1"; "$2"; printf 'READY\\n'; exec /bin/bash -c 'read -r _'`,
			'lock-holder',
			common,
			acquire,
			lock,
		],
		{
			stdio: ['pipe', 'pipe', 'pipe'],
			env: {
				...process.env,
				VEUD_PRODUCTION_ROOT: root,
				VEUD_STAGING_ROOT: root,
				VEUD_STAGING_NODE_BIN: node22,
				VEUD_STAGING_NPM_BIN: node22,
			},
		},
	)
	childProcesses.add(child)
	await waitForReady(child)
	return { child, lock }
}

function tryExclusiveLock(lock) {
	return runBash('exec 6>"$1"; flock --exclusive --nonblock 6', {
		args: [lock],
	})
}

async function stopLockHolder(child) {
	child.stdin.end('\n')
	const [code] = await once(child, 'exit')
	childProcesses.delete(child)
	assert.equal(code, 0)
}

function runInjectedTransition(
	environment,
	root,
	{ fault = '', release = requestedRelease } = {},
) {
	fs.mkdirSync(root, { recursive: true })
	const source = `
set -Eeuo pipefail
source "$1"
die() { printf 'ERROR: %s\\n' "$*" >&2; exit 1; }
prefix="$2"
transition_root="$3"
requested="$4"
events="$transition_root/events"
state_file="$transition_root/state"
writer_lock="$transition_root/writer-lifetime.lock"
holder_ready="$transition_root/holder-ready"
holder_released="$transition_root/holder-released"
mutation_started=false
backup_evidence=''
phase=initial
exclusive_held=false
holder_pid=''

event() { printf '%s\\n' "$1" >>"$events"; }
write_state() {
	local temporary="$state_file.tmp-$$"
	{
		printf 'release=%s\\n' "$requested"
		printf 'mutation_started=%s\\n' "$mutation_started"
		printf 'backup_evidence=%s\\n' "$backup_evidence"
		printf 'phase=%s\\n' "$phase"
	} >"$temporary"
	mv -f "$temporary" "$state_file"
}
if [[ -f "$state_file" ]]; then
	recorded_release="$(sed -n 's/^release=//p' "$state_file")"
	[[ "$recorded_release" == "$requested" ]] ||
		die 'Injected transition state belongs to another release'
	mutation_started="$(sed -n 's/^mutation_started=//p' "$state_file")"
	backup_evidence="$(sed -n 's/^backup_evidence=//p' "$state_file")"
	phase="$(sed -n 's/^phase=//p' "$state_file")"
fi

acquire_exclusive() {
	if [[ "$exclusive_held" == true ]]; then return 0; fi
	exec 6>"$writer_lock"
	flock --exclusive --wait 5 6
	exclusive_held=true
}
release_exclusive() {
	if [[ "$exclusive_held" == true ]]; then
		exec 6>&-
		exclusive_held=false
	fi
}
fake_stop_and_drain() {
	event stop
	acquire_exclusive
	phase=stopped
	write_state
}
fake_backup_or_verify() {
	if [[ "$mutation_started" == true ]]; then
		[[ "$backup_evidence" == pinned-receipt ]] ||
			die 'Injected resume lost its pinned backup'
		event verify-backup
	else
		backup_evidence=pinned-receipt
		event backup
	fi
	phase=backed-up
	write_state
}
fake_mutate() {
	event mutate
	mutation_started=true
	phase=mutated
	write_state
}
fake_activate_and_health() {
	event activate
	phase=activated
	write_state
	release_exclusive
	if [[ "\${VEUD_CUTOVER_TEST_FAULT_PHASE:-}" == after-activate_and_health ]]; then
		rm -f "$holder_ready" "$holder_released"
		(
			exec 8>"$writer_lock"
			flock --shared 8
			event holder-acquired
			: >"$holder_ready"
			/bin/sleep 0.35
			event holder-released
			: >"$holder_released"
		) </dev/null >/dev/null 2>&1 &
		holder_pid=$!
		for _ in {1..100}; do
			[[ -f "$holder_ready" ]] && break
			/bin/sleep 0.01
		done
		[[ -f "$holder_ready" ]] ||
			die 'Injected shared writer did not start'
	fi
}
fake_restore() {
	event restore
	phase=restored
	write_state
}
fake_complete() {
	event complete
	rm -f "$state_file"
}
fake_handle_failure() {
	local status="$1"
	event "handle:$status"
	if [[ "$mutation_started" == true ]]; then
		phase=blocking
		write_state
		event blocking
		acquire_exclusive
		event quiescent
		phase=failed-after-mutation
		write_state
	else
		event rollback
		release_exclusive
		rm -f "$state_file"
	fi
}

production_stop_and_drain() { fake_stop_and_drain; }
production_backup_or_verify() { fake_backup_or_verify; }
production_mutate() { fake_mutate; }
production_activate_and_health() { fake_activate_and_health; }
production_restore() { fake_restore; }
production_complete() { fake_complete; }
production_handle_injected_failure() { fake_handle_failure "$1"; }
staging_stop_and_drain() { fake_stop_and_drain; }
staging_backup_or_verify() { fake_backup_or_verify; }
staging_mutate() { fake_mutate; }
staging_activate_and_health() { fake_activate_and_health; }
staging_restore() { fake_restore; }
staging_complete() { fake_complete; }
staging_handle_injected_failure() { fake_handle_failure "$1"; }

status=0
cutover_run_transition_driver "$prefix" || status=$?
release_exclusive
if [[ -n "$holder_pid" ]]; then wait "$holder_pid"; fi
exit "$status"
`
	return runBash(source, {
		args: [catalogCutoverCommon, environment, root, release],
		env: {
			VEUD_CUTOVER_TEST_MODE: '1',
			VEUD_CUTOVER_TEST_FAULT_PHASE: fault,
		},
	})
}

function transitionEvents(root) {
	const file = path.join(root, 'events')
	return fs.existsSync(file)
		? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean)
		: []
}

test('production v2 marker permits only exact release/phase roles and v1 fails closed', () => {
	const root = temporaryRoot('production-roles')
	createActiveRelease(root, originalRelease)
	createRelease(root, requestedRelease)

	for (const role of ['app', 'backup', 'writer']) {
		expectAllowed(runGuard('production', root, role))
	}

	writeProductionMarker(root, {
		format: 1,
		phase: 'resume-backup',
		activated: true,
	})
	for (const role of ['app', 'backup', 'writer']) {
		expectBlocked(runGuard('production', root, role))
	}

	writeProductionMarker(root, {
		phase: 'backup-before-mutation',
		mutation: false,
	})
	expectBlocked(runGuard('production', root, 'backup'))
	expectBlocked(runGuard('production', root, 'app'))
	expectBlocked(runGuard('production', root, 'writer'))

	writeProductionMarker(root, {
		phase: 'backup-before-mutation',
		mutation: true,
	})
	expectBlocked(runGuard('production', root, 'backup'))

	writeProductionMarker(root, {
		phase: 'healthcheck-compatible-release',
	})
	expectBlocked(runGuard('production', root, 'app'))
	selectActiveRelease(root, requestedRelease)
	expectAllowed(runGuard('production', root, 'app'))
	expectBlocked(runGuard('production', root, 'writer'))

	writeProductionMarker(root, {
		phase: 'resume-writers',
		activated: true,
	})
	expectAllowed(runGuard('production', root, 'app'))
	expectAllowed(runGuard('production', root, 'writer'))
	expectBlocked(runGuard('production', root, 'backup'))

	writeProductionMarker(root, {
		phase: 'resume-backup',
		activated: true,
	})
	for (const role of ['app', 'backup', 'writer']) {
		expectAllowed(runGuard('production', root, role))
	}

	writeProductionMarker(root, {
		phase: 'failed-after-database-mutation',
		activated: true,
	})
	for (const role of ['app', 'backup', 'writer']) {
		expectBlocked(runGuard('production', root, role))
	}
})

test('production restoration accepts only the exact recorded release directory', () => {
	const root = temporaryRoot('production-restoration')
	createActiveRelease(root, originalRelease)
	createRelease(root, requestedRelease)
	writeProductionMarker(root, {
		phase: 'restore-before-mutation',
		mutation: false,
	})
	for (const role of ['app', 'backup', 'writer']) {
		expectAllowed(runGuard('production', root, role))
	}

	const externalRoot = temporaryRoot('production-external')
	const external = createRelease(externalRoot, originalRelease)
	fs.unlinkSync(path.join(root, 'app/current'))
	fs.symlinkSync(external, path.join(root, 'app/current'))
	for (const role of ['app', 'backup', 'writer']) {
		expectBlocked(runGuard('production', root, role))
	}

	selectActiveRelease(root, requestedRelease)
	for (const role of ['app', 'backup', 'writer']) {
		expectBlocked(runGuard('production', root, role))
	}
})

test('staging v2 marker gates exact releases, bootstrap, backups, and resumption', () => {
	const root = temporaryRoot('staging-roles')
	createActiveRelease(root, originalRelease)
	createRelease(root, requestedRelease)

	for (const role of ['app', 'backup', 'load-backup', 'writer']) {
		expectAllowed(runGuard('staging', root, role))
	}
	writeStagingMarker(root, {
		format: 1,
		phase: 'restore-prior-unit-states',
		activated: true,
	})
	for (const role of ['app', 'backup', 'load-backup', 'writer']) {
		expectBlocked(runGuard('staging', root, role))
	}

	writeStagingMarker(root, {
		phase: 'restore-before-mutation',
		mutation: false,
	})
	for (const role of ['app', 'backup', 'load-backup', 'writer']) {
		expectAllowed(runGuard('staging', root, role))
	}

	writeStagingMarker(root, {
		phase: 'backup-application-database',
		mutation: false,
	})
	expectBlocked(runGuard('staging', root, 'backup'))
	expectBlocked(runGuard('staging', root, 'load-backup'))
	expectBlocked(runGuard('staging', root, 'app'))
	expectBlocked(runGuard('staging', root, 'writer'))

	writeStagingMarker(root, {
		phase: 'backup-load-database',
		mutation: false,
	})
	expectBlocked(runGuard('staging', root, 'load-backup'))
	expectBlocked(runGuard('staging', root, 'backup'))
	writeStagingMarker(root, {
		phase: 'backup-load-database',
		mutation: true,
	})
	expectBlocked(runGuard('staging', root, 'load-backup'))

	writeStagingMarker(root, { phase: 'healthcheck-new-release' })
	expectBlocked(runGuard('staging', root, 'app'))
	selectActiveRelease(root, requestedRelease)
	expectAllowed(runGuard('staging', root, 'app'))

	writeStagingMarker(root, {
		phase: 'restore-prior-unit-states',
		activated: true,
	})
	for (const role of ['app', 'backup', 'load-backup', 'writer']) {
		expectAllowed(runGuard('staging', root, role))
	}

	writeStagingMarker(root, {
		phase: 'restore-before-mutation',
		mutation: false,
		bootstrap: true,
	})
	for (const role of ['app', 'backup', 'load-backup', 'writer']) {
		expectBlocked(runGuard('staging', root, role))
	}

	const marker = path.join(root, 'run/provenance-cutover-incomplete')
	fs.writeFileSync(
		marker,
		fs
			.readFileSync(marker, 'utf8')
			.replace(
				'backup_source_policy=pristine-empty-v1',
				'backup_source_policy=migrated-veud-v1',
			),
	)
	expectBlocked(runGuard('staging', root, 'app'))
})

test('duplicate and cross-environment marker fields fail closed', () => {
	const productionRoot = temporaryRoot('production-malformed')
	createActiveRelease(productionRoot, requestedRelease)
	writeProductionMarker(productionRoot, {
		phase: 'resume-writers',
		activated: true,
	})
	fs.appendFileSync(
		path.join(productionRoot, 'run/catalog-release-maintenance.state'),
		'phase=resume-backup\n',
	)
	expectBlocked(runGuard('production', productionRoot, 'writer'))

	const stagingRoot = temporaryRoot('staging-malformed')
	createActiveRelease(stagingRoot, originalRelease)
	writeStagingMarker(stagingRoot, {
		environment: 'production',
		phase: 'restore-before-mutation',
		mutation: false,
	})
	expectBlocked(runGuard('staging', stagingRoot, 'app'))

	const wrongStateRoot = temporaryRoot('production-wrong-state-dir')
	createActiveRelease(wrongStateRoot, originalRelease)
	writeProductionMarker(wrongStateRoot, {
		phase: 'restore-before-mutation',
		mutation: false,
		stateDir: path.join(wrongStateRoot, 'run/not-release-owned'),
	})
	expectBlocked(runGuard('production', wrongStateRoot, 'app'))

	const missingStateRoot = temporaryRoot('staging-missing-state-dir')
	createActiveRelease(missingStateRoot, originalRelease)
	writeStagingMarker(missingStateRoot, {
		phase: 'restore-before-mutation',
		mutation: false,
		stateDir: null,
	})
	expectBlocked(runGuard('staging', missingStateRoot, 'app'))
})

test('writer lifetime locks survive exec, drain exclusively, and reuse inherited fd 8', async () => {
	for (const kind of ['production', 'staging']) {
		for (const preopened of [false, true]) {
			const root = temporaryRoot(`${kind}-lifetime-${preopened}`)
			const { child, lock } = await startLifetimeLockHolder(
				kind,
				root,
				preopened,
			)
			assert.notEqual(
				tryExclusiveLock(lock).status,
				0,
				`${kind} exclusive lock entered while an exec-inherited shared lock lived`,
			)
			await stopLockHolder(child)
			assert.equal(tryExclusiveLock(lock).status, 0)
		}
	}
})

test('real transition driver executes success and pre-mutation rollback for both deployments', () => {
	for (const environment of ['production', 'staging']) {
		const successRoot = temporaryRoot(`${environment}-driver-success`)
		expectAllowed(runInjectedTransition(environment, successRoot))
		assert.deepEqual(transitionEvents(successRoot), [
			'stop',
			'backup',
			'mutate',
			'activate',
			'restore',
			'complete',
		])
		assert.ok(!fs.existsSync(path.join(successRoot, 'state')))

		const rollbackRoot = temporaryRoot(`${environment}-driver-rollback`)
		const rollback = runInjectedTransition(environment, rollbackRoot, {
			fault: 'after-backup_or_verify',
		})
		assert.equal(rollback.status, 97, rollback.stderr)
		assert.deepEqual(transitionEvents(rollbackRoot), [
			'stop',
			'backup',
			'handle:97',
			'rollback',
		])
		assert.ok(
			!fs.existsSync(path.join(rollbackRoot, 'state')),
			`${environment} pre-mutation failure retained transition state`,
		)
		assert.equal(
			tryExclusiveLock(path.join(rollbackRoot, 'writer-lifetime.lock')).status,
			0,
		)
	}
})

test('post-mutation failure blocks, drains a live shared writer, and resumes only pinned state', () => {
	for (const environment of ['production', 'staging']) {
		const root = temporaryRoot(`${environment}-driver-resume`)
		const failed = runInjectedTransition(environment, root, {
			fault: 'after-activate_and_health',
		})
		assert.equal(failed.status, 97, failed.stderr)
		assert.deepEqual(transitionEvents(root), [
			'stop',
			'backup',
			'mutate',
			'activate',
			'holder-acquired',
			'handle:97',
			'blocking',
			'holder-released',
			'quiescent',
		])
		const blockedState = fs.readFileSync(path.join(root, 'state'), 'utf8')
		assert.match(blockedState, /^release=2{40}$/m)
		assert.match(blockedState, /^mutation_started=true$/m)
		assert.match(blockedState, /^backup_evidence=pinned-receipt$/m)
		assert.match(blockedState, /^phase=failed-after-mutation$/m)
		assert.equal(
			tryExclusiveLock(path.join(root, 'writer-lifetime.lock')).status,
			0,
		)

		expectAllowed(runInjectedTransition(environment, root))
		assert.deepEqual(transitionEvents(root).slice(-6), [
			'stop',
			'verify-backup',
			'mutate',
			'activate',
			'restore',
			'complete',
		])
		assert.equal(
			transitionEvents(root).filter(event => event === 'backup').length,
			1,
			`${environment} resume replaced its pinned recovery backup`,
		)
		assert.ok(!fs.existsSync(path.join(root, 'state')))
	}
})

test('shared deployment lock rejects concurrent production and staging deploys', async () => {
	for (const environment of ['production', 'staging']) {
		const root = temporaryRoot(`${environment}-deployment-lock`)
		const lock = path.join(root, 'deploy.lock')
		const message = `Another ${environment} deployment is active`
		const holder = spawn(
			'/bin/bash',
			[
				'-c',
				`source "$1"
die() { printf 'ERROR: %s\\n' "$*" >&2; exit 1; }
cutover_acquire_deployment_lock "$2" "$3"
printf 'READY\\n'
exec /bin/bash -c 'read -r _'`,
				'deployment-lock-holder',
				catalogCutoverCommon,
				lock,
				message,
			],
			{ stdio: ['pipe', 'pipe', 'pipe'] },
		)
		childProcesses.add(holder)
		await waitForReady(holder)

		const contender = runBash(
			`source "$1"
die() { printf 'ERROR: %s\\n' "$*" >&2; exit 1; }
cutover_acquire_deployment_lock "$2" "$3"`,
			{ args: [catalogCutoverCommon, lock, message] },
		)
		assert.notEqual(contender.status, 0)
		assert.match(contender.stderr, new RegExp(message))
		await stopLockHolder(holder)

		expectAllowed(
			runBash(
				`source "$1"
die() { printf 'ERROR: %s\\n' "$*" >&2; exit 1; }
cutover_acquire_deployment_lock "$2" "$3"`,
				{ args: [catalogCutoverCommon, lock, message] },
			),
		)
	}
})

test('cutover authority publication and removal sync files and parent directories', () => {
	const root = temporaryRoot('durable-cutover-state')
	const temporary = path.join(root, 'state.tmp')
	const target = path.join(root, 'state')
	fs.writeFileSync(temporary, 'durable state\n')
	const result = runBash(
		`set -Eeuo pipefail
source "$1"
cutover_publish_file_durable "$2" "$3"
[[ -f "$3" && ! -e "$2" ]]
cutover_remove_file_durable "$3"
[[ ! -e "$3" ]]`,
		{ args: [catalogCutoverCommon, temporary, target] },
	)
	expectAllowed(result)
	const commonSource = fs.readFileSync(catalogCutoverCommon, 'utf8')
	const publish = extractShellFunction(
		commonSource,
		'cutover_publish_file_durable',
	)
	const remove = extractShellFunction(
		commonSource,
		'cutover_remove_file_durable',
	)
	assert.match(publish, /sync -f "\$temporary"/)
	assert.match(publish, /cutover_sync_path_and_parent "\$target"/)
	assert.match(remove, /sync -f "\$\(dirname "\$target"\)"/)
})

test('release tree and active symlink publication use bounded durable filesystem syncs', () => {
	const root = temporaryRoot('durable-release-publication')
	const temporaryTree = path.join(root, 'release.partial')
	const release = path.join(root, 'release')
	const next = path.join(root, 'current.next')
	const current = path.join(root, 'current')
	const syncLog = path.join(root, 'sync.log')
	fs.mkdirSync(path.join(temporaryTree, 'nested'), { recursive: true })
	fs.writeFileSync(path.join(temporaryTree, 'nested', 'asset'), 'release\n')
	fs.symlinkSync(release, next)

	const result = runBash(
		`set -Eeuo pipefail
source "$1"
sync_log="$5"
sync() { printf '%s\\n' "$*" >>"$sync_log"; }
cutover_publish_tree_durable "$2" "$3"
cutover_publish_symlink_durable "$4" "$6"
[[ -f "$3/nested/asset" && -L "$6" ]]`,
		{
			args: [
				catalogCutoverCommon,
				temporaryTree,
				release,
				next,
				syncLog,
				current,
			],
		},
	)
	expectAllowed(result)
	const syncCalls = fs.readFileSync(syncLog, 'utf8').trim().split('\n')
	assert.equal(
		syncCalls.length,
		4,
		'publishing a release tree and symlink must use a bounded sync count',
	)
	assert.equal(
		syncCalls.filter(call => call === `-f ${temporaryTree}`).length,
		1,
		'the release tree must be flushed with one filesystem sync',
	)
	const commonSource = fs.readFileSync(catalogCutoverCommon, 'utf8')
	assert.match(
		extractShellFunction(commonSource, 'cutover_install_immutable_units'),
		/cutover_sync_path_and_parent "\$unit_dir\/\$unit"/,
	)
	assert.match(
		extractShellFunction(commonSource, 'cutover_restore_unit_definitions'),
		/cutover_(?:sync_path_and_parent|remove_file_durable)/,
	)
	assert.match(
		extractShellFunction(productionDeploy, 'save_pm2_state'),
		/cutover_sync_path_and_parent "\$pm2_dump_file"/,
	)
})

test('staging database identity accepts exact parity and rejects drift', () => {
	const application =
		'postgresql://veud_staging_app:test@127.0.0.1:5433/veud_staging?schema=public'
	const operations =
		'postgresql://veud_staging_app:test@127.0.0.1:5433/veud_staging?schema=public'
	const load =
		'postgresql://veud_staging_load:test@127.0.0.1:5433/veud_staging_load?schema=public'
	const restore =
		'postgresql://veud_staging_restore:test@127.0.0.1:5433/veud_staging_restore?schema=public'
	const run = urls =>
		runBash(
			'source "$1"; assert_staging_database_identities "$2" "$3" "$4" "$5"',
			{
				args: [stagingCommon, ...urls],
				env: {
					VEUD_STAGING_NODE_BIN: node22,
					VEUD_STAGING_NPM_BIN: node22,
				},
			},
		)

	expectAllowed(run([application, operations, load, restore]))
	for (const urls of [
		[
			application,
			operations.replace('/veud_staging?', '/another_database?'),
			load,
			restore,
		],
		[application, operations, load.replace('127.0.0.1', 'localhost'), restore],
		[
			application,
			operations,
			load.replace('schema=public', 'schema=private'),
			restore,
		],
		[
			application,
			operations,
			load,
			restore.replace('veud_staging_restore', 'veud_staging_load'),
		],
	]) {
		assert.notEqual(run(urls).status, 0)
	}
})

test('health identity requires exact release and environment headers', () => {
	const root = temporaryRoot('health-identity')
	const headers = path.join(root, 'headers')
	const run = (release, environment) =>
		runBash('source "$1"; cutover_health_headers_match "$2" "$3" "$4"', {
			args: [catalogCutoverCommon, headers, release, environment],
		})

	fs.writeFileSync(
		headers,
		[
			'HTTP/1.1 200 OK\r',
			`X-Veud-Release: ${requestedRelease}\r`,
			'X-Veud-Environment: staging\r',
			'\r',
		].join('\n'),
	)
	expectAllowed(run(requestedRelease, 'staging'))
	assert.notEqual(run(originalRelease, 'staging').status, 0)
	assert.notEqual(run(requestedRelease, 'production').status, 0)
	assert.notEqual(run('not-a-release', 'staging').status, 0)

	fs.appendFileSync(headers, `\nX-Veud-Release: ${originalRelease}\r\n`)
	assert.notEqual(
		run(requestedRelease, 'staging').status,
		0,
		'duplicate release identity headers must fail closed',
	)
})

test('all supervisor database launchers acquire a shared lifetime lock before their guard', () => {
	const launchersByEnvironment = new Map([
		['production', new Set(productionPm2Launchers())],
		['staging', new Set()],
	])

	for (const environment of ['production', 'staging']) {
		for (const definition of serviceDefinitions(environment)) {
			for (const execStart of definition.execStarts) {
				for (const word of shellWords(execStart)) {
					const launcher = repositoryLauncher(word)
					if (launcher) launchersByEnvironment.get(environment).add(launcher)
				}
			}
		}
	}
	launchersByEnvironment
		.get('staging')
		.delete(path.join(repositoryRoot, 'ops/local-staging/run-postgres.sh'))

	for (const [environment, launchers] of launchersByEnvironment) {
		assert.ok(launchers.size > 0, `${environment} has no guarded launchers`)
		for (const launcher of launchers) {
			assert.ok(fs.existsSync(launcher), `Missing launcher: ${launcher}`)
			assert.notEqual(fs.statSync(launcher).mode & 0o111, 0, launcher)
			const relativeLauncher = path.relative(repositoryRoot, launcher)
			const indexEntry = spawnSync(
				'git',
				['ls-files', '--stage', '--', relativeLauncher],
				{ cwd: repositoryRoot, encoding: 'utf8' },
			)
			assert.equal(indexEntry.status, 0, indexEntry.stderr)
			assert.match(
				indexEntry.stdout,
				/^100755 [0-9a-f]{40,64} 0\t/,
				`Release archives require executable Git mode: ${relativeLauncher}`,
			)
			instrumentLauncher(launcher, environment)
		}
	}

	const prepareWorkerMount = temporaryRoot('prepare-worker-mount')
	const prepareWorker = runBash(
		`source "$1"
events=()
record() { events+=("$1"); }
guard_live_storage() { record storage; }
load_production_worker_environment() { record environment; }
verify_node_22() { record node; }
assert_production_application_database_identity() { record datasource; }
require_command() { :; }
acquire_production_writer_lifetime_lock_shared() { record lifetime-shared; }
verify_active_release() { record release; }
assert_production_catalog_cutover_role() { record catalog-guard; }
APP_ROOT="$2"
prepare_worker
printf '%s\\n' "\${events[@]}"`,
		{
			args: [productionCommon, temporaryRoot('prepare-worker')],
			env: {
				VEUD_STAGING_NODE_BIN: node22,
				VEUD_STAGING_NPM_BIN: node22,
				// prepare_worker mkdirs $PRODUCTION_ROOT/run, which resolves under
				// the real /media mounts. Those exist on the deployment host but
				// not in CI, so the roots must be redirected into the sandbox.
				VEUD_STAGING_LIVE_MOUNT: prepareWorkerMount,
				VEUD_STAGING_BACKUP_MOUNT: prepareWorkerMount,
				VEUD_PRODUCTION_ROOT: path.join(prepareWorkerMount, 'veud-production'),
				VEUD_STAGING_ROOT: path.join(prepareWorkerMount, 'veud-staging'),
			},
		},
	)
	expectAllowed(prepareWorker)
	const events = prepareWorker.stdout.trim().split('\n')
	assert.ok(
		events.indexOf('datasource') < events.indexOf('lifetime-shared'),
		'prepare_worker must validate its datasource before acquiring the lifetime lock',
	)
	assert.ok(
		events.indexOf('lifetime-shared') < events.indexOf('catalog-guard'),
		'prepare_worker must acquire its lifetime lock before the role guard',
	)
})

test('deployment renderers install candidate-owned immutable unit definitions', () => {
	for (const environment of ['production', 'staging']) {
		const root = temporaryRoot(`${environment}-immutable-units`)
		const candidate = path.join(root, 'candidate', requestedRelease)
		const sourceDirectory = path.join(
			repositoryRoot,
			`ops/local-${environment}/systemd`,
		)
		const candidateDirectory = path.join(
			candidate,
			`ops/local-${environment}/systemd`,
		)
		fs.mkdirSync(path.dirname(candidateDirectory), { recursive: true })
		fs.cpSync(sourceDirectory, candidateDirectory, { recursive: true })
		const units = fs.readdirSync(sourceDirectory).sort()
		const installed = path.join(root, 'installed')
		const state = path.join(root, 'state')
		const deploy =
			environment === 'production' ? productionDeploy : stagingDeploy
		const functionName =
			environment === 'production'
				? 'install_immutable_writer_unit_definitions'
				: 'install_immutable_cutover_unit_definitions'
		const arrayName =
			environment === 'production' ? 'all_writer_units' : 'all_units'
		const candidateName =
			environment === 'production' ? 'destination' : 'release'
		const result = runBash(
			`set -Eeuo pipefail
source "$4"
${extractShellFunction(deploy, functionName)}
die() { printf 'ERROR: %s\\n' "$*" >&2; exit 1; }
systemctl() {
	if [[ "$*" == "--user daemon-reload" ]]; then
		return
	fi
	local unit='' property='' argument
	for argument in "$@"; do
		[[ "$argument" == *.service || "$argument" == *.timer ]] && unit="$argument"
		[[ "$argument" == --property=* ]] && property="\${argument#--property=}"
	done
	case "$property" in
	FragmentPath) printf '%s' "$unit_dir/$unit" ;;
	DropInPaths) : ;;
	ExecStart) sed -n 's/^ExecStart=//p' "$unit_dir/$unit" ;;
	*) return 1 ;;
	esac
}
${arrayName}=(${units.map(unit => `'${unit}'`).join(' ')})
${candidateName}="$1"
unit_dir="$2"
state_dir="$3"
${functionName}`,
			{ args: [candidate, installed, state, catalogCutoverCommon] },
		)
		expectAllowed(result)

		for (const unit of units) {
			const rendered = fs.readFileSync(path.join(installed, unit), 'utf8')
			assert.ok(
				!rendered.includes(`%h/Programs/Veud/ops/local-${environment}`),
				unit,
			)
			if (unit.endsWith('.service')) {
				const parsed = parseUnitFile(rendered)
				const starts = parsed.get('Service.ExecStart') ?? []
				assert.ok(starts.length > 0, unit)
				for (const start of starts) {
					assert.ok(
						start.startsWith(`${candidate}/ops/local-${environment}/`),
						`${unit}: ${start}`,
					)
				}
			}
		}

		const invalidUnit = units.find(unit => unit.endsWith('.service'))
		const invalidPath = path.join(candidateDirectory, invalidUnit)
		fs.writeFileSync(
			invalidPath,
			fs
				.readFileSync(invalidPath, 'utf8')
				.replace(
					`%h/Programs/Veud/ops/local-${environment}`,
					'/tmp/mutable-checkout',
				),
		)
		const invalid = runBash(
			`set -Eeuo pipefail
source "$4"
${extractShellFunction(deploy, functionName)}
die() { printf 'ERROR: %s\\n' "$*" >&2; exit 1; }
systemctl() { :; }
${arrayName}=(${units.map(unit => `'${unit}'`).join(' ')})
${candidateName}="$1"
unit_dir="$2"
state_dir="$3"
${functionName}`,
			{
				args: [
					candidate,
					path.join(root, 'invalid-installed'),
					path.join(root, 'invalid-state'),
					catalogCutoverCommon,
				],
			},
		)
		assert.notEqual(invalid.status, 0)
	}
})

test('systemd cutover transitions reject effective drop-ins and restoration drift', () => {
	const installRoot = temporaryRoot('systemd-effective-install')
	const installSource = path.join(installRoot, 'source')
	const installTarget = path.join(installRoot, 'units')
	const installState = path.join(installRoot, 'state')
	fs.mkdirSync(installSource, { recursive: true })
	fs.writeFileSync(
		path.join(installSource, 'writer.service'),
		['[Service]', 'ExecStart=/mutable/run-writer.sh', ''].join('\n'),
	)
	const dropInInstall = runBash(
		`set -Eeuo pipefail
source "$1"
die() { printf 'ERROR: %s\\n' "$*" >&2; exit 1; }
systemctl() {
	if [[ "$*" == "--user daemon-reload" ]]; then return; fi
	local property='' argument
	for argument in "$@"; do
		[[ "$argument" == --property=* ]] && property="\${argument#--property=}"
	done
	case "$property" in
	FragmentPath) printf '%s' "$unit_dir/writer.service" ;;
	DropInPaths) printf '%s' "$unit_dir/writer.service.d/override.conf" ;;
	ExecStart) printf '%s' "$immutable_prefix/run-writer.sh" ;;
	esac
}
unit_dir="$3"
immutable_prefix=/immutable
cutover_install_immutable_units "$4" "$unit_dir" "$2" /mutable "$immutable_prefix" writer.service`,
		{
			args: [catalogCutoverCommon, installSource, installTarget, installState],
		},
	)
	assert.notEqual(dropInInstall.status, 0)
	assert.match(dropInInstall.stderr, /effective immutable definitions/)

	for (const scenario of ['valid', 'drop-in', 'fragment', 'exec-start']) {
		const root = temporaryRoot(`systemd-effective-restore-${scenario}`)
		const unitDir = path.join(root, 'units')
		const state = path.join(root, 'state')
		const unit = path.join(unitDir, 'writer.service')
		fs.mkdirSync(unitDir, { recursive: true })
		fs.writeFileSync(unit, '[Service]\nExecStart=/original/writer\n')
		const result = runBash(
			`set -Eeuo pipefail
source "$1"
die() { printf 'ERROR: %s\\n' "$*" >&2; exit 1; }
mode=capture
scenario="$4"
unit_dir="$2"
systemctl() {
	if [[ "$*" == "--user daemon-reload" ]]; then
		mode=restore
		return
	fi
	local property='' argument
	for argument in "$@"; do
		[[ "$argument" == --property=* ]] && property="\${argument#--property=}"
	done
	case "$property" in
	FragmentPath)
		if [[ "$mode" == restore && "$scenario" == fragment ]]; then
			printf '%s' "$unit_dir/other.service"
		else
			printf '%s' "$unit_dir/writer.service"
		fi
		;;
	DropInPaths)
		[[ "$mode" == restore && "$scenario" == drop-in ]] &&
			printf '%s' "$unit_dir/writer.service.d/override.conf"
		return 0
		;;
	ExecStart)
		if [[ "$mode" == restore && "$scenario" == exec-start ]]; then
			printf /different/writer
		else
			printf /original/writer
		fi
		;;
	esac
}
cutover_capture_unit_definitions "$3" "$unit_dir" writer.service
printf '[Service]\\nExecStart=/candidate/writer\\n' >"$unit_dir/writer.service"
cutover_restore_unit_definitions "$3" "$unit_dir" writer.service`,
			{
				args: [catalogCutoverCommon, unitDir, state, scenario],
			},
		)
		if (scenario === 'valid') {
			expectAllowed(result)
		} else {
			assert.notEqual(result.status, 0, scenario)
		}
	}
})

test('staging pins and revalidates restore receipts for both databases and drives', () => {
	const root = temporaryRoot('staging-backup-evidence')
	const backup = path.join(root, 'backup')
	const offsite = path.join(root, 'offsite')
	const stagingRoot = path.join(root, 'staging')
	const pairs = {
		applicationLocal: writeBackupPair(
			path.join(root, 'source/application-local'),
			'application.dump',
			'application-local',
			'127.0.0.1:5433/veud_staging',
			'127.0.0.1:5433/veud_staging_restore',
		),
		applicationOffsite: writeBackupPair(
			path.join(root, 'source/application-offsite'),
			'application.dump',
			'application-offsite',
			'127.0.0.1:5433/veud_staging',
			'127.0.0.1:5433/veud_staging_restore',
		),
		loadLocal: writeBackupPair(
			path.join(root, 'source/load-local'),
			'load.dump',
			'load-local',
			'127.0.0.1:5433/veud_staging_load',
			'127.0.0.1:5433/veud_staging_restore',
		),
		loadOffsite: writeBackupPair(
			path.join(root, 'source/load-offsite'),
			'load.dump',
			'load-offsite',
			'127.0.0.1:5433/veud_staging_load',
			'127.0.0.1:5433/veud_staging_restore',
		),
	}
	const functions = ['verify_backup_pair', 'verify_cutover_backup_evidence']
		.map(name => extractShellFunction(stagingDeploy, name))
		.join('\n')
	const expected = {
		applicationArchive: path.join(
			backup,
			'.cutover-pins',
			requestedRelease,
			'application.dump',
		),
		applicationOffsite: path.join(
			offsite,
			'.cutover-pins',
			requestedRelease,
			'application.dump',
		),
		loadArchive: path.join(
			stagingRoot,
			'backups/catalog/.cutover-pins',
			requestedRelease,
			'load.dump',
		),
		loadOffsite: path.join(
			offsite,
			'catalog/.cutover-pins',
			requestedRelease,
			'load.dump',
		),
	}
	const commonSetup = `
source "\${10}"
${functions}
NODE_BIN="$1"
commit="$2"
BACKUP_DIR="$3"
OFFSITE_DIR="$4"
STAGING_ROOT="$5"
backup_source_policy=migrated-veud-v1
application_backup_archive="$6"
application_backup_receipt="\${application_backup_archive}.restore-verified.json"
application_backup_offsite_archive="$7"
application_backup_offsite_receipt="\${application_backup_offsite_archive}.restore-verified.json"
load_backup_archive="$8"
load_backup_receipt="\${load_backup_archive}.restore-verified.json"
load_backup_offsite_archive="$9"
load_backup_offsite_receipt="\${load_backup_offsite_archive}.restore-verified.json"
`
	const args = [
		node22,
		requestedRelease,
		backup,
		offsite,
		stagingRoot,
		expected.applicationArchive,
		expected.applicationOffsite,
		expected.loadArchive,
		expected.loadOffsite,
		catalogCutoverCommon,
	]
	const pinCommands = [
		[pairs.applicationLocal, expected.applicationArchive],
		[pairs.applicationOffsite, expected.applicationOffsite],
		[pairs.loadLocal, expected.loadArchive],
		[pairs.loadOffsite, expected.loadOffsite],
	]
		.flatMap(([pair, destination]) => [
			`cutover_pin_backup_file '${pair.archive}' '${destination}'`,
			`cutover_pin_backup_file '${pair.receipt}' '${destination}.restore-verified.json'`,
		])
		.join('\n')
	const pinned = runBash(
		`set -Eeuo pipefail
${commonSetup}
${pinCommands}
verify_cutover_backup_evidence all`,
		{ args },
	)
	expectAllowed(pinned)

	const loadOffsiteReceipt = `${expected.loadOffsite}.restore-verified.json`
	const validReceipt = fs.readFileSync(loadOffsiteReceipt, 'utf8')
	const wrongIdentity = JSON.parse(validReceipt)
	wrongIdentity.sourceTarget = '127.0.0.1:5433/veud_staging'
	fs.writeFileSync(loadOffsiteReceipt, JSON.stringify(wrongIdentity))
	assert.notEqual(
		runBash(
			`set -Eeuo pipefail
${commonSetup}
verify_cutover_backup_evidence all`,
			{ args },
		).status,
		0,
	)
	fs.writeFileSync(loadOffsiteReceipt, validReceipt)

	fs.appendFileSync(expected.loadOffsite, 'tampered')
	const tampered = runBash(
		`set -Eeuo pipefail
${commonSetup}
verify_cutover_backup_evidence all`,
		{ args },
	)
	assert.notEqual(tampered.status, 0)
})

test('cutover backup evidence rejects symlinks and immutable pins reject replacement', () => {
	const root = temporaryRoot('cutover-backup-symlink')
	const pair = writeBackupPair(
		path.join(root, 'source'),
		'postgres-test.dump',
		'archive contents',
		'127.0.0.1:5433/veud_staging',
		'127.0.0.1:5433/veud_staging_restore',
	)
	const archiveLink = path.join(root, 'archive-link.dump')
	const receiptLink = path.join(root, 'receipt-link.restore-verified.json')
	fs.symlinkSync(pair.archive, archiveLink)
	fs.symlinkSync(pair.receipt, receiptLink)

	for (const [archive, receipt] of [
		[archiveLink, pair.receipt],
		[pair.archive, receiptLink],
	]) {
		const result = runBash(
			`set -Eeuo pipefail
source "$1"
cutover_verify_backup_pair "$2" "$3" "$4"`,
			{ args: [catalogCutoverCommon, node22, archive, receipt] },
		)
		assert.notEqual(result.status, 0)
	}

	const symlinkDestination = path.join(root, 'pins', 'symlink.dump')
	const symlinkPin = runBash(
		`set -Eeuo pipefail
source "$1"
cutover_pin_backup_file "$2" "$3"`,
		{ args: [catalogCutoverCommon, archiveLink, symlinkDestination] },
	)
	assert.notEqual(symlinkPin.status, 0)
	assert.equal(fs.existsSync(symlinkDestination), false)

	const immutableDestination = path.join(root, 'pins', 'immutable.dump')
	fs.mkdirSync(path.dirname(immutableDestination), { recursive: true })
	fs.writeFileSync(immutableDestination, 'existing evidence')
	const replacement = runBash(
		`set -Eeuo pipefail
source "$1"
cutover_pin_backup_file "$2" "$3"`,
		{ args: [catalogCutoverCommon, pair.archive, immutableDestination] },
	)
	assert.notEqual(replacement.status, 0)
	assert.equal(
		fs.readFileSync(immutableDestination, 'utf8'),
		'existing evidence',
	)
})

test('partial immutable backup pins reconcile after a hard interruption', async () => {
	const root = temporaryRoot('cutover-pin-reconciliation')
	const backup = path.join(root, 'backup')
	const offsite = path.join(root, 'offsite')
	const pinRoot = path.join(backup, '.cutover-pins/release')
	const offsitePinRoot = path.join(offsite, '.cutover-pins/release')
	const sourceTarget = '127.0.0.1:5433/veud_staging'
	const restoreTarget = '127.0.0.1:5433/veud_staging_restore'
	const name = 'postgres-20260729T120000Z.dump'
	const local = writeBackupPair(
		backup,
		name,
		'interruption-safe archive',
		sourceTarget,
		restoreTarget,
	)
	const offsitePair = writeBackupPair(
		offsite,
		name,
		'interruption-safe archive',
		sourceTarget,
		restoreTarget,
	)
	const pinnedArchive = path.join(pinRoot, 'application.dump')
	const reconcile = () =>
		runBash(
			`set -Eeuo pipefail
source "$1"
cutover_reconcile_backup_pins \\
	"$2" "$3" "$4" "$5" "$6" application "$7" "$8" migrated-veud-v1`,
			{
				args: [
					catalogCutoverCommon,
					node22,
					backup,
					offsite,
					pinRoot,
					offsitePinRoot,
					sourceTarget,
					restoreTarget,
				],
			},
		)

	const interrupted = spawn(
		'/bin/bash',
		[
			'-c',
			`set -Eeuo pipefail
source "$1"
cutover_pin_backup_file "$2" "$3"
printf 'READY\\n'
read -r _`,
			'pin-interruption',
			catalogCutoverCommon,
			local.archive,
			pinnedArchive,
		],
		{ stdio: ['pipe', 'pipe', 'pipe'] },
	)
	childProcesses.add(interrupted)
	await waitForReady(interrupted)
	interrupted.kill('SIGKILL')
	await once(interrupted, 'exit')
	childProcesses.delete(interrupted)
	expectAllowed(reconcile())
	const expectedPins = [
		pinnedArchive,
		`${pinnedArchive}.restore-verified.json`,
		path.join(offsitePinRoot, 'application.dump'),
		path.join(offsitePinRoot, 'application.dump.restore-verified.json'),
	]
	for (const pin of expectedPins) {
		assert.equal(fs.existsSync(pin), true, pin)
	}

	for (const source of [
		local.archive,
		local.receipt,
		offsitePair.archive,
		offsitePair.receipt,
	]) {
		fs.rmSync(source)
	}
	expectAllowed(reconcile())

	const foreignRoot = temporaryRoot('cutover-pin-reconciliation-foreign')
	const foreign = writeBackupPair(
		foreignRoot,
		name,
		'foreign archive',
		sourceTarget,
		restoreTarget,
	)
	fs.rmSync(expectedPins[1])
	fs.linkSync(foreign.receipt, expectedPins[1])
	assert.notEqual(
		reconcile().status,
		0,
		'foreign partial evidence must never be accepted',
	)
})

test('staging bootstrap wires the pristine policy to both distinct backups and reuses pins', () => {
	const backupFunction = extractShellFunction(
		stagingDeploy,
		'staging_backup_or_verify',
	)
	const fresh = runBash(
		`set -Eeuo pipefail
${backupFunction}
write_cutover_sentinel() { :; }
reconcile_cutover_backup_evidence() { return 2; }
create_and_pin_cutover_backup() { printf 'create:%s\\n' "$*"; }
verify_cutover_backup_evidence() { printf 'verify:%s\\n' "$1"; }
mutation_started=false
backup_source_policy=pristine-empty-v1
BACKUP_DIR=/backup
OFFSITE_DIR=/offsite
STAGING_ROOT=/staging
application_database_url='postgresql://app@127.0.0.1:5433/veud_staging?schema=public'
STAGING_LOAD_DATABASE_URL='postgresql://load@127.0.0.1:5433/veud_staging_load?schema=public'
NODE_BIN=/bin/true
release=/release
phase=testing
staging_backup_or_verify`,
	)
	expectAllowed(fresh)
	const creates = fresh.stdout
		.trim()
		.split('\n')
		.filter(line => line.startsWith('create:'))
	assert.equal(creates.length, 2)
	assert.match(
		creates[0],
		/application .*DATABASE_URL=postgresql:\/\/app@.*\/veud_staging\?/,
	)
	assert.match(creates[0], /BACKUP_SOURCE_POLICY=pristine-empty-v1/)
	assert.match(
		creates[1],
		/load .*DATABASE_URL=postgresql:\/\/load@.*\/veud_staging_load\?/,
	)
	assert.match(creates[1], /BACKUP_SOURCE_POLICY=pristine-empty-v1/)

	const retry = runBash(
		`set -Eeuo pipefail
${backupFunction}
write_cutover_sentinel() { :; }
reconcile_cutover_backup_evidence() { printf 'unexpected-reconcile\\n'; return 1; }
create_and_pin_cutover_backup() { printf 'unexpected-create\\n'; return 1; }
verify_cutover_backup_evidence() { printf 'verify:%s\\n' "$1"; }
mutation_started=true
backup_source_policy=pristine-empty-v1
phase=testing
staging_backup_or_verify`,
	)
	expectAllowed(retry)
	assert.equal(retry.stdout.trim(), 'verify:all')

	const preMutationRetry = runBash(
		`set -Eeuo pipefail
${backupFunction}
write_cutover_sentinel() { :; }
reconcile_cutover_backup_evidence() { printf 'reused:%s\\n' "$1"; }
create_and_pin_cutover_backup() { printf 'unexpected-create\\n'; return 1; }
mutation_started=false
backup_source_policy=pristine-empty-v1
BACKUP_DIR=/backup
OFFSITE_DIR=/offsite
STAGING_ROOT=/staging
application_database_url=application
STAGING_LOAD_DATABASE_URL=load
NODE_BIN=/bin/true
release=/release
phase=testing
staging_backup_or_verify`,
	)
	expectAllowed(preMutationRetry)
	assert.deepEqual(preMutationRetry.stdout.trim().split('\n'), [
		'reused:application',
		'reused:load',
	])
})

test('staging pristine bootstrap attestation is pre-PONR only and retries migrated state', () => {
	const mutate = extractShellFunction(stagingDeploy, 'staging_mutate')
	const release = temporaryRoot('staging-pristine-retry')
	const run = mutationStarted =>
		runBash(
			`set -Eeuo pipefail
${mutate}
write_cutover_sentinel() { printf 'phase:%s\\n' "$phase"; }
drain_staging_database_sessions_at_mutation_boundary() { :; }
write_staging_emergency_block() { :; }
release="$1"
mutation_started="$2"
backup_source_policy=pristine-empty-v1
DATABASE_URL=application
STAGING_LOAD_DATABASE_URL=load
NODE_BIN=/bin/false
NPM_BIN=/bin/true
phase=testing
staging_mutate`,
			{ args: [release, String(mutationStarted)] },
		)

	const retry = run(true)
	expectAllowed(retry)
	assert.doesNotMatch(
		retry.stdout,
		/phase:attest-pristine-databases-at-mutation-boundary/,
	)
	assert.match(retry.stdout, /phase:migrate-application-database/)

	const beforePonr = run(false)
	assert.notEqual(beforePonr.status, 0)
	assert.match(
		beforePonr.stdout,
		/phase:attest-pristine-databases-at-mutation-boundary/,
	)
	assert.doesNotMatch(beforePonr.stdout, /phase:migrate-application-database/)
})

test('backup creation verifies datasource identities before publishing recovery pins', () => {
	const root = temporaryRoot('backup-create-pin')
	const sourceTarget = '127.0.0.1:5433/veud_staging'
	const restoreTarget = '127.0.0.1:5433/veud_staging_restore'
	const source = writeBackupPair(
		path.join(root, 'source'),
		'postgres-cutover.dump',
		'verified-cutover-backup',
		sourceTarget,
		restoreTarget,
	)
	const generator = path.join(root, 'generate-backup.sh')
	fs.writeFileSync(
		generator,
		`#!/usr/bin/env bash
set -Eeuo pipefail
archive="$1"
receipt="$2"
backup_dir="$3"
offsite_dir="$4"
cp "$archive" "$backup_dir/postgres-cutover.dump"
cp "$receipt" "$backup_dir/postgres-cutover.dump.restore-verified.json"
cp "$archive" "$offsite_dir/postgres-cutover.dump"
cp "$receipt" "$offsite_dir/postgres-cutover.dump.restore-verified.json"
`,
		{ mode: 0o755 },
	)
	const runCreate = (label, expectedSource = sourceTarget) => {
		const operationRoot = path.join(root, label)
		const directories = {
			state: path.join(operationRoot, 'state'),
			backup: path.join(operationRoot, 'backup'),
			offsite: path.join(operationRoot, 'offsite'),
			pins: path.join(operationRoot, 'pins'),
			offsitePins: path.join(operationRoot, 'offsite-pins'),
		}
		fs.mkdirSync(directories.state, { recursive: true })
		const result = runBash(
			`source "$COMMON"
die() { printf 'ERROR: %s\\n' "$*" >&2; exit 1; }
cutover_create_and_pin_backup \
	"$NODE_BIN" \
	"$STATE_DIR" \
	"$BACKUP_DIR" \
	"$OFFSITE_DIR" \
	"$PIN_ROOT" \
	"$OFFSITE_PIN_ROOT" \
	application \
	"$EXPECTED_SOURCE" \
	"$EXPECTED_RESTORE" \
	migrated-veud-v1 \
	"$GENERATOR" \
	"$SOURCE_ARCHIVE" \
	"$SOURCE_RECEIPT" \
	"$BACKUP_DIR" \
	"$OFFSITE_DIR"`,
			{
				env: {
					COMMON: catalogCutoverCommon,
					NODE_BIN: node22,
					STATE_DIR: directories.state,
					BACKUP_DIR: directories.backup,
					OFFSITE_DIR: directories.offsite,
					PIN_ROOT: directories.pins,
					OFFSITE_PIN_ROOT: directories.offsitePins,
					EXPECTED_SOURCE: expectedSource,
					EXPECTED_RESTORE: restoreTarget,
					GENERATOR: generator,
					SOURCE_ARCHIVE: source.archive,
					SOURCE_RECEIPT: source.receipt,
				},
			},
		)
		return { directories, result }
	}

	const valid = runCreate('valid')
	expectAllowed(valid.result)
	const published = valid.result.stdout.trim().split('\t')
	assert.deepEqual(published, [
		path.join(valid.directories.pins, 'application.dump'),
		path.join(valid.directories.pins, 'application.dump.restore-verified.json'),
		path.join(valid.directories.offsitePins, 'application.dump'),
		path.join(
			valid.directories.offsitePins,
			'application.dump.restore-verified.json',
		),
	])
	for (const pinned of published) assert.ok(fs.existsSync(pinned), pinned)

	const wrongIdentity = runCreate(
		'wrong-identity',
		'127.0.0.1:5433/veud_staging_load',
	)
	assert.notEqual(wrongIdentity.result.status, 0)
	assert.ok(
		!fs.existsSync(wrongIdentity.directories.pins),
		'a receipt with the wrong source identity must not be pinned',
	)
	assert.ok(!fs.existsSync(wrongIdentity.directories.offsitePins))
})

test('retry loaders enforce the same candidate and active release boundary', () => {
	const productionRoot = temporaryRoot('production-retry-state')
	createActiveRelease(productionRoot, originalRelease)
	createRelease(productionRoot, requestedRelease)
	const productionStateDir = path.join(productionRoot, 'durable-state')
	fs.mkdirSync(productionStateDir)
	const productionState = path.join(productionRoot, 'maintenance.state')
	fs.writeFileSync(
		productionState,
		[
			'format=2',
			'environment=production',
			`original_active_release=${originalRelease}`,
			`requested_release=${requestedRelease}`,
			`state_dir=${productionStateDir}`,
			'phase=backup-verified',
			'database_mutation_started=false',
			'release_activated=false',
			'cutover_backup_archive=',
			'cutover_backup_receipt=',
			'cutover_backup_offsite_archive=',
			'cutover_backup_offsite_receipt=',
			'original_pm2_veud=online',
			'original_pm2_veud_backup=stopped',
			'unit.test.service=active',
			'enabled.test.service=disabled',
			'unit.test.timer=inactive',
			'enabled.test.timer=enabled',
			'',
		].join('\n'),
	)
	const productionLoader = `
source "$1"
${extractShellFunction(productionDeploy, 'is_writer_unit')}
${extractShellFunction(productionDeploy, 'load_maintenance_state')}
all_writer_units=(test.service test.timer)
declare -A original_unit_states=()
declare -A original_unit_enabled_states=()
release="$2"
state_dir="$3"
maintenance_state="$4"
verify_captured_unit_definitions() { return 0; }
verify_captured_pm2_definitions() { return 0; }
maintenance_loaded=false
maintenance_started=false
load_maintenance_state
`
	const productionArgs = [
		productionCommon,
		requestedRelease,
		productionStateDir,
		productionState,
	]
	expectAllowed(
		runBash(productionLoader, {
			args: productionArgs,
			env: {
				VEUD_PRODUCTION_ROOT: productionRoot,
				VEUD_STAGING_NODE_BIN: node22,
				VEUD_STAGING_NPM_BIN: node22,
			},
		}),
	)
	expectBlocked(
		runBash(productionLoader, {
			args: [
				productionCommon,
				differentRelease,
				productionStateDir,
				productionState,
			],
			env: {
				VEUD_PRODUCTION_ROOT: productionRoot,
				VEUD_STAGING_NODE_BIN: node22,
				VEUD_STAGING_NPM_BIN: node22,
			},
		}),
	)

	const stagingRoot = temporaryRoot('staging-retry-state')
	createActiveRelease(stagingRoot, originalRelease)
	createRelease(stagingRoot, requestedRelease)
	const stagingStateDir = path.join(stagingRoot, 'durable-state')
	fs.mkdirSync(stagingStateDir)
	const stagingSentinel = path.join(stagingRoot, 'sentinel')
	const writeRetrySentinel = ({ bootstrap = false } = {}) => {
		fs.writeFileSync(
			stagingSentinel,
			[
				'format=2',
				'environment=staging',
				`release=${requestedRelease}`,
				`original_release=${bootstrap ? 'none' : originalRelease}`,
				`bootstrap=${bootstrap}`,
				`backup_source_policy=${
					bootstrap ? 'pristine-empty-v1' : 'migrated-veud-v1'
				}`,
				`state_dir=${stagingStateDir}`,
				'phase=stop-writers',
				'mutation_started=false',
				'release_activated=false',
				'application_backup_archive=',
				'application_backup_receipt=',
				'application_backup_offsite_archive=',
				'application_backup_offsite_receipt=',
				'load_backup_archive=',
				'load_backup_receipt=',
				'load_backup_offsite_archive=',
				'load_backup_offsite_receipt=',
				'',
			].join('\n'),
		)
	}
	writeRetrySentinel()
	const stagingLoader = `
source "$1"
${extractShellFunction(stagingDeploy, 'active_staging_release_id')}
${extractShellFunction(stagingDeploy, 'load_cutover_sentinel_state')}
commit="$2"
state_dir="$3"
cutover_sentinel="$4"
current="$5"
bootstrap=false
backup_source_policy=pending
original_release=''
mutation_started=false
release_activated=false
load_cutover_sentinel_state
`
	const stagingArgs = [
		stagingCommon,
		requestedRelease,
		stagingStateDir,
		stagingSentinel,
		path.join(stagingRoot, 'app/current'),
	]
	expectAllowed(
		runBash(stagingLoader, {
			args: stagingArgs,
			env: {
				VEUD_STAGING_ROOT: stagingRoot,
				VEUD_STAGING_NODE_BIN: node22,
				VEUD_STAGING_NPM_BIN: node22,
			},
		}),
	)
	expectBlocked(
		runBash(stagingLoader, {
			args: [
				stagingCommon,
				differentRelease,
				stagingStateDir,
				stagingSentinel,
				path.join(stagingRoot, 'app/current'),
			],
			env: {
				VEUD_STAGING_ROOT: stagingRoot,
				VEUD_STAGING_NODE_BIN: node22,
				VEUD_STAGING_NPM_BIN: node22,
			},
		}),
	)

	fs.unlinkSync(path.join(stagingRoot, 'app/current'))
	writeRetrySentinel({ bootstrap: true })
	expectAllowed(
		runBash(stagingLoader, {
			args: stagingArgs,
			env: {
				VEUD_STAGING_ROOT: stagingRoot,
				VEUD_STAGING_NODE_BIN: node22,
				VEUD_STAGING_NPM_BIN: node22,
			},
		}),
	)
})

test('fresh staging bootstrap activates only the app, backups, and configured integrations', () => {
	const configure = extractShellFunction(
		stagingDeploy,
		'configure_bootstrap_target_states',
	)
	const script = `
set -Eeuo pipefail
${configure}
bootstrap=true
service_units=(
	veud-staging-app.service
	veud-staging-notification-digests.service
	veud-staging-mal-hydration.service
	veud-staging-mal-inventory.service
	veud-staging-mal-trending.service
	veud-staging-tmdb-hydration.service
	veud-staging-tmdb-inventory.service
	veud-staging-backup.service
	veud-staging-catalog-backup.service
)
regular_timer_units=(
	veud-staging-notification-digests.timer
	veud-staging-mal-hydration.timer
	veud-staging-mal-inventory.timer
	veud-staging-mal-trending.timer
	veud-staging-tmdb-hydration.timer
	veud-staging-tmdb-inventory.timer
)
backup_timer_units=(
	veud-staging-backup.timer
	veud-staging-catalog-backup.timer
)
timer_units=("\${regular_timer_units[@]}" "\${backup_timer_units[@]}")
declare -A prior_active_state=()
declare -A prior_enabled_state=()
declare -A prior_running=()
persist_recorded_unit_states() { :; }
configure_bootstrap_target_states
for unit in veud-staging-app.service "\${timer_units[@]}"; do
	printf '%s|%s|%s|%s\\n' \
		"$unit" \
		"\${prior_active_state[$unit]}" \
		"\${prior_enabled_state[$unit]}" \
		"\${prior_running[$unit]}"
done
`
	const parse = result =>
		new Map(
			result.stdout
				.trim()
				.split('\n')
				.map(line => {
					const [unit, active, enabled, running] = line.split('|')
					return [unit, { active, enabled, running }]
				}),
		)

	const minimalResult = runBash(script, {
		env: {
			MAL_CLIENT_ID: '',
			MAL_CATALOG_POLICY_APPROVAL_REF: '',
			TMDB_API_KEY: '',
			RESEND_API_KEY: '',
		},
	})
	expectAllowed(minimalResult)
	const minimal = parse(minimalResult)
	assert.deepEqual(minimal.get('veud-staging-app.service'), {
		active: 'active',
		enabled: 'enabled',
		running: '1',
	})
	for (const timer of [
		'veud-staging-backup.timer',
		'veud-staging-catalog-backup.timer',
	]) {
		assert.deepEqual(minimal.get(timer), {
			active: 'active',
			enabled: 'enabled',
			running: '1',
		})
	}
	for (const timer of [
		'veud-staging-notification-digests.timer',
		'veud-staging-mal-hydration.timer',
		'veud-staging-mal-inventory.timer',
		'veud-staging-mal-trending.timer',
		'veud-staging-tmdb-hydration.timer',
		'veud-staging-tmdb-inventory.timer',
	]) {
		assert.deepEqual(minimal.get(timer), {
			active: 'inactive',
			enabled: 'disabled',
			running: '0',
		})
	}

	const configuredResult = runBash(script, {
		env: {
			MAL_CLIENT_ID: 'test',
			MAL_CATALOG_POLICY_APPROVAL_REF: 'approved',
			TMDB_API_KEY: 'test',
			RESEND_API_KEY: 'test',
		},
	})
	expectAllowed(configuredResult)
	const configured = parse(configuredResult)
	for (const timer of [
		'veud-staging-notification-digests.timer',
		'veud-staging-mal-hydration.timer',
		'veud-staging-mal-inventory.timer',
		'veud-staging-mal-trending.timer',
		'veud-staging-tmdb-hydration.timer',
		'veud-staging-tmdb-inventory.timer',
	]) {
		assert.deepEqual(configured.get(timer), {
			active: 'active',
			enabled: 'enabled',
			running: '1',
		})
	}
})

test('fresh staging bootstrap rejects live or boot-enabled cutover units', () => {
	const record = extractShellFunction(stagingDeploy, 'record_unit_states')
	const root = temporaryRoot('bootstrap-prerequisites')
	const script = `
set -Eeuo pipefail
source "$3"
${record}
scenario="$1"
unit_state_file="$2"
commit='${requestedRelease}'
bootstrap=true
original_release=none
states_recorded=false
all_units=(veud-staging-app.service worker.service worker.timer)
boot_units=(veud-staging-app.service worker.timer)
declare -A prior_active_state=()
declare -A prior_enabled_state=()
declare -A prior_running=()
die() { printf 'ERROR: %s\\n' "$*" >&2; exit 1; }
systemctl() {
	local operation='' unit='' property='' argument
	for argument in "$@"; do
		[[ "$argument" == show || "$argument" == is-enabled ]] &&
			operation="$argument"
		[[ "$argument" == *.service || "$argument" == *.timer ]] && unit="$argument"
		[[ "$argument" == --property=* ]] && property="\${argument#--property=}"
	done
	if [[ "$operation" == is-enabled ]]; then
		if [[ "$scenario" == enabled && "$unit" == worker.timer ]]; then
			printf enabled
		else
			printf disabled
		fi
	elif [[ "$property" == LoadState ]]; then
		printf loaded
	elif [[ "$scenario" == active && "$unit" == veud-staging-app.service ]]; then
		printf active
	else
		printf inactive
	fi
}
record_unit_states
`
	const run = scenario =>
		runBash(script, {
			args: [
				scenario,
				path.join(root, `${scenario}.state`),
				catalogCutoverCommon,
			],
		})
	expectAllowed(run('safe'))
	assert.notEqual(run('active').status, 0)
	assert.notEqual(run('enabled').status, 0)
})

test('service completion and timer catch-up rules remain fail closed', () => {
	const functions = [
		'is_completion_capable_service_unit',
		'verify_service_states_restored',
	]
		.map(name => extractShellFunction(stagingDeploy, name))
		.join('\n')
	const script = `
set -Eeuo pipefail
source "$2"
${functions}
service_units=(veud-staging-app.service veud-staging-backup.service)
completion_capable_service_units=(veud-staging-backup.service)
declare -A prior_active_state=(
	[veud-staging-app.service]=active
	[veud-staging-backup.service]=active
	[veud-staging-backup.timer]=active
)
systemctl() {
	local unit='' property='' argument
	for argument in "$@"; do
		[[ "$argument" == *.service || "$argument" == *.timer ]] && unit="$argument"
		[[ "$argument" == --property=* ]] && property="\${argument#--property=}"
	done
	if [[ "$property" == ActiveState ]]; then
		case "$1:$unit" in
		batch-success:veud-staging-app.service) printf active ;;
		batch-success:veud-staging-backup.service) printf inactive ;;
		app-stopped:veud-staging-app.service) printf inactive ;;
		app-stopped:veud-staging-backup.service) printf inactive ;;
		batch-failed:veud-staging-app.service) printf active ;;
		batch-failed:veud-staging-backup.service) printf inactive ;;
		catchup:veud-staging-app.service) printf active ;;
		catchup:veud-staging-backup.service) printf activating ;;
		esac
	else
		[[ "$1" == batch-failed ]] && printf exit-code || printf success
	fi
}
scenario="$1"
systemctl() {
	local unit='' property='' argument
	for argument in "$@"; do
		[[ "$argument" == *.service || "$argument" == *.timer ]] && unit="$argument"
		[[ "$argument" == --property=* ]] && property="\${argument#--property=}"
	done
	if [[ "$property" == ActiveState ]]; then
		case "$scenario:$unit" in
		batch-success:veud-staging-app.service) printf active ;;
		batch-success:veud-staging-backup.service) printf inactive ;;
		app-stopped:veud-staging-app.service) printf inactive ;;
		app-stopped:veud-staging-backup.service) printf inactive ;;
		batch-failed:veud-staging-app.service) printf active ;;
		batch-failed:veud-staging-backup.service) printf inactive ;;
		catchup:veud-staging-app.service) printf active ;;
		catchup:veud-staging-backup.service) printf activating ;;
		esac
	else
		[[ "$scenario" == batch-failed ]] && printf exit-code || printf success
	fi
}
if [[ "$scenario" == catchup ]]; then
	prior_active_state[veud-staging-backup.service]=inactive
	verify_service_states_restored true
else
	verify_service_states_restored false
fi
`
	const runScenario = scenario =>
		runBash(script, { args: [scenario, catalogCutoverCommon] })
	expectAllowed(runScenario('batch-success'))
	assert.notEqual(runScenario('app-stopped').status, 0)
	assert.notEqual(runScenario('batch-failed').status, 0)
	expectAllowed(runScenario('catchup'))
})

test('restoration orders services before timers and restores definitions before runtime', () => {
	const stagingRestore = runBash(`
set -Eeuo pipefail
${extractShellFunction(stagingDeploy, 'restore_prior_unit_states')}
service_units=(app.service worker.service)
regular_timer_units=(worker.timer)
backup_timer_units=(backup.timer)
timer_units=("\${regular_timer_units[@]}" "\${backup_timer_units[@]}")
restore_enablement_for_units() { printf 'enable:%s\\n' "$*"; }
restore_unit_if_previously_running() { printf 'restore:%s\\n' "$1"; }
verify_service_states_restored() { printf 'verify-services:%s\\n' "$1"; }
verify_timer_states_restored() { printf 'verify-timers\\n'; }
verify_enabled_states_unchanged() { printf 'verify-enabled\\n'; }
restore_prior_unit_states
`)
	expectAllowed(stagingRestore)
	assertOrdered(
		stagingRestore.stdout,
		[
			'enable:veud-staging-app.service',
			'restore:app.service',
			'restore:worker.service',
			'verify-services:false',
			'enable:worker.timer backup.timer',
			'restore:worker.timer',
			'restore:backup.timer',
			'verify-timers',
			'verify-services:true',
			'verify-enabled',
		],
		'staging runtime restoration',
	)

	const productionRoot = temporaryRoot('production-restoration-order')
	const productionRestore = runBash(
		`set -Eeuo pipefail
${extractShellFunction(productionDeploy, 'remove_production_cutover_authority')}
${extractShellFunction(productionDeploy, 'restore_before_mutation_best_effort')}
cutover_remove_file_durable() { rm -f "$1"; }
write_maintenance_state() { printf 'marker:%s\\n' "$1"; }
release_provider_locks() { printf 'release-provider\\n'; }
release_writer_lifetime_lock() { printf 'release-lifetime\\n'; }
restore_original_unit_definitions() { printf 'restore-definitions\\n'; }
restore_original_pm2_definitions() { printf 'restore-pm2-definitions\\n'; }
restore_writer_services() { printf 'restore-services\\n'; }
verify_writer_service_states() { printf 'verify-services:%s\\n' "$1"; }
restore_writer_enablement() { printf 'restore-enablement\\n'; }
restore_writer_timers() { printf 'restore-timers\\n'; }
verify_writer_timer_states() { printf 'verify-timers\\n'; }
verify_enabled_states_unchanged() { printf 'verify-enabled\\n'; }
verify_pm2_runtime_states() { printf 'verify-pm2\\n'; }
write_production_completion_cleanup_state() { :; }
cleanup_completed_production_release() { :; }
maintenance_state="$1/maintenance"
preparation_state="$1/preparation"
state_dir="$1/state"
PRODUCTION_BACKUP_DIR="$1/backups"
PRODUCTION_OFFSITE_DIR="$1/offsite"
release='${requestedRelease}'
restore_before_mutation_best_effort`,
		{ args: [productionRoot] },
	)
	expectAllowed(productionRestore)
	assertOrdered(
		productionRestore.stdout,
		[
			'restore-definitions',
			'release-provider',
			'release-lifetime',
			'restore-pm2-definitions',
			'restore-services',
			'verify-services:false',
			'restore-enablement',
			'restore-timers',
			'verify-timers',
			'verify-enabled',
			'verify-pm2',
		],
		'production pre-mutation restoration',
	)
})

test('staging discards only a non-authoritative release orphan', () => {
	const root = temporaryRoot('staging-orphan-state')
	const unitState = path.join(root, 'run/provenance-cutover-unit-state')
	const releaseAState = path.join(
		root,
		`run/provenance-cutover-state-${originalRelease}`,
	)
	const releaseBState = path.join(
		root,
		`run/provenance-cutover-state-${requestedRelease}`,
	)
	fs.mkdirSync(releaseAState, { recursive: true })
	fs.mkdirSync(releaseBState, { recursive: true })
	fs.writeFileSync(unitState, `# release=${originalRelease}\n`)

	const runDiscard = () =>
		runBash(
			`set -Eeuo pipefail
${extractShellFunction(stagingDeploy, 'cleanup_staging_release_artifacts')}
${extractShellFunction(stagingDeploy, 'discard_orphaned_staging_unit_state')}
cutover_remove_tree_durable() { rm -rf -- "$1"; }
cutover_remove_file_durable() { rm -f "$1"; }
STAGING_ROOT="$1"
unit_state_file="$2"
BACKUP_DIR="$1/backups"
OFFSITE_DIR="$1/offsite"
discard_orphaned_staging_unit_state`,
			{ args: [root, unitState] },
		)

	expectAllowed(runDiscard())
	assert.equal(fs.existsSync(unitState), false)
	assert.equal(fs.existsSync(releaseAState), false)
	assert.equal(fs.existsSync(releaseBState), true)

	const outside = path.join(root, 'must-remain')
	fs.mkdirSync(outside)
	fs.writeFileSync(
		unitState,
		'# release=../../must-remain\n# release=duplicate\n',
	)
	expectAllowed(runDiscard())
	assert.equal(fs.existsSync(unitState), false)
	assert.equal(fs.existsSync(outside), true)
	assert.equal(fs.existsSync(releaseBState), true)
})

test('staging cleanup retains its unit-state journal after any artifact failure', () => {
	const root = temporaryRoot('staging-cleanup-failure')
	const unitState = path.join(root, 'run/provenance-cutover-unit-state')
	fs.mkdirSync(path.dirname(unitState), { recursive: true })
	fs.writeFileSync(unitState, `# release=${requestedRelease}\n`)
	const result = runBash(
		`set -u
${extractShellFunction(stagingDeploy, 'cleanup_staging_release_artifacts')}
cutover_remove_tree_durable() {
	[[ "$1" != "$OFFSITE_DIR/.cutover-pins/${requestedRelease}" ]] || return 1
	rm -rf -- "$1"
}
cutover_remove_file_durable() { rm -f "$1"; }
STAGING_ROOT="$1"
BACKUP_DIR="$1/backups"
OFFSITE_DIR="$1/offsite"
unit_state_file="$2"
set +e
cleanup_staging_release_artifacts '${requestedRelease}'
status=$?
set -e
printf 'status=%s\\n' "$status"`,
		{ args: [root, unitState] },
	)
	expectAllowed(result)
	assert.equal(result.stdout.trim(), 'status=1')
	assert.equal(fs.existsSync(unitState), true)
})

test('production removes preparation before its stronger maintenance authority', () => {
	const root = temporaryRoot('production-authority-removal')
	const maintenance = path.join(root, 'maintenance')
	const preparation = path.join(root, 'preparation')
	const helper = extractShellFunction(
		productionDeploy,
		'remove_production_cutover_authority',
	)
	const runRemoval = ({ interrupt = false } = {}) =>
		runBash(
			`set -Eeuo pipefail
source "$3"
${helper}
maintenance_state="$1"
preparation_state="$2"
${
	interrupt
		? `rm() {
	command rm "$@"
	exit 97
}`
		: ''
}
remove_production_cutover_authority`,
			{ args: [maintenance, preparation, catalogCutoverCommon] },
		)

	fs.writeFileSync(maintenance, 'strong\n')
	fs.writeFileSync(preparation, 'weak\n')
	assert.equal(runRemoval({ interrupt: true }).status, 97)
	assert.equal(fs.existsSync(preparation), false)
	assert.equal(fs.existsSync(maintenance), true)

	expectAllowed(runRemoval())
	assert.equal(fs.existsSync(preparation), false)
	assert.equal(fs.existsSync(maintenance), false)
})

test('failed blocking-state publication creates an independent emergency deny authority', () => {
	const productionRoot = temporaryRoot('production-emergency-block')
	const productionEmergency = path.join(productionRoot, 'emergency')
	const productionRecovery = runBash(
		`set -Eeuo pipefail
source "$2"
${extractShellFunction(productionDeploy, 'write_production_emergency_block')}
${extractShellFunction(productionDeploy, 'recover_production_cutover_failure')}
write_maintenance_state() { return 1; }
quiesce_writers_after_mutation() { [[ -f "$emergency_block_state" ]]; }
release_provider_locks() { :; }
die() { printf 'ERROR: %s\\n' "$*" >&2; exit 1; }
emergency_block_state="$1"
release='${requestedRelease}'
deployment_succeeded=false
maintenance_started=true
database_mutation_started=true
recover_production_cutover_failure 97
emergency_inode="$(stat -c %i "$emergency_block_state")"
write_production_emergency_block
[[ "$(stat -c %i "$emergency_block_state")" == "$emergency_inode" ]]`,
		{ args: [productionEmergency, catalogCutoverCommon] },
	)
	expectAllowed(productionRecovery)
	assert.equal(fs.existsSync(productionEmergency), true)
	assert.match(fs.readFileSync(productionEmergency, 'utf8'), /^format=1$/m)

	const stagingRoot = temporaryRoot('staging-emergency-block')
	const stagingEmergency = path.join(stagingRoot, 'emergency')
	const stagingRecovery = runBash(
		`set -u
source "$3"
${extractShellFunction(stagingDeploy, 'write_staging_emergency_block')}
${extractShellFunction(stagingDeploy, 'recover_staging_cutover_failure')}
write_cutover_sentinel() { return 1; }
quiesce_cutover_after_mutation() { [[ -f "$emergency_block_state" ]]; }
release_provider_locks() { :; }
die() { printf 'ERROR: %s\\n' "$*" >&2; exit 1; }
emergency_block_state="$1"
cutover_sentinel="$2"
commit='${requestedRelease}'
deployment_succeeded=false
mutation_started=true
states_recorded=false
phase=testing
set +e
recover_staging_cutover_failure 97
status=$?
set -e
[[ "$status" -eq 0 ]]
emergency_inode="$(stat -c %i "$emergency_block_state")"
write_staging_emergency_block
[[ "$(stat -c %i "$emergency_block_state")" == "$emergency_inode" ]]`,
		{
			args: [
				stagingEmergency,
				path.join(stagingRoot, 'sentinel'),
				catalogCutoverCommon,
			],
		},
	)
	expectAllowed(stagingRecovery)
	assert.equal(fs.existsSync(stagingEmergency), true)
	assert.match(fs.readFileSync(stagingEmergency, 'utf8'), /^format=1$/m)
})

test('production target preparation is initial-only and joins both cutover locks', () => {
	assertOrdered(
		productionPrepareTarget,
		[
			'assert_production_operations_database_identities',
			'assert_postgres_16_14_client "$PSQL_BIN" psql',
			'copyPostgresBackupToPrivatePath',
			'validatePostgresBackupReceipt(receipt, {',
			'receipt.version !== 2 ||',
			'receipt.checks.sourcePolicy !== "migrated-veud-v1"',
			'cutover_acquire_deployment_lock',
			'catalog-release-preparation.state',
			'catalog-release-maintenance.state',
			'catalog-release-emergency-block.state',
			'[[ ! -e "$APP_ROOT" && ! -L "$APP_ROOT" ]]',
			'assert_application_is_not_using_production_target',
			'exec 6>"$PRODUCTION_ROOT/run/catalog-writer-lifetime.lock"',
			'flock --exclusive 6',
			'assert_application_is_not_using_production_target',
			'--no-psqlrc',
			'ALTER DATABASE veud_production CONNECTION LIMIT 0',
			'pg_catalog.pg_terminate_backend',
			'FROM pg_catalog.pg_prepared_xacts',
			'target_server_version" == 160014',
			'assert_staged_archive',
			'DROP DATABASE IF EXISTS veud_production WITH (FORCE)',
			'TEMPLATE template0',
			'CONNECTION LIMIT 0;',
			'REVOKE ALL ON DATABASE veud_production FROM PUBLIC',
			'ALTER SCHEMA public OWNER TO veud_production_app',
			'--role=veud_production_app',
			'assert_staged_archive',
			'FROM pg_catalog.pg_largeobject_metadata',
			'FROM pg_catalog.pg_subscription',
			'FROM pg_catalog.pg_foreign_data_wrapper',
			'FROM pg_catalog.pg_event_trigger',
			'ALTER DATABASE veud_production CONNECTION LIMIT -1',
		],
		'initial-only production target preparation',
	)
})

test('production target recreation is total, policy exact, and residue free', () => {
	// A public-schema-only reset leaves foreign residue behind; the target must
	// be rebuilt from template0 with its exact owner/ACL/connection policy.
	assert.doesNotMatch(
		productionPrepareTarget,
		/DROP SCHEMA IF EXISTS public CASCADE/,
	)
	for (const needle of [
		"pg_catalog.pg_encoding_to_char(database_object.encoding) || '|'",
		'DROP DATABASE IF EXISTS veud_production WITH (FORCE)',
		'OWNER veud_production_app',
		'TEMPLATE template0',
		"ENCODING '$target_encoding'",
		"LC_COLLATE '$target_collate'",
		"LC_CTYPE '$target_ctype'",
		'REVOKE ALL ON DATABASE veud_production FROM PUBLIC',
		'GRANT TEMPORARY ON DATABASE veud_production TO PUBLIC',
		'ALTER SCHEMA public OWNER TO veud_production_app',
		'REVOKE ALL ON SCHEMA public FROM PUBLIC',
		"dependency.deptype = 'e'",
		'NOT database_object.datistemplate',
		'Recreated production target OID could not be established',
	]) {
		assert.ok(
			productionPrepareTarget.includes(needle),
			`production target recreation: missing ${needle}`,
		)
	}
	// Residual inventory must reject every class of foreign object.
	for (const needle of [
		'pg_catalog.pg_namespace AS namespace_object',
		"extension_object.extname NOT IN ('plpgsql', 'pg_trgm')",
		'pg_catalog.pg_largeobject_metadata',
		'pg_catalog.pg_publication',
		'pg_catalog.pg_subscription',
		'pg_catalog.pg_foreign_data_wrapper',
		'pg_catalog.pg_foreign_server',
		'pg_catalog.pg_user_mapping',
		'pg_catalog.pg_foreign_table',
		'pg_catalog.pg_event_trigger',
		'pg_catalog.pg_get_userbyid(relation.relowner) <>',
		'pg_catalog.pg_get_userbyid(routine.proowner) <>',
	]) {
		assert.ok(
			productionPrepareTarget.includes(needle),
			`production residue inventory: missing ${needle}`,
		)
	}
})

test('production target preparation rejects an application already selecting the target', () => {
	const root = temporaryRoot('production-prepare-app-config')
	const config = path.join(root, 'application.env')
	const productionUrl =
		'postgresql://veud_production_app:secret@127.0.0.1:5433/veud_production?schema=public'
	const check = value => {
		fs.writeFileSync(config, `DATABASE_URL="${value}"\n`, { mode: 0o600 })
		return runBash(
			`set -Eeuo pipefail
cd "$1"
${extractShellFunction(
	productionPrepareTarget,
	'assert_application_is_not_using_production_target',
)}
die() { printf 'ERROR: %s\\n' "$*" >&2; exit 1; }
APPLICATION_CONFIG_FILE="$2"
NODE_BIN="$3"
assert_application_is_not_using_production_target`,
			{ args: [repositoryRoot, config, node22] },
		)
	}
	assert.notEqual(check(productionUrl).status, 0)
	expectAllowed(check('file:/tmp/veud-development.db'))
})

test('provisioning serializes database mutations and isolates every libpq child', () => {
	assertOrdered(
		productionProvision,
		[
			'cutover_acquire_deployment_lock',
			'catalog-release-maintenance.state',
			'exec 6>"$PRODUCTION_ROOT/run/catalog-writer-lifetime.lock"',
			'flock --exclusive --wait "$provision_lock_wait" 6',
			'production_postgres_environment=(',
			'env',
			'-i',
			'run_production_admin_psql',
			'pg_catalog.pg_stat_activity',
			'pg_catalog.pg_prepared_xacts',
			'pg_catalog.pg_get_userbyid(database_object.datdba)',
		],
		'production provision coordination and database fence',
	)
	for (const source of [productionProvision, stagingProvision]) {
		assert.match(source, /PGOPTIONS=-csearch_path=pg_catalog/)
		for (const catalog of [
			'pg_roles',
			'pg_auth_members',
			'pg_db_role_setting',
			'pg_shdescription',
			'pg_shseclabel',
		]) {
			assert.doesNotMatch(
				source,
				new RegExp(`(?:FROM|JOIN) ${catalog}\\b`),
				`${catalog} must be explicitly schema-qualified`,
			)
		}
		assert.match(source, /Existing .* database .* is owned by/)
	}

	for (const [source, functionName, environmentName] of [
		[
			productionProvision,
			'run_production_admin_psql',
			'production_postgres_environment',
		],
		[
			stagingProvision,
			'run_staging_admin_psql',
			'staging_postgres_environment',
		],
	]) {
		const root = temporaryRoot(`provision-env-${functionName}`)
		const fakePsql = path.join(root, 'psql')
		fs.writeFileSync(
			fakePsql,
			`#!/usr/bin/env bash
printf '%s|%s|%s|%s\\n' \
	"\${PGHOSTADDR-unset}" \
	"\${PGSERVICE-unset}" \
	"\${PGOPTIONS-unset}" \
	"\${PGPASSWORD-unset}"
`,
			{ mode: 0o700 },
		)
		const result = runBash(
			`set -Eeuo pipefail
${extractShellFunction(source, functionName)}
${environmentName}=(env -i "HOME=$HOME" "PATH=$1:/usr/bin:/bin" LANG=C LC_ALL=C)
PG_BIN="$1"
PGADMINUSER=admin
PGADMINPASSWORD=intended-password
${functionName} --dbname=postgres`,
			{
				args: [root],
				env: {
					PGHOSTADDR: '203.0.113.44',
					PGSERVICE: 'hostile-service',
					PGOPTIONS: '-csearch_path=public',
					PGPASSWORD: 'hostile-password',
				},
			},
		)
		expectAllowed(result)
		assert.equal(
			result.stdout.trim(),
			'unset|unset|-csearch_path=pg_catalog|intended-password',
		)
	}
})

test('staging provisioning cannot replace immutable cutover units', () => {
	assertOrdered(
		stagingProvision,
		[
			'cutover_acquire_deployment_lock',
			'exec 6>"$STAGING_ROOT/run/catalog-writer-lifetime.lock"',
			'flock --exclusive --wait "$provision_lock_wait" 6',
			'provenance-cutover-incomplete',
			'assert_staging_database_identities',
			// Every managed unit is preflighted before any of them is replaced.
			'managed_units=(veud-staging-postgres.service',
			'Systemd drop-ins are forbidden for managed staging unit',
			'if [[ -L "$current" ]]; then',
			'cutover_active_release_id "$current" "$STAGING_ROOT/app/releases"',
			'cmp -s "$rendered_units/$unit" "$unit_dir/$unit"',
			'Provisioning refuses to replace immutable active unit',
			'elif [[ -e "$current" ]]; then',
			'publish_managed_unit() {',
			'mv -f "$temporary" "$unit_dir/$unit"',
			'systemctl --user daemon-reload',
			'cutover_verify_effective_immutable_units',
		],
		'staging provisioning lock and immutable-release boundary',
	)
})

test('fresh staging restoration requires both immediate migrated backups', () => {
	const root = temporaryRoot('staging-bootstrap-backups')
	const release = path.join(root, 'release')
	const launcherDirectory = path.join(release, 'ops/local-staging')
	const eventLog = path.join(root, 'events.log')
	fs.mkdirSync(launcherDirectory, { recursive: true })
	for (const launcher of ['run-backup.sh', 'run-load-backup.sh']) {
		const filename = path.join(launcherDirectory, launcher)
		fs.writeFileSync(
			filename,
			`#!/usr/bin/env bash\nprintf '%s\\n' '${launcher}' >>"$BOOTSTRAP_EVENT_LOG"\n`,
		)
		fs.chmodSync(filename, 0o700)
	}
	const result = runBash(
		`set -Eeuo pipefail
${extractShellFunction(stagingDeploy, 'staging_restore')}
write_cutover_sentinel() { printf 'phase:%s\\n' "$phase" >>"$BOOTSTRAP_EVENT_LOG"; }
release_provider_locks() { :; }
restore_prior_unit_states() { :; }
cutover_sync_tree() { :; }
bootstrap=true
release="$1"
unit_dir="$2"
export BOOTSTRAP_EVENT_LOG="$3"
staging_restore`,
		{ args: [release, root, eventLog] },
	)
	expectAllowed(result)
	assert.deepEqual(fs.readFileSync(eventLog, 'utf8').trim().split('\n'), [
		'phase:post-bootstrap-application-backup',
		'run-backup.sh',
		'phase:post-bootstrap-load-backup',
		'run-load-backup.sh',
		'phase:restore-prior-unit-states',
	])
})

test('production completion cleanup journal recovers interrupted pin removal', () => {
	const root = temporaryRoot('production-completion-cleanup')
	const run = path.join(root, 'run')
	const localBackups = path.join(root, 'backups')
	const offsiteBackups = path.join(root, 'offsite')
	const cleanupState = path.join(run, 'completion.state')
	const maintenance = path.join(run, 'maintenance.state')
	const preparation = path.join(run, 'preparation.state')
	const emergency = path.join(run, 'emergency.state')
	const state = path.join(run, `catalog-release-state-${requestedRelease}`)
	const localPin = path.join(localBackups, '.cutover-pins', requestedRelease)
	const offsitePin = path.join(
		offsiteBackups,
		'.cutover-pins',
		requestedRelease,
	)
	const releases = path.join(root, 'app/releases')
	const activeRelease = path.join(releases, requestedRelease)
	const appRoot = path.join(root, 'app/current')
	fs.mkdirSync(activeRelease, { recursive: true })
	fs.writeFileSync(path.join(activeRelease, 'RELEASE'), `${requestedRelease}\n`)
	fs.symlinkSync(activeRelease, appRoot)
	for (const directory of [state, localPin, offsitePin]) {
		fs.mkdirSync(directory, { recursive: true })
		fs.writeFileSync(path.join(directory, 'evidence'), 'pinned\n')
	}
	fs.writeFileSync(
		cleanupState,
		[
			'format=2',
			'environment=production',
			`release=${requestedRelease}`,
			`active_release=${requestedRelease}`,
			'',
		].join('\n'),
	)
	for (const authority of [maintenance, preparation]) {
		fs.writeFileSync(
			authority,
			[
				'format=2',
				'environment=production',
				`requested_release=${requestedRelease}`,
				'',
			].join('\n'),
		)
	}
	fs.writeFileSync(
		emergency,
		[
			'format=1',
			'environment=production',
			`requested_release=${requestedRelease}`,
			'',
		].join('\n'),
	)

	const invoke = () =>
		runBash(
			`set -Eeuo pipefail
source "$1"
${extractShellFunction(productionDeploy, 'remove_production_cutover_authority')}
${extractShellFunction(
	productionDeploy,
	'cleanup_completed_production_release',
)}
completion_cleanup_state="$2"
maintenance_state="$3"
preparation_state="$4"
emergency_block_state="$5"
PRODUCTION_ROOT="$6"
PRODUCTION_BACKUP_DIR="$7"
PRODUCTION_OFFSITE_DIR="$8"
APP_ROOT="$9"
cleanup_completed_production_release`,
			{
				args: [
					catalogCutoverCommon,
					cleanupState,
					maintenance,
					preparation,
					emergency,
					root,
					localBackups,
					offsiteBackups,
					appRoot,
				],
			},
		)

	const failedCleanup = runBash(
		`set -u
source "$1"
${extractShellFunction(productionDeploy, 'remove_production_cutover_authority')}
${extractShellFunction(
	productionDeploy,
	'cleanup_completed_production_release',
)}
offsite_root="$8"
cutover_remove_tree_durable() {
	[[ "$1" != "$offsite_root/.cutover-pins/${requestedRelease}" ]] || return 1
	rm -rf -- "$1"
}
cutover_remove_file_durable() { rm -f "$1"; }
completion_cleanup_state="$2"
maintenance_state="$3"
preparation_state="$4"
emergency_block_state="$5"
PRODUCTION_ROOT="$6"
PRODUCTION_BACKUP_DIR="$7"
PRODUCTION_OFFSITE_DIR="$8"
APP_ROOT="$9"
cleanup_completed_production_release`,
		{
			args: [
				catalogCutoverCommon,
				cleanupState,
				maintenance,
				preparation,
				emergency,
				root,
				localBackups,
				offsiteBackups,
				appRoot,
			],
		},
	)
	assert.notEqual(failedCleanup.status, 0)
	assert.equal(
		fs.existsSync(cleanupState),
		true,
		'cleanup journal must survive any artifact removal failure',
	)
	for (const authority of [maintenance, preparation, emergency]) {
		assert.equal(
			fs.existsSync(authority),
			false,
			'completed release authority should be reconciled before housekeeping',
		)
	}
	expectAllowed(invoke())
	for (const target of [cleanupState, state, localPin, offsitePin]) {
		assert.equal(fs.existsSync(target), false, target)
	}
})

test('production pre-mutation restoration cleans requested pins while retaining the original release', () => {
	const root = temporaryRoot('production-pre-mutation-cleanup')
	const run = path.join(root, 'run')
	const backup = path.join(root, 'backups')
	const offsite = path.join(root, 'offsite')
	const cleanup = path.join(run, 'completion.state')
	const current = path.join(root, 'app/current')
	const original = path.join(root, 'app/releases', originalRelease)
	for (const directory of [
		path.join(run, `catalog-release-state-${requestedRelease}`),
		path.join(backup, '.cutover-pins', requestedRelease),
		path.join(offsite, '.cutover-pins', requestedRelease),
		original,
	]) {
		fs.mkdirSync(directory, { recursive: true })
	}
	fs.writeFileSync(path.join(original, 'RELEASE'), `${originalRelease}\n`)
	fs.symlinkSync(original, current)
	fs.writeFileSync(
		cleanup,
		[
			'format=2',
			'environment=production',
			`release=${requestedRelease}`,
			`active_release=${originalRelease}`,
			'',
		].join('\n'),
	)
	const result = runBash(
		`set -Eeuo pipefail
source "$1"
${extractShellFunction(productionDeploy, 'remove_production_cutover_authority')}
${extractShellFunction(
	productionDeploy,
	'cleanup_completed_production_release',
)}
completion_cleanup_state="$2"
maintenance_state="$3"
preparation_state="$4"
emergency_block_state="$5"
PRODUCTION_ROOT="$6"
PRODUCTION_BACKUP_DIR="$7"
PRODUCTION_OFFSITE_DIR="$8"
APP_ROOT="$9"
cleanup_completed_production_release`,
		{
			args: [
				catalogCutoverCommon,
				cleanup,
				path.join(run, 'maintenance'),
				path.join(run, 'preparation'),
				path.join(run, 'emergency'),
				root,
				backup,
				offsite,
				current,
			],
		},
	)
	expectAllowed(result)
	assert.equal(fs.existsSync(cleanup), false)
	assert.equal(fs.existsSync(current), true)
	assert.equal(
		fs.readFileSync(path.join(current, 'RELEASE'), 'utf8').trim(),
		originalRelease,
	)
	assert.equal(
		fs.existsSync(path.join(backup, '.cutover-pins', requestedRelease)),
		false,
	)
})

test('staging completion journal reconciles sentinel and emergency crash windows', () => {
	const root = temporaryRoot('staging-completion-cleanup')
	const run = path.join(root, 'run')
	const backup = path.join(root, 'backups')
	const offsite = path.join(root, 'offsite')
	const completion = path.join(run, 'completion.state')
	const sentinel = path.join(run, 'sentinel.state')
	const emergency = path.join(run, 'emergency.state')
	const unitState = path.join(run, 'unit.state')
	const state = path.join(run, `provenance-cutover-state-${requestedRelease}`)
	const current = path.join(root, 'app/current')
	const release = path.join(root, 'app/releases', requestedRelease)
	for (const directory of [
		state,
		path.join(backup, '.cutover-pins', requestedRelease),
		path.join(offsite, '.cutover-pins', requestedRelease),
		path.join(backup, 'catalog/.cutover-pins', requestedRelease),
		path.join(offsite, 'catalog/.cutover-pins', requestedRelease),
		release,
	]) {
		fs.mkdirSync(directory, { recursive: true })
	}
	fs.writeFileSync(path.join(release, 'RELEASE'), `${requestedRelease}\n`)
	fs.symlinkSync(release, current)
	fs.writeFileSync(
		completion,
		`format=1\nenvironment=staging\nrelease=${requestedRelease}\n`,
	)
	fs.writeFileSync(
		sentinel,
		`format=2\nenvironment=staging\nrelease=${requestedRelease}\n`,
	)
	fs.writeFileSync(
		emergency,
		`format=1\nenvironment=staging\nrelease=${requestedRelease}\n`,
	)
	fs.writeFileSync(unitState, `# release=${requestedRelease}\n`)

	const result = runBash(
		`set -Eeuo pipefail
source "$1"
${extractShellFunction(stagingDeploy, 'cleanup_staging_release_artifacts')}
${extractShellFunction(stagingDeploy, 'cleanup_completed_staging_release')}
STAGING_ROOT="$2"
BACKUP_DIR="$3"
OFFSITE_DIR="$4"
completion_cleanup_state="$5"
cutover_sentinel="$6"
emergency_block_state="$7"
unit_state_file="$8"
current="$9"
cleanup_completed_staging_release`,
		{
			args: [
				catalogCutoverCommon,
				root,
				backup,
				offsite,
				completion,
				sentinel,
				emergency,
				unitState,
				current,
			],
		},
	)
	expectAllowed(result)
	for (const target of [
		completion,
		sentinel,
		emergency,
		unitState,
		state,
		path.join(backup, '.cutover-pins', requestedRelease),
		path.join(offsite, '.cutover-pins', requestedRelease),
	]) {
		assert.equal(fs.existsSync(target), false, target)
	}
})

test('top-level deployment policies preserve singleton, retry, recovery, and health boundaries', () => {
	const productionTopLevel = withoutShellFunctions(productionDeploy)
	const stagingTopLevel = withoutShellFunctions(stagingDeploy)
	const productionStop = extractShellFunction(
		productionDeploy,
		'production_stop_and_drain',
	)
	const productionBackup = extractShellFunction(
		productionDeploy,
		'production_backup_or_verify',
	)
	const productionMutate = extractShellFunction(
		productionDeploy,
		'production_mutate',
	)
	const productionActivate = extractShellFunction(
		productionDeploy,
		'production_activate_and_health',
	)
	const productionRestore = extractShellFunction(
		productionDeploy,
		'production_restore',
	)
	const productionRecovery = extractShellFunction(
		productionDeploy,
		'recover_production_cutover_failure',
	)
	const stagingStop = extractShellFunction(
		stagingDeploy,
		'staging_stop_and_drain',
	)
	const stagingBackup = extractShellFunction(
		stagingDeploy,
		'staging_backup_or_verify',
	)
	const stagingDrain = extractShellFunction(
		stagingDeploy,
		'drain_staging_database_sessions_at_mutation_boundary',
	)
	const stagingMutate = extractShellFunction(stagingDeploy, 'staging_mutate')
	const stagingActivate = extractShellFunction(
		stagingDeploy,
		'staging_activate_and_health',
	)
	const stagingRestore = extractShellFunction(stagingDeploy, 'staging_restore')
	const stagingComplete = extractShellFunction(
		stagingDeploy,
		'staging_complete',
	)
	const stagingRecovery = extractShellFunction(
		stagingDeploy,
		'recover_staging_cutover_failure',
	)

	assertOrdered(
		productionTopLevel,
		[
			'cutover_acquire_deployment_lock',
			'for existing_state in "$maintenance_state" "$preparation_state"; do',
			'mkdir -p "$releases_root"',
			'mkdir -p "$partial"',
			'git archive "$release" | tar -x -C "$partial"',
			'cutover_publish_tree_durable "$partial" "$destination"',
			'write_maintenance_state preparing-supervisors "$preparation_state"',
			'cutover_run_transition_driver production',
		],
		'production singleton and ownership preflight',
	)
	assertOrdered(
		productionStop,
		[
			'stop_pm2_process veud',
			'remove_pm2_boot_definitions',
			'maintenance_loaded=true',
			'maintenance_started=true',
			'write_maintenance_state draining-writers',
			'install_guarded_pm2_definitions',
			'stop_writer_unit "$unit"',
			'disable_writer_timers',
			'install_immutable_writer_unit_definitions',
			'acquire_writer_lifetime_lock_exclusive',
		],
		'production first guarded PM2 transition',
	)
	assert.match(
		productionBackup,
		/if \[\[ "\$database_mutation_started" == false \]\]; then[\s\S]*create_and_pin_cutover_backup[\s\S]*else[\s\S]*verify_cutover_backup_evidence/,
	)
	assertOrdered(
		productionMutate,
		[
			'write_production_emergency_block',
			'database_mutation_started=true',
			'write_maintenance_state migrating',
			'migrate deploy',
			'--require-clean',
			'write_maintenance_state database-compatible',
		],
		'production mutation boundary',
	)
	assertOrdered(
		productionActivate,
		[
			'ln -s "$destination" "$current_next"',
			'cutover_publish_symlink_durable "$current_next" "$current"',
			'write_maintenance_state healthcheck-compatible-release',
			'cutover_remove_file_durable "$emergency_block_state"',
			'release_writer_lifetime_lock',
			'cutover_health_headers_match',
			'release_activated=true',
		],
		'production activation identity',
	)
	assertOrdered(
		productionRestore,
		[
			'write_maintenance_state resume-writers',
			'release_provider_locks',
			'restore_writer_services',
			'verify_writer_service_states false',
			'restore_writer_timers',
			'cutover_sync_tree "$unit_dir"',
			'write_maintenance_state resume-backup',
			'save_pm2_state',
		],
		'production compatible restoration',
	)
	assertOrdered(
		productionRecovery,
		[
			'write_maintenance_state blocking-after-database-mutation',
			'quiesce_writers_after_mutation',
			'write_maintenance_state failed-after-database-mutation',
		],
		'production post-mutation failure',
	)
	assertOrdered(
		extractShellFunction(productionDeploy, 'quiesce_writers_after_mutation'),
		[
			'systemctl --user stop "$unit"',
			'"$pm2_bin" stop "$name"',
			'acquire_writer_lifetime_lock_exclusive',
			'save_pm2_state',
		],
		'production post-failure lifetime drain',
	)

	assertOrdered(
		stagingStop,
		[
			'cutover_acquire_deployment_lock',
			'if [[ -e "$cutover_sentinel" || -L "$cutover_sentinel" ]]; then',
			'mkdir -p "$STAGING_ROOT/app/releases"',
			'rm -rf "$temporary"',
			'git -C "$REPO_ROOT" archive "$commit" | tar -x -C "$temporary"',
			'cutover_publish_tree_durable "$temporary" "$release"',
			'load_cutover_sentinel_state',
			'load_recorded_unit_states',
			"phase='stop-writers'",
			'write_cutover_sentinel 0',
			'stop_cutover_units',
			'disable_cutover_boot_units',
			'acquire_writer_lifetime_lock_exclusive',
			'install_immutable_cutover_unit_definitions',
		],
		'staging retry ownership and writer drain',
	)
	assert.match(
		stagingBackup,
		/if \[\[ "\$mutation_started" == false \]\]; then[\s\S]*create_and_pin_cutover_backup[\s\S]*else[\s\S]*verify_cutover_backup_evidence all/,
	)
	assertOrdered(
		stagingBackup,
		[
			"phase='backup-load-database'",
			"phase='recheck-pristine-application-database'",
			'DATABASE_URL="$DATABASE_URL"',
			"phase='recheck-pristine-load-database'",
			'DATABASE_URL="$STAGING_LOAD_DATABASE_URL"',
		],
		'fresh bootstrap source-after-dump verification',
	)
	assertOrdered(
		stagingMutate,
		[
			"phase='drain-database-sessions-at-mutation-boundary'",
			'drain_staging_database_sessions_at_mutation_boundary',
			"phase='attest-pristine-databases-at-mutation-boundary'",
			'assert-pristine-postgres.mjs',
			"phase='migrate-application-database'",
			'write_staging_emergency_block',
			'mutation_started=true',
			'DATABASE_URL="$DATABASE_URL" "$NPM_BIN" run db:migrate:postgres',
			"phase='migrate-load-database'",
			'DATABASE_URL="$STAGING_LOAD_DATABASE_URL" "$NPM_BIN" run db:migrate:postgres',
			"phase='verify-migrated-databases'",
			"phase='repair-application-database'",
			"phase='repair-load-database'",
			"phase='synchronize-linked-application-metadata'",
			"phase='assert-provenance-boundaries'",
			'--require-clean',
		],
		'staging dual-database mutation boundary',
	)
	assertOrdered(
		stagingDrain,
		[
			'for database in veud_staging veud_staging_load; do',
			'--no-psqlrc',
			'pg_catalog.pg_terminate_backend',
			'pg_catalog.pg_stat_activity',
			'pg_catalog.pg_prepared_xacts',
		],
		'staging database session drain',
	)
	assert.match(
		stagingDrain,
		/-u PGHOST[\s\S]*-u PGSERVICE[\s\S]*-u PGOPTIONS[\s\S]*PGPASSWORD="\$PGADMINPASSWORD"/,
	)
	assertOrdered(
		stagingActivate,
		[
			"phase='activate-release'",
			'ln -s "$release" "$current_next"',
			'cutover_publish_symlink_durable "$current_next" "$current"',
			"phase='healthcheck-new-release'",
			'cutover_remove_file_durable "$emergency_block_state"',
			'release_writer_lifetime_lock',
			'cutover_health_headers_match',
			'release_activated=true',
			'configure_bootstrap_target_states',
		],
		'staging activation identity',
	)
	assertOrdered(
		stagingRestore,
		[
			'release_provider_locks',
			"phase='post-bootstrap-application-backup'",
			'"$release/ops/local-staging/run-backup.sh"',
			"phase='post-bootstrap-load-backup'",
			'"$release/ops/local-staging/run-load-backup.sh"',
			"phase='restore-prior-unit-states'",
			'restore_prior_unit_states',
			'cutover_sync_tree "$unit_dir"',
		],
		'staging activation and compatible restoration',
	)
	assertOrdered(
		stagingRecovery,
		[
			"phase='blocking-after-database-mutation'",
			'write_cutover_sentinel "$exit_status"',
			'quiesce_cutover_after_mutation',
			"phase='failed-after-database-mutation'",
		],
		'staging post-mutation failure',
	)
	assertOrdered(
		extractShellFunction(stagingDeploy, 'quiesce_cutover_after_mutation'),
		[
			'systemctl --user stop "${timer_units[@]}"',
			'systemctl --user stop "${service_units[@]}"',
			'acquire_writer_lifetime_lock_exclusive',
		],
		'staging post-failure lifetime drain',
	)
	assertOrdered(
		stagingRecovery,
		[
			'restore_original_unit_definitions',
			'release_writer_lifetime_lock',
			'restore_prior_unit_states',
			'cutover_remove_file_durable "$cutover_sentinel"',
			'cleanup_staging_release_artifacts "$commit"',
		],
		'staging pre-mutation definition/runtime restoration',
	)
	assert.doesNotMatch(
		stagingStop,
		/elif \[\[ -f "\$unit_state_file" \]\]; then\s+load_recorded_unit_states/,
		'orphaned pre-sentinel unit state must not be treated as an active cutover',
	)
	assertOrdered(
		stagingStop,
		[
			'if [[ -f "$cutover_sentinel" ]]; then',
			'load_cutover_sentinel_state',
			'load_recorded_unit_states',
			'rm -f "$unit_state_file"',
			'rm -rf "$state_dir"',
			'record_unit_states',
			"phase='stop-writers'",
		],
		'staging sentinel authority and orphan-state recovery',
	)
	assertOrdered(
		stagingComplete,
		[
			'cutover_remove_file_durable "$cutover_sentinel"',
			'deployment_succeeded=true',
			'cleanup_staging_release_artifacts "$commit"',
			'trap - EXIT',
		],
		'staging crash-safe completion publication',
	)
	assert.match(stagingTopLevel, /cutover_run_transition_driver staging/)

	const digest = fs.readFileSync(
		path.join(
			repositoryRoot,
			'ops/local-production/run-notification-digests.sh',
		),
		'utf8',
	)
	assert.match(digest, /notifications:digests -- --commit --limit 100(?:\s|$)/)
})

const catalogCutoverCommonSource = fs.readFileSync(catalogCutoverCommon, 'utf8')

function healthRequestScript(extra = '') {
	return `set -Eeuo pipefail
die() { printf 'ERROR: %s\\n' "$*" >&2; exit 1; }
${extractShellFunction(
	catalogCutoverCommonSource,
	'cutover_isolated_health_request',
)}
CUTOVER_CURL_BIN="\${CUTOVER_CURL_BIN:-/usr/bin/curl}"
CUTOVER_HEALTH_CONNECT_TIMEOUT_SECONDS=2
CUTOVER_HEALTH_MAX_TIME_SECONDS=5
${extra}
cutover_isolated_health_request "$1" "$2"`
}

test('isolated health requests ignore hostile proxy and curlrc state', () => {
	const root = temporaryRoot('isolated-health-request')
	const headers = path.join(root, 'headers.txt')
	const decoy = path.join(root, 'decoy.txt')
	const server = path.join(root, 'health-server.mjs')
	const release = 'a'.repeat(40)
	const port = 45871
	// A hostile ~/.curlrc that would redirect output and force a dead proxy.
	fs.writeFileSync(
		path.join(root, '.curlrc'),
		[`output = "${decoy}"`, 'proxy = "http://127.0.0.1:9"', ''].join('\n'),
	)
	fs.writeFileSync(
		server,
		[
			'import http from "node:http"',
			'const [release, port] = process.argv.slice(2)',
			'http',
			'\t.createServer((request, response) => {',
			'\t\tresponse.setHeader("x-veud-release", release)',
			'\t\tresponse.end("ok")',
			'\t})',
			'\t.listen(Number(port), "127.0.0.1")',
			'',
		].join('\n'),
	)
	const script = `set -Eeuo pipefail
die() { printf 'ERROR: %s\\n' "$*" >&2; exit 1; }
${extractShellFunction(
	catalogCutoverCommonSource,
	'cutover_isolated_health_request',
)}
CUTOVER_CURL_BIN=/usr/bin/curl
CUTOVER_HEALTH_CONNECT_TIMEOUT_SECONDS=2
CUTOVER_HEALTH_MAX_TIME_SECONDS=5
"$1" "$5" "$2" "$3" >/dev/null 2>&1 &
server_pid=$!
sleep 0.8
status=0
cutover_isolated_health_request "$4" "http://127.0.0.1:$3/resources/healthcheck" ||
	status=$?
kill "$server_pid" 2>/dev/null || true
wait "$server_pid" 2>/dev/null || true
exit "$status"`
	const result = runBash(script, {
		args: [node22, release, String(port), headers, server],
		env: {
			HOME: root,
			CURL_HOME: root,
			http_proxy: 'http://127.0.0.1:9',
			https_proxy: 'http://127.0.0.1:9',
			ALL_PROXY: 'socks5://127.0.0.1:9',
			all_proxy: 'socks5://127.0.0.1:9',
			NO_PROXY: '',
		},
	})
	// The hostile proxy must have been bypassed and the real service observed.
	assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
	assert.equal(fs.existsSync(decoy), false)
	const captured = fs.readFileSync(headers, 'utf8')
	assert.match(captured, /200 OK/)
	assert.ok(captured.toLowerCase().includes(`x-veud-release: ${release}`))
	// Every option must be recognised: no curl warnings.
	assert.ok(!/warning/i.test(result.stderr), result.stderr)
}, 20_000)

test('isolated health requests refuse non-loopback and non-http targets', () => {
	const root = temporaryRoot('isolated-health-target')
	const headers = path.join(root, 'headers.txt')
	const attempt = url =>
		runBash(healthRequestScript(), { args: [headers, url] }).status
	assert.notEqual(attempt('http://example.com/resources/healthcheck'), 0)
	assert.notEqual(attempt('https://127.0.0.1:4021/resources/healthcheck'), 0)
	assert.notEqual(attempt('file:///etc/passwd'), 0)
	assert.notEqual(attempt('http://127.0.0.1.evil.example/health'), 0)
	assert.notEqual(attempt('http://127.0.0.1:4021'), 0)
	assert.notEqual(attempt('http://127.0.0.1:0x50/resources/healthcheck'), 0)
	assert.notEqual(attempt('http://127.0.0.1:4021999999/health'), 0)
})

test('the loopback pin itself rejects userinfo that reaches a live server', () => {
	// The userinfo host must RESOLVE, otherwise curl fails on its own and the
	// assertion would pass even with the pin deleted. Pointing userinfo at a
	// live loopback server means only the pin can cause the rejection.
	const root = temporaryRoot('isolated-health-userinfo')
	const headers = path.join(root, 'headers.txt')
	const server = path.join(root, 'health-server.mjs')
	const port = 45873
	fs.writeFileSync(
		server,
		[
			'import http from "node:http"',
			'const [port] = process.argv.slice(2)',
			'http',
			'\t.createServer((request, response) => {',
			'\t\tresponse.setHeader("x-veud-release", "b".repeat(40))',
			'\t\tresponse.end("ok")',
			'\t})',
			'\t.listen(Number(port), "127.0.0.1")',
			'',
		].join('\n'),
	)
	const script = `set -Eeuo pipefail
die() { printf 'ERROR: %s\\n' "$*" >&2; exit 1; }
${extractShellFunction(
	catalogCutoverCommonSource,
	'cutover_isolated_health_request',
)}
CUTOVER_CURL_BIN=/usr/bin/curl
CUTOVER_HEALTH_CONNECT_TIMEOUT_SECONDS=2
CUTOVER_HEALTH_MAX_TIME_SECONDS=5
"$1" "$4" "$2" >/dev/null 2>&1 &
server_pid=$!
sleep 0.6
status=0
cutover_isolated_health_request "$3" "$5" || status=$?
kill "$server_pid" 2>/dev/null || true
wait "$server_pid" 2>/dev/null || true
exit "$status"`
	// Sanity: the plain loopback URL against this server must succeed, proving
	// the server is reachable and the rejection below is the pin's doing.
	const reachable = runBash(script, {
		args: [
			node22,
			String(port),
			headers,
			server,
			`http://127.0.0.1:${port}/resources/healthcheck`,
		],
	})
	assert.equal(reachable.status, 0, `${reachable.stdout}${reachable.stderr}`)

	// Same live server, reached through userinfo: curl would connect happily.
	const userinfo = runBash(script, {
		args: [
			node22,
			String(port),
			headers,
			server,
			`http://127.0.0.1:${port}@127.0.0.1:${port}/resources/healthcheck`,
		],
	})
	assert.notEqual(
		userinfo.status,
		0,
		'userinfo must be rejected by the loopback pin, not by curl',
	)
}, 20_000)

test('health request arguments are ordered, complete, and used everywhere', () => {
	const block = catalogCutoverCommonSource.slice(
		catalogCutoverCommonSource.indexOf('cutover_isolated_health_request() {'),
		catalogCutoverCommonSource.indexOf('cutover_health_headers_match() {'),
	)
	// --disable is only honoured as the very first curl argument.
	const disable = block.indexOf('--disable')
	assert.ok(disable > -1)
	for (const later of [
		'--noproxy',
		"--proto '=http'",
		"--proto-redir '-all'",
		'--max-redirs 0',
		'--connect-timeout',
		'--max-time',
		'--fail',
	]) {
		assert.ok(block.indexOf(later) > disable)
	}
	for (const cleared of [
		'-u http_proxy',
		'-u https_proxy',
		'-u ALL_PROXY',
		'-u NO_PROXY',
		'-u CURL_HOME',
	]) {
		assert.ok(String(block).includes(cleared))
	}
	assert.ok(String(block).includes('[[ -x "$CUTOVER_CURL_BIN" ]] || return 1'))
	for (const source of [productionDeploy, stagingDeploy]) {
		assert.ok(String(source).includes('cutover_isolated_health_request'))
		assert.ok(!String(source).includes('curl --fail --silent --show-error \\'))
	}
})

test('new private files publish atomically, privately, and never clobber', () => {
	const root = temporaryRoot('crash-safe-publish')
	const target = path.join(root, 'published.env')
	const script = `set -Eeuo pipefail
die() { printf 'ERROR: %s\\n' "$*" >&2; exit 1; }
${extractShellFunction(catalogCutoverCommonSource, 'cutover_new_private_temporary')}
${extractShellFunction(catalogCutoverCommonSource, 'cutover_publish_new_private_file')}
temporary="$(cutover_new_private_temporary "$1")"
# The temporary must already be private before any secret is written into it.
[[ "$(stat -c %a "$temporary")" == 600 ]] || die "temporary mode $(stat -c %a "$temporary")"
printf 'SECRET="value"\\n' >"$temporary"
cutover_publish_new_private_file "$temporary" "$2"
[[ ! -e "$temporary" ]] || die 'temporary survived publication'`
	const first = runBash(script, { args: [root, target] })
	assert.equal(first.status, 0, `${first.stdout}${first.stderr}`)
	assert.equal(fs.readFileSync(target, 'utf8'), 'SECRET="value"\n')
	assert.equal(fs.statSync(target).mode & 0o777, 0o600)

	// A second publication must refuse to clobber the established file.
	const second = runBash(script, { args: [root, target] })
	assert.notEqual(second.status, 0)
	assert.match(second.stderr, /Refusing to clobber/)
	assert.equal(fs.readFileSync(target, 'utf8'), 'SECRET="value"\n')

	// Empty and symlink sources are refused.
	const symlinkTarget = path.join(root, 'via-symlink.env')
	const decoy = path.join(root, 'decoy.env')
	fs.writeFileSync(decoy, 'x\n')
	fs.symlinkSync(decoy, symlinkTarget)
	const symlinked = runBash(
		`set -Eeuo pipefail
die() { printf 'ERROR: %s\\n' "$*" >&2; exit 1; }
${extractShellFunction(catalogCutoverCommonSource, 'cutover_publish_new_private_file')}
cutover_publish_new_private_file "$1" "$2"`,
		{ args: [decoy, symlinkTarget] },
	)
	assert.notEqual(symlinked.status, 0)
})

test('provisioning publishes every generated secret crash-safely', () => {
	for (const source of [stagingProvision, productionProvision]) {
		assert.ok(source.includes('cutover_new_private_temporary'))
		assert.ok(source.includes('cutover_publish_new_private_file'))
		// No generated configuration may be written straight to its final path.
		assert.ok(!/^\s*\} >"\$PRODUCTION_CONFIG_FILE"$/m.test(source))
		assert.ok(!/^\s*cat >"\$APPLICATION_CONFIG_FILE"/m.test(source))
		assert.ok(!/^\s*cat >"\$CONFIG_FILE"/m.test(source))
		assert.ok(!/^\s*cat >"\$ADMIN_CONFIG_FILE"/m.test(source))
	}
	// Exact published contracts are validated before publication.
	assert.ok(
		productionProvision.includes(
			'Production configuration DATABASE_URL is not the exact expected form',
		),
	)
	assert.ok(stagingProvision.includes('is not an exact 32-byte hex secret'))
})

test('staging PGDATA initialization is crash resumable and fails closed', () => {
	// Initialization happens in a sibling directory and is published by one
	// rename after a synced completion marker.
	assert.ok(stagingProvision.includes('pgdata_staging="$PGDATA.initializing"'))
	const markerWrite = stagingProvision.indexOf(
		'>"$pgdata_staging/veud-managed-cluster.marker"',
	)
	const syncTree = stagingProvision.indexOf(
		'cutover_sync_tree "$pgdata_staging"',
	)
	const publish = stagingProvision.indexOf('mv "$pgdata_staging" "$PGDATA"')
	assert.ok(markerWrite > -1)
	assert.ok(syncTree > markerWrite)
	assert.ok(publish > syncTree)
	assert.ok(
		stagingProvision.indexOf('cutover_sync_path_and_parent "$PGDATA"') >
			publish,
	)
	// An interrupted attempt (no PG_VERSION) is discarded, never adopted — but
	// only when it is empty. Unattested CONTENT must never be destroyed.
	assert.ok(stagingProvision.includes('rmdir "$PGDATA" 2>/dev/null ||'))
	assert.ok(
		stagingProvision.includes(
			'Refusing to discard a non-empty unattested staging PGDATA',
		),
	)
	assert.ok(
		!stagingProvision.includes('cutover_remove_tree_durable "$PGDATA"'),
		'a bare rm -rf of PGDATA must never be reachable',
	)
	// Unknown established data fails closed rather than being rewritten.
	assert.ok(stagingProvision.includes('refusing to rewrite unknown data'))
	assert.ok(
		stagingProvision.includes(
			'Existing staging PGDATA marker does not attest the exact managed configuration',
		),
	)
})

test('staging unit publication preflights everything before replacing any unit', () => {
	const preflight = stagingProvision.indexOf(
		'managed_units=(veud-staging-postgres.service',
	)
	const immutability = stagingProvision.indexOf(
		'Provisioning refuses to replace immutable active unit',
	)
	const publishPostgres = stagingProvision.indexOf(
		'publish_managed_unit \\\n\t"$REPO_ROOT/ops/local-staging/systemd/veud-staging-postgres.service"',
	)
	assert.ok(preflight > -1, 'missing managed unit preflight')
	assert.ok(
		immutability > preflight,
		'immutability check must follow preflight',
	)
	assert.ok(
		publishPostgres > immutability,
		'the PostgreSQL unit must be published only after every preflight',
	)
	// The old ordering installed the PostgreSQL unit before any preflight.
	assert.ok(
		!stagingProvision.includes(
			'install -m 600 "$REPO_ROOT/ops/local-staging/systemd/veud-staging-postgres.service"',
		),
	)
	// Drop-ins and non-regular targets are rejected for every managed unit.
	assert.ok(
		stagingProvision.includes(
			'Systemd drop-ins are forbidden for managed staging unit',
		),
	)
	assert.ok(
		stagingProvision.includes(
			'Managed staging systemd unit target is not a regular file',
		),
	)
})

test('managed units are published atomically and synced', () => {
	const block = stagingProvision.slice(
		stagingProvision.indexOf('publish_managed_unit() {'),
		stagingProvision.indexOf('publish_managed_unit \\'),
	)
	assert.ok(block.includes('umask 077 && mktemp "$unit_dir/.veud-unit.'))
	assert.ok(block.includes('chmod 600 "$temporary"'))
	const sync = block.indexOf('sync -f "$temporary"')
	const rename = block.indexOf('mv -f "$temporary" "$unit_dir/$unit"')
	assert.ok(sync > -1 && rename > sync, 'must flush before renaming')
	assert.ok(
		block.indexOf('cutover_sync_path_and_parent "$unit_dir/$unit"') > rename,
	)
	// install(1) writes in place and can leave a partial unit behind.
	assert.ok(
		!/install -m 600 \\\n\t*"\$REPO_ROOT\/ops\/local-staging\/systemd\/\$unit"/.test(
			stagingProvision,
		),
	)
})
