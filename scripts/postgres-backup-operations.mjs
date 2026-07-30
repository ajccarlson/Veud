import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { isIP } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import {
	assertPrivatePostgresBackupDirectory,
	assertPrivatePostgresBackupFile,
	attestPostgresBackupFile,
	withPrivatePostgresRestoreArchive,
} from './postgres-backup-publication.mjs'
import {
	assertSafeRestoreTarget,
	parsePostgresConnection,
	postgresConnectionEnv,
} from './postgres-backup-utils.mjs'
import { withPostgresRestoreLock } from './postgres-restore-lock.mjs'

export const DEFAULT_POSTGRES_BACKUP_SOURCE_POLICY = 'migrated-veud-v1'
export const PRISTINE_EMPTY_POSTGRES_SOURCE_POLICY = 'pristine-empty-v1'
export const POSTGRES_BACKUP_SERVER_VERSION_NUM = 160014
export const POSTGRES_BACKUP_CLIENT_VERSION = '16.14'

const POSTGRES_BACKUP_SOURCE_POLICIES = new Set([
	DEFAULT_POSTGRES_BACKUP_SOURCE_POLICY,
	PRISTINE_EMPTY_POSTGRES_SOURCE_POLICY,
])
const PRISTINE_FINGERPRINT_EXPECTATIONS = Object.freeze({
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
	retainedSystemAclDrift: 0,
	informationSchemaAclDrift: 0,
	retainedSystemSecurityLabels: 0,
	plpgsqlRoutineComments: 0,
	parameterAcls: 0,
	prismaMigrations: 0,
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
	publicSchemaOwnerCreatePrivileges: 1,
	publicSchemaOwnerUsagePrivileges: 1,
	publicSchemaPublicCreatePrivileges: 0,
	publicSchemaOtherPrivileges: 0,
	publicSchemaGrantOptions: 0,
	publicSchemaUnexpectedAclGrantors: 0,
})
const PRISTINE_FINGERPRINT_STRING_FIELDS = Object.freeze([
	'database',
	'sessionUser',
	'currentUser',
	'databaseOwner',
	'databaseEncoding',
	'databaseCollate',
	'databaseCtype',
	'databaseLocaleProvider',
	'databaseTablespace',
	'publicSchemaOwner',
	'plpgsqlExtensionOwner',
	'plpgsqlExtensionVersion',
	'plpgsqlExtensionSchema',
	'plpgsqlLanguageOwner',
	'plpgsqlRoutineDefinitionSignature',
	'retainedSystemObjectsDigest',
	'retainedSystemDefinitionsDigest',
	'retainedSystemCommentsDigest',
])
const PRISTINE_FINGERPRINT_NULLABLE_STRING_FIELDS = Object.freeze([
	'databaseIcuLocale',
	'databaseIcuRules',
	'databaseCollationVersion',
	'databaseComment',
	'publicSchemaComment',
	'ownerRoleValidUntil',
])
const PRISTINE_FINGERPRINT_BOOLEAN_FIELDS = Object.freeze([
	'databaseIsTemplate',
	'databaseAllowsConnections',
	'databaseAclIsNull',
	'publicSchemaAclIsNull',
	'plpgsqlExtensionRelocatable',
	'plpgsqlLanguageTrusted',
	'ownerRoleSuperuser',
	'ownerRoleInherit',
	'ownerRoleCreateRole',
	'ownerRoleCreateDatabase',
	'ownerRoleCanLogin',
	'ownerRoleReplication',
	'ownerRoleBypassRls',
	'ownerRoleConfigIsNull',
	'ownerRoleCommentPresent',
	'plpgsqlOwnerSuperuser',
	'plpgsqlRoutineOwnersMatch',
	'plpgsqlExtensionCommentIsDefault',
	'plpgsqlLanguageCommentIsDefault',
	'sessionCanCreateDatabaseObjects',
	'sessionCanCreatePgCatalogObjects',
	'sessionCanCreateInformationSchemaObjects',
	'sessionCanCreatePublicSchemaObjects',
	'sessionIsDatabaseOwnerMember',
])
const PRISTINE_TEMPLATE_BASELINE_FIELDS = Object.freeze([
	'plpgsqlExtensionOwner',
	'plpgsqlExtensionVersion',
	'plpgsqlExtensionSchema',
	'plpgsqlExtensionRelocatable',
	'plpgsqlExtensionCommentIsDefault',
	'plpgsqlLanguageOwner',
	'plpgsqlLanguageTrusted',
	'plpgsqlLanguageCommentIsDefault',
	'plpgsqlOwnerSuperuser',
	'plpgsqlRoutineOwnersMatch',
	'plpgsqlRoutineDefinitionSignature',
	'retainedSystemObjects',
	'retainedSystemObjectsDigest',
	'retainedSystemDefinitionsDigest',
	'retainedSystemCommentsDigest',
])
const PRISTINE_RESTORE_PARITY_FIELDS = Object.freeze([
	'databaseEncoding',
	'databaseCollate',
	'databaseCtype',
	'databaseLocaleProvider',
	'databaseIcuLocale',
	'databaseIcuRules',
	'databaseCollationVersion',
	'databaseTablespace',
])
const PRISTINE_POSTGRES_FINGERPRINT_MODES = new Set(['source', 'restored'])
const POSTGRES_CRASH_BOUND_CHILD_EXECUTABLE = '/usr/bin/setpriv'

export const PRISTINE_EMPTY_POSTGRES_SUMMARY = Object.freeze({
	users: 0,
	watchlists: 0,
	entries: 0,
	media: 0,
	migrations: 0,
})

function command(name, fallback) {
	return process.env[name]?.trim() || fallback
}

export function sanitizedPostgresClientEnvironment(
	connection,
	ambient = process.env,
) {
	const environment = {}
	for (const [name, value] of Object.entries(ambient)) {
		if (!name.startsWith('PG')) environment[name] = value
	}
	return {
		...environment,
		...postgresConnectionEnv(connection),
		...(connection.hostAddress ? { PGHOSTADDR: connection.hostAddress } : {}),
		PGAPPNAME: 'veud-backup-verifier',
		PGCONNECT_TIMEOUT: '10',
		PGOPTIONS: '-c search_path=pg_catalog',
	}
}

export function postgresClientExecutionOptions(
	connection,
	ambient = process.env,
) {
	return {
		env: sanitizedPostgresClientEnvironment(connection, ambient),
		extendEnv: false,
	}
}

async function run(binary, args, connection, capture = false) {
	return execa(binary, args, {
		...postgresClientExecutionOptions(connection),
		...(capture ? {} : { stdio: 'inherit' }),
	})
}

async function runPostgresScript(
	binary,
	args,
	connection,
	script,
	capture = false,
) {
	return execa(binary, args, {
		...postgresClientExecutionOptions(connection),
		input: script,
		...(capture ? {} : { stdout: 'inherit', stderr: 'inherit' }),
	})
}

export function parsePostgresClientVersion(stdout, label) {
	const match = /\b(\d+\.\d+)(?:\.\d+)?\b/.exec(stdout)
	if (!match) throw new Error(`Could not determine ${label} version`)
	if (match[1] !== POSTGRES_BACKUP_CLIENT_VERSION) {
		throw new Error(
			`${label} must be PostgreSQL ${POSTGRES_BACKUP_CLIENT_VERSION}`,
		)
	}
	return match[1]
}

async function assertPostgresClientVersion(binary, label, connection) {
	const result = await run(binary, ['--version'], connection, true)
	parsePostgresClientVersion(result.stdout, label)
}

export function postgresEndpointIdentityQuery() {
	return `
		SELECT pg_catalog.jsonb_build_object(
			'database', pg_catalog.current_database(),
			'databaseOid',
				(SELECT database_object.oid::text
				 FROM pg_catalog.pg_database AS database_object
				 WHERE database_object.datname = pg_catalog.current_database()),
			'serverAddress',
				COALESCE(
					pg_catalog.host(pg_catalog.inet_server_addr()),
					'local-socket'
				),
			'serverPort',
				COALESCE(pg_catalog.inet_server_port(), 0),
			'postmasterStartedAt',
				(
					EXTRACT(EPOCH FROM pg_catalog.pg_postmaster_start_time()) *
					1000000
				)::bigint::text,
			'serverVersionNum',
				pg_catalog.current_setting('server_version_num')::integer,
			'otherDatabaseSessions',
				(SELECT COUNT(*)
				 FROM pg_catalog.pg_stat_activity AS activity
				 WHERE activity.datname = pg_catalog.current_database()
				   AND activity.pid <> pg_catalog.pg_backend_pid()),
			'preparedTransactions',
				(SELECT COUNT(*)
				 FROM pg_catalog.pg_prepared_xacts AS prepared
				 WHERE prepared.database = pg_catalog.current_database())
		);
	`
}

export function parsePostgresEndpointIdentity(stdout, expected, label) {
	let identity
	try {
		identity = JSON.parse(stdout.trim())
	} catch {
		throw new Error(`Could not verify ${label} PostgreSQL identity`)
	}
	const fields = new Set([
		'database',
		'databaseOid',
		'serverAddress',
		'serverPort',
		'postmasterStartedAt',
		'serverVersionNum',
		'otherDatabaseSessions',
		'preparedTransactions',
	])
	if (
		!identity ||
		typeof identity !== 'object' ||
		Array.isArray(identity) ||
		Object.keys(identity).some(field => !fields.has(field)) ||
		[...fields].some(field => !Object.hasOwn(identity, field)) ||
		typeof identity.database !== 'string' ||
		typeof identity.databaseOid !== 'string' ||
		!/^\d+$/.test(identity.databaseOid) ||
		typeof identity.serverAddress !== 'string' ||
		!identity.serverAddress ||
		(identity.serverAddress !== 'local-socket' &&
			isIP(identity.serverAddress) === 0) ||
		!Number.isSafeInteger(identity.serverPort) ||
		identity.serverPort < 0 ||
		identity.serverPort > 65_535 ||
		(identity.serverAddress === 'local-socket') !==
			(identity.serverPort === 0) ||
		typeof identity.postmasterStartedAt !== 'string' ||
		!/^\d+$/.test(identity.postmasterStartedAt) ||
		!Number.isSafeInteger(identity.serverVersionNum) ||
		!Number.isSafeInteger(identity.otherDatabaseSessions) ||
		identity.otherDatabaseSessions < 0 ||
		!Number.isSafeInteger(identity.preparedTransactions) ||
		identity.preparedTransactions < 0
	) {
		throw new Error(`Could not verify ${label} PostgreSQL identity`)
	}
	if (identity.database !== expected.database) {
		throw new Error(`${label} connected to an unexpected PostgreSQL database`)
	}
	if (identity.serverVersionNum !== POSTGRES_BACKUP_SERVER_VERSION_NUM) {
		throw new Error(
			`${label} must use PostgreSQL ${POSTGRES_BACKUP_CLIENT_VERSION}`,
		)
	}
	return identity
}

export function assertDistinctPostgresEndpointIdentities(
	source,
	restore,
	requireExclusiveRestore = true,
) {
	if (source.database === restore.database) {
		throw new Error(
			'PostgreSQL source and restore sessions resolved to the same database',
		)
	}
	if (
		source.serverAddress === restore.serverAddress &&
		source.serverPort === restore.serverPort &&
		source.postmasterStartedAt === restore.postmasterStartedAt &&
		source.databaseOid === restore.databaseOid
	) {
		throw new Error(
			'PostgreSQL source and restore sessions resolved to the same server database identity',
		)
	}
	if (
		requireExclusiveRestore &&
		(restore.otherDatabaseSessions !== 0 || restore.preparedTransactions !== 0)
	) {
		throw new Error(
			'PostgreSQL restore target has another session or prepared transaction',
		)
	}
}

export function pinPostgresConnectionToEndpoint(connection, identity) {
	if (identity.serverAddress === 'local-socket') return { ...connection }
	return {
		...connection,
		hostAddress: identity.serverAddress,
	}
}

export function assertPostgresEndpointIdentityUnchanged(
	expected,
	actual,
	label,
) {
	for (const field of [
		'database',
		'databaseOid',
		'serverAddress',
		'serverPort',
		'postmasterStartedAt',
		'serverVersionNum',
	]) {
		if (actual?.[field] !== expected?.[field]) {
			throw new Error(`${label} PostgreSQL endpoint identity changed`)
		}
	}
}

async function readPostgresEndpointIdentity(psql, connection, label) {
	await assertPostgresClientVersion(psql, 'psql', connection)
	const result = await run(
		psql,
		[
			'--no-psqlrc',
			'--set',
			'ON_ERROR_STOP=1',
			'--tuples-only',
			'--no-align',
			'--command',
			postgresEndpointIdentityQuery(),
		],
		connection,
		true,
	)
	return parsePostgresEndpointIdentity(result.stdout, connection, label)
}

export function parsePostgresBackupSourcePolicy(value) {
	const policy = value?.trim() || DEFAULT_POSTGRES_BACKUP_SOURCE_POLICY
	if (!POSTGRES_BACKUP_SOURCE_POLICIES.has(policy)) {
		throw new Error(
			'BACKUP_SOURCE_POLICY must be migrated-veud-v1 or pristine-empty-v1',
		)
	}
	return policy
}

export function pristineFingerprintQuery() {
	return `
		WITH database_metadata AS (
			SELECT
				database_object.*,
				pg_catalog.pg_get_userbyid(database_object.datdba) AS database_owner,
				pg_catalog.pg_encoding_to_char(database_object.encoding) AS database_encoding,
				tablespace.spcname AS database_tablespace
			FROM pg_catalog.pg_database AS database_object
			JOIN pg_catalog.pg_tablespace AS tablespace
			  ON tablespace.oid = database_object.dattablespace
			WHERE database_object.datname = pg_catalog.current_database()
		),
		database_owner_role AS (
			SELECT role.*
			FROM pg_catalog.pg_roles AS role
			JOIN database_metadata AS database_object
			  ON role.oid = database_object.datdba
		),
		plpgsql_extension AS (
			SELECT extension.*
			FROM pg_catalog.pg_extension AS extension
			WHERE extension.extname = 'plpgsql'
		),
		plpgsql_language AS (
			SELECT language.*
			FROM pg_catalog.pg_language AS language
			WHERE language.lanname = 'plpgsql'
		),
		plpgsql_owner_role AS (
			SELECT role.*
			FROM pg_catalog.pg_roles AS role
			JOIN plpgsql_extension AS extension
			  ON role.oid = extension.extowner
		),
		namespaces AS (
			SELECT
				oid,
				nspname,
				nspowner,
				nspacl,
				(
					nspname = 'pg_catalog' OR
					nspname = 'information_schema' OR
					nspname ~ '^pg_(toast|temp)(_|$)'
				) AS is_system
			FROM pg_catalog.pg_namespace
		),
		public_schema AS (
			SELECT
				namespace.*,
				pg_catalog.pg_get_userbyid(namespace.nspowner) AS schema_owner,
				pg_catalog.obj_description(namespace.oid, 'pg_namespace') AS schema_comment
			FROM namespaces AS namespace
			WHERE namespace.nspname = 'public'
		),
		database_acl AS (
			SELECT acl.*
			FROM database_metadata AS database_object
			CROSS JOIN LATERAL pg_catalog.aclexplode(
				COALESCE(
					database_object.datacl,
					pg_catalog.acldefault('d', database_object.datdba)
				)
			) AS acl
		),
		public_schema_acl AS (
			SELECT acl.*
			FROM public_schema AS namespace
			CROSS JOIN LATERAL pg_catalog.aclexplode(
				COALESCE(namespace.nspacl, pg_catalog.acldefault('n', namespace.nspowner))
			) AS acl
		),
		custom_object_addresses AS (
			SELECT 'pg_namespace'::regclass::oid AS classoid, namespace.oid AS objoid
			FROM namespaces AS namespace
			WHERE NOT namespace.is_system AND namespace.nspname <> 'public'
			UNION ALL
			SELECT 'pg_class'::regclass::oid, object.oid
			FROM pg_catalog.pg_class AS object
			JOIN namespaces AS namespace ON namespace.oid = object.relnamespace
			WHERE NOT namespace.is_system
			UNION ALL
			SELECT 'pg_proc'::regclass::oid, object.oid
			FROM pg_catalog.pg_proc AS object
			JOIN namespaces AS namespace ON namespace.oid = object.pronamespace
			WHERE NOT namespace.is_system
			UNION ALL
			SELECT 'pg_type'::regclass::oid, object.oid
			FROM pg_catalog.pg_type AS object
			JOIN namespaces AS namespace ON namespace.oid = object.typnamespace
			WHERE NOT namespace.is_system
			UNION ALL
			SELECT 'pg_collation'::regclass::oid, object.oid
			FROM pg_catalog.pg_collation AS object
			JOIN namespaces AS namespace ON namespace.oid = object.collnamespace
			WHERE NOT namespace.is_system
			UNION ALL
			SELECT 'pg_conversion'::regclass::oid, object.oid
			FROM pg_catalog.pg_conversion AS object
			JOIN namespaces AS namespace ON namespace.oid = object.connamespace
			WHERE NOT namespace.is_system
			UNION ALL
			SELECT 'pg_ts_parser'::regclass::oid, object.oid
			FROM pg_catalog.pg_ts_parser AS object
			JOIN namespaces AS namespace ON namespace.oid = object.prsnamespace
			WHERE NOT namespace.is_system
			UNION ALL
			SELECT 'pg_ts_dict'::regclass::oid, object.oid
			FROM pg_catalog.pg_ts_dict AS object
			JOIN namespaces AS namespace ON namespace.oid = object.dictnamespace
			WHERE NOT namespace.is_system
			UNION ALL
			SELECT 'pg_ts_template'::regclass::oid, object.oid
			FROM pg_catalog.pg_ts_template AS object
			JOIN namespaces AS namespace ON namespace.oid = object.tmplnamespace
			WHERE NOT namespace.is_system
			UNION ALL
			SELECT 'pg_ts_config'::regclass::oid, object.oid
			FROM pg_catalog.pg_ts_config AS object
			JOIN namespaces AS namespace ON namespace.oid = object.cfgnamespace
			WHERE NOT namespace.is_system
			UNION ALL
			SELECT 'pg_operator'::regclass::oid, object.oid
			FROM pg_catalog.pg_operator AS object
			JOIN namespaces AS namespace ON namespace.oid = object.oprnamespace
			WHERE NOT namespace.is_system
			UNION ALL
			SELECT 'pg_opclass'::regclass::oid, object.oid
			FROM pg_catalog.pg_opclass AS object
			JOIN namespaces AS namespace ON namespace.oid = object.opcnamespace
			WHERE NOT namespace.is_system
			UNION ALL
			SELECT 'pg_opfamily'::regclass::oid, object.oid
			FROM pg_catalog.pg_opfamily AS object
			JOIN namespaces AS namespace ON namespace.oid = object.opfnamespace
			WHERE NOT namespace.is_system
			UNION ALL
			SELECT 'pg_statistic_ext'::regclass::oid, object.oid
			FROM pg_catalog.pg_statistic_ext AS object
			JOIN namespaces AS namespace ON namespace.oid = object.stxnamespace
			WHERE NOT namespace.is_system
			UNION ALL
			SELECT 'pg_extension'::regclass::oid, object.oid
			FROM pg_catalog.pg_extension AS object
			WHERE object.extname <> 'plpgsql'
			UNION ALL
			SELECT 'pg_foreign_data_wrapper'::regclass::oid, object.oid
			FROM pg_catalog.pg_foreign_data_wrapper AS object
			UNION ALL
			SELECT 'pg_foreign_server'::regclass::oid, object.oid
			FROM pg_catalog.pg_foreign_server AS object
			UNION ALL
			SELECT 'pg_user_mapping'::regclass::oid, object.oid
			FROM (
				SELECT umid AS oid
				FROM pg_catalog.pg_user_mappings
			) AS object
			UNION ALL
			SELECT 'pg_event_trigger'::regclass::oid, object.oid
			FROM pg_catalog.pg_event_trigger AS object
			UNION ALL
			SELECT 'pg_largeobject_metadata'::regclass::oid, object.oid
			FROM pg_catalog.pg_largeobject_metadata AS object
			UNION ALL
			SELECT 'pg_publication'::regclass::oid, object.oid
			FROM pg_catalog.pg_publication AS object
			UNION ALL
			SELECT 'pg_subscription'::regclass::oid, object.oid
			FROM pg_catalog.pg_subscription AS object
			JOIN database_metadata AS database_object
			  ON database_object.oid = object.subdbid
		),
		retained_system_object_addresses AS (
			SELECT
				'pg_namespace'::regclass::oid AS classoid,
				namespace.oid AS objoid,
				namespace.nspowner AS owneroid
			FROM namespaces AS namespace
			WHERE namespace.is_system
			UNION
			SELECT 'pg_class'::regclass::oid, object.oid, object.relowner
			FROM pg_catalog.pg_class AS object
			JOIN namespaces AS namespace ON namespace.oid = object.relnamespace
			WHERE namespace.is_system
			UNION
			SELECT 'pg_proc'::regclass::oid, object.oid, object.proowner
			FROM pg_catalog.pg_proc AS object
			JOIN namespaces AS namespace ON namespace.oid = object.pronamespace
			WHERE namespace.is_system
			UNION
			SELECT 'pg_type'::regclass::oid, object.oid, object.typowner
			FROM pg_catalog.pg_type AS object
			JOIN namespaces AS namespace ON namespace.oid = object.typnamespace
			WHERE namespace.is_system
			UNION
			SELECT 'pg_collation'::regclass::oid, object.oid, object.collowner
			FROM pg_catalog.pg_collation AS object
			JOIN namespaces AS namespace ON namespace.oid = object.collnamespace
			WHERE namespace.is_system
			UNION
			SELECT 'pg_conversion'::regclass::oid, object.oid, object.conowner
			FROM pg_catalog.pg_conversion AS object
			JOIN namespaces AS namespace ON namespace.oid = object.connamespace
			WHERE namespace.is_system
			UNION
			SELECT 'pg_ts_parser'::regclass::oid, object.oid, 0::oid
			FROM pg_catalog.pg_ts_parser AS object
			JOIN namespaces AS namespace ON namespace.oid = object.prsnamespace
			WHERE namespace.is_system
			UNION
			SELECT 'pg_ts_dict'::regclass::oid, object.oid, object.dictowner
			FROM pg_catalog.pg_ts_dict AS object
			JOIN namespaces AS namespace ON namespace.oid = object.dictnamespace
			WHERE namespace.is_system
			UNION
			SELECT 'pg_ts_template'::regclass::oid, object.oid, 0::oid
			FROM pg_catalog.pg_ts_template AS object
			JOIN namespaces AS namespace ON namespace.oid = object.tmplnamespace
			WHERE namespace.is_system
			UNION
			SELECT 'pg_ts_config'::regclass::oid, object.oid, object.cfgowner
			FROM pg_catalog.pg_ts_config AS object
			JOIN namespaces AS namespace ON namespace.oid = object.cfgnamespace
			WHERE namespace.is_system
			UNION
			SELECT 'pg_operator'::regclass::oid, object.oid, object.oprowner
			FROM pg_catalog.pg_operator AS object
			JOIN namespaces AS namespace ON namespace.oid = object.oprnamespace
			WHERE namespace.is_system
			UNION
			SELECT 'pg_opclass'::regclass::oid, object.oid, object.opcowner
			FROM pg_catalog.pg_opclass AS object
			JOIN namespaces AS namespace ON namespace.oid = object.opcnamespace
			WHERE namespace.is_system
			UNION
			SELECT 'pg_opfamily'::regclass::oid, object.oid, object.opfowner
			FROM pg_catalog.pg_opfamily AS object
			JOIN namespaces AS namespace ON namespace.oid = object.opfnamespace
			WHERE namespace.is_system
			UNION
			SELECT 'pg_statistic_ext'::regclass::oid, object.oid, object.stxowner
			FROM pg_catalog.pg_statistic_ext AS object
			JOIN namespaces AS namespace ON namespace.oid = object.stxnamespace
			WHERE namespace.is_system
			UNION
			SELECT 'pg_attrdef'::regclass::oid, object.oid, relation.relowner
			FROM pg_catalog.pg_attrdef AS object
			JOIN pg_catalog.pg_class AS relation ON relation.oid = object.adrelid
			JOIN namespaces AS namespace ON namespace.oid = relation.relnamespace
			WHERE namespace.is_system
			UNION
			SELECT 'pg_constraint'::regclass::oid, object.oid, 0::oid
			FROM pg_catalog.pg_constraint AS object
			JOIN namespaces AS namespace ON namespace.oid = object.connamespace
			WHERE namespace.is_system
			UNION
			SELECT 'pg_rewrite'::regclass::oid, object.oid, relation.relowner
			FROM pg_catalog.pg_rewrite AS object
			JOIN pg_catalog.pg_class AS relation ON relation.oid = object.ev_class
			JOIN namespaces AS namespace ON namespace.oid = relation.relnamespace
			WHERE namespace.is_system
			UNION
			SELECT 'pg_trigger'::regclass::oid, object.oid, relation.relowner
			FROM pg_catalog.pg_trigger AS object
			JOIN pg_catalog.pg_class AS relation ON relation.oid = object.tgrelid
			JOIN namespaces AS namespace ON namespace.oid = relation.relnamespace
			WHERE namespace.is_system
			UNION
			SELECT 'pg_policy'::regclass::oid, object.oid, relation.relowner
			FROM pg_catalog.pg_policy AS object
			JOIN pg_catalog.pg_class AS relation ON relation.oid = object.polrelid
			JOIN namespaces AS namespace ON namespace.oid = relation.relnamespace
			WHERE namespace.is_system
			UNION
			SELECT 'pg_amop'::regclass::oid, object.oid, family.opfowner
			FROM pg_catalog.pg_amop AS object
			JOIN pg_catalog.pg_opfamily AS family ON family.oid = object.amopfamily
			JOIN namespaces AS namespace ON namespace.oid = family.opfnamespace
			WHERE namespace.is_system
			UNION
			SELECT 'pg_amproc'::regclass::oid, object.oid, family.opfowner
			FROM pg_catalog.pg_amproc AS object
			JOIN pg_catalog.pg_opfamily AS family ON family.oid = object.amprocfamily
			JOIN namespaces AS namespace ON namespace.oid = family.opfnamespace
			WHERE namespace.is_system
			UNION
			SELECT 'pg_cast'::regclass::oid, object.oid, 0::oid
			FROM pg_catalog.pg_cast AS object
			UNION
			SELECT 'pg_transform'::regclass::oid, object.oid, 0::oid
			FROM pg_catalog.pg_transform AS object
			UNION
			SELECT 'pg_language'::regclass::oid, object.oid, object.lanowner
			FROM pg_catalog.pg_language AS object
			UNION
			SELECT 'pg_am'::regclass::oid, object.oid, 0::oid
			FROM pg_catalog.pg_am AS object
			UNION
			SELECT 'pg_extension'::regclass::oid, extension.oid, extension.extowner
			FROM plpgsql_extension AS extension
		),
		stable_system_definition_rows AS (
			SELECT
				'relation'::text AS object_kind,
				pg_catalog.format('%I.%I', namespace.nspname, object.relname)
					AS object_identity,
				pg_catalog.jsonb_build_object(
					'owner', pg_catalog.pg_get_userbyid(object.relowner),
					'kind', object.relkind,
					'persistence', object.relpersistence,
					'accessMethod', access_method.amname,
					'tablespace', tablespace.spcname,
					'rowSecurity', object.relrowsecurity,
					'forceRowSecurity', object.relforcerowsecurity,
					'replicaIdentity', object.relreplident,
					'isPartition', object.relispartition,
					'options', object.reloptions,
					'acl', COALESCE(
						(SELECT pg_catalog.jsonb_agg(item::text ORDER BY item::text)
						 FROM pg_catalog.unnest(object.relacl) AS item),
						'[]'::jsonb
					),
					'viewDefinition', CASE
						WHEN object.relkind IN ('v', 'm')
						THEN pg_catalog.pg_get_viewdef(object.oid, false)
						ELSE NULL
					END,
					'comment',
						pg_catalog.obj_description(object.oid, 'pg_class')
				) AS object_metadata
			FROM pg_catalog.pg_class AS object
			JOIN namespaces AS namespace ON namespace.oid = object.relnamespace
			LEFT JOIN pg_catalog.pg_am AS access_method
			  ON access_method.oid = object.relam
			LEFT JOIN pg_catalog.pg_tablespace AS tablespace
			  ON tablespace.oid = object.reltablespace
			WHERE namespace.is_system
			UNION ALL
			SELECT
				'column',
				pg_catalog.format(
					'%I.%I.%I',
					namespace.nspname,
					relation.relname,
					attribute.attname
				),
				pg_catalog.jsonb_build_object(
					'type',
						pg_catalog.format_type(
							attribute.atttypid,
							attribute.atttypmod
						),
					'notNull', attribute.attnotnull,
					'identity', attribute.attidentity,
					'generated', attribute.attgenerated,
					'storage', attribute.attstorage,
					'compression', attribute.attcompression,
					'statistics', attribute.attstattarget,
					'options', attribute.attoptions,
					'collation', collation_object.collname,
					'acl', COALESCE(
						(SELECT pg_catalog.jsonb_agg(item::text ORDER BY item::text)
						 FROM pg_catalog.unnest(attribute.attacl) AS item),
						'[]'::jsonb
					),
					'default',
						(SELECT pg_catalog.pg_get_expr(
							default_value.adbin,
							default_value.adrelid
						 )
						 FROM pg_catalog.pg_attrdef AS default_value
						 WHERE default_value.adrelid = attribute.attrelid
						   AND default_value.adnum = attribute.attnum),
					'comment',
						pg_catalog.col_description(
							attribute.attrelid,
							attribute.attnum
						)
				)
			FROM pg_catalog.pg_attribute AS attribute
			JOIN pg_catalog.pg_class AS relation
			  ON relation.oid = attribute.attrelid
			JOIN namespaces AS namespace ON namespace.oid = relation.relnamespace
			LEFT JOIN pg_catalog.pg_collation AS collation_object
			  ON collation_object.oid = attribute.attcollation
			WHERE namespace.is_system
			  AND attribute.attnum > 0
			  AND NOT attribute.attisdropped
			UNION ALL
			SELECT
				'routine',
				pg_catalog.format(
					'%I.%I(%s)',
					namespace.nspname,
					routine.proname,
					pg_catalog.pg_get_function_identity_arguments(routine.oid)
				),
				pg_catalog.jsonb_build_object(
					'owner', pg_catalog.pg_get_userbyid(routine.proowner),
					'language', language.lanname,
					'returnType', pg_catalog.pg_get_function_result(routine.oid),
					'kind', routine.prokind,
					'securityDefiner', routine.prosecdef,
					'leakproof', routine.proleakproof,
					'strict', routine.proisstrict,
					'returnsSet', routine.proretset,
					'volatility', routine.provolatile,
					'parallel', routine.proparallel,
					'support', routine.prosupport::regprocedure::text,
					'source', routine.prosrc,
					'binary', routine.probin,
					'config', routine.proconfig,
					'cost', routine.procost,
					'rows', routine.prorows,
					'acl', COALESCE(
						(SELECT pg_catalog.jsonb_agg(item::text ORDER BY item::text)
						 FROM pg_catalog.unnest(routine.proacl) AS item),
						'[]'::jsonb
					),
					'comment',
						pg_catalog.obj_description(routine.oid, 'pg_proc')
				)
			FROM pg_catalog.pg_proc AS routine
			JOIN namespaces AS namespace ON namespace.oid = routine.pronamespace
			JOIN pg_catalog.pg_language AS language
			  ON language.oid = routine.prolang
			WHERE namespace.is_system
			UNION ALL
			SELECT
				'type',
				pg_catalog.format('%I.%I', namespace.nspname, type_object.typname),
				pg_catalog.jsonb_build_object(
					'owner', pg_catalog.pg_get_userbyid(type_object.typowner),
					'kind', type_object.typtype,
					'category', type_object.typcategory,
					'length', type_object.typlen,
					'byValue', type_object.typbyval,
					'alignment', type_object.typalign,
					'storage', type_object.typstorage,
					'notNull', type_object.typnotnull,
					'preferred', type_object.typispreferred,
					'defined', type_object.typisdefined,
					'delimiter', type_object.typdelim,
					'default', type_object.typdefault,
					'baseType',
						pg_catalog.format_type(type_object.typbasetype, NULL),
					'elementType',
						pg_catalog.format_type(type_object.typelem, NULL),
					'collation', collation_object.collname,
					'acl', COALESCE(
						(SELECT pg_catalog.jsonb_agg(item::text ORDER BY item::text)
						 FROM pg_catalog.unnest(type_object.typacl) AS item),
						'[]'::jsonb
					),
					'comment',
						pg_catalog.obj_description(type_object.oid, 'pg_type')
				)
			FROM pg_catalog.pg_type AS type_object
			JOIN namespaces AS namespace ON namespace.oid = type_object.typnamespace
			LEFT JOIN pg_catalog.pg_collation AS collation_object
			  ON collation_object.oid = type_object.typcollation
			WHERE namespace.is_system
			UNION ALL
			SELECT
				'constraint',
				pg_catalog.format(
					'%I.%I',
					namespace.nspname,
					constraint_object.conname
				),
				pg_catalog.jsonb_build_object(
					'type', constraint_object.contype,
					'definition',
						pg_catalog.pg_get_constraintdef(
							constraint_object.oid,
							false
						),
					'deferrable', constraint_object.condeferrable,
					'deferred', constraint_object.condeferred,
					'validated', constraint_object.convalidated,
					'comment',
						pg_catalog.obj_description(
							constraint_object.oid,
							'pg_constraint'
						)
				)
			FROM pg_catalog.pg_constraint AS constraint_object
			JOIN namespaces AS namespace
			  ON namespace.oid = constraint_object.connamespace
			WHERE namespace.is_system
			UNION ALL
			SELECT
				'cast',
				pg_catalog.format(
					'%s->%s',
					pg_catalog.format_type(cast_object.castsource, NULL),
					pg_catalog.format_type(cast_object.casttarget, NULL)
				),
				pg_catalog.jsonb_build_object(
					'context', cast_object.castcontext,
					'method', cast_object.castmethod,
					'function', cast_object.castfunc::regprocedure::text
				)
			FROM pg_catalog.pg_cast AS cast_object
			UNION ALL
			SELECT
				'language',
				language.lanname,
				pg_catalog.jsonb_build_object(
					'owner', pg_catalog.pg_get_userbyid(language.lanowner),
					'procedural', language.lanispl,
					'trusted', language.lanpltrusted,
					'handler', language.lanplcallfoid::regprocedure::text,
					'inline', language.laninline::regprocedure::text,
					'validator', language.lanvalidator::regprocedure::text,
					'acl', COALESCE(
						(SELECT pg_catalog.jsonb_agg(item::text ORDER BY item::text)
						 FROM pg_catalog.unnest(language.lanacl) AS item),
						'[]'::jsonb
					)
				)
			FROM pg_catalog.pg_language AS language
			UNION ALL
			SELECT
				'access-method',
				access_method.amname,
				pg_catalog.jsonb_build_object(
					'type', access_method.amtype,
					'handler', access_method.amhandler::regprocedure::text
				)
			FROM pg_catalog.pg_am AS access_method
			UNION ALL
			SELECT
				'extension',
				extension.extname,
				pg_catalog.jsonb_build_object(
					'owner', pg_catalog.pg_get_userbyid(extension.extowner),
					'schema', namespace.nspname,
					'relocatable', extension.extrelocatable,
					'version', extension.extversion,
					'comment',
						pg_catalog.obj_description(extension.oid, 'pg_extension')
				)
			FROM pg_catalog.pg_extension AS extension
			JOIN pg_catalog.pg_namespace AS namespace
			  ON namespace.oid = extension.extnamespace
			UNION ALL
			SELECT
				'parameter-acl',
				parameter_acl.parname,
				pg_catalog.jsonb_build_object(
					'acl', COALESCE(
						(SELECT pg_catalog.jsonb_agg(item::text ORDER BY item::text)
						 FROM pg_catalog.unnest(parameter_acl.paracl) AS item),
						'[]'::jsonb
					)
				)
			FROM pg_catalog.pg_parameter_acl AS parameter_acl
		),
		retained_acl_objects AS (
			SELECT
				'pg_namespace'::regclass::oid AS classoid,
				namespace.oid AS objoid,
				0 AS objsubid,
				namespace.nspacl AS acl,
				namespace.nspname AS namespace_name
			FROM namespaces AS namespace
			WHERE namespace.is_system
			UNION ALL
			SELECT
				'pg_class'::regclass::oid,
				object.oid,
				0,
				object.relacl,
				namespace.nspname
			FROM pg_catalog.pg_class AS object
			JOIN namespaces AS namespace ON namespace.oid = object.relnamespace
			WHERE namespace.is_system
			UNION ALL
			SELECT
				'pg_class'::regclass::oid,
				attribute.attrelid,
				attribute.attnum,
				attribute.attacl,
				namespace.nspname
			FROM pg_catalog.pg_attribute AS attribute
			JOIN pg_catalog.pg_class AS object ON object.oid = attribute.attrelid
			JOIN namespaces AS namespace ON namespace.oid = object.relnamespace
			WHERE namespace.is_system
			  AND attribute.attnum > 0
			  AND NOT attribute.attisdropped
			UNION ALL
			SELECT
				'pg_proc'::regclass::oid,
				object.oid,
				0,
				object.proacl,
				namespace.nspname
			FROM pg_catalog.pg_proc AS object
			JOIN namespaces AS namespace ON namespace.oid = object.pronamespace
			WHERE namespace.is_system
			UNION ALL
			SELECT
				'pg_type'::regclass::oid,
				object.oid,
				0,
				object.typacl,
				namespace.nspname
			FROM pg_catalog.pg_type AS object
			JOIN namespaces AS namespace ON namespace.oid = object.typnamespace
			WHERE namespace.is_system
			UNION ALL
			SELECT
				'pg_language'::regclass::oid,
				language.oid,
				0,
				language.lanacl,
				'pg_catalog'
			FROM plpgsql_language AS language
		),
		retained_acl_comparison AS (
			SELECT
				object.*,
				COALESCE(
					ARRAY(
						SELECT acl_item::text
						FROM pg_catalog.unnest(object.acl) AS acl_item
						ORDER BY acl_item::text
					),
					ARRAY[]::text[]
				) AS actual_acl,
				COALESCE(
					ARRAY(
						SELECT acl_item::text
						FROM pg_catalog.unnest(initial.initprivs) AS acl_item
						ORDER BY acl_item::text
					),
					ARRAY[]::text[]
				) AS initial_acl
			FROM retained_acl_objects AS object
			LEFT JOIN pg_catalog.pg_init_privs AS initial
			  ON initial.classoid = object.classoid
			 AND initial.objoid = object.objoid
			 AND initial.objsubid = object.objsubid
		),
		custom_comments AS (
			SELECT description.objoid
			FROM pg_catalog.pg_description AS description
			JOIN custom_object_addresses AS object
			  ON object.classoid = description.classoid
			 AND object.objoid = description.objoid
			UNION ALL
			SELECT description.objoid
			FROM pg_catalog.pg_shdescription AS description
			JOIN database_metadata AS database_object
			  ON description.classoid = 'pg_database'::regclass
			 AND description.objoid = database_object.oid
		),
		custom_security_labels AS (
			SELECT label.objoid
			FROM pg_catalog.pg_seclabel AS label
			JOIN custom_object_addresses AS object
			  ON object.classoid = label.classoid
			 AND object.objoid = label.objoid
			UNION ALL
			SELECT label.objoid
			FROM pg_catalog.pg_seclabel AS label
			JOIN public_schema AS namespace
			  ON label.classoid = 'pg_namespace'::regclass
			 AND label.objoid = namespace.oid
			UNION ALL
			SELECT label.objoid
			FROM pg_catalog.pg_shseclabel AS label
			JOIN database_metadata AS database_object
			  ON label.classoid = 'pg_database'::regclass
			 AND label.objoid = database_object.oid
		),
		retained_system_comments AS (
			SELECT
				description.classoid,
				description.objoid,
				description.objsubid,
				description.description
			FROM pg_catalog.pg_description AS description
			JOIN retained_system_object_addresses AS object
			  ON object.classoid = description.classoid
			 AND object.objoid = description.objoid
		),
		retained_system_security_labels AS (
			SELECT label.objoid
			FROM pg_catalog.pg_seclabel AS label
			JOIN retained_system_object_addresses AS object
			  ON object.classoid = label.classoid
			 AND object.objoid = label.objoid
		)
		SELECT pg_catalog.jsonb_build_object(
			'database', pg_catalog.current_database(),
			'sessionUser', session_user,
			'currentUser', current_user,
			'serverVersionNum', pg_catalog.current_setting('server_version_num')::integer,
			'databaseOwner',
				(SELECT database_owner FROM database_metadata),
			'ownerRoleSuperuser',
				(SELECT rolsuper FROM database_owner_role),
			'ownerRoleInherit',
				(SELECT rolinherit FROM database_owner_role),
			'ownerRoleCreateRole',
				(SELECT rolcreaterole FROM database_owner_role),
			'ownerRoleCreateDatabase',
				(SELECT rolcreatedb FROM database_owner_role),
			'ownerRoleCanLogin',
				(SELECT rolcanlogin FROM database_owner_role),
			'ownerRoleReplication',
				(SELECT rolreplication FROM database_owner_role),
			'ownerRoleBypassRls',
				(SELECT rolbypassrls FROM database_owner_role),
			'ownerRoleConnectionLimit',
				(SELECT rolconnlimit FROM database_owner_role),
			'ownerRoleValidUntil',
				(SELECT rolvaliduntil::text FROM database_owner_role),
			'ownerRoleConfigIsNull',
				(SELECT rolconfig IS NULL FROM database_owner_role),
			'ownerRoleCommentPresent',
				(SELECT pg_catalog.shobj_description(oid, 'pg_authid') IS NOT NULL
				 FROM database_owner_role),
			'databaseEncoding',
				(SELECT database_encoding FROM database_metadata),
			'databaseCollate',
				(SELECT datcollate FROM database_metadata),
			'databaseCtype',
				(SELECT datctype FROM database_metadata),
			'databaseLocaleProvider',
				(SELECT datlocprovider::text FROM database_metadata),
			'databaseIcuLocale',
				(SELECT daticulocale FROM database_metadata),
			'databaseIcuRules',
				(SELECT daticurules FROM database_metadata),
			'databaseCollationVersion',
				(SELECT datcollversion FROM database_metadata),
			'databaseTablespace',
				(SELECT database_tablespace FROM database_metadata),
			'databaseIsTemplate',
				(SELECT datistemplate FROM database_metadata),
			'databaseAllowsConnections',
				(SELECT datallowconn FROM database_metadata),
			'databaseConnectionLimit',
				(SELECT datconnlimit FROM database_metadata),
			'databaseComment',
				(SELECT pg_catalog.shobj_description(oid, 'pg_database')
				 FROM database_metadata),
			'publicSchemaOwner',
				(SELECT schema_owner FROM public_schema),
			'publicSchemaComment',
				(SELECT schema_comment FROM public_schema),
			'plpgsqlExtensionOwner',
				(SELECT pg_catalog.pg_get_userbyid(extowner)
				 FROM plpgsql_extension),
			'plpgsqlExtensionVersion',
				(SELECT extversion
				 FROM plpgsql_extension),
			'plpgsqlExtensionSchema',
				(SELECT namespace.nspname
				 FROM plpgsql_extension AS extension
				 JOIN pg_catalog.pg_namespace AS namespace
				   ON namespace.oid = extension.extnamespace),
			'plpgsqlExtensionRelocatable',
				(SELECT extrelocatable
				 FROM plpgsql_extension),
			'plpgsqlExtensionCommentIsDefault',
				(SELECT pg_catalog.obj_description(oid, 'pg_extension') =
					'PL/pgSQL procedural language'
				 FROM plpgsql_extension),
			'plpgsqlLanguageOwner',
				(SELECT pg_catalog.pg_get_userbyid(lanowner)
				 FROM plpgsql_language),
			'plpgsqlLanguageTrusted',
				(SELECT lanpltrusted
				 FROM plpgsql_language),
			'plpgsqlLanguageCommentIsDefault',
				(SELECT pg_catalog.obj_description(oid, 'pg_language') =
					'PL/pgSQL procedural language'
				 FROM plpgsql_language),
			'plpgsqlOwnerSuperuser',
				(SELECT rolsuper FROM plpgsql_owner_role),
			'plpgsqlRoutineOwnersMatch',
				(SELECT COUNT(*) = 3 AND pg_catalog.bool_and(
					routine.proowner = extension.extowner
				)
				 FROM pg_catalog.pg_proc AS routine
				 CROSS JOIN plpgsql_extension AS extension
				 CROSS JOIN plpgsql_language AS language
				 WHERE routine.oid IN (
						language.lanplcallfoid,
						language.laninline,
						language.lanvalidator
				   )),
			'publicSchemas',
				(SELECT COUNT(*) FROM namespaces WHERE nspname = 'public'),
			'userSchemasBeyondPublic',
				(SELECT COUNT(*) FROM namespaces
				 WHERE NOT is_system AND nspname <> 'public'),
			'customRelations',
				(SELECT COUNT(*) FROM pg_catalog.pg_class AS object
				 JOIN namespaces AS namespace ON namespace.oid = object.relnamespace
				 WHERE NOT namespace.is_system),
			'customRoutines',
				(SELECT COUNT(*) FROM pg_catalog.pg_proc AS routine
				 JOIN namespaces AS namespace ON namespace.oid = routine.pronamespace
				 WHERE NOT namespace.is_system),
			'customTypes',
				(SELECT COUNT(*) FROM pg_catalog.pg_type AS object_type
				 JOIN namespaces AS namespace
				   ON namespace.oid = object_type.typnamespace
				 WHERE NOT namespace.is_system)
		) || pg_catalog.jsonb_build_object(
			'customCollations',
				(SELECT COUNT(*) FROM pg_catalog.pg_collation AS object
				 JOIN namespaces AS namespace
				   ON namespace.oid = object.collnamespace
				 WHERE NOT namespace.is_system),
			'customConversions',
				(SELECT COUNT(*) FROM pg_catalog.pg_conversion AS object
				 JOIN namespaces AS namespace
				   ON namespace.oid = object.connamespace
				 WHERE NOT namespace.is_system),
			'customTextSearchParsers',
				(SELECT COUNT(*) FROM pg_catalog.pg_ts_parser AS object
				 JOIN namespaces AS namespace
				   ON namespace.oid = object.prsnamespace
				 WHERE NOT namespace.is_system),
			'customTextSearchDictionaries',
				(SELECT COUNT(*) FROM pg_catalog.pg_ts_dict AS object
				 JOIN namespaces AS namespace
				   ON namespace.oid = object.dictnamespace
				 WHERE NOT namespace.is_system),
			'customTextSearchTemplates',
				(SELECT COUNT(*) FROM pg_catalog.pg_ts_template AS object
				 JOIN namespaces AS namespace
				   ON namespace.oid = object.tmplnamespace
				 WHERE NOT namespace.is_system),
			'customTextSearchConfigurations',
				(SELECT COUNT(*) FROM pg_catalog.pg_ts_config AS object
				 JOIN namespaces AS namespace
				   ON namespace.oid = object.cfgnamespace
				 WHERE NOT namespace.is_system),
			'customOperators',
				(SELECT COUNT(*) FROM pg_catalog.pg_operator AS object
				 JOIN namespaces AS namespace
				   ON namespace.oid = object.oprnamespace
				 WHERE NOT namespace.is_system),
			'customOperatorClasses',
				(SELECT COUNT(*) FROM pg_catalog.pg_opclass AS object
				 JOIN namespaces AS namespace
				   ON namespace.oid = object.opcnamespace
				 WHERE NOT namespace.is_system),
			'customOperatorFamilies',
				(SELECT COUNT(*) FROM pg_catalog.pg_opfamily AS object
				 JOIN namespaces AS namespace
				   ON namespace.oid = object.opfnamespace
				 WHERE NOT namespace.is_system),
			'customStatistics',
				(SELECT COUNT(*) FROM pg_catalog.pg_statistic_ext AS object
				 JOIN namespaces AS namespace
				   ON namespace.oid = object.stxnamespace
				 WHERE NOT namespace.is_system),
			'plpgsqlExtensions',
				(SELECT COUNT(*) FROM pg_catalog.pg_extension WHERE extname = 'plpgsql'),
			'plpgsqlLanguages',
				(SELECT COUNT(*) FROM pg_catalog.pg_language WHERE lanname = 'plpgsql'),
			'customExtensions',
				(SELECT COUNT(*) FROM pg_catalog.pg_extension WHERE extname <> 'plpgsql'),
			'foreignDataWrappers',
				(SELECT COUNT(*) FROM pg_catalog.pg_foreign_data_wrapper),
			'foreignServers',
				(SELECT COUNT(*) FROM pg_catalog.pg_foreign_server),
			'foreignUserMappings',
				(SELECT COUNT(*) FROM pg_catalog.pg_user_mappings),
			'eventTriggers',
				(SELECT COUNT(*) FROM pg_catalog.pg_event_trigger),
			'largeObjects',
				(SELECT COUNT(*) FROM pg_catalog.pg_largeobject_metadata),
			'publications',
				(SELECT COUNT(*) FROM pg_catalog.pg_publication),
			'subscriptions',
				(SELECT COUNT(*) FROM pg_catalog.pg_subscription AS subscription
				 JOIN database_metadata AS database_object
				   ON database_object.oid = subscription.subdbid),
			'customComments',
				(SELECT COUNT(*) FROM custom_comments),
			'customSecurityLabels',
				(SELECT COUNT(*) FROM custom_security_labels),
			'databaseDefaultAcls',
				(SELECT COUNT(*) FROM pg_catalog.pg_default_acl),
			'databaseSettings',
				(SELECT COUNT(*) FROM pg_catalog.pg_db_role_setting AS setting
				 JOIN database_metadata AS database_object
				   ON database_object.oid = setting.setdatabase),
			'ownerRoleMemberships',
				(SELECT COUNT(*)
				 FROM pg_catalog.pg_auth_members AS membership
				 JOIN database_owner_role AS role
				   ON membership.member = role.oid),
			'ownerRoleGrantedMemberships',
				(SELECT COUNT(*)
				 FROM pg_catalog.pg_auth_members AS membership
				 JOIN database_owner_role AS role
				   ON membership.roleid = role.oid),
			'ownerRoleSettings',
				(SELECT COUNT(*)
				 FROM pg_catalog.pg_db_role_setting AS setting
				 JOIN database_owner_role AS role
				   ON setting.setrole = role.oid),
			'ownerRoleSecurityLabels',
				(SELECT COUNT(*)
				 FROM pg_catalog.pg_shseclabel AS label
				 JOIN database_owner_role AS role
				   ON label.classoid = 'pg_authid'::regclass
				  AND label.objoid = role.oid),
			'otherDatabaseSessions',
				(SELECT COUNT(*)
				 FROM pg_catalog.pg_stat_activity AS activity
				 WHERE activity.datname = pg_catalog.current_database()
				   AND activity.pid <> pg_catalog.pg_backend_pid()),
			'preparedTransactions',
				(SELECT COUNT(*)
				 FROM pg_catalog.pg_prepared_xacts AS prepared
				 WHERE prepared.database = pg_catalog.current_database()),
			'retainedSystemAclDrift',
				(SELECT COUNT(*)
				 FROM retained_acl_comparison AS comparison
				 WHERE comparison.actual_acl IS DISTINCT FROM comparison.initial_acl
				   AND NOT (
						comparison.namespace_name = 'information_schema' AND
						comparison.objsubid = 0 AND
						comparison.classoid IN (
							'pg_namespace'::regclass::oid,
							'pg_class'::regclass::oid
						)
				   )),
			'informationSchemaAclDrift',
				(
					(SELECT COUNT(*)
					 FROM pg_catalog.pg_namespace AS namespace
					 WHERE namespace.nspname = 'information_schema'
					   AND (
							(SELECT COUNT(*)
							 FROM pg_catalog.aclexplode(namespace.nspacl)) <> 3 OR
							(SELECT COUNT(*)
							 FROM pg_catalog.aclexplode(namespace.nspacl) AS acl
							 WHERE acl.grantee = 0
							   AND acl.privilege_type = 'USAGE') <> 1 OR
							(SELECT COUNT(*)
							 FROM pg_catalog.aclexplode(namespace.nspacl) AS acl
							 WHERE acl.grantee = namespace.nspowner
							   AND acl.privilege_type IN ('CREATE', 'USAGE')) <> 2 OR
							(SELECT COUNT(*)
							 FROM pg_catalog.aclexplode(namespace.nspacl) AS acl
							 WHERE acl.grantor <> namespace.nspowner
							    OR acl.is_grantable) <> 0
					   )) +
					(SELECT COUNT(*)
					 FROM pg_catalog.pg_class AS object
					 JOIN pg_catalog.pg_namespace AS namespace
					   ON namespace.oid = object.relnamespace
					 WHERE namespace.nspname = 'information_schema'
					   AND (
							(
								object.relname IN (
									'_pg_foreign_data_wrappers',
									'_pg_foreign_servers',
									'_pg_foreign_table_columns',
									'_pg_foreign_tables',
									'_pg_user_mappings',
									'sql_parts',
									'transforms'
								) AND
								object.relacl IS NOT NULL
							) OR
							(
								object.relname NOT IN (
									'_pg_foreign_data_wrappers',
									'_pg_foreign_servers',
									'_pg_foreign_table_columns',
									'_pg_foreign_tables',
									'_pg_user_mappings',
									'sql_parts',
									'transforms'
								) AND (
									(SELECT COUNT(*)
									 FROM pg_catalog.aclexplode(object.relacl)) <> 8 OR
									(SELECT COUNT(*)
									 FROM pg_catalog.aclexplode(object.relacl) AS acl
									 WHERE acl.grantee = 0
									   AND acl.privilege_type = 'SELECT') <> 1 OR
									(SELECT COUNT(*)
									 FROM pg_catalog.aclexplode(object.relacl) AS acl
									 WHERE acl.grantee = object.relowner
									   AND acl.privilege_type IN (
											'INSERT',
											'SELECT',
											'UPDATE',
											'DELETE',
											'TRUNCATE',
											'REFERENCES',
											'TRIGGER'
									   )) <> 7 OR
									(SELECT COUNT(*)
									 FROM pg_catalog.aclexplode(object.relacl) AS acl
									 WHERE acl.grantor <> object.relowner
									    OR acl.is_grantable) <> 0
								)
							)
					   ))
				),
			'retainedSystemCommentsDigest',
				(SELECT pg_catalog.encode(
					pg_catalog.sha256(pg_catalog.convert_to(
						COALESCE(
							pg_catalog.jsonb_agg(
								pg_catalog.jsonb_build_array(
									identity.type,
									identity.object_names,
									identity.object_args,
									comment.description
								)
								ORDER BY
									identity.type,
									identity.object_names::text,
									identity.object_args::text
							)::text,
							'[]'
						),
						'UTF8'
					)),
					'hex'
				 )
				 FROM retained_system_comments AS comment
				 CROSS JOIN LATERAL pg_catalog.pg_identify_object_as_address(
					comment.classoid,
					comment.objoid,
					comment.objsubid
				 ) AS identity),
			'retainedSystemSecurityLabels',
				(SELECT COUNT(*) FROM retained_system_security_labels),
			'plpgsqlRoutineComments',
				(SELECT COUNT(*)
				 FROM pg_catalog.pg_description AS description
				 JOIN pg_catalog.pg_proc AS routine
				   ON description.classoid = 'pg_proc'::regclass
				  AND description.objoid = routine.oid
				  AND description.objsubid = 0
				 JOIN pg_catalog.pg_namespace AS namespace
				   ON namespace.oid = routine.pronamespace
				 WHERE namespace.nspname = 'pg_catalog'
				   AND routine.proname IN (
						'plpgsql_call_handler',
						'plpgsql_inline_handler',
						'plpgsql_validator'
				   )),
			'prismaMigrations',
				(SELECT COUNT(*)
				 FROM pg_catalog.pg_class AS relation
				 JOIN pg_catalog.pg_namespace AS namespace
				   ON namespace.oid = relation.relnamespace
				 WHERE namespace.nspname = 'public'
				   AND relation.relname = '_prisma_migrations'),
			'parameterAcls',
				(SELECT COUNT(*) FROM pg_catalog.pg_parameter_acl),
			'sessionCanCreateDatabaseObjects',
				pg_catalog.has_database_privilege(
					current_user,
					pg_catalog.current_database(),
					'CREATE'
				),
			'sessionCanCreatePgCatalogObjects',
				pg_catalog.has_schema_privilege(
					current_user,
					'pg_catalog',
					'CREATE'
				),
			'sessionCanCreateInformationSchemaObjects',
				pg_catalog.has_schema_privilege(
					current_user,
					'information_schema',
					'CREATE'
				),
			'sessionCanCreatePublicSchemaObjects',
				pg_catalog.has_schema_privilege(
					current_user,
					'public',
					'CREATE'
				),
			'sessionIsDatabaseOwnerMember',
				pg_catalog.pg_has_role(
					current_user,
					(SELECT datdba FROM database_metadata),
					'MEMBER'
				)
		) || pg_catalog.jsonb_build_object(
			'databaseAclIsNull',
				(SELECT datacl IS NULL FROM database_metadata),
			'databaseAclPrivileges',
				(SELECT COUNT(*) FROM database_acl),
			'databasePublicCreatePrivileges',
				(SELECT COUNT(*) FROM database_acl
				 WHERE grantee = 0 AND privilege_type = 'CREATE'),
			'databasePublicConnectPrivileges',
				(SELECT COUNT(*) FROM database_acl
				 WHERE grantee = 0 AND privilege_type = 'CONNECT'),
			'databasePublicTemporaryPrivileges',
				(SELECT COUNT(*) FROM database_acl
				 WHERE grantee = 0 AND privilege_type = 'TEMPORARY'),
			'databaseOwnerCreatePrivileges',
				(SELECT COUNT(*) FROM database_acl AS acl
				 JOIN database_metadata AS database_object
				   ON acl.grantee = database_object.datdba
				 WHERE acl.privilege_type = 'CREATE'),
			'databaseOwnerConnectPrivileges',
				(SELECT COUNT(*) FROM database_acl AS acl
				 JOIN database_metadata AS database_object
				   ON acl.grantee = database_object.datdba
				 WHERE acl.privilege_type = 'CONNECT'),
			'databaseOwnerTemporaryPrivileges',
				(SELECT COUNT(*) FROM database_acl AS acl
				 JOIN database_metadata AS database_object
				   ON acl.grantee = database_object.datdba
				 WHERE acl.privilege_type = 'TEMPORARY'),
			'databaseOtherPrivileges',
				(SELECT COUNT(*) FROM database_acl AS acl
				 JOIN database_metadata AS database_object ON TRUE
				 WHERE acl.grantee <> 0
				   AND acl.grantee <> database_object.datdba),
			'databaseGrantOptions',
				(SELECT COUNT(*) FROM database_acl WHERE is_grantable),
			'databaseUnexpectedAclGrantors',
				(SELECT COUNT(*) FROM database_acl AS acl
				 JOIN database_metadata AS database_object
				   ON acl.grantor <> database_object.datdba),
			'publicSchemaAclIsNull',
				(SELECT nspacl IS NULL FROM public_schema),
			'publicSchemaAclPrivileges',
				(SELECT COUNT(*) FROM public_schema_acl),
			'publicSchemaOwnerCreatePrivileges',
				(SELECT COUNT(*) FROM public_schema_acl AS acl
				 JOIN public_schema AS namespace ON acl.grantee = namespace.nspowner
				 WHERE acl.privilege_type = 'CREATE'),
			'publicSchemaOwnerUsagePrivileges',
				(SELECT COUNT(*) FROM public_schema_acl AS acl
				 JOIN public_schema AS namespace ON acl.grantee = namespace.nspowner
				 WHERE acl.privilege_type = 'USAGE'),
			'publicSchemaPublicCreatePrivileges',
				(SELECT COUNT(*) FROM public_schema_acl
				 WHERE grantee = 0 AND privilege_type = 'CREATE'),
			'publicSchemaPublicUsagePrivileges',
				(SELECT COUNT(*) FROM public_schema_acl
				 WHERE grantee = 0 AND privilege_type = 'USAGE'),
			'publicSchemaOtherPrivileges',
				(SELECT COUNT(*) FROM public_schema_acl AS acl
				 JOIN public_schema AS namespace ON TRUE
				 WHERE acl.grantee <> 0
				   AND acl.grantee <> namespace.nspowner),
			'publicSchemaGrantOptions',
				(SELECT COUNT(*) FROM public_schema_acl WHERE is_grantable),
			'publicSchemaUnexpectedAclGrantors',
				(SELECT COUNT(*) FROM public_schema_acl AS acl
				 JOIN public_schema AS namespace
				   ON acl.grantor <> namespace.nspowner)
		) || pg_catalog.jsonb_build_object(
			'plpgsqlRoutineDefinitionSignature',
				(SELECT pg_catalog.encode(
					pg_catalog.sha256(pg_catalog.convert_to(
						pg_catalog.jsonb_agg(
							pg_catalog.jsonb_build_array(
								pg_catalog.format(
									'%I.%I(%s)',
									namespace.nspname,
									routine.proname,
									pg_catalog.pg_get_function_identity_arguments(
										routine.oid
									)
								),
								routine.proname,
								pg_catalog.pg_get_userbyid(routine.proowner),
								language.lanname,
								pg_catalog.pg_get_function_result(routine.oid),
								routine.prokind,
								routine.prosecdef,
								routine.proleakproof,
								routine.proisstrict,
								routine.proretset,
								routine.provolatile,
								routine.proparallel,
								routine.prosrc,
								routine.probin,
								routine.proconfig,
								COALESCE(
									(SELECT pg_catalog.jsonb_agg(
										item::text ORDER BY item::text
									 )
									 FROM pg_catalog.unnest(routine.proacl) AS item),
									'[]'::jsonb
								)
							)
							ORDER BY routine.proname
						)::text,
						'UTF8'
					)),
					'hex'
				 )
				 FROM pg_catalog.pg_proc AS routine
				 JOIN pg_catalog.pg_namespace AS namespace
				   ON namespace.oid = routine.pronamespace
				 JOIN pg_catalog.pg_language AS language
				   ON language.oid = routine.prolang
				 CROSS JOIN plpgsql_language AS plpgsql
				 WHERE namespace.nspname = 'pg_catalog'
				   AND routine.oid IN (
						plpgsql.lanplcallfoid,
						plpgsql.laninline,
						plpgsql.lanvalidator
				   )),
			'retainedSystemObjects',
				(SELECT COUNT(*) FROM retained_system_object_addresses),
			'retainedSystemObjectsDigest',
				(SELECT pg_catalog.encode(
					pg_catalog.sha256(pg_catalog.convert_to(
						COALESCE(
							pg_catalog.jsonb_agg(
								pg_catalog.jsonb_build_array(
									identity.type,
									identity.object_names,
									identity.object_args,
									CASE
										WHEN object.owneroid = 0 THEN NULL
										ELSE pg_catalog.pg_get_userbyid(
											object.owneroid
										)
									END
								)
								ORDER BY
									identity.type,
									identity.object_names::text,
									identity.object_args::text
							)::text,
							'[]'
						),
						'UTF8'
					)),
					'hex'
				 )
				 FROM retained_system_object_addresses AS object
				 CROSS JOIN LATERAL pg_catalog.pg_identify_object_as_address(
					object.classoid,
					object.objoid,
					0
				 ) AS identity),
			'retainedSystemDefinitionsDigest',
				(SELECT pg_catalog.encode(
					pg_catalog.sha256(pg_catalog.convert_to(
						COALESCE(
							pg_catalog.jsonb_agg(
								pg_catalog.jsonb_build_array(
									definition.object_kind,
									definition.object_identity,
									definition.object_metadata
								)
								ORDER BY
									definition.object_kind,
									definition.object_identity
							)::text,
							'[]'
						),
						'UTF8'
					)),
					'hex'
				 )
				 FROM stable_system_definition_rows AS definition)
		);
	`
}

export function parsePristinePostgresFingerprint(stdout) {
	let fingerprint
	try {
		fingerprint = JSON.parse(stdout.trim())
	} catch {
		throw new Error('Could not parse pristine PostgreSQL fingerprint')
	}
	if (
		!fingerprint ||
		typeof fingerprint !== 'object' ||
		Array.isArray(fingerprint)
	) {
		throw new Error('Could not parse pristine PostgreSQL fingerprint')
	}
	const expectedFields = new Set([
		...PRISTINE_FINGERPRINT_STRING_FIELDS,
		...PRISTINE_FINGERPRINT_NULLABLE_STRING_FIELDS,
		...PRISTINE_FINGERPRINT_BOOLEAN_FIELDS,
		'databaseConnectionLimit',
		'ownerRoleConnectionLimit',
		'retainedSystemObjects',
		'serverVersionNum',
		'publicSchemaAclPrivileges',
		'publicSchemaPublicUsagePrivileges',
		...Object.keys(PRISTINE_FINGERPRINT_EXPECTATIONS),
	])
	const unexpectedField = Object.keys(fingerprint).find(
		field => !expectedFields.has(field),
	)
	if (unexpectedField) {
		throw new Error(
			`Unexpected pristine PostgreSQL fingerprint field: ${unexpectedField}`,
		)
	}
	for (const field of PRISTINE_FINGERPRINT_STRING_FIELDS) {
		if (typeof fingerprint?.[field] !== 'string' || !fingerprint[field]) {
			throw new Error(`Invalid pristine PostgreSQL fingerprint field: ${field}`)
		}
	}
	for (const field of PRISTINE_FINGERPRINT_NULLABLE_STRING_FIELDS) {
		if (
			fingerprint[field] !== null &&
			(typeof fingerprint[field] !== 'string' || !fingerprint[field])
		) {
			throw new Error(`Invalid pristine PostgreSQL fingerprint field: ${field}`)
		}
	}
	for (const field of PRISTINE_FINGERPRINT_BOOLEAN_FIELDS) {
		if (typeof fingerprint[field] !== 'boolean') {
			throw new Error(`Invalid pristine PostgreSQL fingerprint field: ${field}`)
		}
	}
	for (const field of [
		...Object.keys(PRISTINE_FINGERPRINT_EXPECTATIONS),
		'publicSchemaAclPrivileges',
		'publicSchemaPublicUsagePrivileges',
	]) {
		if (!Number.isSafeInteger(fingerprint?.[field]) || fingerprint[field] < 0) {
			throw new Error(`Invalid pristine PostgreSQL fingerprint field: ${field}`)
		}
	}
	if (
		!Number.isSafeInteger(fingerprint.databaseConnectionLimit) ||
		fingerprint.databaseConnectionLimit < -1
	) {
		throw new Error(
			'Invalid pristine PostgreSQL fingerprint field: databaseConnectionLimit',
		)
	}
	if (
		!Number.isSafeInteger(fingerprint.ownerRoleConnectionLimit) ||
		fingerprint.ownerRoleConnectionLimit < -1
	) {
		throw new Error(
			'Invalid pristine PostgreSQL fingerprint field: ownerRoleConnectionLimit',
		)
	}
	for (const field of ['retainedSystemObjects', 'serverVersionNum']) {
		if (!Number.isSafeInteger(fingerprint[field]) || fingerprint[field] < 1) {
			throw new Error(`Invalid pristine PostgreSQL fingerprint field: ${field}`)
		}
	}
	const missingField = [...expectedFields].find(
		field => !Object.hasOwn(fingerprint, field),
	)
	if (missingField) {
		throw new Error(
			`Invalid pristine PostgreSQL fingerprint field: ${missingField}`,
		)
	}
	return fingerprint
}

function fingerprintDiagnosticValue(field, value) {
	if (
		['databaseComment', 'publicSchemaComment'].includes(field) &&
		value !== null
	) {
		return '<non-default>'
	}
	return String(value)
}

export function assertPristinePostgresFingerprint(
	fingerprint,
	label,
	expectedConnection,
	mode = 'source',
	templateBaseline,
) {
	if (!PRISTINE_POSTGRES_FINGERPRINT_MODES.has(mode)) {
		throw new Error(`Invalid pristine PostgreSQL fingerprint mode: ${mode}`)
	}
	const differences = Object.entries(PRISTINE_FINGERPRINT_EXPECTATIONS)
		.filter(([field, expected]) => fingerprint?.[field] !== expected)
		.map(
			([field, expected]) =>
				`${field}=${fingerprintDiagnosticValue(field, fingerprint?.[field])} (expected ${expected})`,
		)
	const exactExpectations = {
		serverVersionNum: POSTGRES_BACKUP_SERVER_VERSION_NUM,
		databaseEncoding: 'UTF8',
		databaseTablespace: 'pg_default',
		databaseIsTemplate: false,
		databaseAllowsConnections: true,
		databaseConnectionLimit: -1,
		databaseComment: null,
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
		publicSchemaComment: mode === 'source' ? 'standard public schema' : null,
		plpgsqlExtensionVersion: '1.0',
		plpgsqlExtensionSchema: 'pg_catalog',
		plpgsqlExtensionRelocatable: false,
		plpgsqlExtensionCommentIsDefault: true,
		plpgsqlLanguageTrusted: true,
		plpgsqlLanguageCommentIsDefault: true,
		plpgsqlOwnerSuperuser: true,
		plpgsqlRoutineOwnersMatch: true,
		sessionCanCreateDatabaseObjects: true,
		sessionCanCreatePgCatalogObjects: false,
		sessionCanCreateInformationSchemaObjects: false,
		sessionCanCreatePublicSchemaObjects: true,
		sessionIsDatabaseOwnerMember: true,
		databaseAclIsNull: false,
		publicSchemaAclIsNull: mode === 'restored',
		publicSchemaAclPrivileges: mode === 'source' ? 3 : 2,
		publicSchemaPublicUsagePrivileges: mode === 'source' ? 1 : 0,
	}
	for (const [field, expected] of Object.entries(exactExpectations)) {
		if (fingerprint?.[field] !== expected) {
			differences.push(
				`${field}=${fingerprintDiagnosticValue(field, fingerprint?.[field])} (expected ${String(expected)})`,
			)
		}
	}
	if (!templateBaseline) {
		differences.push(
			'trustedTemplateBaseline=<missing> (expected protected template1 fingerprint)',
		)
	} else {
		for (const field of PRISTINE_TEMPLATE_BASELINE_FIELDS) {
			if (fingerprint?.[field] !== templateBaseline?.[field]) {
				differences.push(
					`${field}=${fingerprintDiagnosticValue(field, fingerprint?.[field])} (template1 ${fingerprintDiagnosticValue(field, templateBaseline?.[field])})`,
				)
			}
		}
	}
	if (
		fingerprint?.plpgsqlExtensionOwner !== fingerprint?.plpgsqlLanguageOwner
	) {
		differences.push(
			`plpgsqlLanguageOwner=${String(fingerprint?.plpgsqlLanguageOwner)} (expected ${String(fingerprint?.plpgsqlExtensionOwner)})`,
		)
	}
	if (
		expectedConnection &&
		fingerprint?.plpgsqlExtensionOwner === expectedConnection.user
	) {
		differences.push(
			'plpgsqlExtensionOwner=<database-owner> (expected a distinct PostgreSQL superuser)',
		)
	}
	if (
		expectedConnection &&
		fingerprint?.database !== expectedConnection.database
	) {
		differences.push(
			`database=${String(fingerprint?.database)} (expected ${expectedConnection.database})`,
		)
	}
	if (expectedConnection) {
		for (const field of ['sessionUser', 'currentUser', 'databaseOwner']) {
			if (fingerprint?.[field] !== expectedConnection.user) {
				differences.push(
					`${field}=${String(fingerprint?.[field])} (expected ${expectedConnection.user})`,
				)
			}
		}
		const expectedSchemaOwner =
			mode === 'source' ? 'pg_database_owner' : expectedConnection.user
		if (fingerprint?.publicSchemaOwner !== expectedSchemaOwner) {
			differences.push(
				`publicSchemaOwner=${String(fingerprint?.publicSchemaOwner)} (expected ${expectedSchemaOwner})`,
			)
		}
	}
	if (differences.length) {
		throw new Error(
			`${label} is not an exact pristine-empty-v1 PostgreSQL database: ${differences.join(', ')}`,
		)
	}
}

export function assertPristinePostgresRestoreParity(
	sourceFingerprint,
	restoredFingerprint,
) {
	const differences = PRISTINE_RESTORE_PARITY_FIELDS.filter(
		field => sourceFingerprint?.[field] !== restoredFingerprint?.[field],
	).map(
		field =>
			`${field}=${String(restoredFingerprint?.[field])} (source ${String(sourceFingerprint?.[field])})`,
	)
	if (differences.length) {
		throw new Error(
			`Restored pristine PostgreSQL database properties differ from source: ${differences.join(', ')}`,
		)
	}
}

export function assertTrustedPostgresTemplateFingerprint(
	fingerprint,
	expectedConnection,
	label = 'PostgreSQL template1 baseline',
) {
	const differences = []
	const exact = {
		database: 'template1',
		sessionUser: expectedConnection.user,
		currentUser: expectedConnection.user,
		serverVersionNum: POSTGRES_BACKUP_SERVER_VERSION_NUM,
		databaseIsTemplate: true,
		databaseAllowsConnections: true,
		ownerRoleSuperuser: true,
		sessionCanCreateDatabaseObjects: false,
		sessionCanCreatePgCatalogObjects: false,
		sessionCanCreateInformationSchemaObjects: false,
		sessionCanCreatePublicSchemaObjects: false,
		sessionIsDatabaseOwnerMember: false,
		parameterAcls: 0,
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
		databaseDefaultAcls: 0,
		retainedSystemAclDrift: 0,
		informationSchemaAclDrift: 0,
		retainedSystemSecurityLabels: 0,
		plpgsqlRoutineComments: 0,
	}
	for (const [field, expected] of Object.entries(exact)) {
		if (fingerprint?.[field] !== expected) {
			differences.push(
				`${field}=${fingerprintDiagnosticValue(field, fingerprint?.[field])} (expected ${String(expected)})`,
			)
		}
	}
	if (
		fingerprint?.databaseOwner === expectedConnection.user ||
		fingerprint?.plpgsqlExtensionOwner === expectedConnection.user
	) {
		differences.push(
			'template1 owner=<verification-role> (expected protected superuser ownership)',
		)
	}
	if (differences.length) {
		throw new Error(
			`${label} is not a protected PostgreSQL 16.14 template: ${differences.join(', ')}`,
		)
	}
}

async function readTrustedPostgresTemplateBaseline(psql, connection, label) {
	const templateConnection = {
		...connection,
		database: 'template1',
	}
	const sourceIdentity = await readPostgresEndpointIdentity(
		psql,
		connection,
		`${label} endpoint`,
	)
	const templateIdentity = await readPostgresEndpointIdentity(
		psql,
		templateConnection,
		`${label} template1`,
	)
	for (const field of [
		'serverAddress',
		'serverPort',
		'postmasterStartedAt',
		'serverVersionNum',
	]) {
		if (templateIdentity[field] !== sourceIdentity[field]) {
			throw new Error(
				`${label} template1 baseline resolved to a different PostgreSQL cluster`,
			)
		}
	}
	await assertPostgresClientVersion(psql, 'psql', templateConnection)
	const result = await run(
		psql,
		[
			'--no-psqlrc',
			'--set',
			'ON_ERROR_STOP=1',
			'--tuples-only',
			'--no-align',
			'--command',
			pristineFingerprintQuery(),
		],
		templateConnection,
		true,
	)
	const fingerprint = parsePristinePostgresFingerprint(result.stdout)
	assertTrustedPostgresTemplateFingerprint(
		fingerprint,
		templateConnection,
		`${label} template1 baseline`,
	)
	return fingerprint
}

async function readAndAssertPristinePostgresDatabase(
	psql,
	connection,
	label,
	mode,
) {
	const templateBaseline = await readTrustedPostgresTemplateBaseline(
		psql,
		connection,
		label,
	)
	await assertPostgresClientVersion(psql, 'psql', connection)
	const result = await run(
		psql,
		[
			'--no-psqlrc',
			'--set',
			'ON_ERROR_STOP=1',
			'--tuples-only',
			'--no-align',
			'--command',
			pristineFingerprintQuery(),
		],
		connection,
		true,
	)
	const fingerprint = parsePristinePostgresFingerprint(result.stdout)
	assertPristinePostgresFingerprint(
		fingerprint,
		label,
		connection,
		mode,
		templateBaseline,
	)
	return fingerprint
}

export async function assertPristinePostgresDatabase({
	connectionUrl,
	label = 'PostgreSQL backup source',
}) {
	const connection = parsePostgresConnection(connectionUrl, 'DATABASE_URL')
	return readAndAssertPristinePostgresDatabase(
		command('PSQL_BIN', 'psql'),
		connection,
		label,
		'source',
	)
}

export function verificationQuery(includeExpectedUsername) {
	return `
			SELECT
				(SELECT COUNT(*) FROM public."User")::text || '|' ||
				(SELECT COUNT(*) FROM public."Watchlist")::text || '|' ||
				(SELECT COUNT(*) FROM public."Entry")::text || '|' ||
				(SELECT COUNT(*) FROM public."Media")::text || '|' ||
				(SELECT COUNT(*) FROM public."_prisma_migrations"
				 WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::text || '|' ||
				(SELECT COUNT(*) FROM pg_catalog.pg_constraint
				 WHERE contype = 'f' AND NOT convalidated)::text || '|' ||
				(SELECT COUNT(*) FROM pg_catalog.pg_extension WHERE extname = 'pg_trgm')::text
				${includeExpectedUsername ? `|| '|' || (SELECT COUNT(*) FROM public."User" WHERE username = :'veud_expected_username')::text` : ''};
	`
}

export function postgresVerificationScriptArguments(expectedUsername) {
	return [
		'--no-psqlrc',
		'--set',
		'ON_ERROR_STOP=1',
		...(expectedUsername
			? ['--set', `veud_expected_username=${expectedUsername}`]
			: []),
		'--tuples-only',
		'--no-align',
		'--file=-',
	]
}

export function postgresRestoreSqlArguments(backupPath) {
	return [
		'--exit-on-error',
		'--no-owner',
		'--no-privileges',
		'--file=-',
		backupPath,
	]
}

async function listAppliedMigrations(psql, connection) {
	await assertPostgresClientVersion(psql, 'psql', connection)
	const result = await run(
		psql,
		[
			'--no-psqlrc',
			'--set',
			'ON_ERROR_STOP=1',
			'--tuples-only',
			'--no-align',
			'--command',
			`SELECT migration_name FROM public."_prisma_migrations"
				 WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
				 ORDER BY migration_name;`,
		],
		connection,
		true,
	)
	return result.stdout.split(/\r?\n/).filter(Boolean)
}

function waitForPostgresChild(child, label) {
	return new Promise((resolve, reject) => {
		child.once('error', error =>
			reject(
				new Error(`${label} failed to start`, {
					cause: error,
				}),
			),
		)
		child.once('close', (code, signal) => {
			if (code === 0) resolve()
			else {
				reject(
					new Error(
						`${label} failed (${signal ? `signal ${signal}` : `exit ${String(code)}`})`,
					),
				)
			}
		})
	})
}

function spawnCrashBoundPostgresChild(binary, args, options) {
	return spawn(
		POSTGRES_CRASH_BOUND_CHILD_EXECUTABLE,
		['--pdeathsig', 'SIGTERM', '--', binary, ...args],
		options,
	)
}

// A previous owner that was killed leaves the fence in place on purpose: the
// guardian retains CONNECTION LIMIT 1 so exactly one retry slot survives. The
// retry must therefore spend that slot on releasing the fence before the new
// guardian and restore session need two slots of their own. This is identity
// pinned and refuses to touch anything but the expected, currently idle
// target.
async function releasePostgresRestoreConnectionFence({
	psql,
	connection,
	identity,
}) {
	await runPostgresScript(
		psql,
		[
			'--no-psqlrc',
			'--set',
			'ON_ERROR_STOP=1',
			'--set',
			`veud_expected_database=${identity.database}`,
			'--set',
			`veud_expected_database_oid=${identity.databaseOid}`,
			'--set',
			`veud_expected_server_start=${identity.postmasterStartedAt}`,
			'--file=-',
		],
		connection,
		`SELECT 1 / CASE WHEN (
				pg_catalog.current_database() = :'veud_expected_database' AND
				(SELECT database_object.oid::text
				 FROM pg_catalog.pg_database AS database_object
				 WHERE database_object.datname = pg_catalog.current_database()) =
					:'veud_expected_database_oid' AND
				(
					EXTRACT(EPOCH FROM pg_catalog.pg_postmaster_start_time()) *
					1000000
				)::bigint::text = :'veud_expected_server_start' AND
				pg_catalog.current_setting('server_version_num')::integer =
					${POSTGRES_BACKUP_SERVER_VERSION_NUM} AND
				NOT EXISTS (
					SELECT 1
					FROM pg_catalog.pg_stat_activity AS activity
					WHERE activity.datname = pg_catalog.current_database()
					  AND activity.pid <> pg_catalog.pg_backend_pid()
				) AND
				NOT EXISTS (
					SELECT 1
					FROM pg_catalog.pg_prepared_xacts AS prepared
					WHERE prepared.database = pg_catalog.current_database()
				)
			) THEN 1 ELSE 0 END;
			ALTER DATABASE :"veud_expected_database" CONNECTION LIMIT -1;
		`,
	)
}

const POSTGRES_RESTORE_GUARDIAN_SCRIPT = fileURLToPath(
	new URL('./postgres-restore-guardian.mjs', import.meta.url),
)
const POSTGRES_RESTORE_GUARDIAN_START_TIMEOUT_MS = 30_000
const POSTGRES_RESTORE_GUARDIAN_RELEASE_TIMEOUT_MS = 20_000

// The guardian holds one extra backend, established before the restore
// session drops the database to CONNECTION LIMIT 1, so a SIGKILLed owner can
// still be recovered: crash-bound SIGTERM delivery makes the guardian
// terminate the orphaned restore backend, retain the limit, and exit — which
// leaves exactly one free slot for an immediate retry.
async function startPostgresRestoreGuardian({ psql, clientEnvironment }) {
	const child = spawnCrashBoundPostgresChild(
		process.execPath,
		[POSTGRES_RESTORE_GUARDIAN_SCRIPT],
		{
			env: { ...clientEnvironment, VEUD_GUARDIAN_PSQL: psql },
			stdio: ['pipe', 'pipe', 'inherit'],
		},
	)
	child.stdin.on('error', () => {})
	const backendPid = await new Promise((resolve, reject) => {
		let buffered = ''
		const timer = setTimeout(() => {
			child.kill('SIGKILL')
			reject(new Error('PostgreSQL restore guardian did not report a backend'))
		}, POSTGRES_RESTORE_GUARDIAN_START_TIMEOUT_MS)
		child.stdout.on('data', chunk => {
			buffered += chunk
			const match = /^VEUD_GUARDIAN_BACKEND:([0-9]{1,7})$/m.exec(buffered)
			if (match) {
				clearTimeout(timer)
				resolve(Number.parseInt(match[1], 10))
			}
		})
		child.once('error', error => {
			clearTimeout(timer)
			reject(
				new Error('PostgreSQL restore guardian failed to start', {
					cause: error,
				}),
			)
		})
		child.once('close', () => {
			clearTimeout(timer)
			reject(new Error('PostgreSQL restore guardian exited during startup'))
		})
	})
	if (!Number.isSafeInteger(backendPid) || backendPid < 1) {
		child.kill('SIGKILL')
		throw new Error('PostgreSQL restore guardian reported an invalid backend')
	}
	let released = false
	return {
		backendPid,
		// True only while the guardian is still able to rescue a crashed owner.
		alive: () => child.exitCode === null && child.signalCode === null,
		async release({ requireAlive = false } = {}) {
			if (released) return
			released = true
			const diedEarly = child.exitCode !== null || child.signalCode !== null
			await new Promise(resolve => {
				const timer = setTimeout(() => {
					child.kill('SIGKILL')
					resolve()
				}, POSTGRES_RESTORE_GUARDIAN_RELEASE_TIMEOUT_MS)
				child.once('close', () => {
					clearTimeout(timer)
					resolve()
				})
				if (diedEarly) {
					clearTimeout(timer)
					resolve()
					return
				}
				if (!child.stdin.destroyed) child.stdin.end('release\n')
			})
			if (diedEarly && requireAlive) {
				// The restore ran without a rescue guarantee; report it rather
				// than letting a silent degradation pass as success.
				throw new Error(
					'PostgreSQL restore guardian exited before the restore completed',
				)
			}
		},
	}
}

const POSTGRES_RESET_ZERO_FINGERPRINT_FIELDS = Object.freeze([
	'userSchemasBeyondPublic',
	'customRelations',
	'customRoutines',
	'customTypes',
	'customCollations',
	'customConversions',
	'customTextSearchParsers',
	'customTextSearchDictionaries',
	'customTextSearchTemplates',
	'customTextSearchConfigurations',
	'customOperators',
	'customOperatorClasses',
	'customOperatorFamilies',
	'customStatistics',
	'customExtensions',
	'foreignDataWrappers',
	'foreignServers',
	'foreignUserMappings',
	'eventTriggers',
	'largeObjects',
	'publications',
	'subscriptions',
	'customComments',
	'customSecurityLabels',
	'databaseDefaultAcls',
	'databaseSettings',
	'retainedSystemSecurityLabels',
	'plpgsqlRoutineComments',
	'parameterAcls',
	'prismaMigrations',
])

export function postgresRestoreResetAssertionQuery() {
	const fingerprintQuery = pristineFingerprintQuery()
		.trim()
		.replace(/;\s*$/, '')
	const zeroComparisons = POSTGRES_RESET_ZERO_FINGERPRINT_FIELDS.map(
		field => `(fingerprint.value ->> '${field}')::bigint = 0`,
	).join(' AND\n\t\t\t\t')
	return `
		WITH fingerprint(value) AS (
			${fingerprintQuery}
		)
		SELECT 1 / CASE WHEN (
			(fingerprint.value ->> 'publicSchemas')::bigint = 1 AND
			${zeroComparisons} AND
			(fingerprint.value ->> 'plpgsqlExtensions')::bigint = 1 AND
			(fingerprint.value ->> 'plpgsqlLanguages')::bigint = 1 AND
			(fingerprint.value ->> 'retainedSystemObjects')::bigint =
				:'veud_template_system_object_count'::bigint AND
			fingerprint.value ->> 'retainedSystemObjectsDigest' =
				:'veud_template_system_object_digest' AND
			fingerprint.value ->> 'retainedSystemDefinitionsDigest' =
				:'veud_template_system_definition_digest' AND
			fingerprint.value ->> 'retainedSystemCommentsDigest' =
				:'veud_template_system_comment_digest' AND
			(fingerprint.value ->> 'retainedSystemAclDrift')::bigint =
				:'veud_template_system_acl_drift'::bigint AND
			(fingerprint.value ->> 'informationSchemaAclDrift')::bigint =
				:'veud_template_information_schema_acl_drift'::bigint
		) THEN 1 ELSE 0 END
		FROM fingerprint;
	`
}

function postgresRestoreFailureRecoveryScript() {
	return `
		\\set ON_ERROR_STOP on
		ROLLBACK;
		ALTER DATABASE :"veud_expected_database" CONNECTION LIMIT -1;
		SELECT 1 / 0;
	`
}

function postgresRestoreCompletionScript() {
	return `
		SELECT 1;
		\\if :ERROR
			${postgresRestoreFailureRecoveryScript()}
		\\else
			\\set ON_ERROR_STOP on
			COMMIT;
			ALTER DATABASE :"veud_expected_database" CONNECTION LIMIT -1;
		\\endif
	`
}

async function restorePostgresBackupExclusively({
	psql,
	pgRestore,
	connection,
	identity,
	templateBaseline,
	backupPath,
	signal,
}) {
	signal?.throwIfAborted()
	await assertPostgresClientVersion(psql, 'psql', connection)
	await assertPostgresClientVersion(pgRestore, 'pg_restore', connection)
	const clientEnvironment = sanitizedPostgresClientEnvironment(connection)
	await releasePostgresRestoreConnectionFence({ psql, connection, identity })
	const guardian = await startPostgresRestoreGuardian({
		psql,
		clientEnvironment,
	})
	let restoreSessionFailed = false
	try {
		const psqlChild = spawnCrashBoundPostgresChild(
			psql,
			[
				'--no-psqlrc',
				'--set',
				'ON_ERROR_STOP=1',
				'--set',
				`veud_guardian_pid=${guardian.backendPid}`,
				'--set',
				`veud_expected_database=${identity.database}`,
				'--set',
				`veud_expected_database_oid=${identity.databaseOid}`,
				'--set',
				`veud_expected_server_start=${identity.postmasterStartedAt}`,
				'--set',
				`veud_expected_server_address=${identity.serverAddress}`,
				'--set',
				`veud_expected_server_port=${identity.serverPort}`,
				'--set',
				`veud_expected_session_user=${connection.user}`,
				'--set',
				`veud_template_system_object_count=${templateBaseline.retainedSystemObjects}`,
				'--set',
				`veud_template_system_object_digest=${templateBaseline.retainedSystemObjectsDigest}`,
				'--set',
				`veud_template_system_definition_digest=${templateBaseline.retainedSystemDefinitionsDigest}`,
				'--set',
				`veud_template_system_comment_digest=${templateBaseline.retainedSystemCommentsDigest}`,
				'--set',
				`veud_template_system_acl_drift=${templateBaseline.retainedSystemAclDrift}`,
				'--set',
				`veud_template_information_schema_acl_drift=${templateBaseline.informationSchemaAclDrift}`,
			],
			{
				env: clientEnvironment,
				stdio: ['pipe', 'inherit', 'inherit'],
			},
		)
		let restoreFinished = false
		let streamError
		psqlChild.stdin.on('error', error => {
			streamError = error
		})
		const psqlCompletion = waitForPostgresChild(
			psqlChild,
			'Exclusive PostgreSQL restore session',
		)
		const abortRestore = () => {
			psqlChild.kill('SIGTERM')
		}
		signal?.addEventListener('abort', abortRestore, { once: true })
		const prelude = `
		SELECT 1 / CASE WHEN (
			pg_catalog.current_database() = :'veud_expected_database' AND
			SESSION_USER = :'veud_expected_session_user' AND
			CURRENT_USER = :'veud_expected_session_user' AND
			(SELECT database_object.oid::text
			 FROM pg_catalog.pg_database AS database_object
			 WHERE database_object.datname = pg_catalog.current_database()) =
				:'veud_expected_database_oid' AND
			COALESCE(
				pg_catalog.host(pg_catalog.inet_server_addr()),
				'local-socket'
			) = :'veud_expected_server_address' AND
			COALESCE(pg_catalog.inet_server_port(), 0)::text =
				:'veud_expected_server_port' AND
			(
				EXTRACT(EPOCH FROM pg_catalog.pg_postmaster_start_time()) *
				1000000
			)::bigint::text = :'veud_expected_server_start' AND
			pg_catalog.current_setting('server_version_num')::integer =
				${POSTGRES_BACKUP_SERVER_VERSION_NUM}
		) THEN 1 ELSE 0 END;
		SELECT pg_catalog.format(
			'REVOKE CONNECT ON DATABASE %I FROM %s',
			pg_catalog.current_database(),
			CASE
				WHEN acl.grantee = 0 THEN 'PUBLIC'
				ELSE pg_catalog.quote_ident(role.rolname)
			END
		)
		FROM pg_catalog.pg_database AS database_object
		CROSS JOIN LATERAL pg_catalog.aclexplode(
			COALESCE(
				database_object.datacl,
				pg_catalog.acldefault('d', database_object.datdba)
			)
		) AS acl
		LEFT JOIN pg_catalog.pg_roles AS role ON role.oid = acl.grantee
		WHERE database_object.datname = pg_catalog.current_database()
		  AND acl.privilege_type = 'CONNECT'
		  AND acl.grantee <> database_object.datdba
		\\gexec
		ALTER DATABASE :"veud_expected_database" CONNECTION LIMIT 1;
		SELECT pg_catalog.pg_terminate_backend(activity.pid)
		FROM pg_catalog.pg_stat_activity AS activity
		WHERE activity.datname = pg_catalog.current_database()
		  AND activity.pid <> pg_catalog.pg_backend_pid()
		  AND activity.pid <> :veud_guardian_pid;
		SELECT 1 / CASE WHEN (
				EXISTS (
				SELECT 1
				FROM pg_catalog.pg_stat_activity AS activity
				WHERE activity.datname = pg_catalog.current_database()
				  AND activity.pid = :veud_guardian_pid
				  AND activity.usename = :'veud_expected_session_user'
			) AND
				NOT EXISTS (
				SELECT 1
				FROM pg_catalog.pg_stat_activity AS activity
				WHERE activity.datname = pg_catalog.current_database()
				  AND activity.pid <> pg_catalog.pg_backend_pid()
				  AND activity.pid <> :veud_guardian_pid
			) AND
			NOT EXISTS (
				SELECT 1
				FROM pg_catalog.pg_prepared_xacts AS prepared
					WHERE prepared.database = pg_catalog.current_database()
				) AND
				NOT EXISTS (
					SELECT 1
					FROM pg_catalog.pg_database AS database_object
					CROSS JOIN LATERAL pg_catalog.aclexplode(
						COALESCE(
							database_object.datacl,
							pg_catalog.acldefault('d', database_object.datdba)
						)
					) AS acl
					WHERE database_object.datname = pg_catalog.current_database()
					  AND acl.privilege_type = 'CONNECT'
					  AND acl.grantee <> database_object.datdba
				)
		) THEN 1 ELSE 0 END;
		BEGIN;
		DROP OWNED BY CURRENT_USER CASCADE;
		ALTER DATABASE :"veud_expected_database" RESET ALL;
		COMMENT ON DATABASE :"veud_expected_database" IS NULL;
		REVOKE ALL ON DATABASE :"veud_expected_database" FROM PUBLIC;
		GRANT TEMPORARY ON DATABASE :"veud_expected_database" TO PUBLIC;
		DROP SCHEMA IF EXISTS public CASCADE;
		CREATE SCHEMA public AUTHORIZATION CURRENT_USER;
		${postgresRestoreResetAssertionQuery()}
		\\set ON_ERROR_STOP off
	`
		psqlChild.stdin.write(prelude)

		const restoreChild = spawnCrashBoundPostgresChild(
			pgRestore,
			postgresRestoreSqlArguments(backupPath),
			{
				env: clientEnvironment,
				stdio: ['ignore', 'pipe', 'inherit'],
			},
		)
		const abortArchiveExpansion = () => restoreChild.kill('SIGTERM')
		signal?.addEventListener('abort', abortArchiveExpansion, { once: true })
		psqlChild.once('exit', () => {
			if (!restoreFinished) restoreChild.kill('SIGTERM')
		})
		restoreChild.stdout.pipe(psqlChild.stdin, { end: false })
		let archiveExpansionError
		try {
			await waitForPostgresChild(
				restoreChild,
				'PostgreSQL restore archive expansion',
			)
		} catch (error) {
			archiveExpansionError = error
		}
		restoreFinished = true
		restoreChild.stdout.unpipe(psqlChild.stdin)
		if (streamError && !archiveExpansionError)
			archiveExpansionError = streamError
		if (archiveExpansionError) {
			restoreSessionFailed = true
			if (!psqlChild.stdin.destroyed) {
				psqlChild.stdin.end(postgresRestoreFailureRecoveryScript())
			}
			try {
				await psqlCompletion
			} catch {
				// The final intentional SQL error marks a recovered restore failure.
			}
			signal?.removeEventListener('abort', abortRestore)
			signal?.removeEventListener('abort', abortArchiveExpansion)
			throw archiveExpansionError
		}
		if (!psqlChild.stdin.destroyed) {
			psqlChild.stdin.end(postgresRestoreCompletionScript())
		}
		try {
			await psqlCompletion
		} catch (error) {
			restoreSessionFailed = true
			throw error
		} finally {
			signal?.removeEventListener('abort', abortRestore)
			signal?.removeEventListener('abort', abortArchiveExpansion)
		}
	} finally {
		// The guardian must outlive the restore session on every path so a
		// crashed owner is always recoverable; release it only once the
		// session has fully completed or failed. A guardian that died early
		// means the rescue guarantee was absent and must be surfaced.
		if (restoreSessionFailed) {
			// Never let a guardian diagnostic supersede the real failure.
			await guardian.release().catch(() => {})
		} else {
			await guardian.release({ requireAlive: true })
		}
	}
}

export function assertMigrationParity(sourceMigrations, restoredMigrations) {
	const source = new Set(sourceMigrations)
	const restored = new Set(restoredMigrations)
	const missing = [...source].filter(migration => !restored.has(migration))
	const unexpected = [...restored].filter(migration => !source.has(migration))
	if (!missing.length && !unexpected.length) return
	const details = [
		missing.length ? `missing from restore: ${missing.join(', ')}` : '',
		unexpected.length ? `not present in source: ${unexpected.join(', ')}` : '',
	]
		.filter(Boolean)
		.join('; ')
	throw new Error(
		`Restored PostgreSQL migration history differs from source: ${details}`,
	)
}

export async function verifyPostgresBackup({
	backupPath,
	sourceUrl,
	verifyUrl,
	expectedUsername,
	sourcePolicy,
}) {
	const policy = parsePostgresBackupSourcePolicy(sourcePolicy)
	const archiveAttestation = attestPostgresBackupFile(
		backupPath,
		undefined,
		'PostgreSQL restore archive',
	)
	return withPrivatePostgresRestoreArchive(
		backupPath,
		archiveAttestation,
		async privateArchive => {
			const restoreArchivePath = privateArchive.path
			const source = parsePostgresConnection(sourceUrl, 'DATABASE_URL')
			const verify = parsePostgresConnection(
				verifyUrl,
				'POSTGRES_BACKUP_VERIFY_URL',
			)
			assertSafeRestoreTarget(source, verify)
			const pgRestore = command('PG_RESTORE_BIN', 'pg_restore')
			const psql = command('PSQL_BIN', 'psql')
			const sourceIdentity = await readPostgresEndpointIdentity(
				psql,
				source,
				'PostgreSQL backup source',
			)
			const restoreIdentity = await readPostgresEndpointIdentity(
				psql,
				verify,
				'PostgreSQL restore target',
			)
			assertDistinctPostgresEndpointIdentities(
				sourceIdentity,
				restoreIdentity,
				false,
			)
			const pinnedSource = pinPostgresConnectionToEndpoint(
				source,
				sourceIdentity,
			)
			const pinnedRestore = pinPostgresConnectionToEndpoint(
				verify,
				restoreIdentity,
			)
			return withPostgresRestoreLock(restoreIdentity, async ({ signal }) => {
				signal.throwIfAborted()
				const lockedSourceIdentity = await readPostgresEndpointIdentity(
					psql,
					pinnedSource,
					'Locked PostgreSQL backup source',
				)
				const lockedRestoreIdentity = await readPostgresEndpointIdentity(
					psql,
					pinnedRestore,
					'Locked PostgreSQL restore target',
				)
				assertPostgresEndpointIdentityUnchanged(
					sourceIdentity,
					lockedSourceIdentity,
					'Locked source',
				)
				assertPostgresEndpointIdentityUnchanged(
					restoreIdentity,
					lockedRestoreIdentity,
					'Locked restore target',
				)
				assertDistinctPostgresEndpointIdentities(
					lockedSourceIdentity,
					lockedRestoreIdentity,
				)
				const restoreTemplateBaseline =
					await readTrustedPostgresTemplateBaseline(
						psql,
						pinnedRestore,
						'PostgreSQL restore target',
					)
				await inspectPostgresBackup({
					backupPath: restoreArchivePath,
					connectionUrl: verifyUrl,
					connection: pinnedRestore,
				})
				let sourceFingerprint
				if (policy === PRISTINE_EMPTY_POSTGRES_SOURCE_POLICY) {
					sourceFingerprint = await readAndAssertPristinePostgresDatabase(
						psql,
						pinnedSource,
						'PostgreSQL backup source',
						'source',
					)
				}
				const sourceMigrations =
					policy === DEFAULT_POSTGRES_BACKUP_SOURCE_POLICY
						? await listAppliedMigrations(psql, pinnedSource)
						: undefined

				attestPostgresBackupFile(
					restoreArchivePath,
					privateArchive.attestation,
					'PostgreSQL restore archive private copy',
				)
				assertPrivatePostgresBackupFile(
					restoreArchivePath,
					privateArchive.attestation,
					'PostgreSQL restore archive private copy',
				)
				await restorePostgresBackupExclusively({
					psql,
					pgRestore,
					connection: pinnedRestore,
					identity: restoreIdentity,
					templateBaseline: restoreTemplateBaseline,
					backupPath: restoreArchivePath,
					signal,
				})
				assertPrivatePostgresBackupFile(
					restoreArchivePath,
					privateArchive.attestation,
					'PostgreSQL restore archive private copy',
				)
				await assertPostgresClientVersion(psql, 'psql', pinnedRestore)
				await run(
					psql,
					[
						'--no-psqlrc',
						'--set',
						'ON_ERROR_STOP=1',
						'--command',
						`SELECT 1 / CASE WHEN (
				(SELECT database_object.datconnlimit
				 FROM pg_catalog.pg_database AS database_object
				 WHERE database_object.datname = pg_catalog.current_database()) = -1
			) THEN 1 ELSE 0 END;`,
					],
					pinnedRestore,
				)
				const postRestoreIdentity = await readPostgresEndpointIdentity(
					psql,
					pinnedRestore,
					'Restored PostgreSQL target',
				)
				assertPostgresEndpointIdentityUnchanged(
					restoreIdentity,
					postRestoreIdentity,
					'Restored target',
				)
				if (
					postRestoreIdentity.otherDatabaseSessions !== 0 ||
					postRestoreIdentity.preparedTransactions !== 0
				) {
					throw new Error(
						'Restored PostgreSQL target has another session or prepared transaction',
					)
				}

				if (policy === PRISTINE_EMPTY_POSTGRES_SOURCE_POLICY) {
					const restoredFingerprint =
						await readAndAssertPristinePostgresDatabase(
							psql,
							pinnedRestore,
							'Restored PostgreSQL archive',
							'restored',
						)
					assertPristinePostgresRestoreParity(
						sourceFingerprint,
						restoredFingerprint,
					)
					return { ...PRISTINE_EMPTY_POSTGRES_SUMMARY }
				}

				const restoredMigrations = await listAppliedMigrations(
					psql,
					pinnedRestore,
				)
				assertMigrationParity(sourceMigrations, restoredMigrations)

				await assertPostgresClientVersion(psql, 'psql', pinnedRestore)
				const result = await runPostgresScript(
					psql,
					postgresVerificationScriptArguments(expectedUsername),
					pinnedRestore,
					verificationQuery(Boolean(expectedUsername)),
					true,
				)
				const [
					users,
					watchlists,
					entries,
					media,
					migrations,
					invalidFks,
					trgm,
					account,
				] = result.stdout.trim().split('|').map(Number)
				if (
					[
						users,
						watchlists,
						entries,
						media,
						migrations,
						invalidFks,
						trgm,
					].some(Number.isNaN)
				) {
					throw new Error(
						'Could not parse PostgreSQL restore verification counts',
					)
				}
				if (invalidFks !== 0)
					throw new Error('Restored PostgreSQL has invalid foreign keys')
				if (trgm !== 1)
					throw new Error('Restored PostgreSQL is missing pg_trgm')
				if (expectedUsername && account !== 1) {
					throw new Error(
						'Restored PostgreSQL does not contain BACKUP_VERIFY_USERNAME',
					)
				}
				return { users, watchlists, entries, media, migrations }
			})
		},
		'PostgreSQL restore archive',
	)
}

export async function inspectPostgresBackup({
	backupPath,
	connectionUrl,
	connection: pinnedConnection,
}) {
	const archiveAttestation = attestPostgresBackupFile(
		backupPath,
		undefined,
		'PostgreSQL inspection archive',
	)
	const connection =
		pinnedConnection ??
		parsePostgresConnection(connectionUrl, 'POSTGRES_BACKUP_VERIFY_URL')
	const pgRestore = command('PG_RESTORE_BIN', 'pg_restore')
	await assertPostgresClientVersion(pgRestore, 'pg_restore', connection)
	await run(pgRestore, ['--list', backupPath], connection, true)
	attestPostgresBackupFile(
		backupPath,
		archiveAttestation,
		'PostgreSQL inspection archive',
	)
}

export async function createPostgresBackup({
	outputPath,
	sourceUrl,
	sourcePolicy,
}) {
	const policy = parsePostgresBackupSourcePolicy(sourcePolicy)
	const source = parsePostgresConnection(sourceUrl, 'DATABASE_URL')
	const pgDump = command('PG_DUMP_BIN', 'pg_dump')
	const psql = command('PSQL_BIN', 'psql')
	await assertPostgresClientVersion(pgDump, 'pg_dump', source)
	const sourceIdentity = await readPostgresEndpointIdentity(
		psql,
		source,
		'PostgreSQL backup source',
	)
	const pinnedSource = pinPostgresConnectionToEndpoint(source, sourceIdentity)
	if (policy === PRISTINE_EMPTY_POSTGRES_SOURCE_POLICY) {
		await readAndAssertPristinePostgresDatabase(
			psql,
			pinnedSource,
			'PostgreSQL backup source',
			'source',
		)
	}
	assertPrivatePostgresBackupDirectory(
		path.dirname(outputPath),
		'PostgreSQL staged archive directory',
	)
	const outputDescriptor = fs.openSync(
		outputPath,
		fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL,
		0o600,
	)
	fs.closeSync(outputDescriptor)
	try {
		await assertPostgresClientVersion(pgDump, 'pg_dump', pinnedSource)
		await run(
			pgDump,
			[
				'--format=custom',
				'--compress=6',
				'--no-owner',
				'--no-privileges',
				'--serializable-deferrable',
				'--file',
				outputPath,
			],
			pinnedSource,
		)
	} catch (error) {
		fs.rmSync(outputPath, { force: true })
		throw error
	}
	if (policy === PRISTINE_EMPTY_POSTGRES_SOURCE_POLICY) {
		await readAndAssertPristinePostgresDatabase(
			psql,
			pinnedSource,
			'PostgreSQL backup source after pg_dump',
			'source',
		)
	}
	const postDumpIdentity = await readPostgresEndpointIdentity(
		psql,
		pinnedSource,
		'PostgreSQL backup source after pg_dump',
	)
	assertPostgresEndpointIdentityUnchanged(
		sourceIdentity,
		postDumpIdentity,
		'Backup source',
	)
	assertPrivatePostgresBackupFile(
		outputPath,
		undefined,
		'PostgreSQL staged archive',
	)
}
