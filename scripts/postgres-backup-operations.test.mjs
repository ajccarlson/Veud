import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import {
	DEFAULT_POSTGRES_BACKUP_SOURCE_POLICY,
	POSTGRES_BACKUP_CLIENT_VERSION,
	POSTGRES_BACKUP_SERVER_VERSION_NUM,
	PRISTINE_EMPTY_POSTGRES_SOURCE_POLICY,
	PRISTINE_EMPTY_POSTGRES_SUMMARY,
	assertDistinctPostgresEndpointIdentities,
	assertMigrationParity,
	assertPostgresEndpointIdentityUnchanged,
	assertPristinePostgresRestoreParity,
	assertPristinePostgresFingerprint,
	assertTrustedPostgresTemplateFingerprint,
	parsePostgresBackupSourcePolicy,
	parsePostgresClientVersion,
	parsePostgresEndpointIdentity,
	parsePristinePostgresFingerprint,
	pinPostgresConnectionToEndpoint,
	postgresClientExecutionOptions,
	postgresEndpointIdentityQuery,
	postgresRestoreSqlArguments,
	postgresRestoreResetAssertionQuery,
	postgresVerificationScriptArguments,
	pristineFingerprintQuery,
	sanitizedPostgresClientEnvironment,
	verificationQuery,
} from './postgres-backup-operations.mjs'

const pristineFingerprint = {
	database: 'veud_pristine',
	sessionUser: 'veud_pristine_owner',
	currentUser: 'veud_pristine_owner',
	serverVersionNum: 160014,
	databaseOwner: 'veud_pristine_owner',
	ownerRoleSuperuser: false,
	ownerRoleInherit: true,
	ownerRoleCreateRole: false,
	ownerRoleCreateDatabase: false,
	ownerRoleCanLogin: true,
	ownerRoleReplication: false,
	ownerRoleBypassRls: false,
	ownerRoleConnectionLimit: -1,
	ownerRoleValidUntil: null,
	ownerRoleConfigIsNull: true,
	ownerRoleCommentPresent: false,
	databaseEncoding: 'UTF8',
	databaseCollate: 'en_US.UTF-8',
	databaseCtype: 'en_US.UTF-8',
	databaseLocaleProvider: 'c',
	databaseIcuLocale: null,
	databaseIcuRules: null,
	databaseCollationVersion: '2.36',
	databaseTablespace: 'pg_default',
	databaseIsTemplate: false,
	databaseAllowsConnections: true,
	databaseConnectionLimit: -1,
	databaseComment: null,
	publicSchemaOwner: 'pg_database_owner',
	publicSchemaComment: 'standard public schema',
	plpgsqlExtensionOwner: 'postgres',
	plpgsqlExtensionVersion: '1.0',
	plpgsqlExtensionSchema: 'pg_catalog',
	plpgsqlExtensionRelocatable: false,
	plpgsqlExtensionCommentIsDefault: true,
	plpgsqlLanguageOwner: 'postgres',
	plpgsqlLanguageTrusted: true,
	plpgsqlLanguageCommentIsDefault: true,
	plpgsqlOwnerSuperuser: true,
	plpgsqlRoutineOwnersMatch: true,
	plpgsqlRoutineDefinitionSignature:
		'0ede0d146cffe3bca2df4f23512a3ff729f1a0b8b9445465b8454cdc585d47ab',
	publicSchemas: 1,
	userSchemasBeyondPublic: 0,
	customRelations: 0,
	customRoutines: 0,
	customTypes: 0,
	customCollations: 0,
	customConversions: 0,
	customTextSearchParsers: 0,
	customTextSearchDictionaries: 0,
	customTextSearchTemplates: 0,
	customTextSearchConfigurations: 0,
	customOperators: 0,
	customOperatorClasses: 0,
	customOperatorFamilies: 0,
	customStatistics: 0,
	plpgsqlExtensions: 1,
	plpgsqlLanguages: 1,
	customExtensions: 0,
	foreignDataWrappers: 0,
	foreignServers: 0,
	foreignUserMappings: 0,
	eventTriggers: 0,
	largeObjects: 0,
	publications: 0,
	subscriptions: 0,
	customComments: 0,
	customSecurityLabels: 0,
	databaseDefaultAcls: 0,
	databaseSettings: 0,
	ownerRoleMemberships: 0,
	ownerRoleGrantedMemberships: 0,
	ownerRoleSettings: 0,
	ownerRoleSecurityLabels: 0,
	otherDatabaseSessions: 0,
	preparedTransactions: 0,
	retainedSystemObjects: 8655,
	retainedSystemAclDrift: 0,
	informationSchemaAclDrift: 0,
	retainedSystemObjectsDigest:
		'9c54cbb512192e7ea9093e74c697bc28124a3d57a526281eb90bd24ae9a3a23d',
	retainedSystemDefinitionsDigest:
		'28a526a9cb48b4a802016826b2b8addfbe400bac8fc6abe362d95afefa87202c',
	retainedSystemCommentsDigest:
		'81aa024e0700769bb7926b75c67697c223bdb26d8b34bef7ae0c0ca33a16626c',
	retainedSystemSecurityLabels: 0,
	plpgsqlRoutineComments: 0,
	parameterAcls: 0,
	prismaMigrations: 0,
	sessionCanCreateDatabaseObjects: true,
	sessionCanCreatePgCatalogObjects: false,
	sessionCanCreateInformationSchemaObjects: false,
	sessionCanCreatePublicSchemaObjects: true,
	sessionIsDatabaseOwnerMember: true,
	databaseAclIsNull: false,
	databaseAclPrivileges: 4,
	databasePublicCreatePrivileges: 0,
	databasePublicConnectPrivileges: 0,
	databasePublicTemporaryPrivileges: 1,
	databaseOwnerCreatePrivileges: 1,
	databaseOwnerConnectPrivileges: 1,
	databaseOwnerTemporaryPrivileges: 1,
	databaseOtherPrivileges: 0,
	databaseGrantOptions: 0,
	databaseUnexpectedAclGrantors: 0,
	publicSchemaAclIsNull: false,
	publicSchemaAclPrivileges: 3,
	publicSchemaOwnerCreatePrivileges: 1,
	publicSchemaOwnerUsagePrivileges: 1,
	publicSchemaPublicCreatePrivileges: 0,
	publicSchemaPublicUsagePrivileges: 1,
	publicSchemaOtherPrivileges: 0,
	publicSchemaGrantOptions: 0,
	publicSchemaUnexpectedAclGrantors: 0,
}

const restoredPristineFingerprint = {
	...pristineFingerprint,
	database: 'veud_pristine_restore',
	sessionUser: 'veud_pristine_restore_owner',
	currentUser: 'veud_pristine_restore_owner',
	databaseOwner: 'veud_pristine_restore_owner',
	publicSchemaOwner: 'veud_pristine_restore_owner',
	publicSchemaComment: null,
	publicSchemaAclIsNull: true,
	publicSchemaAclPrivileges: 2,
	publicSchemaPublicUsagePrivileges: 0,
}

const pristineTemplateBaseline = {
	...pristineFingerprint,
	database: 'template1',
}

const trustedTemplateFingerprint = {
	...pristineFingerprint,
	database: 'template1',
	databaseOwner: 'postgres',
	databaseIsTemplate: true,
	ownerRoleSuperuser: true,
	sessionCanCreateDatabaseObjects: false,
	sessionCanCreatePublicSchemaObjects: false,
	sessionIsDatabaseOwnerMember: false,
}

function assertTestPristine(
	fingerprint,
	label,
	expectedConnection,
	mode = 'source',
) {
	return assertPristinePostgresFingerprint(
		fingerprint,
		label,
		expectedConnection,
		mode,
		pristineTemplateBaseline,
	)
}

describe('PostgreSQL backup migration parity', () => {
	test('accepts a restore that exactly matches its source database', () => {
		expect(() =>
			assertMigrationParity(
				['migration-1', 'migration-2'],
				['migration-1', 'migration-2'],
			),
		).not.toThrow()
	})

	test('accepts a source that intentionally predates the current checkout', () => {
		expect(() =>
			assertMigrationParity(['migration-1'], ['migration-1']),
		).not.toThrow()
	})

	test('rejects a restore that omitted a source migration', () => {
		expect(() =>
			assertMigrationParity(['migration-1', 'migration-2'], ['migration-1']),
		).toThrow('missing from restore: migration-2')
	})

	test('rejects migration history that was not present in the source', () => {
		expect(() =>
			assertMigrationParity(
				['migration-1'],
				['migration-1', 'migration-unexpected'],
			),
		).toThrow('not present in source: migration-unexpected')
	})
})

describe('PostgreSQL backup source policy', () => {
	test('defaults to migrated Veud verification for existing callers', () => {
		expect(parsePostgresBackupSourcePolicy()).toBe(
			DEFAULT_POSTGRES_BACKUP_SOURCE_POLICY,
		)
		expect(parsePostgresBackupSourcePolicy('   ')).toBe(
			DEFAULT_POSTGRES_BACKUP_SOURCE_POLICY,
		)
	})

	test('accepts only the two versioned source policies', () => {
		expect(
			parsePostgresBackupSourcePolicy(
				` ${PRISTINE_EMPTY_POSTGRES_SOURCE_POLICY} `,
			),
		).toBe(PRISTINE_EMPTY_POSTGRES_SOURCE_POLICY)
		expect(() => parsePostgresBackupSourcePolicy('pristine-empty')).toThrow(
			'BACKUP_SOURCE_POLICY must be migrated-veud-v1 or pristine-empty-v1',
		)
	})
})

describe('PostgreSQL client and destructive-target identity', () => {
	const sourceIdentity = {
		database: 'veud_source',
		databaseOid: '16384',
		serverAddress: '127.0.0.1',
		serverPort: 5433,
		postmasterStartedAt: '1750000000000000',
		serverVersionNum: POSTGRES_BACKUP_SERVER_VERSION_NUM,
		otherDatabaseSessions: 2,
		otherDatabaseSessionDetail: '4001 idle backup; 4002 active backup',
		preparedTransactions: 0,
	}
	const restoreIdentity = {
		...sourceIdentity,
		database: 'veud_restore',
		databaseOid: '16385',
		otherDatabaseSessions: 0,
		otherDatabaseSessionDetail: '',
	}

	test('requires the exact PostgreSQL 16.14 client contract', () => {
		expect(
			parsePostgresClientVersion(
				'psql (PostgreSQL) 16.14 (Debian 16.14-1)',
				'psql',
			),
		).toBe(POSTGRES_BACKUP_CLIENT_VERSION)
		expect(() =>
			parsePostgresClientVersion('psql (PostgreSQL) 16.13', 'psql'),
		).toThrow('psql must be PostgreSQL 16.14')
		expect(() => parsePostgresClientVersion('unknown', 'psql')).toThrow(
			'Could not determine psql version',
		)
	})

	test('sanitizes ambient libpq controls without exposing connection secrets', () => {
		const environment = sanitizedPostgresClientEnvironment(
			{
				host: 'db.example',
				port: '5433',
				user: 'owner',
				password: 'synthetic-password',
				database: 'catalog',
			},
			{
				PATH: '/usr/bin',
				PGHOSTADDR: 'attacker.example',
				PGOPTIONS: '-c role=postgres',
				PGSERVICE: 'ambient-service',
				PGPASSWORD: 'ambient-password',
			},
		)
		expect(environment).toMatchObject({
			PATH: '/usr/bin',
			PGHOST: 'db.example',
			PGPORT: '5433',
			PGUSER: 'owner',
			PGPASSWORD: 'synthetic-password',
			PGDATABASE: 'catalog',
			PGAPPNAME: 'veud-backup-verifier',
			PGCONNECT_TIMEOUT: '10',
			PGOPTIONS: '-c search_path=pg_catalog',
		})
		expect(environment).not.toHaveProperty('PGHOSTADDR')
		expect(environment).not.toHaveProperty('PGSERVICE')

		const execution = postgresClientExecutionOptions(
			{
				host: 'db.example',
				port: '5432',
				user: 'veud',
				password: 'synthetic-password',
				database: 'veud',
			},
			{
				PATH: '/usr/bin',
				PGSERVICE: 'ambient-service',
			},
		)
		expect(execution.extendEnv).toBe(false)
		expect(execution.env).toMatchObject({
			PATH: '/usr/bin',
			PGHOST: 'db.example',
			PGPORT: '5432',
			PGUSER: 'veud',
			PGPASSWORD: 'synthetic-password',
			PGDATABASE: 'veud',
		})
		expect(execution.env).not.toHaveProperty('PGSERVICE')

		const pinned = sanitizedPostgresClientEnvironment(
			pinPostgresConnectionToEndpoint(
				{
					host: 'database.internal',
					port: '5433',
					user: 'owner',
					password: 'synthetic-password',
					database: 'catalog',
				},
				restoreIdentity,
			),
			{ PGHOSTADDR: 'attacker.example' },
		)
		expect(pinned.PGHOST).toBe('database.internal')
		expect(pinned.PGHOSTADDR).toBe('127.0.0.1')
	})

	test('parses the attested endpoint and rejects alias-resolved same targets', () => {
		expect(
			parsePostgresEndpointIdentity(
				JSON.stringify(restoreIdentity),
				{ database: 'veud_restore' },
				'Restore target',
			),
		).toEqual(restoreIdentity)
		expect(() =>
			parsePostgresEndpointIdentity(
				JSON.stringify({
					...restoreIdentity,
					database: 'veud_source',
				}),
				{ database: 'veud_restore' },
				'Restore target',
			),
		).toThrow('connected to an unexpected PostgreSQL database')
		expect(() =>
			parsePostgresEndpointIdentity(
				JSON.stringify({
					...restoreIdentity,
					serverAddress: '127.0.0.1/32',
				}),
				{ database: 'veud_restore' },
				'Restore target',
			),
		).toThrow('Could not verify Restore target PostgreSQL identity')
		expect(() =>
			assertDistinctPostgresEndpointIdentities(sourceIdentity, {
				...restoreIdentity,
				databaseOid: sourceIdentity.databaseOid,
			}),
		).toThrow('same server database identity')
		expect(() =>
			assertDistinctPostgresEndpointIdentities(sourceIdentity, {
				...restoreIdentity,
				otherDatabaseSessions: 1,
			}),
		).toThrow('another session or prepared transaction')
		// Naming the holder is the point: a bare count is what made this failure
		// recur for a week without ever being diagnosable.
		expect(() =>
			assertDistinctPostgresEndpointIdentities(sourceIdentity, {
				...restoreIdentity,
				otherDatabaseSessions: 1,
				otherDatabaseSessionDetail: '9182 idle veud-backup',
			}),
		).toThrow('9182 idle veud-backup')
		expect(() =>
			assertDistinctPostgresEndpointIdentities(sourceIdentity, {
				...restoreIdentity,
				preparedTransactions: 1,
			}),
		).toThrow('another session or prepared transaction')
		expect(() =>
			assertDistinctPostgresEndpointIdentities(sourceIdentity, restoreIdentity),
		).not.toThrow()
		expect(() =>
			assertPostgresEndpointIdentityUnchanged(
				restoreIdentity,
				{ ...restoreIdentity, postmasterStartedAt: '1' },
				'Restore target',
			),
		).toThrow('endpoint identity changed')
	})

	test('keeps destructive checks server-derived and username matching parameterized', () => {
		const identityQuery = postgresEndpointIdentityQuery()
		expect(identityQuery).toContain('current_database()')
		expect(identityQuery).toContain(
			'pg_catalog.host(pg_catalog.inet_server_addr())',
		)
		expect(identityQuery).toContain('pg_postmaster_start_time()')
		expect(identityQuery).toContain('pg_prepared_xacts')
		const accountQuery = verificationQuery(true)
		expect(accountQuery).toContain("username = :'veud_expected_username'")
		expect(accountQuery).not.toContain('synthetic-account-name')
		expect(postgresVerificationScriptArguments("eve' OR TRUE; --")).toEqual([
			'--no-psqlrc',
			'--set',
			'ON_ERROR_STOP=1',
			'--set',
			"veud_expected_username=eve' OR TRUE; --",
			'--tuples-only',
			'--no-align',
			'--file=-',
		])
		expect(postgresRestoreSqlArguments('/private/archive.dump')).toEqual([
			'--exit-on-error',
			'--no-owner',
			'--no-privileges',
			'--file=-',
			'/private/archive.dump',
		])
	})
})

describe('pristine PostgreSQL fingerprints', () => {
	test('parses and accepts the exact provisioned source database inventory', () => {
		const fingerprint = parsePristinePostgresFingerprint(
			`\n${JSON.stringify(pristineFingerprint)}\n`,
		)
		expect(fingerprint).toEqual(pristineFingerprint)
		expect(() =>
			assertTestPristine(fingerprint, 'Test source', {
				database: 'veud_pristine',
				user: 'veud_pristine_owner',
			}),
		).not.toThrow()
		expect(PRISTINE_EMPTY_POSTGRES_SUMMARY).toEqual({
			users: 0,
			watchlists: 0,
			entries: 0,
			media: 0,
			migrations: 0,
		})
	})

	test('accepts the intentionally owner-only restored public schema', () => {
		const fingerprint = parsePristinePostgresFingerprint(
			JSON.stringify(restoredPristineFingerprint),
		)
		expect(() =>
			assertTestPristine(
				fingerprint,
				'Test restore',
				{
					database: 'veud_pristine_restore',
					user: 'veud_pristine_restore_owner',
				},
				'restored',
			),
		).not.toThrow()
	})

	test.each([
		['publicSchemas', 0],
		['userSchemasBeyondPublic', 1],
		['customRelations', 1],
		['customRoutines', 1],
		['customTypes', 1],
		['customCollations', 1],
		['customConversions', 1],
		['customTextSearchParsers', 1],
		['customTextSearchDictionaries', 1],
		['customTextSearchTemplates', 1],
		['customTextSearchConfigurations', 1],
		['customOperators', 1],
		['customOperatorClasses', 1],
		['customOperatorFamilies', 1],
		['customStatistics', 1],
		['plpgsqlExtensions', 0],
		['plpgsqlLanguages', 0],
		['customExtensions', 1],
		['foreignDataWrappers', 1],
		['foreignServers', 1],
		['foreignUserMappings', 1],
		['eventTriggers', 1],
		['largeObjects', 1],
		['publications', 1],
		['subscriptions', 1],
		['customComments', 1],
		['customSecurityLabels', 1],
		['databaseDefaultAcls', 1],
		['databaseSettings', 1],
		['ownerRoleMemberships', 1],
		['ownerRoleGrantedMemberships', 1],
		['ownerRoleSettings', 1],
		['ownerRoleSecurityLabels', 1],
		['otherDatabaseSessions', 1],
		['preparedTransactions', 1],
		['retainedSystemAclDrift', 1],
		['informationSchemaAclDrift', 1],
		['retainedSystemSecurityLabels', 1],
		['plpgsqlRoutineComments', 1],
		['parameterAcls', 1],
		['prismaMigrations', 1],
	])('rejects a non-pristine %s count', (field, value) => {
		expect(() =>
			assertTestPristine(
				{ ...pristineFingerprint, [field]: value },
				'Test source',
			),
		).toThrow(
			`Test source is not an exact pristine-empty-v1 PostgreSQL database: ${field}=${value}`,
		)
	})

	test.each([
		['databaseAclPrivileges', 5],
		['databasePublicCreatePrivileges', 1],
		['databasePublicConnectPrivileges', 1],
		['databasePublicTemporaryPrivileges', 0],
		['databaseOwnerCreatePrivileges', 0],
		['databaseOwnerConnectPrivileges', 0],
		['databaseOwnerTemporaryPrivileges', 0],
		['databaseOtherPrivileges', 1],
		['databaseGrantOptions', 1],
		['databaseUnexpectedAclGrantors', 1],
		['publicSchemaOwnerCreatePrivileges', 0],
		['publicSchemaOwnerUsagePrivileges', 0],
		['publicSchemaPublicCreatePrivileges', 1],
		['publicSchemaOtherPrivileges', 1],
		['publicSchemaGrantOptions', 1],
		['publicSchemaUnexpectedAclGrantors', 1],
	])('rejects a non-pristine %s security value', (field, value) => {
		expect(() =>
			assertTestPristine(
				{ ...pristineFingerprint, [field]: value },
				'Test source',
			),
		).toThrow(`${field}=${value}`)
	})

	test.each([
		['databaseEncoding', 'LATIN1'],
		['databaseTablespace', 'custom_tablespace'],
		['databaseIsTemplate', true],
		['databaseAllowsConnections', false],
		['databaseConnectionLimit', 10],
		['databaseComment', 'custom comment'],
		['serverVersionNum', 160013],
		['ownerRoleSuperuser', true],
		['ownerRoleInherit', false],
		['ownerRoleCreateRole', true],
		['ownerRoleCreateDatabase', true],
		['ownerRoleCanLogin', false],
		['ownerRoleReplication', true],
		['ownerRoleBypassRls', true],
		['ownerRoleConnectionLimit', 1],
		['ownerRoleValidUntil', '2030-01-01 00:00:00+00'],
		['ownerRoleConfigIsNull', false],
		['ownerRoleCommentPresent', true],
		['publicSchemaComment', null],
		['plpgsqlExtensionVersion', '2.0'],
		['plpgsqlExtensionSchema', 'public'],
		['plpgsqlExtensionRelocatable', true],
		['plpgsqlExtensionCommentIsDefault', false],
		['plpgsqlLanguageTrusted', false],
		['plpgsqlLanguageCommentIsDefault', false],
		['plpgsqlOwnerSuperuser', false],
		['plpgsqlRoutineOwnersMatch', false],
		['plpgsqlRoutineDefinitionSignature', 'changed'],
		['retainedSystemObjects', 8656],
		['retainedSystemObjectsDigest', 'changed'],
		['retainedSystemDefinitionsDigest', 'changed'],
		['retainedSystemCommentsDigest', 'changed'],
		['sessionCanCreateDatabaseObjects', false],
		['sessionCanCreatePgCatalogObjects', true],
		['sessionCanCreateInformationSchemaObjects', true],
		['sessionCanCreatePublicSchemaObjects', false],
		['sessionIsDatabaseOwnerMember', false],
		['databaseAclIsNull', true],
		['publicSchemaAclIsNull', true],
		['publicSchemaAclPrivileges', 2],
		['publicSchemaPublicUsagePrivileges', 0],
	])('rejects a non-pristine exact %s property', (field, value) => {
		const diagnosticValue =
			field === 'databaseComment' ? '<non-default>' : String(value)
		expect(() =>
			assertTestPristine(
				{ ...pristineFingerprint, [field]: value },
				'Test source',
			),
		).toThrow(`${field}=${diagnosticValue}`)
	})

	test('does not echo custom database or schema comments in diagnostics', () => {
		for (const field of ['databaseComment', 'publicSchemaComment']) {
			expect(() =>
				assertTestPristine(
					{
						...pristineFingerprint,
						[field]: 'credential-shaped synthetic secret',
					},
					'Test source',
				),
			).toThrow(`${field}=<non-default>`)
			try {
				assertTestPristine(
					{
						...pristineFingerprint,
						[field]: 'credential-shaped synthetic secret',
					},
					'Test source',
				)
			} catch (error) {
				expect(error.message).not.toContain(
					'credential-shaped synthetic secret',
				)
			}
		}
	})

	test('rejects malformed and unknown inventory output', () => {
		expect(() => parsePristinePostgresFingerprint('not JSON')).toThrow(
			'Could not parse pristine PostgreSQL fingerprint',
		)
		expect(() => parsePristinePostgresFingerprint('[]')).toThrow(
			'Could not parse pristine PostgreSQL fingerprint',
		)
		expect(() =>
			parsePristinePostgresFingerprint(
				JSON.stringify({ ...pristineFingerprint, password: 'redacted' }),
			),
		).toThrow('Unexpected pristine PostgreSQL fingerprint field: password')
		expect(() =>
			parsePristinePostgresFingerprint(
				JSON.stringify({ ...pristineFingerprint, customTypes: -1 }),
			),
		).toThrow('Invalid pristine PostgreSQL fingerprint field: customTypes')
	})

	test.each(Object.keys(pristineFingerprint))(
		'rejects a fingerprint missing %s',
		field => {
			const incomplete = { ...pristineFingerprint }
			delete incomplete[field]
			expect(() =>
				parsePristinePostgresFingerprint(JSON.stringify(incomplete)),
			).toThrow(`Invalid pristine PostgreSQL fingerprint field: ${field}`)
		},
	)

	test.each([
		['database', ''],
		['databaseIcuLocale', 1],
		['databaseIsTemplate', 'false'],
		['databaseConnectionLimit', -2],
		['customCollations', 0.5],
	])('rejects an invalid %s field type or domain', (field, value) => {
		expect(() =>
			parsePristinePostgresFingerprint(
				JSON.stringify({ ...pristineFingerprint, [field]: value }),
			),
		).toThrow(`Invalid pristine PostgreSQL fingerprint field: ${field}`)
	})

	test.each(['sessionUser', 'currentUser', 'databaseOwner'])(
		'rejects a fingerprint with a mismatched %s',
		field => {
			expect(() =>
				assertTestPristine(
					{ ...pristineFingerprint, [field]: 'another_role' },
					'Test source',
					{
						database: 'veud_pristine',
						user: 'veud_pristine_owner',
					},
				),
			).toThrow(`${field}=another_role (expected veud_pristine_owner)`)
		},
	)

	test('rejects a fingerprint from another database or schema owner', () => {
		expect(() =>
			assertTestPristine(pristineFingerprint, 'Test source', {
				database: 'another_database',
				user: 'veud_pristine_owner',
			}),
		).toThrow('database=veud_pristine (expected another_database)')
		expect(() =>
			assertTestPristine(
				{ ...pristineFingerprint, publicSchemaOwner: 'another_role' },
				'Test source',
				{
					database: 'veud_pristine',
					user: 'veud_pristine_owner',
				},
			),
		).toThrow('publicSchemaOwner=another_role (expected pg_database_owner)')
	})

	test('requires callers to identify source versus restored schema security', () => {
		expect(() =>
			assertTestPristine(
				restoredPristineFingerprint,
				'Test restore',
				{
					database: 'veud_pristine_restore',
					user: 'veud_pristine_restore_owner',
				},
				'unknown',
			),
		).toThrow('Invalid pristine PostgreSQL fingerprint mode: unknown')
		expect(() =>
			assertTestPristine(
				pristineFingerprint,
				'Test source',
				{
					database: 'veud_pristine',
					user: 'veud_pristine_owner',
				},
				'restored',
			),
		).toThrow('publicSchemaAclIsNull=false (expected true)')
	})
})

describe('trusted PostgreSQL template baseline', () => {
	test('accepts only a protected, same-role-inaccessible template1 baseline', () => {
		expect(() =>
			assertTrustedPostgresTemplateFingerprint(trustedTemplateFingerprint, {
				user: 'veud_pristine_owner',
			}),
		).not.toThrow()
		for (const [field, value] of [
			['parameterAcls', 1],
			['customRelations', 1],
			['sessionCanCreateDatabaseObjects', true],
			['sessionCanCreatePublicSchemaObjects', true],
			['sessionIsDatabaseOwnerMember', true],
			['ownerRoleSuperuser', false],
		]) {
			expect(() =>
				assertTrustedPostgresTemplateFingerprint(
					{ ...trustedTemplateFingerprint, [field]: value },
					{ user: 'veud_pristine_owner' },
				),
			).toThrow(field)
		}
	})
})

describe('pristine PostgreSQL source and restore parity', () => {
	test('accepts immutable database properties copied from the source', () => {
		expect(() =>
			assertPristinePostgresRestoreParity(
				pristineFingerprint,
				restoredPristineFingerprint,
			),
		).not.toThrow()
	})

	test.each([
		'databaseEncoding',
		'databaseCollate',
		'databaseCtype',
		'databaseLocaleProvider',
		'databaseIcuLocale',
		'databaseIcuRules',
		'databaseCollationVersion',
		'databaseTablespace',
	])('rejects restored %s drift from the source', field => {
		expect(() =>
			assertPristinePostgresRestoreParity(pristineFingerprint, {
				...restoredPristineFingerprint,
				[field]: `${String(pristineFingerprint[field])}-changed`,
			}),
		).toThrow(
			`Restored pristine PostgreSQL database properties differ from source: ${field}=`,
		)
	})

	test('rejects mismatched PL/pgSQL extension and language ownership', () => {
		expect(() =>
			assertTestPristine(
				{ ...pristineFingerprint, plpgsqlLanguageOwner: 'another_role' },
				'Test source',
			),
		).toThrow('plpgsqlLanguageOwner=another_role (expected postgres)')
		expect(() =>
			assertTestPristine(
				{
					...pristineFingerprint,
					plpgsqlExtensionOwner: 'veud_pristine_owner',
					plpgsqlLanguageOwner: 'veud_pristine_owner',
				},
				'Test source',
				{
					database: 'veud_pristine',
					user: 'veud_pristine_owner',
				},
			),
		).toThrow('expected a distinct PostgreSQL superuser')
	})
})

describe('pristine PostgreSQL inventory query', () => {
	const query = pristineFingerprintQuery()

	test.each([
		'pg_collation',
		'pg_conversion',
		'pg_ts_parser',
		'pg_ts_dict',
		'pg_ts_template',
		'pg_ts_config',
		'pg_operator',
		'pg_opclass',
		'pg_opfamily',
		'pg_attrdef',
		'pg_constraint',
		'pg_rewrite',
		'pg_trigger',
		'pg_policy',
		'pg_amop',
		'pg_amproc',
		'pg_cast',
		'pg_transform',
		'pg_language',
		'pg_am',
		'pg_statistic_ext',
		'pg_user_mappings',
		'pg_publication',
		'pg_subscription',
		'pg_description',
		'pg_shdescription',
		'pg_seclabel',
		'pg_shseclabel',
		'pg_default_acl',
		'pg_db_role_setting',
		'pg_auth_members',
		'pg_stat_activity',
		'pg_prepared_xacts',
		'pg_init_privs',
	])('inventories %s rather than trusting an empty public schema', catalog => {
		expect(query).toContain(catalog)
	})

	test.each([
		'current_user',
		'datdba',
		'encoding',
		'datcollate',
		'datctype',
		'datlocprovider',
		'daticulocale',
		'daticurules',
		'datcollversion',
		'dattablespace',
		'nspowner',
		'nspacl',
		'datacl',
		'extversion',
		'extrelocatable',
		'lanpltrusted',
		'rolsuper',
		'rolinherit',
		'rolcreaterole',
		'rolcreatedb',
		'rolcanlogin',
		'rolreplication',
		'rolbypassrls',
		'rolconnlimit',
		'rolvaliduntil',
		'rolconfig',
	])('captures database and schema property %s', property => {
		expect(query).toContain(property)
	})

	test('derives stable PG16 system-object, ACL, comment, and PL/pgSQL baselines', () => {
		expect(query).toContain("'information_schema'")
		expect(query).toContain("'_pg_foreign_data_wrappers'")
		expect(query).toContain('retained_system_object_addresses')
		expect(query).toContain('retained_acl_comparison')
		expect(query).toContain('retained_system_comments')
		expect(query).toContain('plpgsql_call_handler')
		expect(query).toContain('PL/pgSQL procedural language')
		expect(query).toContain('pg_catalog.sha256')
		expect(query).toContain('prosrc')
		expect(query).toContain('probin')
		expect(query).toContain('lanplcallfoid')
		expect(query).toContain('pg_identify_object_as_address')
		expect(query).toContain('pg_catalog.pg_parameter_acl')
		expect(query).toContain('stable_system_definition_rows')
		expect(query).not.toContain('16384')
		expect(query).not.toContain('md5(')
	})

	test('never selects stored role or subscription credentials', () => {
		expect(query).not.toContain('rolpassword')
		expect(query).not.toContain('subconninfo')
	})

	test('qualifies catalog relations and relies on no caller search path', () => {
		expect(query).not.toMatch(/\b(?:FROM|JOIN)\s+pg_(?!catalog\.)/)
		expect(query).toContain('FROM pg_catalog.pg_database')
		expect(query).toContain('FROM pg_catalog.pg_parameter_acl')
	})

	test('builds a template-relative, full-target reset assertion', () => {
		const reset = postgresRestoreResetAssertionQuery()
		expect(reset).toContain('retainedSystemDefinitionsDigest')
		expect(reset).toContain('veud_template_system_definition_digest')
		expect(reset).toContain("fingerprint.value ->> 'customExtensions'")
		expect(reset).toContain("fingerprint.value ->> 'parameterAcls'")
		expect(reset).not.toContain('8689')
	})
})

describe('exclusive restore rescue guardian', () => {
	const source = fs.readFileSync(
		new URL('./postgres-backup-operations.mjs', import.meta.url),
		'utf8',
	)
	const guardian = fs.readFileSync(
		new URL('./postgres-restore-guardian.mjs', import.meta.url),
		'utf8',
	)

	test('releases a retained fence before the guardian needs a slot', () => {
		const release = source.indexOf('releasePostgresRestoreConnectionFence({')
		const start = source.indexOf('startPostgresRestoreGuardian({\n\t\tpsql,')
		expect(release).toBeGreaterThan(-1)
		expect(start).toBeGreaterThan(release)
	})

	test('fence release is identity pinned and refuses a busy target', () => {
		const block = source.slice(
			source.indexOf('async function releasePostgresRestoreConnectionFence'),
			source.indexOf('const POSTGRES_RESTORE_GUARDIAN_SCRIPT'),
		)
		expect(block).toContain(
			"pg_catalog.current_database() = :'veud_expected_database'",
		)
		expect(block).toContain(":'veud_expected_database_oid'")
		expect(block).toContain(":'veud_expected_server_start'")
		expect(block).toContain('${POSTGRES_BACKUP_SERVER_VERSION_NUM}')
		expect(block).toContain('FROM pg_catalog.pg_stat_activity AS activity')
		expect(block).toContain('FROM pg_catalog.pg_prepared_xacts AS prepared')
		expect(block).toContain(
			'ALTER DATABASE :"veud_expected_database" CONNECTION LIMIT -1;',
		)
		// Variables only interpolate through a script, never through --command.
		expect(block).toContain("'--file=-'")
		expect(block).not.toContain("'--command'")
	})

	test('guardian is crash bound and started before the fence drops to one', () => {
		const block = source.slice(
			source.indexOf('async function startPostgresRestoreGuardian'),
			source.indexOf('async function restorePostgresBackupExclusively'),
		)
		expect(block).toContain('spawnCrashBoundPostgresChild(')
		expect(block).toContain('POSTGRES_RESTORE_GUARDIAN_SCRIPT')
		expect(block).toContain('VEUD_GUARDIAN_BACKEND:')
		const prelude = source.indexOf(
			'ALTER DATABASE :"veud_expected_database" CONNECTION LIMIT 1;',
		)
		expect(
			source.indexOf('startPostgresRestoreGuardian({\n\t\tpsql,'),
		).toBeLessThan(prelude)
	})

	test('exclusivity assertions exclude the guardian but require its presence', () => {
		const prelude = source.slice(
			source.indexOf(
				'ALTER DATABASE :"veud_expected_database" CONNECTION LIMIT 1;',
			),
			source.indexOf('DROP OWNED BY CURRENT_USER CASCADE'),
		)
		expect(prelude).toContain('AND activity.pid <> :veud_guardian_pid')
		expect(prelude).toContain('AND activity.pid = :veud_guardian_pid')
		expect(prelude).toContain(
			"AND activity.usename = :'veud_expected_session_user'",
		)
	})

	test('guardian is always released, on success and on failure', () => {
		const block = source.slice(
			source.indexOf('async function restorePostgresBackupExclusively'),
			source.indexOf('export function assertMigrationParity'),
		)
		expect(block).toContain('} finally {')
		expect(block).toContain('await guardian.release({ requireAlive:')
		// A guardian that died before a successful restore must be surfaced.
		expect(source).toContain(
			'PostgreSQL restore guardian exited before the restore completed',
		)
	})

	test('guardian terminates other backends and retains the fence on owner death', () => {
		expect(guardian).toContain("process.on('SIGTERM', terminateOtherBackends)")
		expect(guardian).toContain("process.on('SIGINT', terminateOtherBackends)")
		expect(guardian).toContain("process.on('SIGHUP', terminateOtherBackends)")
		expect(guardian).toContain('pg_catalog.pg_terminate_backend(activity.pid)')
		expect(guardian).toContain('EXIT WHEN remaining = 0;')
		// The fence must survive so exactly one retry slot exists: the guardian
		// must never issue an ALTER DATABASE of any kind.
		expect(guardian).not.toMatch(/ALTER\s+DATABASE/i)
		// A failed rescue must be loud, never a silent exit(0).
		expect(guardian).toContain('ON_ERROR_STOP=1')
		expect(guardian).toContain('veud guardian could not free the restore slot')
	})

	test('guardian recovers when the owner stream dies without releasing', () => {
		expect(guardian).toContain("process.stdin.on('end'")
		expect(guardian).toContain("process.stdin.on('error'")
		expect(guardian).toContain(
			"if (line.trim() === 'release') releaseCleanly()",
		)
	})
})

// Behavioral coverage for the guardian process itself: these spawn the real
// script against a stub psql so the protocol, not just the source text, is
// exercised.
describe('rescue guardian process behavior', () => {
	const guardianScript = fileURLToPath(
		new URL('./postgres-restore-guardian.mjs', import.meta.url),
	)

	function stubPsql(directory, { exitCode = 0 } = {}) {
		const transcript = path.join(directory, 'psql-transcript.txt')
		const stub = path.join(directory, 'psql-stub.sh')
		fs.writeFileSync(
			stub,
			[
				'#!/usr/bin/env bash',
				`printf '%s\\n' "ARGS:$*" >>"${transcript}"`,
				// Answer the backend-pid probe, then record everything else.
				'while IFS= read -r line; do',
				`  printf '%s\\n' "IN:$line" >>"${transcript}"`,
				'  if [[ "$line" == *pg_backend_pid* ]]; then',
				'    printf "VEUD_GUARDIAN_BACKEND:4242\\n"',
				'  fi',
				'done',
				`exit ${exitCode}`,
			].join('\n'),
			{ mode: 0o755 },
		)
		return { stub, transcript }
	}

	function startGuardian(stub) {
		return spawn(process.execPath, [guardianScript], {
			env: { ...process.env, VEUD_GUARDIAN_PSQL: stub },
			stdio: ['pipe', 'pipe', 'pipe'],
		})
	}

	async function waitForExit(child) {
		return new Promise(resolve =>
			child.once('close', (code, signal) => resolve({ code, signal })),
		)
	}

	async function readBackendPid(child) {
		return new Promise((resolve, reject) => {
			let buffered = ''
			const timer = setTimeout(
				() => reject(new Error('guardian never reported a backend')),
				10_000,
			)
			child.stdout.on('data', chunk => {
				buffered += chunk
				const match = /^VEUD_GUARDIAN_BACKEND:(\d+)$/m.exec(buffered)
				if (match) {
					clearTimeout(timer)
					resolve(Number(match[1]))
				}
			})
		})
	}

	test('reports its backend pid and releases without terminating anything', async () => {
		const directory = fs.mkdtempSync(
			path.join(os.tmpdir(), 'veud-guardian-release-'),
		)
		try {
			const { stub, transcript } = stubPsql(directory)
			const child = startGuardian(stub)
			expect(await readBackendPid(child)).toBe(4242)
			child.stdin.end('release\n')
			const { code } = await waitForExit(child)
			expect(code).toBe(0)
			const recorded = fs.readFileSync(transcript, 'utf8')
			// A clean release must never terminate backends or touch the fence.
			expect(recorded).not.toContain('pg_terminate_backend')
			expect(recorded).not.toMatch(/ALTER\s+DATABASE/i)
			expect(recorded).toContain('ON_ERROR_STOP=1')
		} finally {
			fs.rmSync(directory, { recursive: true, force: true })
		}
	})

	test('on owner death terminates other backends, waits, and keeps the fence', async () => {
		const directory = fs.mkdtempSync(
			path.join(os.tmpdir(), 'veud-guardian-rescue-'),
		)
		try {
			const { stub, transcript } = stubPsql(directory)
			const child = startGuardian(stub)
			expect(await readBackendPid(child)).toBe(4242)
			// Crash-bound delivery is SIGTERM; simulate the owner's death.
			child.kill('SIGTERM')
			const { code } = await waitForExit(child)
			expect(code).toBe(0)
			const recorded = fs.readFileSync(transcript, 'utf8')
			expect(recorded).toContain('pg_terminate_backend')
			expect(recorded).toContain('EXIT WHEN remaining = 0;')
			// The recovery must raise rather than exit quietly when it fails.
			expect(recorded).toContain(
				'veud guardian could not free the restore slot',
			)
			// The connection limit must be retained for the retry slot.
			expect(recorded).not.toMatch(/ALTER\s+DATABASE/i)
		} finally {
			fs.rmSync(directory, { recursive: true, force: true })
		}
	})

	test('a closed owner stream recovers rather than exiting silently', async () => {
		const directory = fs.mkdtempSync(
			path.join(os.tmpdir(), 'veud-guardian-eof-'),
		)
		try {
			const { stub, transcript } = stubPsql(directory)
			const child = startGuardian(stub)
			expect(await readBackendPid(child)).toBe(4242)
			// Owner died without requesting a release: stdin simply ends.
			child.stdin.destroy()
			await waitForExit(child)
			expect(fs.readFileSync(transcript, 'utf8')).toContain(
				'pg_terminate_backend',
			)
		} finally {
			fs.rmSync(directory, { recursive: true, force: true })
		}
	})

	test('a failed rescue exits non-zero instead of mimicking success', async () => {
		const directory = fs.mkdtempSync(
			path.join(os.tmpdir(), 'veud-guardian-failed-'),
		)
		try {
			// psql exits non-zero exactly as it would when ON_ERROR_STOP meets the
			// guardian's RAISE EXCEPTION for an unfreed slot.
			const { stub } = stubPsql(directory, { exitCode: 3 })
			const child = startGuardian(stub)
			expect(await readBackendPid(child)).toBe(4242)
			child.kill('SIGTERM')
			const { code } = await waitForExit(child)
			expect(code).not.toBe(0)
		} finally {
			fs.rmSync(directory, { recursive: true, force: true })
		}
	})

	test('a clean release still reports success even though it sends no SQL', async () => {
		const directory = fs.mkdtempSync(
			path.join(os.tmpdir(), 'veud-guardian-clean-'),
		)
		try {
			const { stub } = stubPsql(directory)
			const child = startGuardian(stub)
			expect(await readBackendPid(child)).toBe(4242)
			child.stdin.end('release\n')
			const { code } = await waitForExit(child)
			expect(code).toBe(0)
		} finally {
			fs.rmSync(directory, { recursive: true, force: true })
		}
	})

	test('a guardian that cannot start is refused, never assumed present', async () => {
		const directory = fs.mkdtempSync(
			path.join(os.tmpdir(), 'veud-guardian-dead-'),
		)
		try {
			const stub = path.join(directory, 'psql-broken.sh')
			fs.writeFileSync(stub, '#!/usr/bin/env bash\nexit 3\n', { mode: 0o755 })
			const child = startGuardian(stub)
			const { code } = await waitForExit(child)
			expect(code).not.toBe(0)
		} finally {
			fs.rmSync(directory, { recursive: true, force: true })
		}
	})
})

test('an endpoint identity whose session detail is not text is rejected', () => {
	const identity = {
		database: 'veud_restore',
		databaseOid: '16385',
		serverAddress: '127.0.0.1',
		serverPort: 5433,
		postmasterStartedAt: '1750000000000000',
		serverVersionNum: POSTGRES_BACKUP_SERVER_VERSION_NUM,
		otherDatabaseSessions: 0,
		otherDatabaseSessionDetail: '',
		preparedTransactions: 0,
	}
	expect(
		parsePostgresEndpointIdentity(
			JSON.stringify(identity),
			{ database: 'veud_restore' },
			'Restore target',
		),
	).toEqual(identity)
	for (const detail of [42, null, undefined, ['4001 idle backup']]) {
		expect(() =>
			parsePostgresEndpointIdentity(
				JSON.stringify({ ...identity, otherDatabaseSessionDetail: detail }),
				{ database: 'veud_restore' },
				'Restore target',
			),
		).toThrow('Could not verify Restore target PostgreSQL identity')
	}
})

test('the identity query returns exactly the fields the parser demands', () => {
	// Without this the two can drift apart silently: the parser rejects any
	// identity missing a field, so a field dropped from the SQL breaks every
	// backup, and one added to the SQL alone breaks it just as thoroughly.
	const query = postgresEndpointIdentityQuery()
	// Keys sit at exactly three tabs; nested subqueries are indented deeper, so
	// string literals inside them cannot be mistaken for keys.
	const selected = [...query.matchAll(/^\t{3}'([A-Za-z]+)',/gm)].map(
		match => match[1],
	)
	expect(new Set(selected)).toEqual(
		new Set([
			'database',
			'databaseOid',
			'serverAddress',
			'serverPort',
			'postmasterStartedAt',
			'serverVersionNum',
			'otherDatabaseSessions',
			'otherDatabaseSessionDetail',
			'preparedTransactions',
		]),
	)
})
