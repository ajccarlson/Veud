import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, test } from 'vitest'

const repositoryRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'..',
)
const productionCommon = path.join(
	repositoryRoot,
	'ops/local-production/common.sh',
)
const stagingCommon = path.join(repositoryRoot, 'ops/local-staging/common.sh')
const temporaryRoots = []
const fixturePassword = 'fixture-secret'

const node22 = [
	process.env.VEUD_STAGING_NODE_BIN,
	path.join(os.homedir(), '.nvm/versions/node/v22.23.1/bin/node'),
	process.execPath,
].find(candidate => {
	if (!candidate || !fs.existsSync(candidate)) return false
	const result = spawnSync(candidate, ['--version'], { encoding: 'utf8' })
	return result.status === 0 && result.stdout.startsWith('v22.')
})

expect(node22).toBeTruthy()

const roles = [
	{
		label: 'Production application datasource',
		user: 'veud_production_app',
		database: 'veud_production',
	},
	{
		label: 'Production restore datasource',
		user: 'veud_production_restore',
		database: 'veud_production_restore',
	},
	{
		label: 'Staging application datasource',
		user: 'veud_staging_app',
		database: 'veud_staging',
	},
	{
		label: 'Staging load datasource',
		user: 'veud_staging_load',
		database: 'veud_staging_load',
	},
	{
		label: 'Staging restore datasource',
		user: 'veud_staging_restore',
		database: 'veud_staging_restore',
	},
]

const wrappers = [
	{
		path: 'ops/local-production/run-app.sh',
		load: 'load_production_worker_environment',
		assertion: 'assert_production_application_database_identity',
		lock: 'acquire_production_writer_lifetime_lock_shared',
		invalid: fixture => {
			const invalid = fixture.productionSource.replace(
				'postgresql:',
				'postgres:',
			)
			fixture.productionSource = invalid
			fixture.productionApplication = invalid
		},
	},
	{
		path: 'ops/local-production/run-backup.sh',
		load: 'load_production_worker_environment',
		assertion: 'assert_production_backup_database_identities',
		lock: 'acquire_production_writer_lifetime_lock_shared',
		invalid: fixture => {
			fixture.productionRestore = fixture.productionRestore.replace(
				'veud_production_restore:',
				'veud_production_app:',
			)
		},
	},
	{
		path: 'ops/local-staging/run-app.sh',
		load: 'load_application_environment',
		assertion: 'assert_staging_application_database_identity',
		lock: 'acquire_staging_writer_lifetime_lock_shared',
		invalid: fixture => {
			fixture.stagingApplication = fixture.stagingApplication.replace(
				'127.0.0.1',
				'localhost',
			)
		},
	},
	{
		path: 'ops/local-staging/run-backup.sh',
		load: 'load_staging_environment',
		assertion: 'assert_staging_operations_database_identities',
		lock: 'acquire_staging_writer_lifetime_lock_shared',
		invalid: fixture => {
			fixture.stagingRestore += '&sslmode=disable'
		},
	},
	{
		path: 'ops/local-staging/run-load-backup.sh',
		load: 'load_staging_environment',
		assertion: 'assert_staging_operations_database_identities',
		lock: 'acquire_staging_writer_lifetime_lock_shared',
		invalid: fixture => {
			fixture.stagingLoad = fixture.stagingLoad.replace(
				'veud_staging_load:',
				'veud_staging_app:',
			)
		},
	},
	...[
		'run-mal-hydration.sh',
		'run-mal-inventory.sh',
		'run-mal-trending.sh',
		'run-tmdb-hydration.sh',
	].map(filename => ({
		path: `ops/local-staging/${filename}`,
		load: 'load_staging_environment',
		assertion: 'assert_staging_application_operations_database_identities',
		lock: 'acquire_staging_writer_lifetime_lock_shared',
		invalid: fixture => {
			fixture.stagingOperations = fixture.stagingOperations.replace(
				fixturePassword,
				`${fixturePassword}-different`,
			)
		},
	})),
	{
		path: 'ops/local-staging/run-notification-digests.sh',
		load: 'load_application_environment',
		assertion: 'assert_staging_application_database_identity',
		lock: 'acquire_staging_writer_lifetime_lock_shared',
		invalid: fixture => {
			fixture.stagingApplication = fixture.stagingApplication.replace(
				'?schema=public',
				'?schema=public&schema=public',
			)
		},
	},
	{
		path: 'ops/local-staging/run-tmdb-inventory.sh',
		load: 'load_staging_environment',
		assertion: 'assert_staging_operations_database_identities',
		lock: 'acquire_staging_writer_lifetime_lock_shared',
		invalid: fixture => {
			fixture.stagingLoad = fixture.stagingLoad.replace(
				'/veud_staging_load?',
				'/veud_staging?',
			)
		},
	},
]

afterEach(() => {
	for (const root of temporaryRoots.splice(0)) {
		fs.rmSync(root, { force: true, recursive: true })
	}
})

function databaseUrl(user, database) {
	return `postgresql://${user}:${fixturePassword}@127.0.0.1:5433/${database}?schema=public`
}

function runDatasourceAssertion(role, url) {
	return spawnSync(
		'/bin/bash',
		[
			'-c',
			[
				'source "$1"',
				'verify_node_22',
				'assert_runtime_postgresql_datasource "$2" "$TEST_DATABASE_URL" "$3" "$4"',
			].join('; '),
			'datasource-test',
			stagingCommon,
			role.label,
			role.user,
			role.database,
		],
		{
			encoding: 'utf8',
			env: {
				...process.env,
				TEST_DATABASE_URL: url,
				VEUD_STAGING_NODE_BIN: node22,
				VEUD_STAGING_NPM_BIN: node22,
			},
		},
	)
}

function writeExecutable(file, source) {
	fs.writeFileSync(file, source, { mode: 0o700 })
}

function createFixture() {
	const root = fs.mkdtempSync(
		path.join(os.tmpdir(), 'veud-runtime-datasource-'),
	)
	temporaryRoots.push(root)
	const live = path.join(root, 'live')
	const backup = path.join(root, 'backup')
	const production = path.join(live, 'production')
	const staging = path.join(live, 'staging')
	const fakeBin = path.join(root, 'bin')
	const lockReached = path.join(root, 'lock-reached')
	for (const directory of [
		live,
		backup,
		path.join(production, 'config'),
		path.join(staging, 'config'),
		fakeBin,
	]) {
		fs.mkdirSync(directory, { recursive: true })
	}

	writeExecutable(
		path.join(fakeBin, 'findmnt'),
		`#!/usr/bin/env bash
set -eu
target=''
field=''
while [[ "$#" -gt 0 ]]; do
	case "$1" in
	-M) target="$2"; shift 2 ;;
	-o) field="$2"; shift 2 ;;
	*) shift ;;
	esac
done
case "$field" in
TARGET) printf '%s\\n' "$target" ;;
OPTIONS) printf 'rw\\n' ;;
*) exit 2 ;;
esac
`,
	)
	writeExecutable(
		path.join(fakeBin, 'df'),
		`#!/usr/bin/env bash
printf 'Filesystem 1024-blocks Used Available Capacity Mounted-on\\n'
printf 'fixture 300000000 1 299999999 1%% %s\\n' "\${*: -1}"
`,
	)
	writeExecutable(
		path.join(fakeBin, 'stat'),
		`#!/usr/bin/env bash
case "\${*: -1}" in
"$VEUD_STAGING_BACKUP_MOUNT") printf '2\\n' ;;
*) printf '1\\n' ;;
esac
`,
	)
	writeExecutable(
		path.join(fakeBin, 'flock'),
		`#!/usr/bin/env bash
: >"$LOCK_REACHED_FILE"
exit 93
`,
	)

	return {
		root,
		live,
		backup,
		production,
		staging,
		fakeBin,
		lockReached,
		productionSource: databaseUrl('veud_production_app', 'veud_production'),
		productionApplication: databaseUrl(
			'veud_production_app',
			'veud_production',
		),
		productionRestore: databaseUrl(
			'veud_production_restore',
			'veud_production_restore',
		),
		stagingApplication: databaseUrl('veud_staging_app', 'veud_staging'),
		stagingOperations: databaseUrl('veud_staging_app', 'veud_staging'),
		stagingLoad: databaseUrl('veud_staging_load', 'veud_staging_load'),
		stagingRestore: databaseUrl('veud_staging_restore', 'veud_staging_restore'),
	}
}

function writeEnvironment(file, values) {
	fs.writeFileSync(
		file,
		Object.entries(values)
			.map(([name, value]) => `${name}=${JSON.stringify(value)}`)
			.join('\n') + '\n',
		{ mode: 0o600 },
	)
}

function writeFixtureConfiguration(fixture) {
	writeEnvironment(path.join(fixture.production, 'config/application.env'), {
		DATABASE_URL: fixture.productionApplication,
	})
	writeEnvironment(path.join(fixture.production, 'config/postgres.env'), {
		DATABASE_URL: fixture.productionSource,
		POSTGRES_BACKUP_VERIFY_URL: fixture.productionRestore,
	})
	writeEnvironment(path.join(fixture.staging, 'config/application.env'), {
		DATABASE_URL: fixture.stagingApplication,
		MAL_CATALOG_POLICY_APPROVAL_REF: 'fixture-approval',
		MAL_CLIENT_ID: 'fixture-client',
		RESEND_API_KEY: 'fixture-resend',
		TMDB_API_KEY: 'fixture-tmdb',
	})
	writeEnvironment(path.join(fixture.staging, 'config/operations.env'), {
		DATABASE_URL: fixture.stagingOperations,
		POSTGRES_BACKUP_VERIFY_URL: fixture.stagingRestore,
		STAGING_LOAD_DATABASE_URL: fixture.stagingLoad,
	})
}

function runWrapper(wrapper, fixture) {
	writeFixtureConfiguration(fixture)
	return spawnSync('/bin/bash', [path.join(repositoryRoot, wrapper.path)], {
		encoding: 'utf8',
		env: {
			...process.env,
			LOCK_REACHED_FILE: fixture.lockReached,
			PATH: `${fixture.fakeBin}:/usr/local/bin:/usr/bin:/bin`,
			VEUD_PRODUCTION_ROOT: fixture.production,
			VEUD_STAGING_BACKUP_MOUNT: fixture.backup,
			VEUD_STAGING_LIVE_MOUNT: fixture.live,
			VEUD_STAGING_NODE_BIN: node22,
			VEUD_STAGING_NPM_BIN: node22,
			VEUD_STAGING_ROOT: fixture.staging,
		},
	})
}

test('accepts only exact role-specific local PostgreSQL datasource URLs', () => {
	for (const role of roles) {
		const valid = databaseUrl(role.user, role.database)
		expect(runDatasourceAssertion(role, valid).status, role.label).toBe(0)

		const invalidUrls = [
			valid.replace('postgresql:', 'postgres:'),
			valid.replace('postgresql:', 'POSTGRESQL:'),
			` ${valid}`,
			valid.replace(`${role.user}:`, `wrong_${role.user}:`),
			valid.replace(`:${fixturePassword}@`, '@'),
			valid.replace('127.0.0.1', 'localhost'),
			valid.replace('127.0.0.1', '127.000.000.001'),
			valid.replace(':5433/', ':5432/'),
			valid.replace(':5433/', ':05433/'),
			valid.replace(`/${role.database}?`, '/wrong_database?'),
			valid.replace('?schema=public', ''),
			valid.replace('schema=public', 'schema=private'),
			`${valid}&schema=public`,
			`${valid}&sslmode=disable`,
			`${valid}#fragment`,
			`${valid}&`,
		]
		for (const invalid of invalidUrls) {
			const result = runDatasourceAssertion(role, invalid)
			expect(result.status, `${role.label}: ${invalid}`).not.toBe(0)
			expect(result.stderr).toContain(
				'does not match the required local PostgreSQL identity',
			)
			expect(result.stderr).not.toContain(invalid)
			expect(result.stderr).not.toContain(fixturePassword)
		}
	}
})

test('requires byte-identical application and operations datasource values', () => {
	const url = databaseUrl('veud_staging_app', 'veud_staging')
	const result = spawnSync(
		'/bin/bash',
		[
			'-c',
			[
				'source "$1"',
				'assert_runtime_datasource_parity Staging "$FIRST_URL" "$SECOND_URL"',
			].join('; '),
			'datasource-test',
			stagingCommon,
		],
		{
			encoding: 'utf8',
			env: {
				...process.env,
				FIRST_URL: url,
				SECOND_URL: url.replace(fixturePassword, 'different-secret'),
			},
		},
	)
	expect(result.status).not.toBe(0)
	expect(result.stderr).toContain(
		'application and operations datasource configurations differ',
	)
	expect(result.stderr).not.toContain(fixturePassword)
	expect(result.stderr).not.toContain('different-secret')
})

test('emergency cutover markers block every launcher role without parsing content', () => {
	const cases = [
		{
			common: productionCommon,
			environment: 'VEUD_PRODUCTION_ROOT',
			guard: 'assert_production_catalog_cutover_role',
			marker: 'catalog-release-emergency-block.state',
			roles: ['app', 'backup', 'writer'],
		},
		{
			common: stagingCommon,
			environment: 'VEUD_STAGING_ROOT',
			guard: 'assert_staging_catalog_cutover_role',
			marker: 'provenance-cutover-emergency-block',
			roles: ['app', 'backup', 'load-backup', 'writer'],
		},
	]
	for (const fixtureCase of cases) {
		for (const content of [
			'malformed emergency state\n',
			'format=1\nenvironment=expected\nphase=blocked\n',
		]) {
			for (const role of fixtureCase.roles) {
				const root = fs.mkdtempSync(
					path.join(os.tmpdir(), 'veud-emergency-datasource-'),
				)
				temporaryRoots.push(root)
				fs.mkdirSync(path.join(root, 'run'), { recursive: true })
				fs.writeFileSync(path.join(root, 'run', fixtureCase.marker), content, {
					mode: 0o600,
				})
				const result = spawnSync(
					'/bin/bash',
					[
						'-c',
						'source "$1"; "$2" "$3"',
						'emergency-test',
						fixtureCase.common,
						fixtureCase.guard,
						role,
					],
					{
						encoding: 'utf8',
						env: {
							...process.env,
							[fixtureCase.environment]: root,
						},
					},
				)
				expect(result.status, `${fixtureCase.guard}:${role}`).not.toBe(0)
				expect(result.stderr).toContain(
					'blocked by emergency catalog maintenance state',
				)
				expect(result.stderr).not.toContain(content.trim())
			}
		}
	}
})

test('maintenance authority paths fail closed for every non-regular or symlink form', () => {
	const cases = [
		{
			common: productionCommon,
			environment: 'VEUD_PRODUCTION_ROOT',
			guard: 'assert_production_catalog_cutover_role',
			marker: 'catalog-release-maintenance.state',
			role: 'app',
		},
		{
			common: stagingCommon,
			environment: 'VEUD_STAGING_ROOT',
			guard: 'assert_staging_catalog_cutover_role',
			marker: 'provenance-cutover-incomplete',
			role: 'app',
		},
	]
	for (const fixtureCase of cases) {
		for (const kind of ['directory', 'dangling-symlink', 'regular-symlink']) {
			const root = fs.mkdtempSync(
				path.join(os.tmpdir(), 'veud-malformed-maintenance-'),
			)
			temporaryRoots.push(root)
			const run = path.join(root, 'run')
			const marker = path.join(run, fixtureCase.marker)
			fs.mkdirSync(run, { recursive: true })
			if (kind === 'directory') {
				fs.mkdirSync(marker)
			} else if (kind === 'dangling-symlink') {
				fs.symlinkSync(path.join(root, 'missing'), marker)
			} else {
				const target = path.join(root, 'marker-target')
				fs.writeFileSync(target, 'format=2\n', { mode: 0o600 })
				fs.symlinkSync(target, marker)
			}
			const result = spawnSync(
				'/bin/bash',
				[
					'-c',
					'source "$1"; "$2" "$3"',
					'maintenance-path-test',
					fixtureCase.common,
					fixtureCase.guard,
					fixtureCase.role,
				],
				{
					encoding: 'utf8',
					env: {
						...process.env,
						[fixtureCase.environment]: root,
					},
				},
			)
			expect(result.status, `${fixtureCase.guard}:${kind}`).not.toBe(0)
			expect(result.stderr).toContain('not a regular non-symlink file')
		}
	}
})

test('every launcher validates sourced configuration before its lifetime lock', () => {
	for (const wrapper of wrappers) {
		const source = fs.readFileSync(
			path.join(repositoryRoot, wrapper.path),
			'utf8',
		)
		const loadIndex = source.lastIndexOf(wrapper.load)
		const assertionIndex = source.indexOf(wrapper.assertion)
		const lockIndex = source.indexOf(wrapper.lock)
		expect(loadIndex, `${wrapper.path} loads configuration`).toBeGreaterThan(-1)
		expect(
			assertionIndex,
			`${wrapper.path} validates its datasource`,
		).toBeGreaterThan(loadIndex)
		expect(
			lockIndex,
			`${wrapper.path} validates before locking`,
		).toBeGreaterThan(assertionIndex)
	}

	const productionSource = fs.readFileSync(productionCommon, 'utf8')
	const prepareWorker = productionSource.slice(
		productionSource.indexOf('prepare_worker() {'),
		productionSource.indexOf(
			'\n}\n\nacquire_provider_lock()',
			productionSource.indexOf('prepare_worker() {'),
		),
	)
	expect(
		prepareWorker.indexOf('load_production_worker_environment'),
	).toBeLessThan(
		prepareWorker.indexOf('assert_production_application_database_identity'),
	)
	expect(
		prepareWorker.indexOf('assert_production_application_database_identity'),
	).toBeLessThan(
		prepareWorker.indexOf('acquire_production_writer_lifetime_lock_shared'),
	)
})

test('wrong launcher datasource configurations fail before any lifetime lock', () => {
	for (const wrapper of wrappers) {
		const fixture = createFixture()
		wrapper.invalid(fixture)
		const result = runWrapper(wrapper, fixture)
		expect(result.status, `${wrapper.path}: ${result.stderr}`).not.toBe(0)
		expect(fs.existsSync(fixture.lockReached), wrapper.path).toBe(false)
		expect(result.stderr).not.toContain(fixturePassword)
	}
})

test('valid launcher datasource configurations reach the lifetime lock', () => {
	for (const wrapper of wrappers) {
		const fixture = createFixture()
		const result = runWrapper(wrapper, fixture)
		expect(result.status, `${wrapper.path}: ${result.stderr}`).toBe(93)
		expect(fs.existsSync(fixture.lockReached), wrapper.path).toBe(true)
	}
})
