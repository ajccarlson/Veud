#!/usr/bin/env bash
set -Eeuo pipefail

source "$(dirname "$0")/common.sh"

archive="${1:-}"
confirmation="${2:-}"
[[ -n "$archive" ]] ||
	die 'Usage: prepare-target.sh CATALOG_DUMP PREPARE_VEUD_PRODUCTION'
[[ "$confirmation" == 'PREPARE_VEUD_PRODUCTION' ]] ||
	die 'Type PREPARE_VEUD_PRODUCTION as the second argument'
receipt="$archive.restore-verified.json"

guard_live_storage
guard_backup_storage
load_production_environment
load_admin_environment
verify_node_22
assert_production_operations_database_identities
require_command flock
export PATH="$(dirname "$NODE_BIN"):$PG_BIN:/usr/bin:/bin"
cd "$REPO_ROOT"

assert_postgres_16_14_client() {
	local binary="$1" label="$2" version
	version="$("$binary" --version)"
	[[ "$version" =~ (^|[[:space:]])16\.14([[:space:]]|$) ]] ||
		die "$label must be exact PostgreSQL 16.14"
}

assert_postgres_16_14_client "$PSQL_BIN" psql
assert_postgres_16_14_client "$PG_RESTORE_BIN" pg_restore

restore_stage_dir="$(mktemp -d "$PRODUCTION_ROOT/run/prepare-restore.XXXXXX")"
chmod 700 "$restore_stage_dir"
staged_archive="$restore_stage_dir/archive.dump"
archive_attestation="$restore_stage_dir/archive.attestation.json"
staged_receipt="$restore_stage_dir/archive.restore-verified.json"
trap 'rm -rf -- "$restore_stage_dir"' EXIT
ARCHIVE_PATH="$archive" \
	RECEIPT_PATH="$receipt" \
	STAGED_ARCHIVE_PATH="$staged_archive" \
	ATTESTATION_PATH="$archive_attestation" \
	STAGED_RECEIPT_PATH="$staged_receipt" \
		"$NODE_BIN" --input-type=module -e '
			import fs from "node:fs"
			import path from "node:path"
			import {
			attestPostgresBackupFile,
			copyPostgresBackupToPrivatePath,
		} from "./scripts/postgres-backup-publication.mjs"
		import {
			validatePostgresBackupReceipt,
		} from "./scripts/postgres-backup-receipt.mjs"

		function readReceipt(filename) {
			const pathStat = fs.lstatSync(filename, { bigint: true })
			if (
				pathStat.isSymbolicLink() ||
				!pathStat.isFile() ||
				pathStat.size < 1n ||
				pathStat.size > 65536n
			) throw new Error("Restore receipt must be a bounded regular non-symlink file")
			const descriptor = fs.openSync(
				filename,
				fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
			)
			try {
				const before = fs.fstatSync(descriptor, { bigint: true })
				if (
					before.dev !== pathStat.dev ||
					before.ino !== pathStat.ino ||
					before.size !== pathStat.size
				) throw new Error("Restore receipt changed while it was opened")
				const content = fs.readFileSync(descriptor, "utf8")
				const after = fs.fstatSync(descriptor, { bigint: true })
				if (
					after.dev !== before.dev ||
					after.ino !== before.ino ||
					after.size !== before.size ||
					after.mtimeNs !== before.mtimeNs ||
					after.ctimeNs !== before.ctimeNs
				) throw new Error("Restore receipt changed while it was read")
				return JSON.parse(content)
			} finally {
				fs.closeSync(descriptor)
			}
		}

		const sourceAttestation = attestPostgresBackupFile(
			process.env.ARCHIVE_PATH,
			undefined,
			"Production preparation source archive",
		)
		const stagedAttestation = copyPostgresBackupToPrivatePath(
			process.env.ARCHIVE_PATH,
			process.env.STAGED_ARCHIVE_PATH,
			sourceAttestation,
			"Production preparation source archive",
		)
		const receipt = readReceipt(process.env.RECEIPT_PATH)
		validatePostgresBackupReceipt(receipt, {
			archiveName: path.basename(process.env.ARCHIVE_PATH),
			archiveAttestation: stagedAttestation,
		})
		if (
			receipt.version !== 2 ||
			receipt.checks.sourcePolicy !== "migrated-veud-v1" ||
			receipt.sourceTarget !== "127.0.0.1:5433/veud_staging" ||
			receipt.restoreTarget !== "127.0.0.1:5433/veud_staging_restore"
		) {
			throw new Error(
				"Production preparation requires the exact migrated, restore-tested staging archive",
			)
		}
		fs.writeFileSync(
			process.env.ATTESTATION_PATH,
			`${JSON.stringify(stagedAttestation)}\n`,
			{ mode: 0o600 },
		)
		fs.writeFileSync(
			process.env.STAGED_RECEIPT_PATH,
			`${JSON.stringify(receipt)}\n`,
			{ mode: 0o600 },
		)
	'

assert_staged_archive() {
	STAGED_ARCHIVE_PATH="$staged_archive" \
		ATTESTATION_PATH="$archive_attestation" \
		"$NODE_BIN" --input-type=module -e '
			import fs from "node:fs"
			import {
				assertPrivatePostgresBackupFile,
			} from "./scripts/postgres-backup-publication.mjs"
			const expected = JSON.parse(
				fs.readFileSync(process.env.ATTESTATION_PATH, "utf8"),
			)
			assertPrivatePostgresBackupFile(
				process.env.STAGED_ARCHIVE_PATH,
				expected,
				"Production preparation private archive",
			)
		'
}
archive="$staged_archive"
receipt="$staged_receipt"

# This command is only for preparing the never-activated production target.
# Once an immutable release exists, every schema mutation must use the regular
# catalog cutover state machine.
cutover_acquire_deployment_lock \
	"$PRODUCTION_ROOT/run/catalog-release-deploy.lock" \
	'Another production catalog deployment is already running'
for cutover_state in \
	"$PRODUCTION_ROOT/run/catalog-release-preparation.state" \
	"$PRODUCTION_ROOT/run/catalog-release-maintenance.state" \
	"$PRODUCTION_ROOT/run/catalog-release-emergency-block.state"; do
	[[ ! -e "$cutover_state" && ! -L "$cutover_state" ]] ||
		die "Production target preparation is blocked by cutover state: $cutover_state"
done
[[ ! -e "$APP_ROOT" && ! -L "$APP_ROOT" ]] ||
	die 'Production target preparation is forbidden after an application release has been activated'

assert_application_is_not_using_production_target() {
	local configured_url=''
	[[ -f "$APPLICATION_CONFIG_FILE" ]] || return 0
	configured_url="$(
		unset DATABASE_URL
		set -a
		# shellcheck disable=SC1090
		source "$APPLICATION_CONFIG_FILE"
		set +a
		printf '%s' "${DATABASE_URL:-}"
	)"
	if DATABASE_URL="$configured_url" "$NODE_BIN" --input-type=module -e '
		import { assertProductionDatabaseUrl } from "./scripts/production-environment-utils.mjs"
		try {
			assertProductionDatabaseUrl(process.env.DATABASE_URL)
		} catch {
			process.exit(1)
		}
	'; then
		die 'Production target preparation is forbidden while the live application configuration selects this database'
	fi
}

assert_application_is_not_using_production_target
exec 6>"$PRODUCTION_ROOT/run/catalog-writer-lifetime.lock"
flock --exclusive 6
[[ ! -e "$APP_ROOT" && ! -L "$APP_ROOT" ]] ||
	die 'An application release became active while preparing the production target'
assert_application_is_not_using_production_target

assert_staged_archive
"$PG_RESTORE_BIN" --list "$archive" >/dev/null

DATABASE_URL="$DATABASE_URL" "$NODE_BIN" --input-type=module -e '
	import { assertProductionDatabaseUrl } from "./scripts/production-environment-utils.mjs"
	try {
		assertProductionDatabaseUrl(process.env.DATABASE_URL)
	} catch {
		console.error("Refusing to prepare an unexpected production target")
		process.exit(1)
	}
'

production_app_password="${DATABASE_URL#*veud_production_app:}"
production_app_password="${production_app_password%%@*}"
[[ "$production_app_password" =~ ^[0-9a-f]{64}$ ]] ||
	die 'Production PostgreSQL URL must retain its generated hexadecimal password'

postgres_ambient_variables=(
	PGHOST
	PGHOSTADDR
	PGPORT
	PGDATABASE
	PGUSER
	PGPASSWORD
	PGPASSFILE
	PGSERVICE
	PGSERVICEFILE
	PGOPTIONS
	PGAPPNAME
	PGCONNECT_TIMEOUT
	PGCLIENTENCODING
	PGTARGETSESSIONATTRS
	PGLOADBALANCEHOSTS
	PGSSLMODE
	PGREQUIRESSL
	PGSSLCERT
	PGSSLKEY
	PGSSLROOTCERT
	PGSSLCRL
	PGSSLCRLDIR
	PGSSLSNI
	PGREQUIREAUTH
	PGCHANNELBINDING
	PGGSSENCMODE
	PGKRBSRVNAME
	PGGSSLIB
	PGSYSCONFDIR
	PG_COLOR
)

run_production_psql() (
	local user="$1" password="$2" database="$3" variable
	shift 3
	for variable in "${postgres_ambient_variables[@]}"; do
		unset "$variable"
	done
	export PGHOST=127.0.0.1
	export PGHOSTADDR=127.0.0.1
	export PGPORT=5433
	export PGUSER="$user"
	export PGPASSWORD="$password"
	export PGDATABASE="$database"
	export PGAPPNAME=veud-production-target-preparation
	export PGCONNECT_TIMEOUT=10
	"$PSQL_BIN" --no-psqlrc "$@"
)

run_production_pg_restore() (
	local variable
	for variable in "${postgres_ambient_variables[@]}"; do
		unset "$variable"
	done
	export PGHOST=127.0.0.1
	export PGHOSTADDR=127.0.0.1
	export PGPORT=5433
	export PGUSER="$PGADMINUSER"
	export PGPASSWORD="$PGADMINPASSWORD"
	export PGDATABASE=veud_production
	export PGAPPNAME=veud-production-target-preparation
	export PGCONNECT_TIMEOUT=10
	"$PG_RESTORE_BIN" "$@"
)

run_without_ambient_postgres() (
	local variable
	for variable in "${postgres_ambient_variables[@]}"; do
		unset "$variable"
	done
	"$@"
)

# Fence ordinary connections before the destructive reset. The admin role can
# still restore while the target remains at connection limit zero.
run_production_psql \
	"$PGADMINUSER" \
	"$PGADMINPASSWORD" \
	postgres \
	--set=ON_ERROR_STOP=1 \
	--quiet \
	--command='ALTER DATABASE veud_production CONNECTION LIMIT 0' \
	--command="
		SELECT pg_catalog.pg_terminate_backend(activity.pid)
		FROM pg_catalog.pg_stat_activity AS activity
		WHERE activity.datname = 'veud_production'
		  AND activity.pid <> pg_catalog.pg_backend_pid();
	" \
	--command="
		SELECT 1 / CASE WHEN (
			(SELECT database_object.datconnlimit = 0
			 FROM pg_catalog.pg_database AS database_object
			 WHERE database_object.datname = 'veud_production') AND
			NOT EXISTS (
				SELECT 1
				FROM pg_catalog.pg_stat_activity AS activity
				WHERE activity.datname = 'veud_production'
			) AND
			NOT EXISTS (
				SELECT 1
				FROM pg_catalog.pg_prepared_xacts AS prepared
				WHERE prepared.database = 'veud_production'
			)
		) THEN 1 ELSE 0 END;
	" \
	>/dev/null

target_identity="$(
	run_production_psql \
		"$PGADMINUSER" \
		"$PGADMINPASSWORD" \
		veud_production \
		--set=ON_ERROR_STOP=1 \
		--tuples-only \
		--no-align \
		--command="
			SELECT
				database_object.oid::text || '|' ||
				COALESCE(pg_catalog.inet_server_addr()::text, 'local-socket') || '|' ||
				COALESCE(pg_catalog.inet_server_port(), 0)::text || '|' ||
				(
					EXTRACT(EPOCH FROM pg_catalog.pg_postmaster_start_time()) *
					1000000
				)::bigint::text || '|' ||
				pg_catalog.current_setting('server_version_num') || '|' ||
				pg_catalog.session_user || '|' ||
				pg_catalog.current_user || '|' ||
				pg_catalog.pg_get_userbyid(database_object.datdba) || '|' ||
				database_object.datconnlimit::text
			FROM pg_catalog.pg_database AS database_object
			WHERE database_object.datname = pg_catalog.current_database();
		"
)"
IFS='|' read -r \
	target_database_oid \
	target_server_address \
	target_server_port \
	target_server_start \
	target_server_version \
	target_session_user \
	target_current_user \
	target_database_owner \
	target_connection_limit <<<"$target_identity"
[[ "$target_database_oid" =~ ^[0-9]+$ &&
	"$target_server_address" == 127.0.0.1 &&
	"$target_server_port" == 5433 &&
	"$target_server_start" =~ ^[0-9]+$ &&
	"$target_server_version" == 160014 &&
	"$target_session_user" == "$PGADMINUSER" &&
	"$target_current_user" == "$PGADMINUSER" &&
	"$target_database_owner" == veud_production_app &&
	"$target_connection_limit" == 0 ]] ||
	die 'Production target identity could not be established before reset'

assert_staged_archive
run_production_psql \
	"$PGADMINUSER" \
	"$PGADMINPASSWORD" \
	veud_production \
	--set=ON_ERROR_STOP=1 \
	--set="veud_expected_database_oid=$target_database_oid" \
	--set="veud_expected_server_address=$target_server_address" \
	--set="veud_expected_server_port=$target_server_port" \
	--set="veud_expected_server_start=$target_server_start" \
	--set="veud_expected_session_user=$PGADMINUSER" \
	--command="
		SELECT 1 / CASE WHEN (
			pg_catalog.current_database() = 'veud_production' AND
			pg_catalog.session_user = :'veud_expected_session_user' AND
			pg_catalog.current_user = :'veud_expected_session_user' AND
			(SELECT database_object.oid::text
			 FROM pg_catalog.pg_database AS database_object
			 WHERE database_object.datname = pg_catalog.current_database()) =
				:'veud_expected_database_oid' AND
			(SELECT pg_catalog.pg_get_userbyid(database_object.datdba)
			 FROM pg_catalog.pg_database AS database_object
			 WHERE database_object.datname = pg_catalog.current_database()) =
				'veud_production_app' AND
			(SELECT database_object.datconnlimit
			 FROM pg_catalog.pg_database AS database_object
			 WHERE database_object.datname = pg_catalog.current_database()) = 0 AND
			COALESCE(
				pg_catalog.inet_server_addr()::text,
				'local-socket'
			) = :'veud_expected_server_address' AND
			COALESCE(pg_catalog.inet_server_port(), 0)::text =
				:'veud_expected_server_port' AND
			(
				EXTRACT(EPOCH FROM pg_catalog.pg_postmaster_start_time()) *
				1000000
			)::bigint::text = :'veud_expected_server_start' AND
			pg_catalog.current_setting('server_version_num')::integer = 160014 AND
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
		SET ROLE veud_production_app;
		SELECT 1 / CASE WHEN pg_catalog.current_user =
			'veud_production_app' THEN 1 ELSE 0 END;
	"

# Capture the exact database properties before the drop so the recreated
# database is byte-for-byte policy identical rather than inheriting whatever
# the cluster default happens to be.
target_database_properties="$(
	run_production_psql \
		"$PGADMINUSER" \
		"$PGADMINPASSWORD" \
		postgres \
		--set=ON_ERROR_STOP=1 \
		--tuples-only \
		--no-align \
		--command="
			SELECT
				pg_catalog.pg_encoding_to_char(database_object.encoding) || '|' ||
				database_object.datcollate || '|' ||
				database_object.datctype || '|' ||
				database_object.datlocprovider
			FROM pg_catalog.pg_database AS database_object
			WHERE database_object.datname = 'veud_production';
		"
)"
IFS='|' read -r \
	target_encoding \
	target_collate \
	target_ctype \
	target_locale_provider <<<"$target_database_properties"
[[ "$target_encoding" == UTF8 &&
	-n "$target_collate" &&
	-n "$target_ctype" ]] ||
	die 'Production target database properties could not be established'
# Recreating an ICU database as libc would silently change collation for every
# text index, so only the provider this profile creates is supported.
[[ "$target_locale_provider" == c ]] ||
	die 'Production target uses a non-libc locale provider; recreation would change collation semantics'

# A public-schema reset leaves non-public schemas, extensions, large objects,
# publications, subscriptions, and foreign-owned residue behind. Recreate the
# whole database from template0 instead. DROP/CREATE DATABASE cannot run in a
# transaction block, so each statement is issued separately and is retry safe:
# a previous interrupted attempt may already have dropped the database.
run_production_psql \
	"$PGADMINUSER" \
	"$PGADMINPASSWORD" \
	postgres \
	--set=ON_ERROR_STOP=1 \
	--quiet \
	--command="DROP DATABASE IF EXISTS veud_production WITH (FORCE)" \
	--command="
		CREATE DATABASE veud_production
			OWNER veud_production_app
			TEMPLATE template0
			ENCODING '$target_encoding'
			LC_COLLATE '$target_collate'
			LC_CTYPE '$target_ctype'
			CONNECTION LIMIT 0;
	" \
	--command="REVOKE ALL ON DATABASE veud_production FROM PUBLIC" \
	--command="GRANT TEMPORARY ON DATABASE veud_production TO PUBLIC" \
	--command="
		SELECT 1 / CASE WHEN (
			(SELECT database_object.datconnlimit = 0 AND
				pg_catalog.pg_get_userbyid(database_object.datdba) =
					'veud_production_app' AND
				pg_catalog.pg_encoding_to_char(database_object.encoding) =
					'$target_encoding' AND
				database_object.datcollate = '$target_collate' AND
				database_object.datctype = '$target_ctype' AND
				database_object.datlocprovider = '$target_locale_provider' AND
				NOT database_object.datistemplate
			 FROM pg_catalog.pg_database AS database_object
			 WHERE database_object.datname = 'veud_production') AND
			NOT EXISTS (
				SELECT 1
				FROM pg_catalog.pg_stat_activity AS activity
				WHERE activity.datname = 'veud_production'
			)
		) THEN 1 ELSE 0 END;
	" \
	>/dev/null

# The recreated database has a fresh OID; re-pin the identity used by every
# later assertion.
target_database_oid="$(
	run_production_psql \
		"$PGADMINUSER" \
		"$PGADMINPASSWORD" \
		postgres \
		--set=ON_ERROR_STOP=1 \
		--tuples-only \
		--no-align \
		--command="
			SELECT database_object.oid::text
			FROM pg_catalog.pg_database AS database_object
			WHERE database_object.datname = 'veud_production';
		"
)"
[[ "$target_database_oid" =~ ^[0-9]+$ ]] ||
	die 'Recreated production target OID could not be established'

# template0 already carries a public schema owned by pg_database_owner. Take
# exact application ownership and deny PUBLIC so the schema policy matches the
# previous reset rather than the template default.
run_production_psql \
	"$PGADMINUSER" \
	"$PGADMINPASSWORD" \
	veud_production \
	--set=ON_ERROR_STOP=1 \
	--quiet \
	--command="
		CREATE SCHEMA IF NOT EXISTS public;
		ALTER SCHEMA public OWNER TO veud_production_app;
		REVOKE ALL ON SCHEMA public FROM PUBLIC;
		SELECT 1 / CASE WHEN (
			(SELECT pg_catalog.pg_get_userbyid(namespace_object.nspowner) =
				'veud_production_app'
			 FROM pg_catalog.pg_namespace AS namespace_object
			 WHERE namespace_object.nspname = 'public')
		) THEN 1 ELSE 0 END;
	" \
	>/dev/null

assert_postgres_16_14_client "$PG_RESTORE_BIN" pg_restore
assert_staged_archive
run_production_pg_restore \
	--exit-on-error \
	--no-owner \
	--no-privileges \
	--role=veud_production_app \
	--dbname=veud_production \
	"$archive"
assert_staged_archive

# Reject any object the migrated application schema does not own. A restore
# from a tampered or foreign archive can otherwise leave extra schemas,
# extensions, large objects, replication objects, or foreign-owned residue in
# the production database while every count-based check still passes.
run_production_psql \
	"$PGADMINUSER" \
	"$PGADMINPASSWORD" \
	veud_production \
	--set=ON_ERROR_STOP=1 \
	--quiet \
	--command="
		SELECT 1 / CASE WHEN (
			NOT EXISTS (
				SELECT 1 FROM pg_catalog.pg_namespace AS namespace_object
				WHERE namespace_object.nspname NOT IN (
					'public', 'information_schema'
				) AND namespace_object.nspname NOT LIKE 'pg\\_%'
			) AND
			NOT EXISTS (
				SELECT 1 FROM pg_catalog.pg_extension AS extension_object
				WHERE extension_object.extname NOT IN ('plpgsql', 'pg_trgm')
			) AND
			NOT EXISTS (SELECT 1 FROM pg_catalog.pg_largeobject_metadata) AND
			NOT EXISTS (SELECT 1 FROM pg_catalog.pg_publication) AND
			NOT EXISTS (SELECT 1 FROM pg_catalog.pg_subscription) AND
			NOT EXISTS (SELECT 1 FROM pg_catalog.pg_foreign_data_wrapper) AND
			NOT EXISTS (SELECT 1 FROM pg_catalog.pg_foreign_server) AND
			NOT EXISTS (SELECT 1 FROM pg_catalog.pg_user_mapping) AND
			NOT EXISTS (SELECT 1 FROM pg_catalog.pg_foreign_table) AND
			NOT EXISTS (SELECT 1 FROM pg_catalog.pg_event_trigger) AND
			-- The restore runs with SET ROLE veud_production_app, so an archive
			-- can plant APP-OWNED objects that an ownership filter alone would
			-- accept. Enumerate the object classes the migrated schema is
			-- allowed to contain instead, mirroring the pristine fingerprint.
			NOT EXISTS (
				SELECT 1 FROM pg_catalog.pg_proc AS routine
				JOIN pg_catalog.pg_namespace AS namespace_object
					ON namespace_object.oid = routine.pronamespace
				WHERE namespace_object.nspname = 'public'
				  AND NOT EXISTS (
					SELECT 1 FROM pg_catalog.pg_depend AS dependency
					WHERE dependency.classid =
						'pg_catalog.pg_proc'::pg_catalog.regclass
					  AND dependency.objid = routine.oid
					  AND dependency.deptype = 'e'
				)
			) AND
			-- Ordinary tables and their indexes are the relation kinds the
			-- migrated schema contains; views, materialized views, standalone
			-- sequences, and partitioned tables are all app-ownable and would
			-- otherwise pass the ownership filter untouched. Sequences owned by
			-- a public table (SERIAL / GENERATED AS IDENTITY) are legitimate
			-- schema, so a future autoincrement migration must not hard-fail a
			-- cutover after the restore has already run.
			NOT EXISTS (
				SELECT 1 FROM pg_catalog.pg_class AS relation
				JOIN pg_catalog.pg_namespace AS namespace_object
					ON namespace_object.oid = relation.relnamespace
				WHERE namespace_object.nspname = 'public'
				  AND relation.relkind NOT IN ('r', 'i')
				  AND NOT (
					relation.relkind = 'S' AND EXISTS (
						SELECT 1 FROM pg_catalog.pg_depend AS ownership
						JOIN pg_catalog.pg_class AS owner_relation
							ON owner_relation.oid = ownership.refobjid
						JOIN pg_catalog.pg_namespace AS owner_namespace
							ON owner_namespace.oid = owner_relation.relnamespace
						WHERE ownership.classid =
							'pg_catalog.pg_class'::pg_catalog.regclass
						  AND ownership.objid = relation.oid
						  AND ownership.deptype IN ('a', 'i')
						  AND owner_namespace.nspname = 'public'
						  AND owner_relation.relkind = 'r'
					)
				)
				  AND NOT EXISTS (
					SELECT 1 FROM pg_catalog.pg_depend AS dependency
					WHERE dependency.classid =
						'pg_catalog.pg_class'::pg_catalog.regclass
					  AND dependency.objid = relation.oid
					  AND dependency.deptype = 'e'
				)
			) AND
			NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy) AND
			NOT EXISTS (
				SELECT 1 FROM pg_catalog.pg_rewrite AS rule_object
				JOIN pg_catalog.pg_class AS relation
					ON relation.oid = rule_object.ev_class
				JOIN pg_catalog.pg_namespace AS namespace_object
					ON namespace_object.oid = relation.relnamespace
				WHERE namespace_object.nspname = 'public'
				  AND rule_object.rulename <> '_RETURN'
			) AND
			NOT EXISTS (
				SELECT 1 FROM pg_catalog.pg_trigger AS trigger_object
				WHERE NOT trigger_object.tgisinternal
			) AND
			NOT EXISTS (
				SELECT 1 FROM pg_catalog.pg_statistic_ext
			) AND
			NOT EXISTS (
				SELECT 1 FROM pg_catalog.pg_default_acl
			) AND
			NOT EXISTS (
				SELECT 1 FROM pg_catalog.pg_db_role_setting AS setting
				JOIN pg_catalog.pg_database AS database_object
					ON database_object.oid = setting.setdatabase
				WHERE database_object.datname = pg_catalog.current_database()
			) AND
			NOT EXISTS (
				SELECT 1 FROM pg_catalog.pg_namespace AS namespace_object
				WHERE namespace_object.nspname LIKE 'pg\\_%'
				  AND namespace_object.nspname NOT IN (
					'pg_catalog', 'pg_toast'
				)
			) AND
			NOT EXISTS (
				SELECT 1 FROM pg_catalog.pg_class AS relation
				JOIN pg_catalog.pg_namespace AS namespace_object
					ON namespace_object.oid = relation.relnamespace
				WHERE namespace_object.nspname = 'public'
				  AND pg_catalog.pg_get_userbyid(relation.relowner) <>
					'veud_production_app'
				  AND NOT EXISTS (
					SELECT 1 FROM pg_catalog.pg_depend AS dependency
					WHERE dependency.classid =
						'pg_catalog.pg_class'::pg_catalog.regclass
					  AND dependency.objid = relation.oid
					  AND dependency.deptype = 'e'
				)
			) AND
			NOT EXISTS (
				SELECT 1 FROM pg_catalog.pg_proc AS routine
				JOIN pg_catalog.pg_namespace AS namespace_object
					ON namespace_object.oid = routine.pronamespace
				WHERE namespace_object.nspname = 'public'
				  AND pg_catalog.pg_get_userbyid(routine.proowner) <>
					'veud_production_app'
				  AND NOT EXISTS (
					SELECT 1 FROM pg_catalog.pg_depend AS dependency
					WHERE dependency.classid =
						'pg_catalog.pg_proc'::pg_catalog.regclass
					  AND dependency.objid = routine.oid
					  AND dependency.deptype = 'e'
				)
			) AND
			(SELECT pg_catalog.pg_get_userbyid(namespace_object.nspowner) =
				'veud_production_app'
			 FROM pg_catalog.pg_namespace AS namespace_object
			 WHERE namespace_object.nspname = 'public')
		) THEN 1 ELSE 0 END;
	" \
	>/dev/null

run_production_psql \
	"$PGADMINUSER" \
	"$PGADMINPASSWORD" \
	postgres \
	--set=ON_ERROR_STOP=1 \
	--command='ALTER DATABASE veud_production CONNECTION LIMIT -1'
unset PGADMINPASSWORD

run_without_ambient_postgres npm run db:migrate:postgres
run_without_ambient_postgres npm run db:verify:postgres

restored_summary="$(run_production_psql \
	veud_production_app \
	"$production_app_password" \
	veud_production \
	--set=ON_ERROR_STOP=1 \
	--tuples-only \
	--no-align \
	--command="
		SELECT
			(SELECT COUNT(*) FROM \"User\")::text || '|' ||
			(SELECT COUNT(*) FROM \"Watchlist\")::text || '|' ||
			(SELECT COUNT(*) FROM \"Entry\")::text || '|' ||
			(SELECT COUNT(*) FROM \"Media\")::text || '|' ||
			(SELECT COUNT(*) FROM \"_prisma_migrations\"
			 WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::text || '|' ||
			(SELECT COUNT(*) FROM pg_constraint
			 WHERE contype = 'f' AND NOT convalidated)::text || '|' ||
			(SELECT COUNT(*) FROM pg_extension WHERE extname = 'pg_trgm')::text;
	")"
printf '%s\n' "$restored_summary"
RESTORED_SUMMARY="$restored_summary" RECEIPT_PATH="$receipt" \
	"$NODE_BIN" --input-type=module -e '
		import fs from "node:fs"
		const receipt = JSON.parse(fs.readFileSync(process.env.RECEIPT_PATH, "utf8"))
		const [users, watchlists, entries, media, migrations, invalidFks, trgm] =
			process.env.RESTORED_SUMMARY.trim().split("|").map(Number)
		const expected = receipt.summary
		if (
			users !== expected.users ||
			watchlists !== expected.watchlists ||
			entries !== expected.entries ||
			media !== expected.media ||
			migrations < expected.migrations ||
			invalidFks !== 0 ||
			trgm !== 1
		) {
			throw new Error("Prepared production counts do not match the verified source receipt")
		}
	'

run_without_ambient_postgres npm run db:backup:postgres
printf 'Prepared, migration-verified, backup-restored, and offsite-protected %s.\n' \
	"$(production_database_identity)"
